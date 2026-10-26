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
  /**
   * Wearable pages count against the budget: a page-in is allowed while resident arrays + pages in use + this page
   * fit. The pool's storage is allocated up front, but on lazily-committing drivers (Mali) the pages are what
   * actually consumes memory, and a pool forced over budget (no free layers) must not keep paging in.
   */
  canPageIn(bytes: number): boolean { return this.residentBytes + this.streamedBytes + bytes <= this.budgetBytes; }
  /** Bytes free for more pool storage. */
  get headroomBytes(): number { return Math.max(0, this.budgetBytes - this.allocatedBytes); }
  stats(): VramStats {
    const m = VramAccountant.mb;
    return { budgetMB: m(this.budgetBytes), residentMB: m(this.residentBytes), streamedMB: m(this.streamedBytes), reservedMB: m(this.reservedBytes),
      totalMB: m(this.allocatedBytes), pagesResident: this.pagesResident, pageSlots: this.pageSlots, pageIns: this.pageIns,
      evictions: this.evictions, pending: this.pending, misses: this.misses, withinBudget: this.withinBudget };
  }
}

interface PageEntry { slot: number; refs: number; lastUsed: number; prio: number; /** frame it was paged in */ since: number }
/** ADR-148: a live page stays at least this many frames before a nearer (non-local-player) request may take it, and only
 *  a clearly nearer request (squared distance x LIVE_STEAL_MARGIN) may: a crowd of near characters used to swap the same
 *  slots every few frames (~15 KTX2 transcodes + uploads a second -> startup / tutorial hitches). */
export const LIVE_MIN_RESIDENT_FRAMES = 120, LIVE_STEAL_MARGIN = 1.5;
/**
 * Page priority (lower = more important): 0 = the local player, else squared tile distance to them. Pages at or under
 * PRIO_NEAR (local player + characters within 12 tiles) are exempt from dress caps / ladder eviction, and a nearer
 * request may evict a farther page even inside the protect window (eviction by distance).
 */
export const PRIO_NEAR = 16; // squared tiles: characters within ~4 tiles never drop below the 1:1 mip

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
  touch(k: K, frame: number, prio = Infinity): boolean { const p = this.pages.get(k); if (!p) return false; p.prio = p.lastUsed === frame ? Math.min(p.prio, prio) : prio; p.lastUsed = frame; return true; }
  /** Best (lowest) priority the page was last drawn at (Infinity if not resident). */
  /** Frame the page was last touched/allocated (-1 if not resident). */
  lastUsedOf(k: K): number { return this.pages.get(k)?.lastUsed ?? -1; }
  prioOf(k: K): number { return this.pages.get(k)?.prio ?? Infinity; }
  /** The page that would be evicted to make room, or undefined when all pages were used in `frame` (pool full of live pages). */
  victim(frame: number, prio = Infinity): K | undefined {
    let best: K | undefined; let bp: PageEntry | undefined;
    for (const [k, p] of this.pages) {
      if (p.lastUsed >= frame - this.protectFrames) continue;
      if (!bp || (p.refs > 0 ? 1 : 0) < (bp.refs > 0 ? 1 : 0) || ((p.refs > 0) === (bp.refs > 0) && p.lastUsed < bp.lastUsed)) { best = k; bp = p; }
    }
    if (best !== undefined || !Number.isFinite(prio)) return best;
    // every page is live: a nearer request takes the farthest live page (that character drops to its fallback).
    // Pinned pages (retained by a visible character's layer set) are only taken by PRIO_NEAR requests (local player /
    // characters right next to them): otherwise two crowds on screen stole each other's wear/face pages every few
    // frames and characters flickered between dressed and body-only.
    for (const [k, p] of this.pages) if (p.prio > prio && (prio === 0 || (p.prio > prio * LIVE_STEAL_MARGIN && frame - p.since >= LIVE_MIN_RESIDENT_FRAMES)) && (p.refs === 0 || prio <= PRIO_NEAR) && (!bp || p.prio > bp.prio)) { best = k; bp = p; }
    return best;
  }
  /**
   * Allocate a slot for `k` (stamped `frame`). Returns { slot, evicted } or null when the pool is full of pages used
   * this frame. `evicted` is the page whose slot was reused.
   */
  allocate(k: K, frame: number, prio = Infinity): { slot: number; evicted?: K } | null {
    const have = this.pages.get(k); if (have) { have.lastUsed = frame; have.prio = prio; return { slot: have.slot }; }
    let slot = this.free.pop(); let evicted: K | undefined;
    if (slot === undefined) {
      evicted = this.victim(frame, prio); if (evicted === undefined) return null;
      slot = this.pages.get(evicted)!.slot; this.pages.delete(evicted);
    }
    this.pages.set(k, { slot, refs: this.refs.get(k) ?? 0, lastUsed: frame, prio, since: frame });
    return evicted === undefined ? { slot } : { slot, evicted };
  }
  /** True when allocate(k, frame) would succeed (resident, a free slot, or an evictable page). */
  canAllocate(k: K, frame: number, prio = Infinity): boolean { return this.pages.has(k) || this.free.length > 0 || this.victim(frame, prio) !== undefined; }
  remove(k: K): void { const p = this.pages.get(k); if (!p) return; this.pages.delete(k); this.free.push(p.slot); }
  keys(): K[] { return [...this.pages.keys()]; }
}
