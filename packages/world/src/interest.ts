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
interface State { x: number; y: number; radius: number; chunks: Set<ChunkKey>; entities: Set<Entity>; enteredChunks: ChunkKey[]; leftChunks: ChunkKey[]; entered: Entity[]; left: Entity[]; always: Set<Entity> }

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
  /** Add/move a client's viewpoint (tile units). Optional per-client radius override. */
  setClient(id: number, x: number, y: number, radius?: number): void {
    let s = this.clients.get(id);
    if (!s) { s = { x, y, radius: radius ?? this.radius, chunks: new Set(), entities: new Set(), enteredChunks: [], leftChunks: [], entered: [], left: [], always: new Set() }; this.clients.set(id, s); }
    s.x = x; s.y = y; if (radius !== undefined) s.radius = radius;
  }
  removeClient(id: number): void { this.clients.delete(id); }
  /** Entities always relevant to a client regardless of position (own player, environment singleton, party). */
  setAlwaysRelevant(id: number, entities: Iterable<Entity>): void { const s = this.clients.get(id); if (s) s.always = new Set(entities); }
  get(id: number): ClientInterest | undefined { return this.clients.get(id); }
  clientIds(): IterableIterator<number> { return this.clients.keys(); }
  isRelevant(id: number, e: Entity): boolean { return this.clients.get(id)?.entities.has(e) ?? false; }

  update(): void {
    for (const s of this.clients.values()) {
      const cx = tileToChunk(s.x), cy = tileToChunk(s.y), r = s.radius, R = r + this.hysteresis;
      const chunks = new Set<ChunkKey>(); s.enteredChunks = []; s.leftChunks = [];
      for (const k of s.chunks) {
        const i = k.indexOf(","); const kx = Number(k.slice(0, i)), ky = Number(k.slice(i + 1));
        if (Math.abs(kx - cx) <= R && Math.abs(ky - cy) <= R) chunks.add(k); else s.leftChunks.push(k);
      }
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const k = chunkKey(cx + dx, cy + dy); if (!chunks.has(k)) { chunks.add(k); s.enteredChunks.push(k); }
      }
      const ents = new Set<Entity>(s.always); s.entered = []; s.left = [];
      for (const k of chunks) for (const e of this.membership.entitiesIn(k)) ents.add(e);
      for (const e of ents) if (!s.entities.has(e)) s.entered.push(e);
      for (const e of s.entities) if (!ents.has(e)) s.left.push(e);
      s.chunks = chunks; s.entities = ents;
    }
  }
}
