/**
 * Camper interior pass ordering (pure; SpriteBatch.drawInterior draws the result with depth test off so the floor is
 * never clipped by terrain): floor -> far walls -> occupants -> near walls. A wall is "near" when it sits in front of
 * the frontmost occupant (larger iso key x + y), i.e. it would hide them: faded to NEAR_WALL_ALPHA (or cut = dropped).
 */
export const InteriorRoute = { None: 0, Floor: 1, Wall: 2, Occupant: 3 } as const;
export const NEAR_WALL_ALPHA = 0.18;
export interface InteriorRegion { cx: number; cy: number; heading: number; length: number; width: number }

/** World point inside a region's footprint (+margin tiles). */
export function inInteriorRegion(r: InteriorRegion, x: number, y: number, margin = 0.15): boolean {
  const dx = x - r.cx, dy = y - r.cy, c = Math.cos(r.heading), s = Math.sin(r.heading);
  const u = dx * c + dy * s, v = -dx * s + dy * c;
  return Math.abs(u) <= r.length / 2 + margin && Math.abs(v) <= r.width / 2 + margin;
}

/**
 * Draw order for n instances (route[i], key[i]); returns indices and a per-index alpha multiplier (1, NEAR_WALL_ALPHA).
 * `cut`: near walls are dropped instead of faded. Without occupants the region centre key stands in for them.
 */
export function interiorOrder(route: ArrayLike<number>, key: ArrayLike<number>, n: number, cut = false, centreKey = -Infinity): { order: number[]; alpha: Float32Array } {
  let occMax = -Infinity; for (let i = 0; i < n; i++) if (route[i] === InteriorRoute.Occupant) occMax = Math.max(occMax, key[i]!);
  if (occMax === -Infinity) occMax = centreKey;
  const alpha = new Float32Array(n).fill(1);
  const near = (i: number) => route[i] === InteriorRoute.Wall && key[i]! > occMax + 0.05;
  const band = (i: number) => route[i] === InteriorRoute.Floor ? 0 : route[i] === InteriorRoute.Occupant ? 2 : near(i) ? 3 : 1;
  const order: number[] = [];
  for (let i = 0; i < n; i++) { if (near(i)) { if (cut) continue; alpha[i] = NEAR_WALL_ALPHA; } order.push(i); }
  order.sort((a, b) => band(a) - band(b) || key[a]! - key[b]! || a - b);
  return { order, alpha };
}
