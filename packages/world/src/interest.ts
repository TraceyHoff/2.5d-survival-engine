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
interface State { views: { x: number; y: number; r: number }[]; chunks: Set<ChunkKey>; entities: Set<Entity>; enteredChunks: ChunkKey[]; leftChunks: ChunkKey[]; entered: Entity[]; left: Entity[]; always: Set<Entity> }

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
    if (!s) { s = { views: [], chunks: new Set(), entities: new Set(), enteredChunks: [], leftChunks: [], entered: [], left: [], always: new Set() }; this.clients.set(id, s); }
    s.views = views.map((v) => ({ x: v.x, y: v.y, r: v.r ?? this.radius }));
  }
  viewpoints(id: number): readonly Viewpoint[] { return this.clients.get(id)?.views ?? []; }
  removeClient(id: number): void { this.clients.delete(id); }
  /** Entities always relevant to a client regardless of position (own player, environment singleton, party). */
  setAlwaysRelevant(id: number, entities: Iterable<Entity>): void { const s = this.clients.get(id); if (s) s.always = new Set(entities); }
  get(id: number): ClientInterest | undefined { return this.clients.get(id); }
  clientIds(): IterableIterator<number> { return this.clients.keys(); }
  isRelevant(id: number, e: Entity): boolean { return this.clients.get(id)?.entities.has(e) ?? false; }

  update(): void {
    for (const s of this.clients.values()) {
      const vs = s.views.map((v) => ({ cx: tileToChunk(v.x), cy: tileToChunk(v.y), r: v.r }));
      const chunks = new Set<ChunkKey>(); s.enteredChunks = []; s.leftChunks = [];
      for (const k of s.chunks) {
        const i = k.indexOf(","); const kx = Number(k.slice(0, i)), ky = Number(k.slice(i + 1));
        if (vs.some((v) => Math.abs(kx - v.cx) <= v.r + this.hysteresis && Math.abs(ky - v.cy) <= v.r + this.hysteresis)) chunks.add(k); else s.leftChunks.push(k);
      }
      for (const v of vs) for (let dy = -v.r; dy <= v.r; dy++) for (let dx = -v.r; dx <= v.r; dx++) {
        const k = chunkKey(v.cx + dx, v.cy + dy); if (!chunks.has(k)) { chunks.add(k); s.enteredChunks.push(k); }
      }
      const ents = new Set<Entity>(s.always); s.entered = []; s.left = [];
      for (const k of chunks) for (const e of this.membership.entitiesIn(k)) ents.add(e);
      for (const e of ents) if (!s.entities.has(e)) s.entered.push(e);
      for (const e of s.entities) if (!ents.has(e)) s.left.push(e);
      s.chunks = chunks; s.entities = ents;
    }
  }
}
