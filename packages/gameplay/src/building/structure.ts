/**
 * StructureIndex: the sim-local mirror of all build pieces (both peers).
 *  - cell + free pieces live in @engine/world BuildingGrid instances (gridId <-> entity);
 *  - thin edge walls live in an EdgeIndex keyed by (tx, ty, z, side N|W) (BuildingGrid has no edge layer);
 *  - openings (doors/hatches/window inserts) are keyed by their parent piece;
 *  - per-chunk piece sets + versions (persistence dirty tracking / net static versions).
 * The server places pieces directly through addPiece(); replicated or loaded pieces are indexed by the
 * structureIndex system from Transform + BuildPiece (PieceSlot is derived, never replicated).
 */
import { defineResource, entityIndex, Transform, type Entity, type World } from "@engine/core";
import { BuildingGrid, chunkKeyOf, type ChunkKey } from "@engine/world";
import { BuildPiece, EdgeSide, PieceLink, PieceSlot, PieceStability, type AttachKind } from "../components.js";
import { gameplayDefs } from "../config.js";
import { Placement, type GameDefs, type PieceDef } from "../defs.js";
import { linkAttachment } from "./links.js";

/** Canonical piece layer ids (PieceLink.layer / BuildingGrid layer); render imports these from here only. */
export const LAYER_DECK = 0, LAYER_STRUCT = 1, LAYER_FURNITURE = 2, LAYER_DECOR = 3, LAYER_OPENING = 4;
const OFF = 1 << 20;
export const edgeKey = (tx: number, ty: number, z: number, side: EdgeSide): number => ((tx + OFF) * 2 ** 21 + (ty + OFF)) * 32 + z * 2 + (side - 1);

export interface Slot { tx: number; ty: number; z: number; side: EdgeSide; rot: number }

/** Geometry of a piece def at a slot: Transform center + facing. */
export function slotTransform(def: PieceDef, slot: Slot, levelHeight: number, x?: number, y?: number): { x: number; y: number; z: number; facing: number } {
  const z = slot.z * levelHeight;
  if (def.placement === Placement.Edge || (def.placement === Placement.Opening && slot.side !== EdgeSide.None)) {
    const flip = (slot.rot & 2) ? Math.PI : 0;
    return slot.side === EdgeSide.North ? { x: slot.tx + 0.5, y: slot.ty, z, facing: norm(flip) } : { x: slot.tx, y: slot.ty + 0.5, z, facing: norm(Math.PI / 2 + flip) };
  }
  if (def.placement === Placement.Free) return { x: x ?? slot.tx + 0.5, y: y ?? slot.ty + 0.5, z, facing: norm((slot.rot * 2 * Math.PI) / 16) };
  const [w, h] = rotatedSize(def, slot.rot & 3);
  return { x: slot.tx + w / 2, y: slot.ty + h / 2, z, facing: norm((slot.rot & 3) * Math.PI / 2) };
}
const norm = (a: number): number => { let r = a; while (r > Math.PI) r -= 2 * Math.PI; while (r < -Math.PI) r += 2 * Math.PI; return r; };
export const rotatedSize = (def: PieceDef, rot4: number): [number, number] => (rot4 & 1 ? [def.footprint.h, def.footprint.w] : [def.footprint.w, def.footprint.h]);
/** Grid rotation (0..3) used for occupancy: cells use rot directly, free pieces round their 16-step rot. */
export const gridRot = (def: PieceDef, rot: number): number => (def.placement === Placement.Free ? Math.round(rot / 4) & 3 : rot & 3);
/** Anchor tile of a cell/free footprint centred near (x,y). */
export function anchorFor(def: PieceDef, x: number, y: number, rot4: number): [number, number] {
  const [w, h] = rotatedSize(def, rot4); return [Math.floor(x - w / 2 + 0.5), Math.floor(y - h / 2 + 0.5)];
}

export class StructureIndex {
  readonly grid: BuildingGrid;
  readonly byGrid = new Map<number, Entity>();
  readonly edges = new Map<number, Entity>();
  /** parent piece -> opening piece. */
  readonly openings = new Map<Entity, Entity>();
  readonly chunkPieces = new Map<ChunkKey, Set<Entity>>();
  readonly chunkVersions = new Map<ChunkKey, number>();
  /** privilege zone (claim piece) -> piece count; piece -> zone. */
  readonly zoneCounts = new Map<Entity, number>();
  readonly zoneOf = new Map<Entity, Entity>();
  /** server: pieces whose stability must be (re)computed this tick; removals trigger region recompute. */
  readonly dirty = new Set<Entity>();
  readonly removedNeighbors = new Set<Entity>();
  /** server: hp damage batched per tick. */
  readonly pendingDamage = new Map<Entity, number>();
  /** entity -> where it is indexed (removal works even after the entity died). */
  readonly info = new Map<Entity, { slot: Slot; gridId: number; parent: Entity | 0; def: PieceDef; ck: ChunkKey }>();
  constructor(readonly world: World, readonly defs: GameDefs) { this.grid = new BuildingGrid(defs.pieceRegistry); }

  def(e: Entity): PieceDef | undefined { const i = this.info.get(e); if (i) return i.def; const t = this.world.getField(e, BuildPiece, "type"); return t === undefined ? undefined : this.defs.pieces.get(t); }
  slotOf(e: Entity): Slot & { gridId: number; parent: number } | undefined {
    const st = this.world.store(PieceSlot); const s = st.slot(entityIndex(e)); if (s < 0) return undefined;
    const d = st.data;
    return { tx: d.tx[s]!, ty: d.ty[s]!, z: d.z[s]!, side: d.side[s]! as EdgeSide, rot: this.world.getField(e, BuildPiece, "rot") ?? 0, gridId: d.gridId[s]!, parent: d.parent[s]! };
  }

  // ---- lookups ----
  deck(tx: number, ty: number, z: number): Entity | 0 { const id = this.grid.at(tx, ty, z, LAYER_DECK); return id ? this.byGrid.get(id) ?? 0 : 0; }
  cell(tx: number, ty: number, z: number, layer: number): Entity | 0 { const id = this.grid.at(tx, ty, z, layer); return id ? this.byGrid.get(id) ?? 0 : 0; }
  edge(tx: number, ty: number, z: number, side: EdgeSide): Entity | 0 { return this.edges.get(edgeKey(tx, ty, z, side)) ?? 0; }
  opening(parent: Entity): Entity | 0 { return this.openings.get(parent) ?? 0; }
  /** Four edges of a tile: N, S, W, E as (tx, ty, side). */
  static tileEdges(tx: number, ty: number): [number, number, EdgeSide][] {
    return [[tx, ty, EdgeSide.North], [tx, ty + 1, EdgeSide.North], [tx, ty, EdgeSide.West], [tx + 1, ty, EdgeSide.West]];
  }
  /** The two tiles an edge separates. */
  static edgeTiles(tx: number, ty: number, side: EdgeSide): [[number, number], [number, number]] {
    return side === EdgeSide.North ? [[tx, ty], [tx, ty - 1]] : [[tx, ty], [tx - 1, ty]];
  }
  tilesOf(e: Entity): [number, number][] {
    const d = this.def(e); const s = this.slotOf(e); if (!d || !s) return [];
    if (s.side !== EdgeSide.None) return [];
    return this.grid.footprintTiles(d.id, s.tx, s.ty, gridRot(d, s.rot));
  }
  /** Piece at a PieceLink-style slot key. layer 4 = opening hosted by the piece at that slot. */
  atSlot(tx: number, ty: number, z: number, side: EdgeSide, layer: number): Entity | 0 {
    if (layer === LAYER_OPENING) {
      const parent = side !== EdgeSide.None ? this.edge(tx, ty, z, side) : this.deck(tx, ty, z);
      return parent ? this.opening(parent) : 0;
    }
    return side !== EdgeSide.None ? this.edge(tx, ty, z, side) : this.cell(tx, ty, z, layer);
  }
  /** Is this deck usable as a floor for walls/furniture (not a roof)? */
  isDeck(e: Entity | 0): e is Entity { return e !== 0 && !this.def(e)?.roof; }

  // ---- add / remove ----
  /** Indexes a piece entity at a slot (no rule checks). Returns false if occupied. */
  addPiece(e: Entity, slot: Slot, parent: Entity | 0 = 0): boolean {
    const def = this.def(e); if (!def) return false;
    let gridId = 0;
    if (def.placement === Placement.Opening) {
      if (!parent || this.openings.has(parent)) return false;
      this.openings.set(parent, e);
    } else if (def.placement === Placement.Edge) {
      const k = edgeKey(slot.tx, slot.ty, slot.z, slot.side); if (this.edges.has(k)) return false;
      this.edges.set(k, e);
    } else {
      gridId = this.grid.place(def.id, slot.tx, slot.ty, slot.z, gridRot(def, slot.rot));
      if (!gridId) return false;
      this.byGrid.set(gridId, e);
    }
    const w = this.world;
    if (w.has(e, PieceSlot)) w.set(e, PieceSlot, { tx: slot.tx, ty: slot.ty, z: slot.z, side: slot.side, gridId, parent });
    else w.add(e, PieceSlot, { tx: slot.tx, ty: slot.ty, z: slot.z, side: slot.side, gridId, parent });
    const ck = this.chunkOf(e); this.info.set(e, { slot: { ...slot }, gridId, parent, def, ck });
    let set = this.chunkPieces.get(ck); if (!set) this.chunkPieces.set(ck, (set = new Set()));
    set.add(e); this.bump(ck);
    return true;
  }
  removePiece(e: Entity): void {
    const inf = this.info.get(e); if (!inf) return;
    this.info.delete(e);
    const { slot: s, def } = inf;
    if (inf.parent && this.openings.get(inf.parent) === e) this.openings.delete(inf.parent);
    else if (def.placement === Placement.Edge) { const k = edgeKey(s.tx, s.ty, s.z, s.side); if (this.edges.get(k) === e) this.edges.delete(k); }
    this.openings.delete(e);
    if (inf.gridId) { this.grid.remove(inf.gridId); this.byGrid.delete(inf.gridId); }
    const set = this.chunkPieces.get(inf.ck); if (set?.delete(e)) { this.bump(inf.ck); if (!set.size) this.chunkPieces.delete(inf.ck); }
    const z = this.zoneOf.get(e); if (z !== undefined) { this.zoneOf.delete(e); this.zoneCounts.set(z, (this.zoneCounts.get(z) ?? 1) - 1); }
    this.dirty.delete(e); this.pendingDamage.delete(e);
    if (this.world.isAlive(e) && this.world.has(e, PieceSlot)) this.world.remove(e, PieceSlot);
  }
  removePieceByEntity(e: Entity): void { this.removePiece(e); }
  chunkOf(e: Entity): ChunkKey { const tf = this.world.get(e, Transform)!; return chunkKeyOf(tf.x, tf.y); }
  bump(ck: ChunkKey): void { this.chunkVersions.set(ck, (this.chunkVersions.get(ck) ?? 0) + 1); this.version++; }
  /** Bumped on any structural change (and door toggles); invalidates enclosure caches. */
  version = 0;
  /**
   * Piece blocking movement across an edge at level z: a blocking wall, or a doorway/hatch whose door is closed.
   * Returns the entity to attack to break through (door if present, else the wall), or 0 if passable.
   */
  edgeBlocker(tx: number, ty: number, z: number, side: EdgeSide): Entity | 0 {
    const w = this.edge(tx, ty, z, side); if (!w) return 0;
    const d = this.def(w)!; const op = this.openings.get(w);
    if (op) { const od = this.def(op); if (od?.door) return this.doorOpen(op) ? 0 : op; return od?.blocksPath ? op : d.blocksPath ? w : 0; }
    return d.blocksPath ? w : 0;
  }
  /** Door open state lookup (DoorState lives on the door's attachment entity). Set by the doors module. */
  doorOpen: (door: Entity) => boolean = () => false;
  private encCache = new Map<number, { enclosed: boolean; size: number }>(); private encVersion = -1;
  /** Flood fill over tiles at level z bounded by blocking edge walls / closed doors (thin walls are not grid cells). */
  edgeEnclosure(tx: number, ty: number, z: number, maxCells = 256): { enclosed: boolean; size: number } {
    if (this.encVersion !== this.version) { this.encCache.clear(); this.encVersion = this.version; }
    const key = edgeKey(tx, ty, z, EdgeSide.North); const hit = this.encCache.get(key); if (hit) return hit;
    const seen = new Set<number>([key]); const stack: [number, number][] = [[tx, ty]]; let open = false;
    while (stack.length && !open) {
      const [x, y] = stack.pop()!;
      const nb: [number, number, number, number, EdgeSide][] = [[x, y - 1, x, y, EdgeSide.North], [x, y + 1, x, y + 1, EdgeSide.North], [x - 1, y, x, y, EdgeSide.West], [x + 1, y, x + 1, y, EdgeSide.West]];
      for (const [nx, ny, ex, ey, side] of nb) {
        if (this.edgeBlocker(ex, ey, z, side) || (this.edge(ex, ey, z, side) && this.def(this.edge(ex, ey, z, side) as Entity)?.opening === 3)) continue;
        const k = edgeKey(nx, ny, z, EdgeSide.North); if (seen.has(k)) continue;
        seen.add(k); if (seen.size > maxCells) { open = true; break; } stack.push([nx, ny]);
      }
    }
    const r = { enclosed: !open, size: seen.size };
    if (!open) for (const k of seen) this.encCache.set(k, r); else this.encCache.set(key, r);
    return r;
  }
  get count(): number { let n = 0; for (const s of this.chunkPieces.values()) n += s.size; return n; }

  // ---- support graph (server stability; also used for client-side "has any support" ghost checks) ----
  /** Supporting pieces of an indexed piece with the loss kind: 0 none (openings/furniture), 1 vertical, 2 horizontal. */
  supports(e: Entity, out: [Entity, number][] = []): { root: boolean; list: [Entity, number][] } {
    const def = this.def(e); const s = this.slotOf(e); out.length = 0;
    if (!def || !s) return { root: false, list: out };
    return this.supportsAt(def, s, s.parent, e, out);
  }
  /** Same for a hypothetical placement (validation / ghost). `self` is excluded from results. */
  supportsAt(def: PieceDef, s: Slot, parent: Entity | 0, self: Entity | 0 = 0, out: [Entity, number][] = []): { root: boolean; list: [Entity, number][] } {
    out.length = 0; const z = s.z;
    if (def.placement === Placement.Opening) { if (parent) out.push([parent, 0]); return { root: false, list: out }; }
    if (def.placement === Placement.Edge) {
      for (const [x, y] of StructureIndex.edgeTiles(s.tx, s.ty, s.side)) { const d = this.deck(x, y, z); if (this.isDeck(d)) out.push([d, 1]); }
      if (z > 0) { const below = this.edge(s.tx, s.ty, z - 1, s.side); if (below) out.push([below, 1]); }
      return { root: false, list: out };
    }
    const tiles = this.grid.footprintTiles(def.id, s.tx, s.ty, gridRot(def, s.rot));
    const seen = new Set<Entity>();
    const push = (x: Entity | 0, kind: number): void => { if (x && x !== self && !seen.has(x)) { seen.add(x); out.push([x, kind]); } };
    if (def.layer === LAYER_DECK) {
      if (z === 0) return { root: def.groundOnly, list: out };
      for (const [x, y] of tiles) {
        for (const [ex, ey, side] of StructureIndex.tileEdges(x, y)) { const w = this.edge(ex, ey, z - 1, side); if (w && this.def(w)?.placement === Placement.Edge) push(w, 1); }
        const p = this.cell(x, y, z - 1, LAYER_STRUCT); if (p && this.def(p)?.supportsAbove) push(p, 1);
        for (const [dx, dy] of NEIGH) push(this.deck(x + dx, y + dy, z), 2);
      }
      return { root: false, list: out };
    }
    if (def.placement === Placement.Free && def.ground && z === 0) {
      let onDeck = false; for (const [x, y] of tiles) if (this.isDeck(this.deck(x, y, 0))) { onDeck = true; break; }
      if (!onDeck) return { root: true, list: out };
    }
    for (const [x, y] of tiles) {
      const d = this.deck(x, y, z); if (this.isDeck(d)) push(d, def.placement === Placement.Free ? 0 : 1);
      if (def.layer === LAYER_STRUCT && z > 0) { const p = this.cell(x, y, z - 1, LAYER_STRUCT); if (p && this.def(p)?.supportsAbove) push(p, 1); }
    }
    return { root: false, list: out };
  }
  /** Pieces that may rest on e (reverse of supports). */
  dependents(e: Entity, out: Entity[] = []): Entity[] {
    out.length = 0; const def = this.def(e); const s = this.slotOf(e); if (!def || !s) return out;
    const z = s.z; const add = (x: Entity | 0): void => { if (x && x !== e && !out.includes(x)) out.push(x); };
    const op = this.openings.get(e); if (op) add(op);
    if (def.placement === Placement.Edge) {
      for (const [x, y] of StructureIndex.edgeTiles(s.tx, s.ty, s.side)) add(this.deck(x, y, z + 1));
      add(this.edge(s.tx, s.ty, z + 1, s.side));
      return out;
    }
    if (def.placement !== Placement.Cell) return out;
    const tiles = this.grid.footprintTiles(def.id, s.tx, s.ty, gridRot(def, s.rot));
    for (const [x, y] of tiles) {
      if (def.layer === LAYER_DECK) {
        for (const [ex, ey, side] of StructureIndex.tileEdges(x, y)) add(this.edge(ex, ey, z, side));
        for (let la = 1; la < 4; la++) add(this.cell(x, y, z, la));
        for (const [dx, dy] of NEIGH) add(this.deck(x + dx, y + dy, z));
      } else if (def.supportsAbove) { add(this.deck(x, y, z + 1)); add(this.cell(x, y, z + 1, LAYER_STRUCT)); }
    }
    return out;
  }
}
const NEIGH = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export const StructureIndexRes = defineResource<StructureIndex>("gameplay.StructureIndex");
export function structures(world: World): StructureIndex {
  let s = world.getResource(StructureIndexRes);
  if (!s) world.setResource(StructureIndexRes, (s = new StructureIndex(world, gameplayDefs(world))));
  return s;
}

/** Slot from a piece position (Transform x/y, level) + BuildPiece.rot. */
export function slotFromPos(def: PieceDef, x: number, y: number, z: number, rot: number): Slot {
  const edgeLike = def.placement === Placement.Edge || (def.placement === Placement.Opening && def.fits !== 4);
  if (edgeLike) {
    const side = rot & 1 ? EdgeSide.West : EdgeSide.North;
    return side === EdgeSide.North ? { tx: Math.floor(x), ty: Math.round(y), z, side, rot } : { tx: Math.round(x), ty: Math.floor(y), z, side, rot };
  }
  if (def.placement === Placement.Opening) return { tx: Math.floor(x), ty: Math.floor(y), z, side: EdgeSide.None, rot };
  const [tx, ty] = anchorFor(def, x, y, gridRot(def, rot));
  return { tx, ty, z, side: EdgeSide.None, rot };
}
/** Derive a slot from replicated/loaded Transform + BuildPiece. */
export function deriveSlot(world: World, e: Entity, def: PieceDef): Slot {
  const tf = world.get(e, Transform)!;
  return slotFromPos(def, tf.x, tf.y, Math.round(tf.z / gameplayDefs(world).building.levelHeight), world.getField(e, BuildPiece, "rot")!);
}
/** Parent (host) of an opening at a slot. */
export function openingParent(idx: StructureIndex, def: PieceDef, slot: Slot): Entity | 0 {
  return slot.side !== EdgeSide.None ? idx.edge(slot.tx, slot.ty, slot.z, slot.side) : idx.deck(slot.tx, slot.ty, slot.z);
}

/**
 * Both peers: index BuildPiece entities that are not yet indexed (replicated / loaded), link PieceLink attachments,
 * and drop removed pieces from the index.
 */
export function structureIndexSystem(world: World): void {
  const idx = structures(world);
  for (const e of world.removed(BuildPiece)) idx.removePieceByEntity(e);
  for (const e of world.query([BuildPiece, Transform], [PieceSlot])) {
    const def = idx.def(e); if (!def) continue;
    const slot = deriveSlot(world, e, def);
    const parent: Entity | 0 = def.placement === Placement.Opening ? openingParent(idx, def, slot) : 0;
    if (def.placement === Placement.Opening && !parent) continue; // parent not streamed yet: retry next tick
    idx.addPiece(e, slot, parent);
    if (world.has(e, PieceStability)) idx.dirty.add(e);
  }
  for (const a of world.query([PieceLink])) {
    if (world.getResource(LinkedRes)?.has(a)) continue;
    const l = world.get(a, PieceLink)!;
    const p = idx.atSlot(l.tx, l.ty, l.z, l.side as EdgeSide, l.layer);
    if (p) { linkAttachment(world, p, a); let m = world.getResource(LinkedRes); if (!m) world.setResource(LinkedRes, (m = new Set())); m.add(a); }
  }
}
const LinkedRes = defineResource<Set<Entity>>("gameplay.LinkedAttachments");
export function markLinked(world: World, a: Entity): void { let m = world.getResource(LinkedRes); if (!m) world.setResource(LinkedRes, (m = new Set())); m.add(a); }
export function unmarkLinked(world: World, a: Entity): void { world.getResource(LinkedRes)?.delete(a); }

export type { AttachKind };
