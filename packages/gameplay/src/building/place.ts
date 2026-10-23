/**
 * Placement: snapping (grid cells, socket/edge snapping for walls and openings, free placement for furniture/decor),
 * validation in a fixed order (first failure wins, BuildFail), and the authoritative place. The same snap + validate
 * runs on the client for the ghost preview (client mode skips server-only stability values and uses "has support").
 *
 * Validation order: UnknownPiece, BadTier, LevelLimit, OutOfRange, NoPrivilege, ZoneFull, Terrain, Occupied,
 * NoSocket, Blocked, NoSupport, CannotAfford.
 */
import { entityIndex, Membership, Transform, type Entity, type World } from "@engine/core";
/** BuildPiece.tint for a clan: 1..255 index into assets clanPalettes (ADR-077). */
export const clanTintIndex = (clanId: number): number => clanId ? 1 + ((clanId - 1) % 255) : 0;
import { installSpatialIndex, SUBTILE } from "@engine/world";
import {
  AttachKind, BuildPiece, Container, ContainerViewers, CraftingStation, DoorState, EdgeSide, Emitter, Fuel, Health,
  PieceLink, PieceStability, PrivilegeZone, Tribe, Zombie,
} from "../components.js";
import { gameplayDefs, isAuthority, rangeSlack } from "../config.js";
import { Placement, SocketKind, StationKind, type GameDefs, type ItemCount, type PieceDef } from "../defs.js";
import { BuildFail, emit, PiecePlaced } from "../events.js";
import { countItem, exchangeItems } from "../inventory.js";
import { emitterSpecs } from "../realism.js";
import { makeNoise } from "../systems/noise.js";
import { TerrainRes } from "../world.js";
import { linkAttachment } from "./links.js";
import { anchorFor, gridRot, LAYER_OPENING, markLinked, slotTransform, structures, type Slot, type StructureIndex } from "./structure.js";
import { Falloff } from "@engine/world";
import { indexEntity } from "../spawn.js";
import { tillSlots } from "../economy/config.js";
import { assignStallOwner, canPlaceStall } from "../economy/stall.js";
import { Listings, StallHeader, StallLedger, StallSign } from "../components.js";

export interface PlaceRequest { piece: number; x: number; y: number; level: number; rot: number; tier: number; variant: number }
export interface Snapped { def: PieceDef; slot: Slot; parent: Entity | 0; pos: { x: number; y: number; z: number; facing: number }; tier: number; variant: number }

export function maxHp(defs: GameDefs, def: PieceDef, tier: number): number {
  return def.tiered ? Math.min(0xffff, Math.round(def.hp * (defs.tiers[tier]?.hpMul ?? 1))) : Math.min(0xffff, def.hp);
}
/** Build cost: tier cost x costScale (tiered) or the piece's own cost. */
export function pieceCost(defs: GameDefs, def: PieceDef, tier: number, scale = 1): ItemCount[] {
  const base = def.tiered ? (defs.tiers[tier]?.cost ?? []).map((c) => ({ item: c.item, count: c.count * def.costScale })) : def.cost.map((c) => ({ item: c.resource, count: c.amount }));
  return base.map((c) => ({ item: c.item, count: Math.ceil(c.count * scale - 1e-9) })).filter((c) => c.count > 0);
}

/** Nearest edge to (x,y): socket snapping (deck EDGE sockets) first, else geometric nearest edge of the tile. */
export function snapEdge(idx: StructureIndex, x: number, y: number, z: number): { tx: number; ty: number; side: EdgeSide } {
  const s = idx.grid.snap(x * SUBTILE, y * SUBTILE, z, { kind: SocketKind.Edge, maxDist: SUBTILE });
  if (s) {
    if (s.sy % SUBTILE === 0) return { tx: Math.floor(s.sx / SUBTILE), ty: s.sy / SUBTILE, side: EdgeSide.North };
    return { tx: s.sx / SUBTILE, ty: Math.floor(s.sy / SUBTILE), side: EdgeSide.West };
  }
  const tx = Math.floor(x), ty = Math.floor(y), fx = x - tx, fy = y - ty;
  const c: [number, number, number, EdgeSide][] = [[fy, tx, ty, EdgeSide.North], [1 - fy, tx, ty + 1, EdgeSide.North], [fx, tx, ty, EdgeSide.West], [1 - fx, tx + 1, ty, EdgeSide.West]];
  c.sort((a, b) => a[0] - b[0] || a[3] - b[3]);
  const [, ex, ey, side] = c[0]!; return { tx: ex, ty: ey, side };
}

export function snapPlacement(world: World, req: PlaceRequest): Snapped | BuildFail {
  const defs = gameplayDefs(world); const def = defs.pieces.get(req.piece);
  if (!def) return BuildFail.UnknownPiece;
  const tier = def.tiered ? req.tier : def.fixedTier;
  if (def.tiered && !(tier >= 0 && tier < defs.tiers.length)) return BuildFail.BadTier;
  const variant = req.variant < def.variants ? req.variant : 0;
  const idx = structures(world); const z = req.level; const lh = defs.building.levelHeight;
  let slot: Slot; let parent: Entity | 0 = 0; let px: number | undefined, py: number | undefined;
  switch (def.placement) {
    case Placement.Cell: { const r = req.rot & 3; const [tx, ty] = anchorFor(def, req.x, req.y, r); slot = { tx, ty, z, side: EdgeSide.None, rot: r }; break; }
    case Placement.Free: {
      const step = defs.building.freeSnapSubtiles / SUBTILE; px = Math.round(req.x / step) * step; py = Math.round(req.y / step) * step;
      const rot = req.rot % defs.building.freeRotSteps; const [tx, ty] = anchorFor(def, px, py, gridRot(def, rot));
      slot = { tx, ty, z, side: EdgeSide.None, rot }; break;
    }
    case Placement.Edge: { const e = snapEdge(idx, req.x, req.y, z); slot = { ...e, z, rot: (e.side === EdgeSide.West ? 1 : 0) | (req.rot & 2) }; break; }
    case Placement.Opening: {
      if (def.fits === SocketKind.Hatch) {
        const tx = Math.floor(req.x), ty = Math.floor(req.y); slot = { tx, ty, z, side: EdgeSide.None, rot: 0 };
        parent = idx.deck(tx, ty, z);
      } else {
        const e = snapEdge(idx, req.x, req.y, z); slot = { ...e, z, rot: (e.side === EdgeSide.West ? 1 : 0) | (req.rot & 2) };
        parent = idx.edge(e.tx, e.ty, z, e.side);
      }
      break;
    }
  }
  const pos = slotTransform(def, slot, lh, px, py);
  if (def.placement === Placement.Opening && parent && def.fits !== SocketKind.Hatch) { const t = world.get(parent, Transform); if (t) { pos.x = t.x; pos.y = t.y; } }
  if (def.placement === Placement.Opening && def.fits === SocketKind.Hatch) { pos.x = slot.tx + 0.5; pos.y = slot.ty + 0.5; }
  return { def, slot, parent, pos, tier, variant };
}

export const tribeOf = (world: World, e: Entity): number => world.getField(e, Tribe, "id") ?? 0;
export const MAX_PRIVILEGE_RADIUS = 16;
/** Privilege zones (claim pieces) covering (x,y). */
export function zonesAt(world: World, x: number, y: number, extra = 0): Entity[] {
  const out: Entity[] = [];
  for (const z of installSpatialIndex(world).queryRadius(x, y, MAX_PRIVILEGE_RADIUS + extra)) {
    const r = world.getField(z, PrivilegeZone, "radius"); if (r === undefined) continue;
    const t = world.get(z, Transform)!; if (Math.hypot(t.x - x, t.y - y) <= r + extra) out.push(z);
  }
  return out.sort((a, b) => a - b);
}
/** Builder may modify at (x,y): no foreign zone covers it. */
export function hasPrivilege(world: World, builder: Entity, x: number, y: number): boolean {
  const tribe = tribeOf(world, builder);
  return zonesAt(world, x, y).every((z) => world.getField(z, PrivilegeZone, "tribe") === tribe && tribe !== 0);
}

/** Candidate stability of a hypothetical placement (server: real values; client: 100 if any support exists). */
export function candidateStability(world: World, sn: Snapped): number {
  const defs = gameplayDefs(world); const idx = structures(world);
  const { root, list } = idx.supportsAt(sn.def, sn.slot, sn.parent);
  if (root) return defs.building.groundStability;
  const tier = defs.tiers[sn.tier] ?? defs.tiers[1]!;
  let best = 0;
  for (const [s, kind] of list) {
    const v = isAuthority(world) ? world.getField(s, PieceStability, "value") ?? 0 : defs.building.groundStability;
    best = Math.max(best, v - (kind === 1 ? tier.vertLoss : kind === 2 ? tier.horizLoss : 0));
  }
  return best;
}

export function validatePlacement(world: World, builder: Entity, sn: Snapped, opts: { ignoreCost?: boolean; ignoreRange?: boolean } = {}): BuildFail | 0 {
  const defs = gameplayDefs(world); const b = defs.building; const idx = structures(world); const { def, slot } = sn;
  if (slot.z > b.maxLevel || slot.z < def.minLevel || (def.groundOnly && slot.z !== 0)) return BuildFail.LevelLimit;
  const bt = world.get(builder, Transform);
  if (!opts.ignoreRange && bt && Math.hypot(bt.x - sn.pos.x, bt.y - sn.pos.y) > b.buildReach + rangeSlack(world, builder)) return BuildFail.OutOfRange;
  // privilege: foreign zones block; a claim also may not overlap a foreign zone and needs a tribe
  const tribe = tribeOf(world, builder);
  const zones = zonesAt(world, sn.pos.x, sn.pos.y, def.privilegeRadius);
  if (zones.some((z) => world.getField(z, PrivilegeZone, "tribe") !== tribe) || (def.privilegeRadius > 0 && tribe === 0)) return BuildFail.NoPrivilege;
  // stalls: clanOnly needs a clan; core land claims (economy.claims) via the stall place permission rule
  if (def.stall && !canPlaceStall(world, builder, sn.pos.x, sn.pos.y, def.stall.clanOnly)) return BuildFail.NoPrivilege;
  const own = zonesAt(world, sn.pos.x, sn.pos.y)[0];
  if (own !== undefined && (idx.zoneCounts.get(own) ?? 0) >= b.maxPiecesPerZone) return BuildFail.ZoneFull;
  // terrain for ground-level pieces
  const tiles = def.placement === Placement.Cell || def.placement === Placement.Free ? idx.grid.footprintTiles(def.id, slot.tx, slot.ty, gridRot(def, slot.rot)) : [];
  const terrain = world.getResource(TerrainRes);
  const onGround = slot.z === 0 && (def.groundOnly || (def.ground && !tiles.some(([x, y]) => idx.isDeck(idx.deck(x, y, 0)))));
  if (terrain && onGround) {
    let lo = Infinity, hi = -Infinity;
    for (const [x, y] of tiles) {
      if (defs.worldgen.unbuildableTiles.has(terrain.tileAt(x, y))) return BuildFail.Terrain;
      const h = terrain.heightAt(x, y); lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (hi - lo > b.maxSlope) return BuildFail.Terrain;
  }
  // occupancy
  if (def.placement === Placement.Edge) { if (idx.edge(slot.tx, slot.ty, slot.z, slot.side)) return BuildFail.Occupied; }
  else if (def.placement === Placement.Opening) {
    if (!sn.parent || idx.def(sn.parent)?.opening !== def.fits) return BuildFail.NoSocket;
    if (idx.opening(sn.parent)) return BuildFail.Occupied;
  } else if (!idx.grid.canPlace(def.id, slot.tx, slot.ty, slot.z, gridRot(def, slot.rot)).ok) return BuildFail.Occupied;
  // furniture/decor on decks need a deck under every tile
  if (def.placement === Placement.Free && !onGround && !tiles.every(([x, y]) => idx.isDeck(idx.deck(x, y, slot.z)))) return BuildFail.NoSupport;
  if (def.placement === Placement.Cell && def.needsDeck && !tiles.every(([x, y]) => idx.isDeck(idx.deck(x, y, slot.z)))) return BuildFail.NoSupport;
  // creatures in the way of solid pieces
  if (def.solid && slot.z === 0) {
    const [hw, hh] = def.placement === Placement.Edge ? (slot.side === EdgeSide.North ? [0.5, 0.15] : [0.15, 0.5]) : [def.footprint.w / 2, def.footprint.h / 2];
    for (const c of installSpatialIndex(world).queryRect(sn.pos.x - hw - 0.3, sn.pos.y - hh - 0.3, sn.pos.x + hw + 0.3, sn.pos.y + hh + 0.3)) {
      if (world.has(c, Health) && !world.has(c, BuildPiece) && (world.has(c, Zombie) || c !== builder || def.placement !== Placement.Free)) return BuildFail.Blocked;
    }
  }
  if (candidateStability(world, sn) < b.minStability) return BuildFail.NoSupport;
  if (!opts.ignoreCost) for (const c of pieceCost(defs, def, sn.tier)) if (countItem(world, builder, c.item) < c.count) return BuildFail.CannotAfford;
  return 0;
}

/**
 * Authoritative place (after validatePlacement). Pays the cost, creates the piece entity (static replication class)
 * and its non-static attachment entities (door state, fire/fuel/emitters, storage), indexes everything.
 */
export function placePiece(world: World, builder: Entity | 0, sn: Snapped, opts: { pay?: boolean; hp?: number; paint?: number; tribe?: number } = {}): Entity {
  const defs = gameplayDefs(world); const idx = structures(world); const { def, slot } = sn;
  if (builder && opts.pay !== false) exchangeItems(world, builder, pieceCost(defs, def, sn.tier), []);
  const e = world.create();
  const tribe = opts.tribe ?? (builder ? tribeOf(world, builder) : 0);
  world.add(e, Transform, sn.pos)
    .add(e, BuildPiece, { type: def.id, rot: slot.rot, variant: sn.variant, tier: sn.tier, hp: opts.hp ?? maxHp(defs, def, sn.tier), damageStage: 0, paint: opts.paint ?? 0 });
  if (tribe) world.add(e, Tribe, { id: tribe });
  // clan tint: u8 index into the assets manifest clanPalettes (0 = no clan; render wraps by palette count)
  const clan = builder && world.isRegistered(Membership) ? world.getField(builder, Membership, "clanId") ?? 0 : 0;
  if (clan) world.setField(e, BuildPiece, "tint", clanTintIndex(clan));
  if (def.privilegeRadius > 0) world.add(e, PrivilegeZone, { radius: def.privilegeRadius, tribe });
  if (def.station !== StationKind.None && !def.fired) world.add(e, CraftingStation, { kind: def.station });
  if (isAuthority(world)) world.add(e, PieceStability, { value: 0, placedTick: world.tick });
  idx.addPiece(e, slot, sn.parent);
  indexEntity(world, e);
  const own = zonesAt(world, sn.pos.x, sn.pos.y)[0];
  if (own !== undefined) { idx.zoneOf.set(e, own); idx.zoneCounts.set(own, (idx.zoneCounts.get(own) ?? 0) + 1); }
  if (def.privilegeRadius > 0) idx.zoneCounts.set(e, idx.zoneCounts.get(e) ?? 0);
  if (isAuthority(world)) {
    world.setField(e, PieceStability, "value", Math.max(0, Math.min(255, candidateStability(world, sn))));
    idx.dirty.add(e);
    spawnAttachments(world, e, def, sn);
    if (def.stall && builder) assignStallOwner(world, e, builder);
  }
  return e;
}

/** Attachment entities (server). Each carries Transform (same position) + PieceLink to its piece slot. */
export function spawnAttachments(world: World, piece: Entity, def: PieceDef, sn: Snapped): Entity[] {
  const out: Entity[] = [];
  const link = (kind: AttachKind): Entity => {
    const a = world.create();
    world.add(a, Transform, sn.pos).add(a, PieceLink, {
      tx: sn.slot.tx, ty: sn.slot.ty, z: sn.slot.z, side: sn.slot.side, kind,
      layer: def.placement === Placement.Opening ? LAYER_OPENING : def.layer,
    });
    linkAttachment(world, piece, a); markLinked(world, a); indexEntity(world, a); out.push(a);
    return a;
  };
  if (def.door) world.add(link(AttachKind.Door), DoorState, { open: 0, lockTribe: def.features.clanLock ? world.getField(piece, Tribe, "id") ?? 0 : 0 });
  const specs = emitterSpecs(def);
  if (def.fired) {
    const f = link(AttachKind.Fire);
    world.add(f, Fuel, { burnUntilTick: 0, lit: 0 }).add(f, Container, { slotCount: Math.max(1, def.container) }).add(f, ContainerViewers);
    const heat = specs.find((s) => s.kind === 1);
    if (heat) world.add(f, Emitter, { kind: heat.kind, radius: heat.radius, strength: 0, falloff: Falloff.Linear });
    if (def.station !== StationKind.None) world.add(f, CraftingStation, { kind: def.station });
  } else if (def.stall) {
    // trade stall: stock (Container slot i = listing i) + header/listings/ledger on one attachment, proceeds in a separate till
    const st = link(AttachKind.Storage);
    world.add(st, Container, { slotCount: def.stall.listings }).add(st, ContainerViewers)
      .add(st, StallHeader, { ownerKind: 0, ownerId: 0, open: 0, listingCount: def.stall.listings }).add(st, Listings).add(st, StallLedger).add(st, StallSign, { soldOut: 1 });
    world.add(link(AttachKind.Till), Container, { slotCount: tillSlots() });
  } else if (def.container > 0) world.add(link(AttachKind.Storage), Container, { slotCount: def.container }).add(out[out.length - 1]!, ContainerViewers);
  const light = specs.find((s) => s.kind === 2);
  if (light) world.add(link(AttachKind.Light), Emitter, { kind: light.kind, radius: light.radius, strength: def.fired ? 0 : light.strength, falloff: Falloff.Quadratic });
  return out;
}

/** Validate + place (the Place intent). Returns the piece entity or the failure. */
export type PlaceResult = { ok: true; piece: Entity } | { ok: false; reason: BuildFail };
export function tryPlace(world: World, builder: Entity, req: PlaceRequest): PlaceResult {
  const sn = snapPlacement(world, req); if (typeof sn === "number") return { ok: false, reason: sn };
  const why = validatePlacement(world, builder, sn); if (why) return { ok: false, reason: why };
  const e = placePiece(world, builder, sn);
  emit(world, PiecePlaced, { piece: e, type: sn.def.id, builder });
  makeNoise(world, builder, gameplayDefs(world).noise.build);
  return { ok: true, piece: e };
}
void entityIndex;
