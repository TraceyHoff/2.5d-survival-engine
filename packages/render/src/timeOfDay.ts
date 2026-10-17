/**
 * Time-of-day -> lighting parameters. Pure function of the TimeOfDay resource's `t` (0..1).
 */
export interface DayLighting {
  hours: number;
  /** Ambient light colour * intensity (linear, 0..1+), multiplied into the scene. */
  ambient: [number, number, number];
  /** Background / clear colour. */
  sky: [number, number, number];
  /** 0 at night, 1 at noon. */
  daylight: number;
  /** Screen-space shadow direction (iso px per px of sprite height). */
  shadowDir: [number, number];
  shadowAlpha: number;
  /** Extra warm haze near dawn/dusk (0..1). */
  haze: number;
}

type K = [hour: number, r: number, g: number, b: number];
// Ambient keyframes (colour already scaled by intensity).
const AMBIENT: K[] = [
  [0, 0.11, 0.13, 0.27], [4.5, 0.11, 0.13, 0.27], [5.6, 0.32, 0.27, 0.42], [6.5, 0.9, 0.6, 0.5],
  [8, 1.0, 0.92, 0.82], [12, 1.02, 1.0, 0.97], [16, 1.0, 0.94, 0.84], [18, 0.98, 0.62, 0.42],
  [19.2, 0.55, 0.36, 0.48], [20.3, 0.17, 0.17, 0.34], [24, 0.11, 0.13, 0.27],
];
const SKY: K[] = [
  [0, 0.02, 0.03, 0.08], [5, 0.03, 0.04, 0.1], [6.5, 0.5, 0.35, 0.35], [9, 0.35, 0.55, 0.75],
  [16, 0.35, 0.55, 0.75], [18.5, 0.55, 0.3, 0.25], [20.5, 0.04, 0.05, 0.12], [24, 0.02, 0.03, 0.08],
];

function sample(keys: K[], h: number): [number, number, number] {
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!; const a = keys[i - 1]!;
    if (h <= b[0]) {
      const t = (h - a[0]) / Math.max(1e-6, b[0] - a[0]);
      const s = t * t * (3 - 2 * t);
      return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s];
    }
  }
  const l = keys[keys.length - 1]!; return [l[1], l[2], l[3]];
}

export function computeDayLighting(t: number): DayLighting {
  const hours = (((t % 1) + 1) % 1) * 24;
  const sunArc = (hours - 6) / 12; // 0 sunrise .. 1 sunset
  const sunUp = sunArc > 0 && sunArc < 1;
  const elev = sunUp ? Math.sin(sunArc * Math.PI) : 0;
  const daylight = Math.min(1, Math.max(0, elev * 1.6));
  // Sun travels east -> west; shadows swing from screen-right to screen-left, longest at dawn/dusk.
  const az = sunArc * Math.PI;
  const len = sunUp ? Math.min(1.6, 0.35 + 0.5 / Math.max(0.3, elev)) : 0;
  const shadowDir: [number, number] = [-Math.cos(az) * len * 0.9, 0.18 + Math.sin(az) * 0.12 * len];
  const haze = Math.max(0, 1 - Math.abs(hours - 6.3) / 1.5) + Math.max(0, 1 - Math.abs(hours - 18.4) / 1.5);
  return {
    hours, ambient: sample(AMBIENT, hours), sky: sample(SKY, hours), daylight,
    shadowDir, shadowAlpha: 0.42 * Math.min(1, daylight * 2), haze: Math.min(1, haze),
  };
}
