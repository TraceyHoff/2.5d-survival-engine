/** Deterministic per-(seed,cx,cy) hash value in [0,1). */
export function hash2(seed: number, x: number, y: number): number {
  let h = Math.imul(seed ^ Math.imul(x | 0, 0x27d4eb2d), 0x165667b1) ^ Math.imul(y | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth value noise in [0,1). */
export function valueNoise(seed: number, x: number, y: number, scale: number): number {
  const fx = x / scale, fy = y / scale, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash2(seed, x0, y0), b = hash2(seed, x0 + 1, y0), c = hash2(seed, x0, y0 + 1), d = hash2(seed, x0 + 1, y0 + 1);
  return a + (b - a) * s(tx) + (c - a) * s(ty) + (a - b - c + d) * s(tx) * s(ty);
}
