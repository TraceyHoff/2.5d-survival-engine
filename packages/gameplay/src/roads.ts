/**
 * ADR-119 roads + settlements. Road tiles are standalone entities (Transform at tile centre + Road), networked and
 * persistent through the core chunk codec (like Crop). Path / gravel / paved surfaces give movement + vehicle speed
 * bonuses; `mask` holds auto-connect bits (N1 E2 S4 W8) so the renderer draws joined edges. Roads may be laid
 * anywhere except inside someone else's privilege zone (land claim), so they can link settlements.
 * Settlements: classifySettlements() clusters owned build pieces into clan cities / villages / houses.
 */
import { defineCommand, PlayerId, Transform, entityIndex, type CommandDef, type CommandHandlers, type Entity, type World } from "@engine/core";
import { emit, XpActivity } from "./events.js";
import { installSpatialIndex } from "@engine/world";
import raw from "../data/roads.json";
import { BuildPiece, Dead, PieceOwner, Road, RoadSurface, Tribe } from "./components.js";
import { gameplayDefs, isAuthority } from "./config.js";
import { countItem, removeItem } from "./inventory.js";
import { hasPrivilege } from "./building/place.js";
import { indexEntity } from "./spawn.js";

const pid = (world: World, e: Entity): number => (world.isRegistered(PlayerId) ? world.getField(e, PlayerId, "id") ?? 0 : 0);
export interface RoadCost { item: string; count: number }
export interface RoadSurfaceDef { key: string; name: string; speedMul: number; vehicleMul: number; cost: RoadCost[]; alt?: RoadCost[]; tools: string[] }
export const ROADS = raw.roads as { maxDragTiles: number; surfaces: RoadSurfaceDef[] };
export const SETTLEMENTS = raw.settlements as { radius: number; clanMinPieces: number };
export const surfaceDef = (s: number): RoadSurfaceDef | undefined => ROADS.surfaces[s - 1];
export const surfaceOf = (key: string): RoadSurface => (ROADS.surfaces.findIndex((d) => d.key === key) + 1) as RoadSurface;

export const enum RoadFail { None = 0, BadSurface = 1, NoPrivilege = 2, Occupied = 3, CannotAfford = 4, NoTool = 5, NotFound = 6, TooFar = 7 }
export const ROAD_FAIL_REASONS = ["", "bad_surface", "no_privilege", "occupied", "cannot_afford", "no_tool", "not_found", "too_far"] as const;
export const MASK_N = 1, MASK_E = 2, MASK_S = 4, MASK_W = 8;

// ---- tile index (rebuilt lazily; road entities never move) --------------------------------------------------------
interface RoadIdx { tiles: Map<number, Entity>; size: number; tick: number }
const idxCache = new WeakMap<World, RoadIdx>();
const key = (tx: number, ty: number): number => (tx + 32768) * 65536 + (ty + 32768);
function roadIndex(world: World): RoadIdx {
  if (!world.isRegistered(Road)) return { tiles: new Map(), size: 0, tick: 0 };
  const st = world.store(Road); let c = idxCache.get(world);
  if (c && c.size === st.size && (c.tick === world.tick || world.tick - c.tick < 20)) return c;
  const tiles = new Map<number, Entity>();
  for (const e of world.query([Road, Transform])) { const t = world.get(e, Transform)!; tiles.set(key(Math.floor(t.x), Math.floor(t.y)), e); }
  c = { tiles, size: st.size, tick: world.tick }; idxCache.set(world, c); return c;
}
const invalidate = (world: World): void => { idxCache.delete(world); };
export function roadAt(world: World, tx: number, ty: number): Entity | undefined {
  const e = roadIndex(world).tiles.get(key(Math.floor(tx), Math.floor(ty)));
  return e !== undefined && world.isAlive(e) && world.has(e, Road) ? e : undefined;
}
export const roadSurfaceAt = (world: World, x: number, y: number): RoadSurface => { const e = roadAt(world, x, y); return e === undefined ? RoadSurface.None : (world.getField(e, Road, "surface") ?? 0) as RoadSurface; };
/** Walking speed multiplier for the tile under (x,y): 1 off-road. */
export const roadSpeedMul = (world: World, x: number, y: number): number => surfaceDef(roadSurfaceAt(world, x, y))?.speedMul ?? 1;
/** Vehicle top-speed multiplier for the tile under (x,y): 1 off-road. */
export const roadVehicleMul = (world: World, x: number, y: number): number => surfaceDef(roadSurfaceAt(world, x, y))?.vehicleMul ?? 1;

/** Auto-connect bits for (tx,ty): neighbours that have any road. */
export function roadMask(world: World, tx: number, ty: number): number {
  return (roadAt(world, tx, ty - 1) !== undefined ? MASK_N : 0) | (roadAt(world, tx + 1, ty) !== undefined ? MASK_E : 0)
    | (roadAt(world, tx, ty + 1) !== undefined ? MASK_S : 0) | (roadAt(world, tx - 1, ty) !== undefined ? MASK_W : 0);
}
function refreshMasks(world: World, tx: number, ty: number): void {
  for (const [dx, dy] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const e = roadAt(world, tx + dx, ty + dy); if (e === undefined) continue;
    const m = roadMask(world, tx + dx, ty + dy); if (world.getField(e, Road, "mask") !== m) world.setField(e, Road, "mask", m);
  }
}

/** Raw spawn (no checks / cost): tests, worldgen, loaders. */
export function spawnRoad(world: World, tx: number, ty: number, surface: RoadSurface, owner = 0): Entity {
  const e = world.create();
  world.add(e, Transform, { x: Math.floor(tx) + 0.5, y: Math.floor(ty) + 0.5 }).add(e, Road, { surface, mask: 0, owner });
  indexEntity(world, e); invalidate(world); refreshMasks(world, Math.floor(tx), Math.floor(ty)); return e;
}

export function itemIdSafe(world: World, key: string): number | undefined { try { return gameplayDefs(world).itemId(key); } catch { return undefined; } }
const has = (world: World, e: Entity, cost: readonly RoadCost[]): boolean => {
  return cost.every((c) => { const id = itemIdSafe(world, c.item); return id !== undefined && countItem(world, e, id) >= c.count; });
};
/** Which cost list the builder can pay (primary, else alt), or undefined. */
export function roadCost(world: World, e: Entity, surface: RoadSurface): readonly RoadCost[] | undefined {
  const d = surfaceDef(surface); if (!d) return undefined;
  if (has(world, e, d.cost)) return d.cost;
  if (d.alt && has(world, e, d.alt)) return d.alt;
  return undefined;
}
function hasTool(world: World, e: Entity, d: RoadSurfaceDef): boolean {
  if (d.tools.length === 0) return true;
  return d.tools.some((k) => { const id = itemIdSafe(world, k); return id !== undefined && countItem(world, e, id) > 0; });
}

/** Lay (or upgrade) one road tile. Authority pays the cost; dryRun only validates. */
export function placeRoad(world: World, e: Entity, tx: number, ty: number, surface: number, dryRun = false): RoadFail {
  tx = Math.floor(tx); ty = Math.floor(ty);
  const d = surfaceDef(surface); if (!d) return RoadFail.BadSurface;
  if (!hasPrivilege(world, e, tx + 0.5, ty + 0.5)) return RoadFail.NoPrivilege;
  const ex = roadAt(world, tx, ty);
  if (ex !== undefined && (world.getField(ex, Road, "surface") ?? 0) >= surface) return RoadFail.Occupied;
  if (!hasTool(world, e, d)) return RoadFail.NoTool;
  const cost = roadCost(world, e, surface as RoadSurface); if (!cost) return RoadFail.CannotAfford;
  if (dryRun) return RoadFail.None;
  for (const c of cost) removeItem(world, e, itemIdSafe(world, c.item)!, c.count);
  const owner = pid(world, e);
  if (ex !== undefined) { world.setField(ex, Road, "surface", surface); world.setField(ex, Road, "owner", owner); }
  else spawnRoad(world, tx, ty, surface as RoadSurface, owner);
  emit(world, XpActivity, { entity: e, source: "road", units: 1 });
  return RoadFail.None;
}

/** Integer tiles on the segment (Bresenham), capped at maxDragTiles. */
export function roadLine(x0: number, y0: number, x1: number, y1: number, max = ROADS.maxDragTiles): [number, number][] {
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
  const out: [number, number][] = []; const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0); const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    out.push([x, y]); if (out.length >= max || (x === x1 && y === y1)) break;
    const e2 = 2 * err;
    // 4-connected: step one axis at a time so the road joins edge-to-edge
    if (e2 >= dy && x !== x1) { err += dy; x += sx; } else if (e2 <= dx) { err += dx; y += sy; }
    else { err += dy; x += sx; }
  }
  return out;
}
/** Drag tool: lays tiles along the line until materials run out. Returns tiles laid and the first hard failure. */
export function placeRoadLine(world: World, e: Entity, x0: number, y0: number, x1: number, y1: number, surface: number): { laid: number; fail: RoadFail } {
  let laid = 0; let fail = RoadFail.None;
  for (const [x, y] of roadLine(x0, y0, x1, y1)) {
    const r = placeRoad(world, e, x, y, surface);
    if (r === RoadFail.None) laid++;
    else if (r !== RoadFail.Occupied) { fail = r; if (r === RoadFail.CannotAfford || r === RoadFail.NoTool || r === RoadFail.BadSurface) break; }
  }
  return { laid, fail: laid > 0 ? RoadFail.None : fail };
}
/** Remove a tile: its owner, or anyone with privilege there (claim owner). No refund. */
export function removeRoad(world: World, e: Entity, tx: number, ty: number): RoadFail {
  const r = roadAt(world, tx, ty); if (r === undefined) return RoadFail.NotFound;
  const owner = world.getField(r, Road, "owner") ?? 0; const me = pid(world, e);
  if (owner !== me && !hasPrivilege(world, e, Math.floor(tx) + 0.5, Math.floor(ty) + 0.5)) return RoadFail.NoPrivilege;
  world.destroy(r); invalidate(world); refreshMasks(world, Math.floor(tx), Math.floor(ty)); return RoadFail.None;
}

// ---- commands -----------------------------------------------------------------------------------------------------
export const PlaceRoadCmd = defineCommand("gameplay.placeRoad", { x0: "i32", y0: "i32", x1: "i32", y1: "i32", surface: "u8" });
export const RemoveRoadCmd = defineCommand("gameplay.removeRoad", { x: "i32", y: "i32" });
export const ROAD_COMMANDS: readonly CommandDef[] = [PlaceRoadCmd, RemoveRoadCmd];
const REACH = 6;
const near = (world: World, e: Entity, x: number, y: number): boolean => { const t = world.get(e, Transform); return !!t && Math.hypot(t.x - x - 0.5, t.y - y - 0.5) <= REACH + ROADS.maxDragTiles; };
export function installRoadCommands(world: World, handlers: CommandHandlers): void {
  const why = (f: RoadFail): string | undefined => (f ? ROAD_FAIL_REASONS[f] : undefined);
  handlers.on(PlaceRoadCmd, {
    validate: (v, c) => (!near(world, c.actor, v.x0, v.y0) ? "too_far" : Math.hypot(v.x1 - v.x0, v.y1 - v.y0) > ROADS.maxDragTiles ? "too_far" : undefined),
    handle: (v, c) => { const r = placeRoadLine(world, c.actor, v.x0, v.y0, v.x1, v.y1, v.surface); if (r.fail) throw new Error(why(r.fail)); },
  });
  handlers.on(RemoveRoadCmd, {
    validate: (v, c) => (!near(world, c.actor, v.x, v.y) ? "too_far" : roadAt(world, v.x, v.y) === undefined ? "not_found" : undefined),
    handle: (v, c) => { const r = removeRoad(world, c.actor, v.x, v.y); if (r) throw new Error(why(r)); },
  });
}

// ---- settlements --------------------------------------------------------------------------------------------------
export const enum SettlementKind { House = 1, Village = 2, ClanCity = 3 }
export const SETTLEMENT_LABELS = ["", "House", "Village", "Clan City"] as const;
export interface Homestead { x: number; y: number; player: number; clan: number }
export interface Settlement { kind: SettlementKind; label: string; x: number; y: number; players: number[]; clan: number; homes: number }
/**
 * Pure classification. Homesteads (one per owner: a player's or clan's piece centroid) within `radius` of each other
 * join one cluster (single linkage). A cluster containing a clan's homestead is a Clan City (named for the clan with
 * the most homesteads there); otherwise 2+ distinct non-clan players = Village; a lone player = House.
 */
export function classifySettlements(homes: readonly Homestead[], radius = SETTLEMENTS.radius): Settlement[] {
  const n = homes.length; const parent = homes.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!; return i; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.hypot(homes[i]!.x - homes[j]!.x, homes[i]!.y - homes[j]!.y) <= radius) parent[find(i)] = find(j);
  const groups = new Map<number, Homestead[]>();
  for (let i = 0; i < n; i++) { const r = find(i); let g = groups.get(r); if (!g) groups.set(r, (g = [])); g.push(homes[i]!); }
  const out: Settlement[] = [];
  for (const g of groups.values()) {
    const x = g.reduce((s, h) => s + h.x, 0) / g.length, y = g.reduce((s, h) => s + h.y, 0) / g.length;
    const clans = new Map<number, number>(); for (const h of g) if (h.clan) clans.set(h.clan, (clans.get(h.clan) ?? 0) + 1);
    const players = [...new Set(g.filter((h) => !h.clan && h.player).map((h) => h.player))];
    let kind: SettlementKind, clan = 0;
    if (clans.size) { kind = SettlementKind.ClanCity; clan = [...clans].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0]; }
    else kind = players.length >= 2 ? SettlementKind.Village : SettlementKind.House;
    out.push({ kind, label: SETTLEMENT_LABELS[kind], x, y, players, clan, homes: g.length });
  }
  return out.sort((a, b) => a.x - b.x || a.y - b.y);
}
/**
 * World -> homesteads: build pieces grouped by owner (clan via Tribe when it is a clan id, else PieceOwner builder,
 * else ownerless pieces are skipped). `isClan(id)` decides whether a Tribe id names a clan.
 */
export function homesteads(world: World, isClan: (tribe: number) => boolean): Homestead[] {
  const acc = new Map<string, { x: number; y: number; n: number; player: number; clan: number }>();
  for (const e of world.query([BuildPiece, Transform], [Dead])) {
    const tribe = world.getField(e, Tribe, "id") ?? 0; const player = world.isRegistered(PieceOwner) ? world.getField(e, PieceOwner, "player") ?? 0 : 0;
    const clan = tribe && isClan(tribe) ? tribe : 0; if (!clan && !player) continue;
    const k = clan ? `c${clan}` : `p${player}`; const t = world.get(e, Transform)!;
    let a = acc.get(k); if (!a) acc.set(k, (a = { x: 0, y: 0, n: 0, player: clan ? 0 : player, clan }));
    a.x += t.x; a.y += t.y; a.n++;
  }
  return [...acc.values()].map((a) => ({ x: a.x / a.n, y: a.y / a.n, player: a.player, clan: a.clan }));
}
/** Nearest settlement to (x,y) within radius (HUD "you are in ..." label). */
export function settlementNear(list: readonly Settlement[], x: number, y: number, radius = SETTLEMENTS.radius): Settlement | undefined {
  let best: Settlement | undefined, bd = radius;
  for (const s of list) { const d = Math.hypot(s.x - x, s.y - y); if (d <= bd) { bd = d; best = s; } }
  return best;
}
export const _roadsInternal = { entityIndex, installSpatialIndex, isAuthority };
