/**
 * Building tier streaming: building_t1..t4 pages are loaded only for the tiers present nearby. Each update counts the
 * nearby pieces per streamed tier page; a tier is retained (AtlasManager.retainSprite: refcount + prefetch) when its
 * count goes 0 -> >0 and released when it drops back to 0, so the pool's LRU may evict it for another tier.
 * No allocation per update (counts and held maps are reused).
 */
export interface TierPages { retainSprite(id: number): void; releaseSprite(id: number): void; streamClass(id: number): string | null; pageKey(id: number): string | null }

export class BuildingTierStreamer {
  /** page key -> nearby piece count (this update) */
  readonly counts = new Map<string, number>();
  /** page key -> sprite id holding its refcount */
  private readonly held = new Map<string, number>();
  private readonly rep = new Map<string, number>();
  /** spriteId -> page key ("" = not a streamed building tier); cached */
  private readonly keyOf = new Map<number, string>();
  retains = 0; releases = 0;
  constructor(private readonly pages: TierPages) {}

  begin(): void { for (const k of this.counts.keys()) this.counts.set(k, 0); }
  /** One nearby piece drawn with this sprite. */
  add(spriteId: number): void {
    let k = this.keyOf.get(spriteId);
    if (k === undefined) { k = this.pages.streamClass(spriteId) === "bld" ? this.pages.pageKey(spriteId) ?? "" : ""; this.keyOf.set(spriteId, k); }
    if (!k) return;
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1); if (!this.rep.has(k)) this.rep.set(k, spriteId);
  }
  /** Apply: retain newly present tiers, release tiers no longer nearby. */
  end(): void {
    for (const [k, n] of this.counts) {
      const h = this.held.get(k);
      if (n > 0 && h === undefined) { const id = this.rep.get(k)!; this.pages.retainSprite(id); this.held.set(k, id); this.retains++; }
      else if (n === 0 && h !== undefined) { this.pages.releaseSprite(h); this.held.delete(k); this.releases++; }
    }
  }
  /** Tiers currently retained (diagnostics). */
  heldKeys(): string[] { return [...this.held.keys()].sort(); }
  /** Release everything (atlas rebuild: sprite ids / pools change). */
  reset(): void { for (const id of this.held.values()) this.pages.releaseSprite(id); this.held.clear(); this.counts.clear(); this.rep.clear(); this.keyOf.clear(); }
}
