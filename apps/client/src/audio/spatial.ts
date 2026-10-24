/**
 * ADR-117 2.5D spatial audio math (pure). Listener = camera focus (the local player when there is one).
 * Distance attenuation in tiles, stereo pan from the iso screen x offset ((dx - dy) * tileW/2), and a simple lowpass
 * when the listener is indoors (under a roof) and the source is outside it (or for outdoor weather/ambience beds).
 */
export interface Vec2 { x: number; y: number }
export interface SpatialOpts { refDist?: number; maxDist?: number; panWidth?: number; indoors?: boolean; sourceIndoors?: boolean }
export interface SpatialOut { gain: number; pan: number; lowpassHz: number; audible: boolean }
export const OPEN_HZ = 20000, OCCLUDED_HZ = 900;
/** Linear-in-dB-ish rolloff: 1 inside refDist, smooth fade to 0 at maxDist. */
export function attenuation(dist: number, refDist = 2, maxDist = 18): number {
  if (dist <= refDist) return 1; if (dist >= maxDist) return 0;
  const t = (dist - refDist) / (maxDist - refDist); return (1 - t) * (1 - t);
}
/** Iso screen-x of a world offset, in tiles of screen width (tileW/2 per unit of dx - dy). */
export const screenDx = (dx: number, dy: number): number => (dx - dy) * 0.5;
export function pan(dx: number, dy: number, panWidth = 8): number { return Math.max(-1, Math.min(1, screenDx(dx, dy) / panWidth)); }
export function spatialize(src: Vec2, listener: Vec2, o: SpatialOpts = {}): SpatialOut {
  const dx = src.x - listener.x, dy = src.y - listener.y, d = Math.hypot(dx, dy);
  const gain = attenuation(d, o.refDist, o.maxDist);
  const occluded = !!o.indoors !== !!o.sourceIndoors;
  return { gain, pan: d < 0.25 ? 0 : pan(dx, dy, o.panWidth), lowpassHz: occluded ? OCCLUDED_HZ : OPEN_HZ, audible: gain > 0.005 };
}
