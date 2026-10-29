import type { Entity } from "@engine/core";
import { chunkKey, tileToChunk, type ChunkKey } from "./chunk.js";
import type { ChunkMembership } from "./membership.js";

export interface InterestOptions {
  /** Chunks within this Chebyshev radius become relevant. */
  radius?: number;
  /** Relevant chunks stay relevant until beyond radius + hysteresis. */
  hysteresis?: number;
}
export interface ClientInterest {
  readonly chunks: ReadonlySet<ChunkKey>;
  readonly entities: ReadonlySet<Entity>;
  /** Deltas produced by the last update(). */
  readonly enteredChunks: readonly ChunkKey[]; readonly leftChunks: readonly ChunkKey[];
  readonly entered: readonly Entity[]; readonly left: readonly Entity[];
}
export interface Viewpoint { x: number; y: number; /** chunk radius (default grid radius) */ r?: number }
interface State { views: { x: number; y: number; r: number }[]; chunks: Set<ChunkKey>; entities: Set<Entity>; enteredChunks: ChunkKey[]; leftChunks: ChunkKey[]; entered: Entity[]; left: Entity[]; always: Set<Entity>;
  /** ADR-212 reuse: viewer chunk window signature, membership version, always-set version, spare (double-buffered) sets. */
  sig: number[]; ver: number; alwaysVer: number; alwaysSeen: number; spareChunks?: Set<ChunkKey>; spareEntities?: Set<Entity> }

/**
 * Per-client relevancy from chunk membership. Cost per update: O(clients x chunks-in-radius + nearby entities);
 * never O(clients x all entities). Netcode consumes enter/leave sets per tick.
 */
export class InterestGrid {
  readonly radius: number; readonly hysteresis: number;
  private clients = new Map<number, State>();
  constructor(private membership: ChunkMembership, opts: InterestOptions = {}) {
    this.radius = opts.radius ?? 2; this.hysteresis = opts.hysteresis ?? 1;
  }
  /** Single-viewpoint shorthand for setClientViewpoints(id, [{x, y, r: radius}]). */
  setClient(id: number, x: number, y: number, radius?: number): void {
    this.setClientViewpoints(id, [radius === undefined ? { x, y } : { x, y, r: radius }]);
  }
  /** Set all viewpoints of a client (player, camera, remote-controlled units...). Relevant set = union. Empty list = nothing relevant except always-relevant entities. */
  setClientViewpoints(id: number, views: readonly Viewpoint[]): void {
    let s = this.clients.get(id);
    if (!s) { s = { views: [], chunks: new Set(), entities: new Set(), enteredChunks: [], leftChunks: [], entered: [], left: [], always: new Set(), sig: [], ver: -1, alwaysVer: 0, alwaysSeen: -1 }; this.clients.set(id, s); }
    s.views = views.map((v) => ({ x: v.x, y: v.y, r: v.r ?? this.radius }));
  }
  viewpoints(id: number): readonly Viewpoint[] { return this.clients.get(id)?.views ?? []; }
  removeClient(id: number): void { this.clients.delete(id); }
  /** Entities always relevant to a client regardless of position (own player, environment singleton, party). */
  setAlwaysRelevant(id: number, entities: Iterable<Entity>): void {
    const s = this.clients.get(id); if (!s) return;
    // ADR-212: called every tick by the server; only a real change invalidates the cached relevant set
    let n = 0, same = true; for (const e of entities) { n++; if (same && !s.always.has(e)) same = false; }
    if (same && n === s.always.size) return; s.always = new Set(entities); s.alwaysVer++;
  }
  get(id: number): ClientInterest | undefined { return this.clients.get(id); }
  clientIds(): IterableIterator<number> { return this.clients.keys(); }
  isRelevant(id: number, e: Entity): boolean { return this.clients.get(id)?.entities.has(e) ?? false; }

  /** ADR-212: compares (and refreshes) the client's chunk window (cx, cy, r per viewpoint) without allocating. */
  private sameWindow(s: State): boolean {
    let same = s.sig.length === s.views.length * 3;
    for (let i = 0; i < s.views.length; i++) {
      const v = s.views[i]!; const cx = tileToChunk(v.x), cy = tileToChunk(v.y);
      if (same && (s.sig[i * 3] !== cx || s.sig[i * 3 + 1] !== cy || s.sig[i * 3 + 2] !== v.r)) same = false;
      s.sig[i * 3] = cx; s.sig[i * 3 + 1] = cy; s.sig[i * 3 + 2] = v.r;
    }
    s.sig.length = s.views.length * 3; return same;
  }
  update(): void {
    for (const s of this.clients.values()) {
      // ADR-212: viewer chunk window unchanged and no membership churn -> keep last tick's sets (no per-tick Set rebuild);
      // otherwise rebuild into the spare sets (double-buffered) instead of allocating new ones.
      const sigSame = this.sameWindow(s); const ver = this.membership.version;
      if (sigSame && ver === s.ver && s.alwaysVer === s.alwaysSeen) { if (s.enteredChunks.length) s.enteredChunks = []; if (s.leftChunks.length) s.leftChunks = []; if (s.entered.length) s.entered = []; if (s.left.length) s.left = []; continue; }
      s.ver = ver; s.alwaysSeen = s.alwaysVer;
      const vs = s.views.map((v) => ({ cx: tileToChunk(v.x), cy: tileToChunk(v.y), r: v.r }));
      const chunks = s.spareChunks ?? new Set<ChunkKey>(); chunks.clear(); s.enteredChunks = []; s.leftChunks = [];
      for (const k of s.chunks) {
        const i = k.indexOf(","); const kx = Number(k.slice(0, i)), ky = Number(k.slice(i + 1));
        if (vs.some((v) => Math.abs(kx - v.cx) <= v.r + this.hysteresis && Math.abs(ky - v.cy) <= v.r + this.hysteresis)) chunks.add(k); else s.leftChunks.push(k);
      }
      for (const v of vs) for (let dy = -v.r; dy <= v.r; dy++) for (let dx = -v.r; dx <= v.r; dx++) {
        const k = chunkKey(v.cx + dx, v.cy + dy); if (!chunks.has(k)) { chunks.add(k); s.enteredChunks.push(k); }
      }
      const ents = s.spareEntities ?? new Set<Entity>(); ents.clear(); for (const e of s.always) ents.add(e); s.entered = []; s.left = [];
      for (const k of chunks) for (const e of this.membership.entitiesIn(k)) ents.add(e);
      for (const e of ents) if (!s.entities.has(e)) s.entered.push(e);
      for (const e of s.entities) if (!ents.has(e)) s.left.push(e);
      s.spareChunks = s.chunks; s.spareEntities = s.entities; s.chunks = chunks; s.entities = ents;
    }
  }
}
