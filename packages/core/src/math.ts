export interface Vec2 { x: number; y: number }
export const vec2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerpAngle = (a: number, b: number, t: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
export const dist2 = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
/** Wraps an angle to [-π, π] (Transform.facing wire range). */
export const normalizeAngle = (a: number): number => { const t = Math.PI * 2; let r = ((a + Math.PI) % t + t) % t - Math.PI; if (r === -Math.PI && a > 0) r = Math.PI; return r; };
