import { entityIndex, fieldLength, StallDisplay, type World } from "@engine/core";
import { Listings, StallHeader } from "../components.js";
import { stallListings } from "../economy/stall.js";

/**
 * Copies gameplay stall Listings (viewer-scoped) into core StallDisplay (broadcast to every observer, ADR-081) so
 * passers-by see what a stall sells. Row i = listing i: item = stock item when enabled (else 0), qty, price =
 * priceCount, currency = priceItem. Rows past StallDisplay's length (core STALL_LISTINGS) are cut off; see
 * stallDisplayRows / truncatedStallTiers. Marks changed only on a diff.
 */
export const STALL_DISPLAY_EVERY = 5;
export const stallDisplayRows = (): number => fieldLength(StallDisplay.schema.item);

export function syncGameplayStallDisplay(world: World, stall: number): boolean {
  if (!world.has(stall, StallDisplay)) world.add(stall, StallDisplay, {});
  const rows = stallDisplayRows(); const ls = stallListings(world, stall);
  const item = world.getArray(stall, StallDisplay, "item")!, qty = world.getArray(stall, StallDisplay, "qty")!;
  const price = world.getArray(stall, StallDisplay, "price")!, cur = world.getArray(stall, StallDisplay, "currency")!;
  let changed = false;
  const put = (a: { [i: number]: number }, i: number, v: number) => { if (a[i] !== v) { a[i] = v; changed = true; } };
  for (let i = 0; i < rows; i++) {
    const l = ls[i]; const on = l !== undefined && l.enabled && l.stockItem !== 0;
    put(item, i, on ? l.stockItem : 0); put(qty, i, l ? l.qty : 0); put(price, i, l ? l.priceCount : 0); put(cur, i, l ? l.priceItem : 0);
  }
  if (changed) world.store(StallDisplay).markChanged(entityIndex(stall));
  return changed;
}

export function stallDisplaySystem(world: World): void {
  if (!world.isRegistered(StallDisplay)) return;
  for (const e of [...world.query([StallHeader, Listings])].sort((a, b) => a - b)) syncGameplayStallDisplay(world, e);
}

/** Stall piece keys whose listing count exceeds the StallDisplay row count. */
export function truncatedStallTiers(pieces: readonly { key: string; stall?: { listings: number } }[], rows = stallDisplayRows()): { key: string; listings: number; rows: number }[] {
  return pieces.filter((p) => p.stall && p.stall.listings > rows).map((p) => ({ key: p.key, listings: p.stall!.listings, rows }));
}
