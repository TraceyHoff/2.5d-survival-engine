/**
 * VRAM bookkeeping for the atlas arrays and streamed wearable pages.
 *
 * - VramAccountant: bytes resident vs textureBudgetMB (gl/capabilities), split into resident (always-on arrays:
 *   world art, bodies) and streamed (pool slots in use), plus page-in / eviction counters. Mip chains are counted
 *   (x4/3) by the callers' byte estimates.
 * - PageLRU: fixed slot pool for lazily paged atlases with refcounts (LayerCache entries holding a page) and
 *   last-use stamps. Eviction picks unpinned pages first (refcount 0), least recently used; pages used in the
 *   current frame are never evicted.
 * Both are pure (no GL) and unit-tested.
 */

/** RGBA8 bytes of a w x h image (one array layer region), optionally with a full mip chain (x4/3). */
export function rgbaBytes(w: number, h: number, mips = true): number { return w * h * 4 * (mips ? 4 / 3 : 1); }

export interface VramStats {
  budgetMB: number; residentMB: number; streamedMB: number; totalMB: number; reservedMB: number;
  pagesResident: number; pageSlots: number; pageIns: number; evictions: number; pending: number; /** cumulative layer draws that showed the fallback (page not resident) */ misses: number;
  /** total <= budget (reserved pool included) */ withinBudget: boolean;
}

export class VramAccountant {
  /** Bytes of always-resident arrays (incl. empty pool layers: the storage is allocated even when unused). */
  residentBytes = 0;
  /** Bytes of the pool storage (reserved inside residentBytes' allocation, counted separately). */
  reservedBytes = 0;
  /** Bytes of pool slots that currently hold a page. */
  streamedBytes = 0;
  pageIns = 0; evictions = 0; misses = 0; pending = 0; pagesResident = 0; pageSlots = 0;
  constructor(public budgetBytes: number) {}
  static mb(b: number): number { return Math.round((b / 1048576) * 10) / 10; }
  setResident(bytes: number, reserved = 0): void { this.residentBytes = bytes; this.reservedBytes = reserved; this.streamedBytes = 0; this.pagesResident = 0; }
  pageIn(bytes: number): void { this.streamedBytes += bytes; this.pageIns++; this.pagesResident++; }
  evict(bytes: number): void { this.streamedBytes = Math.max(0, this.streamedBytes - bytes); this.evictions++; this.pagesResident = Math.max(0, this.pagesResident - 1); }
  /** GPU bytes allocated (resident arrays + reserved pool). */
  get allocatedBytes(): number { return this.residentBytes + this.reservedBytes; }
  get withinBudget(): boolean { return this.allocatedBytes <= this.budgetBytes; }
  /** Bytes free for more pool storage. */
  get headroomBytes(): number { return Math.max(0, this.budgetBytes - this.allocatedBytes); }
  stats(): VramStats {
    const m = VramAccountant.mb;
    return { budgetMB: m(this.budgetBytes), residentMB: m(this.residentBytes), streamedMB: m(this.streamedBytes), reservedMB: m(this.reservedBytes),
      totalMB: m(this.allocatedBytes), pagesResident: this.pagesResident, pageSlots: this.pageSlots, pageIns: this.pageIns,
      evictions: this.evictions, pending: this.pending, misses: this.misses, withinBudget: this.withinBudget };
  }
}

interface PageEntry { slot: number; refs: number; lastUsed: number }

/** Slot pool keyed by page id (atlas key). */
export class PageLRU<K = string> {
  private pages = new Map<K, PageEntry>();
  private refs = new Map<K, number>();
  private free: number[];
  /** `protectFrames`: pages used within this many frames before the current one are not evicted either (no thrash
   *  between characters on screen when the working set exceeds the pool: the overflow just draws its fallback). */
  constructor(readonly capacity: number, readonly protectFrames = 0) { this.free = Array.from({ length: capacity }, (_, i) => capacity - 1 - i); }
  get size(): number { return this.pages.size; }
  has(k: K): boolean { return this.pages.has(k); }
  slotOf(k: K): number { return this.pages.get(k)?.slot ?? -1; }
  refCount(k: K): number { return this.refs.get(k) ?? 0; }
  /** Refcounts survive eviction (a held page that was evicted gets paged back in on use). */
  retain(k: K): void { const n = (this.refs.get(k) ?? 0) + 1; this.refs.set(k, n); const p = this.pages.get(k); if (p) p.refs = n; }
  release(k: K): void {
    const n = Math.max(0, (this.refs.get(k) ?? 0) - 1); if (n) this.refs.set(k, n); else this.refs.delete(k);
    const p = this.pages.get(k); if (p) p.refs = n;
  }
  touch(k: K, frame: number): boolean { const p = this.pages.get(k); if (!p) return false; p.lastUsed = frame; return true; }
  /** The page that would be evicted to make room, or undefined when all pages were used in `frame` (pool full of live pages). */
  victim(frame: number): K | undefined {
    let best: K | undefined; let bp: PageEntry | undefined;
    for (const [k, p] of this.pages) {
      if (p.lastUsed >= frame - this.protectFrames) continue;
      if (!bp || (p.refs > 0 ? 1 : 0) < (bp.refs > 0 ? 1 : 0) || ((p.refs > 0) === (bp.refs > 0) && p.lastUsed < bp.lastUsed)) { best = k; bp = p; }
    }
    return best;
  }
  /**
   * Allocate a slot for `k` (stamped `frame`). Returns { slot, evicted } or null when the pool is full of pages used
   * this frame. `evicted` is the page whose slot was reused.
   */
  allocate(k: K, frame: number): { slot: number; evicted?: K } | null {
    const have = this.pages.get(k); if (have) { have.lastUsed = frame; return { slot: have.slot }; }
    let slot = this.free.pop(); let evicted: K | undefined;
    if (slot === undefined) {
      evicted = this.victim(frame); if (evicted === undefined) return null;
      slot = this.pages.get(evicted)!.slot; this.pages.delete(evicted);
    }
    this.pages.set(k, { slot, refs: this.refs.get(k) ?? 0, lastUsed: frame });
    return evicted === undefined ? { slot } : { slot, evicted };
  }
  /** True when allocate(k, frame) would succeed (resident, a free slot, or an evictable page). */
  canAllocate(k: K, frame: number): boolean { return this.pages.has(k) || this.free.length > 0 || this.victim(frame) !== undefined; }
  remove(k: K): void { const p = this.pages.get(k); if (!p) return; this.pages.delete(k); this.free.push(p.slot); }
  keys(): K[] { return [...this.pages.keys()]; }
}
