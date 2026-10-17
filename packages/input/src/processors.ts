/** Per-binding value processors (pure). Vectors are [x, y]. */
export type Processor =
  | { type: "deadzoneRadial"; min?: number; max?: number }
  | { type: "deadzoneAxial"; min?: number; max?: number }
  | { type: "sensitivity"; value: number }
  | { type: "invert"; x?: boolean; y?: boolean }
  | { type: "curve"; exponent: number }
  | { type: "normalize" }
  | { type: "clamp"; min?: number; max?: number };
export type Vec2 = [number, number];
export const DEFAULT_STICK_DEADZONE = 0.15;
const remap = (m: number, lo: number, hi: number) => (m <= lo ? 0 : m >= hi ? 1 : (m - lo) / (hi - lo));
export function deadzoneRadial(v: Vec2, min = DEFAULT_STICK_DEADZONE, max = 0.95): Vec2 {
  const m = Math.hypot(v[0], v[1]); if (m === 0) return [0, 0]; const k = remap(m, min, max) / m; return [v[0] * k, v[1] * k];
}
export function deadzoneAxial(v: Vec2, min = DEFAULT_STICK_DEADZONE, max = 0.95): Vec2 {
  return [Math.sign(v[0]) * remap(Math.abs(v[0]), min, max), Math.sign(v[1]) * remap(Math.abs(v[1]), min, max)];
}
export function applyProcessors(v: Vec2, ps: readonly Processor[] | undefined): Vec2 {
  let [x, y] = v;
  for (const p of ps ?? []) switch (p.type) {
    case "deadzoneRadial": [x, y] = deadzoneRadial([x, y], p.min, p.max); break;
    case "deadzoneAxial": [x, y] = deadzoneAxial([x, y], p.min, p.max); break;
    case "sensitivity": x *= p.value; y *= p.value; break;
    case "invert": if (p.x ?? true) x = -x; if (p.y) y = -y; break;
    case "curve": { const m = Math.hypot(x, y); if (m > 0) { const k = Math.pow(Math.min(1, m), p.exponent) / m; x *= k; y *= k; } break; }
    case "normalize": { const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } break; }
    case "clamp": { const lo = p.min ?? -1, hi = p.max ?? 1; x = Math.max(lo, Math.min(hi, x)); y = Math.max(lo, Math.min(hi, y)); break; }
  }
  return [x, y];
}
