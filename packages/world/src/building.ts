import { StableIdRegistry } from "@engine/core";
import { CHUNK_SIZE, chunkKey, tileToChunk, tileToLocal, type ChunkKey } from "./chunk.js";

/**
 * Building grid: data structures + queries only. Placement rules, costs, decay and stability are owned by
 * Survival Systems (gameplay) via the hooks below.
 */
export const SUBTILE = 4;          // socket/snap resolution: 1/4 tile
export const MAX_LEVELS = 16;      // z floors 0..15
export const MAX_LAYERS = 4;       // per-cell layers, e.g. 0 floor/foundation, 1 structure/wall, 2 furniture, 3 decor

export interface Socket { /** sub-tile offset from anchor (in 1/SUBTILE tiles), before rotation */ x: number; y: number; z?: number; kind: number }
export interface BuildPieceDef {
  id: number; key: string;
  footprint: { w: number; h: number };
  /** z levels occupied (default 1). */
  levels: number;
  layer: number;
  /** Blocks movement (collision queries). */
  solid: boolean;
  cost: { resource: number; amount: number }[];
  sockets: Socket[];
  hp: number;
  /** Optional sprite/asset id (from the asset registry). */
  sprite?: number;
}
export interface RawBuildPiece {
  key: string; footprint?: { w: number; h: number }; levels?: number; layer?: number; solid?: boolean;
  cost?: { resource: string | number; amount: number }[]; sockets?: { x: number; y: number; z?: number; kind: number }[]; hp: number; sprite?: string;
}

/** Validates raw piece JSON, assigns stable ids. `resolveResource` maps resource keys to ids. */
export function loadBuildPieces(raw: RawBuildPiece[], opts: { lock?: Record<string, number>; resolveResource?: (k: string) => number | undefined; resolveSprite?: (k: string) => number | undefined } = {}): { registry: BuildPieceRegistry; lock: Record<string, number> } {
  const errors: string[] = []; const ids = new StableIdRegistry("buildPieces");
  const keys = raw.map((r) => r.key);
  for (const [i, r] of raw.entries()) {
    if (!r.key || !/^[a-z0-9_]+$/.test(r.key)) errors.push(`[${i}] bad key "${r.key}"`);
    if (keys.indexOf(r.key) !== i) errors.push(`[${i}] duplicate key ${r.key}`);
    const fp = r.footprint ?? { w: 1, h: 1 };
    if (!(fp.w >= 1 && fp.h >= 1 && fp.w <= CHUNK_SIZE && fp.h <= CHUNK_SIZE)) errors.push(`${r.key}: bad footprint`);
    if (!(r.hp > 0)) errors.push(`${r.key}: hp must be > 0`);
    if ((r.layer ?? 1) >= MAX_LAYERS) errors.push(`${r.key}: layer out of range`);
    if ((r.levels ?? 1) < 1 || (r.levels ?? 1) > MAX_LEVELS) errors.push(`${r.key}: levels out of range`);
    for (const c of r.cost ?? []) {
      if (!(c.amount > 0 && Number.isInteger(c.amount))) errors.push(`${r.key}: bad cost amount`);
      if (typeof c.resource === "string" && opts.resolveResource && opts.resolveResource(c.resource) === undefined) errors.push(`${r.key}: unknown resource ${c.resource}`);
    }
  }
  if (errors.length) throw new Error(`BuildPiece validation failed:\n${errors.join("\n")}`);
  const lock = ids.assign(keys, opts.lock);
  const defs = raw.map<BuildPieceDef>((r) => ({
    id: ids.id(r.key), key: r.key, footprint: r.footprint ?? { w: 1, h: 1 }, levels: r.levels ?? 1, layer: r.layer ?? 1, solid: r.solid ?? true,
    cost: (r.cost ?? []).map((c) => ({ resource: typeof c.resource === "number" ? c.resource : opts.resolveResource?.(c.resource) ?? 0, amount: c.amount })),
    sockets: r.sockets ?? [], hp: r.hp,
    ...(r.sprite !== undefined && opts.resolveSprite?.(r.sprite) !== undefined ? { sprite: opts.resolveSprite(r.sprite)! } : {}),
  }));
  return { registry: new BuildPieceRegistry(defs, ids), lock };
}
export class BuildPieceRegistry {
  private byId = new Map<number, BuildPieceDef>();
  constructor(defs: BuildPieceDef[], readonly ids?: StableIdRegistry) { for (const d of defs) this.byId.set(d.id, d); }
  get(id: number): BuildPieceDef { const d = this.byId.get(id); if (!d) throw new Error(`unknown piece ${id}`); return d; }
  byKey(key: string): BuildPieceDef { for (const d of this.byId.values()) if (d.key === key) return d; throw new Error(`unknown piece ${key}`); }
  all(): IterableIterator<BuildPieceDef> { return this.byId.values(); }
  get hash(): number { return this.ids?.hash ?? 0; }
}

export interface EnclosureResult { enclosed: boolean; roofed: boolean; size: number }
export const enum BuildingChangeKind { Placed = 0, Removed = 1, Hp = 2 }
export interface BuildingChange { kind: BuildingChangeKind; id: number; piece: number; tx: number; ty: number; z: number; rot: number; hp: number; key: ChunkKey }
export interface PieceInstance { id: number; piece: number; tx: number; ty: number; z: number; rot: number; hp: number }
export interface PlaceCheck { ok: boolean; blockers: number[]; outOfRange?: boolean }
/** Per-chunk structure layer: sparse occupancy (level, layer, local tile) -> instance id, plus anchored instances. */
export class StructureLayer {
  readonly cells = new Map<number, number>();
  /** Instance ids whose anchor tile is in this chunk (persisted with the chunk). */
  readonly anchored = new Set<number>();
  constructor(readonly key: ChunkKey) {}
}
const cellIndex = (lx: number, ly: number, z: number, layer: number): number => ((z * MAX_LAYERS + layer) * CHUNK_SIZE + ly) * CHUNK_SIZE + lx;

export class BuildingGrid {
  private layers = new Map<ChunkKey, StructureLayer>();
  private instances = new Map<number, PieceInstance>();
  private nextId = 1;
  onPlace?: (inst: PieceInstance) => void;
  onRemove?: (inst: PieceInstance) => void;
  /** Stability hook owned by gameplay: return false to mark an instance unsupported (e.g. to collapse). */
  stabilityRule?: (grid: BuildingGrid, inst: PieceInstance) => boolean;
  /** Bumped on every place/remove; invalidates shelter caches. */
  version = 0;
  /** Layers that count as roof/floor above a tile for isCovered (default [0]). */
  roofLayers: readonly number[] = [0];
  /** Layers whose solid pieces bound rooms in enclosure() (default [1]). */
  wallLayers: readonly number[] = [1];
  private enclosureCache = new Map<string, EnclosureResult>();
  private cacheVersion = -1;
  private changes: BuildingChange[] = [];
  /** Set false to stop recording (e.g. while bulk-loading chunks from disk). */
  recordChanges = true;
  constructor(readonly pieces: BuildPieceRegistry) {}
  private rec(kind: BuildingChangeKind, i: PieceInstance): void {
    if (this.recordChanges) this.changes.push({ kind, id: i.id, piece: i.piece, tx: i.tx, ty: i.ty, z: i.z, rot: i.rot, hp: i.hp, key: chunkKey(tileToChunk(i.tx), tileToChunk(i.ty)) });
  }
  /** Drain building change records (placed / removed / hp) since the last drain, in mutation order. */
  buildingChanges(): BuildingChange[] { return this.changes.splice(0); }
  /** Set hp (clamped >= 0); records an Hp change when it differs. Returns false for unknown ids. */
  setHp(id: number, hp: number): boolean {
    const i = this.instances.get(id); if (!i) return false; const v = Math.max(0, hp); if (v === i.hp) return true;
    i.hp = v; this.rec(BuildingChangeKind.Hp, i); return true;
  }
  /** Subtract damage; returns remaining hp (-1 if unknown). Removal at 0 hp is gameplay's call. */
  damage(id: number, amount: number): number { const i = this.instances.get(id); if (!i) return -1; this.setHp(id, i.hp - amount); return i.hp; }
  get count(): number { return this.instances.size; }
  get(id: number): PieceInstance | undefined { return this.instances.get(id); }
  layer(k: ChunkKey): StructureLayer | undefined { return this.layers.get(k); }
  private layerFor(tx: number, ty: number): StructureLayer {
    const k = chunkKey(tileToChunk(tx), tileToChunk(ty)); let l = this.layers.get(k);
    if (!l) this.layers.set(k, (l = new StructureLayer(k))); return l;
  }
  /** Tiles covered by a piece at anchor (tx,ty) with rotation rot (0..3, 90° steps). */
  footprintTiles(pieceId: number, tx: number, ty: number, rot: number): [number, number][] {
    const d = this.pieces.get(pieceId); const odd = rot & 1; const w = odd ? d.footprint.h : d.footprint.w, h = odd ? d.footprint.w : d.footprint.h;
    const out: [number, number][] = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push([tx + x, ty + y]); return out;
  }
  /** Occupant id at tile/level/layer (0 = empty). Omit layer to get any (lowest layer first). */
  at(tx: number, ty: number, z: number, layer?: number): number {
    const l = this.layers.get(chunkKey(tileToChunk(tx), tileToChunk(ty))); if (!l) return 0;
    const lx = tileToLocal(tx), ly = tileToLocal(ty);
    if (layer !== undefined) return l.cells.get(cellIndex(lx, ly, z, layer)) ?? 0;
    for (let la = 0; la < MAX_LAYERS; la++) { const v = l.cells.get(cellIndex(lx, ly, z, la)); if (v) return v; }
    return 0;
  }
  canPlace(pieceId: number, tx: number, ty: number, z: number, rot = 0): PlaceCheck {
    const d = this.pieces.get(pieceId);
    if (z < 0 || z + d.levels > MAX_LEVELS) return { ok: false, blockers: [], outOfRange: true };
    const blockers = new Set<number>();
    for (const [x, y] of this.footprintTiles(pieceId, tx, ty, rot)) for (let lv = z; lv < z + d.levels; lv++) { const o = this.at(x, y, lv, d.layer); if (o) blockers.add(o); }
    return { ok: blockers.size === 0, blockers: [...blockers] };
  }
  /** Places without rule checks beyond occupancy. Returns instance id, or 0 if blocked. */
  place(pieceId: number, tx: number, ty: number, z: number, rot = 0, hp?: number): number {
    if (!this.canPlace(pieceId, tx, ty, z, rot).ok) return 0;
    const d = this.pieces.get(pieceId); const id = this.nextId++;
    const inst: PieceInstance = { id, piece: pieceId, tx, ty, z, rot: rot & 3, hp: hp ?? d.hp };
    this.instances.set(id, inst); this.layerFor(tx, ty).anchored.add(id);
    this.writeCells(inst, id); this.version++; this.rec(BuildingChangeKind.Placed, inst); this.onPlace?.(inst); return id;
  }
  remove(id: number): boolean {
    const inst = this.instances.get(id); if (!inst) return false;
    this.writeCells(inst, 0); this.layerFor(inst.tx, inst.ty).anchored.delete(id); this.instances.delete(id);
    this.version++; this.rec(BuildingChangeKind.Removed, inst); this.onRemove?.(inst); return true;
  }
  private writeCells(inst: PieceInstance, v: number): void {
    const d = this.pieces.get(inst.piece);
    for (const [x, y] of this.footprintTiles(inst.piece, inst.tx, inst.ty, inst.rot)) {
      const l = this.layerFor(x, y);
      for (let lv = inst.z; lv < inst.z + d.levels; lv++) { const ci = cellIndex(tileToLocal(x), tileToLocal(y), lv, d.layer); if (v) l.cells.set(ci, v); else l.cells.delete(ci); }
    }
  }
  /** Collision: true if any solid piece occupies the tile at level z. */
  isBlocked(tx: number, ty: number, z = 0): boolean {
    for (let la = 0; la < MAX_LAYERS; la++) { const id = this.at(tx, ty, z, la); if (id && this.pieces.get(this.instances.get(id)!.piece).solid) return true; }
    return false;
  }
  /** Instance ids overlapping a tile rect (inclusive), optionally filtered to level z. */
  queryRect(minTx: number, minTy: number, maxTx: number, maxTy: number, z?: number): number[] {
    const out = new Set<number>();
    for (let y = minTy; y <= maxTy; y++) for (let x = minTx; x <= maxTx; x++) {
      if (z !== undefined) { for (let la = 0; la < MAX_LAYERS; la++) { const v = this.at(x, y, z, la); if (v) out.add(v); } }
      else for (let lv = 0; lv < MAX_LEVELS; lv++) for (let la = 0; la < MAX_LAYERS; la++) { const v = this.at(x, y, lv, la); if (v) out.add(v); }
    }
    return [...out];
  }
  /** Support graph: instances directly below (level z-1, any layer) overlapping this footprint. */
  supportsOf(id: number): number[] {
    const i = this.instances.get(id); if (!i || i.z === 0) return [];
    const out = new Set<number>();
    for (const [x, y] of this.footprintTiles(i.piece, i.tx, i.ty, i.rot)) for (let la = 0; la < MAX_LAYERS; la++) { const v = this.at(x, y, i.z - 1, la); if (v && v !== id) out.add(v); }
    return [...out];
  }
  /** Inverse support edges: instances resting on this one. */
  dependentsOf(id: number): number[] {
    const i = this.instances.get(id); if (!i) return [];
    const top = i.z + this.pieces.get(i.piece).levels; const out = new Set<number>();
    for (const [x, y] of this.footprintTiles(i.piece, i.tx, i.ty, i.rot)) for (let la = 0; la < MAX_LAYERS; la++) { const v = this.at(x, y, top, la); if (v && v !== id) out.add(v); }
    return [...out];
  }
  /** Same-level instances sharing an edge with the footprint. */
  neighborsOf(id: number): number[] {
    const i = this.instances.get(id); if (!i) return [];
    const tiles = this.footprintTiles(i.piece, i.tx, i.ty, i.rot); const own = new Set(tiles.map(([x, y]) => `${x},${y}`)); const out = new Set<number>();
    for (const [x, y] of tiles) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (own.has(`${x + dx},${y + dy}`)) continue;
      for (let la = 0; la < MAX_LAYERS; la++) { const v = this.at(x + dx, y + dy, i.z, la); if (v && v !== id) out.add(v); }
    }
    return [...out];
  }
  /** Runs stabilityRule over the given instances (default all); returns unstable ids (gameplay decides what to do). */
  unstable(ids: Iterable<number> = this.instances.keys()): number[] {
    const rule = this.stabilityRule; if (!rule) return [];
    const out: number[] = []; for (const id of ids) { const i = this.instances.get(id); if (i && !rule(this, i)) out.push(id); } return out;
  }
  /** Sockets of an instance in world sub-tile coordinates (rotation applied about the anchor footprint). */
  socketsOf(id: number): { sx: number; sy: number; z: number; kind: number }[] {
    const i = this.instances.get(id); if (!i) return [];
    const d = this.pieces.get(i.piece); const W = d.footprint.w * SUBTILE, H = d.footprint.h * SUBTILE;
    return d.sockets.map((s) => {
      let x = s.x, y = s.y;
      for (let r = 0; r < i.rot; r++) { const nx = (r % 2 === 0 ? H : W) - y; y = x; x = nx; }
      return { sx: i.tx * SUBTILE + x, sy: i.ty * SUBTILE + y, z: i.z + (s.z ?? 0), kind: s.kind };
    });
  }
  /** Nearest socket (of `kind` if given) within maxDist sub-tiles of (sx,sy) at level z. */
  snap(sx: number, sy: number, z: number, opts: { kind?: number; maxDist?: number } = {}): { sx: number; sy: number; z: number; kind: number; owner: number } | undefined {
    const md = opts.maxDist ?? SUBTILE; let best: ReturnType<BuildingGrid["snap"]>; let bd = md * md;
    const t0x = Math.floor((sx - md) / SUBTILE) - CHUNK_SIZE, t1x = Math.floor((sx + md) / SUBTILE), t0y = Math.floor((sy - md) / SUBTILE) - CHUNK_SIZE, t1y = Math.floor((sy + md) / SUBTILE);
    // candidate instances: anchored in chunks overlapping the (expanded) area
    const seen = new Set<number>();
    for (let cy = tileToChunk(t0y); cy <= tileToChunk(t1y); cy++) for (let cx = tileToChunk(t0x); cx <= tileToChunk(t1x); cx++) {
      const l = this.layers.get(chunkKey(cx, cy)); if (!l) continue;
      for (const id of l.anchored) { if (seen.has(id)) continue; seen.add(id);
        for (const s of this.socketsOf(id)) {
          if (s.z !== z || (opts.kind !== undefined && s.kind !== opts.kind)) continue;
          const d2 = (s.sx - sx) ** 2 + (s.sy - sy) ** 2; if (d2 <= bd) { bd = d2; best = { ...s, owner: id }; }
        }
      }
    }
    return best;
  }
  // ---------- shelter / exposure queries (data only; rules live in gameplay) ----------
  /** True if any roof-layer piece exists at this tile on a level above z. */
  isCovered(tx: number, ty: number, z: number): boolean {
    for (let lv = Math.floor(z) + 1; lv < MAX_LEVELS; lv++) for (const la of this.roofLayers) if (this.at(tx, ty, lv, la)) return true;
    return false;
  }
  private isWall(tx: number, ty: number, z: number): boolean {
    for (const la of this.wallLayers) { const id = this.at(tx, ty, z, la); if (id && this.pieces.get(this.instances.get(id)!.piece).solid) return true; }
    return false;
  }
  /**
   * Bounded 4-neighbour flood fill over non-wall tiles at level z starting at (tx,ty). Enclosed when the fill
   * terminates within maxCells; `roofed` when every filled tile is covered. Results are cached per tile and
   * invalidated whenever a piece is placed or removed.
   */
  enclosure(tx: number, ty: number, z: number, maxCells = 256): EnclosureResult {
    if (this.cacheVersion !== this.version) { this.enclosureCache.clear(); this.cacheVersion = this.version; }
    const lv = Math.floor(z); const key = `${tx},${ty},${lv},${maxCells}`; const hit = this.enclosureCache.get(key); if (hit) return hit;
    if (this.isWall(tx, ty, lv)) { const r = { enclosed: false, roofed: false, size: 0 }; this.enclosureCache.set(key, r); return r; }
    const seen = new Set<string>([`${tx},${ty}`]); const stack: [number, number][] = [[tx, ty]]; let roofed = true; let open = false;
    while (stack.length) {
      const [x, y] = stack.pop()!; if (roofed && !this.isCovered(x, y, lv)) roofed = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`; if (seen.has(k) || this.isWall(nx, ny, lv)) continue;
        seen.add(k); if (seen.size > maxCells) { open = true; break; } stack.push([nx, ny]);
      }
      if (open) break;
    }
    const r: EnclosureResult = open ? { enclosed: false, roofed: false, size: seen.size } : { enclosed: true, roofed, size: seen.size };
    if (!open) for (const k of seen) this.enclosureCache.set(`${k},${lv},${maxCells}`, r); else this.enclosureCache.set(key, r);
    return r;
  }
  /**
   * Weather exposure in [0,1] at a world position: 0 inside an enclosed roofed room; otherwise roof cover halves it and
   * each solid wall tile within 3 tiles upwind (opposite windDir, the direction the wind blows toward) cuts 25%.
   * A heuristic for gameplay to scale wetness/wind chill; gameplay may ignore it and compose its own.
   */
  exposure(x: number, y: number, z: number, windDir?: number): number {
    const tx = Math.floor(x), ty = Math.floor(y), lv = Math.floor(z);
    const enc = this.enclosure(tx, ty, lv);
    if (enc.enclosed && enc.roofed) return 0;
    let e = this.isCovered(tx, ty, lv) ? 0.5 : 1;
    if (enc.enclosed) e *= 0.5;
    if (windDir !== undefined) {
      const ux = -Math.cos(windDir), uy = -Math.sin(windDir); let blocked = 0;
      for (let k = 1; k <= 3; k++) if (this.isWall(Math.floor(x + ux * k), Math.floor(y + uy * k), lv)) blocked++;
      e *= Math.max(0, 1 - 0.25 * blocked);
    }
    return e;
  }
  /** Instances anchored in a chunk (for persistence). */
  anchoredIn(k: ChunkKey): PieceInstance[] { return [...(this.layers.get(k)?.anchored ?? [])].map((id) => this.instances.get(id)!); }
  /** Drop all instances anchored in a chunk (on unload). */
  unloadChunk(k: ChunkKey): void { for (const i of this.anchoredIn(k)) { this.writeCells(i, 0); this.instances.delete(i.id); } this.layers.get(k)?.anchored.clear(); if (!this.layers.get(k)?.cells.size) this.layers.delete(k); }
}
