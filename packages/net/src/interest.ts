/** Area of interest on top of @engine/world's ChunkMembership + InterestGrid (32x32-tile chunks, "cx,cy" keys). */
import { ChunkMembership, InterestGrid, chunkKeyOf, type InterestOptions } from "@engine/world";
import type { Entity, World } from "@engine/core";

export type { InterestOptions };

/** Net-facing view of per-client interest. One viewpoint per client (its first owned entity with a Transform). */
export class NetInterest {
  readonly membership: ChunkMembership;
  readonly grid: InterestGrid;
  constructor(world: World, opts: InterestOptions = {}) {
    this.membership = new ChunkMembership(world); this.membership.rebuild();
    this.grid = new InterestGrid(this.membership, opts);
  }
  /** Apply this tick's Transform changes/removals (network phase, before change bits clear). O(changed). */
  sync(): void { this.membership.update(); }
  /** Set (or clear, with no positions) a client's viewpoint. */
  setViewer(id: number, positions: readonly { x: number; y: number }[]): void {
    const p = positions[0];
    if (p) this.grid.setClient(id, p.x, p.y); else this.grid.removeClient(id);
  }
  removeViewer(id: number): void { this.grid.removeClient(id); }
  update(): void { this.grid.update(); }
  /** Entities in the client's relevant chunks (as of the last update). */
  relevant(id: number): ReadonlySet<Entity> { return this.grid.get(id)?.entities ?? EMPTY; }
  /** Is the chunk containing (x,y) relevant to the client? */
  covers(id: number, x: number, y: number): boolean { return this.grid.get(id)?.chunks.has(chunkKeyOf(x, y)) ?? false; }
}
const EMPTY: ReadonlySet<Entity> = new Set();
