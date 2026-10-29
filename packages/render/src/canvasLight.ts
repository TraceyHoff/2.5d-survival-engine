/**
 * ADR-215: Canvas2D lightmap. The fallback renderer used to multiply the whole frame by the ambient colour and then
 * ADD a faint capped glow per light, which tinted the dark but never pushed it back. This builds a real lightmap like
 * the WebGL LightPass: a downscaled offscreen canvas cleared to the ambient colour, every light added ("lighter") as an
 * iso ellipse with the shared lightFalloff profile and flicker, then multiplied onto the scene. The pure helpers below
 * are unit tested; the canvas calls stay in Canvas2DLightmap.
 */
import { lightFalloff } from "./lighting.js";

/** Lightmap resolution divisor (the WebGL low/medium tiers use 4 too; lights are large and smooth). */
export const C2D_LIGHT_DOWNSCALE = 4;
/** Gradient stops (t, profile) of lightFalloff, normalised so the peak is 1 (canvas colour channels clamp at 1). */
export const C2D_FALLOFF_STOPS: ReadonlyArray<readonly [number, number]> = (() => {
  const ts = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]; const peak = lightFalloff(0);
  return ts.map((t) => [t, lightFalloff(t) / peak] as const);
})();
const n1 = (x: number): number => { const v = Math.sin(x) * 43758.5453; return v - Math.floor(v); };
const noise = (x: number): number => { const i = Math.floor(x), f = x - i; return n1(i) + (n1(i + 1) - n1(i)) * f * f * (3 - 2 * f); };
/** Same flicker signal as the WebGL light vertex shader: -amount..+amount, seeded by the light's screen position. */
export function lightFlicker(time: number, sx: number, sy: number, amount: number): number {
  if (!(amount > 0)) return 0; const seed = sx * 0.013 + sy * 0.007;
  return amount * (noise(time * 9 + seed * 31) * 0.7 + noise(time * 23 + seed * 17) * 0.3 - 0.5) * 2;
}
/** Screen-space radius (world px, before camera scale) of a light radius in tiles: same as LightPass (iso 2:1 ellipse). */
export const lightRadiusPx = (radiusTiles: number, tileW: number): number => radiusTiles * (tileW / 2) * 1.414;
/** Light colour at the centre (0..1 per channel, clamped) for intensity x night strength x flicker. */
export function lightPeak(rgb: readonly [number, number, number], intensity: number, strength: number, fl: number): [number, number, number] {
  const k = intensity * strength * (1 + 0.3 * fl) * lightFalloff(0) * 0.75; // 0.75: canvas clamps at 1, keep the plateau warm not white
  return [Math.min(1, rgb[0] * k), Math.min(1, rgb[1] * k), Math.min(1, rgb[2] * k)];
}

export interface C2DLight { sx: number; sy: number; r: number; color: readonly [number, number, number]; intensity: number; flicker: number }
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class Canvas2DLightmap {
  private cv: HTMLCanvasElement | OffscreenCanvas | null = null; private g: Ctx2D | null = null;
  /** Draw the lightmap for `lights` (world px coords) and multiply it onto `dst`; then a small additive hot core. */
  apply(dst: CanvasRenderingContext2D, w: number, h: number, view: { s: number; ox: number; oy: number }, ambient: readonly [number, number, number],
        strength: number, time: number, lights: readonly C2DLight[]): void {
    const lw = Math.max(1, Math.ceil(w / C2D_LIGHT_DOWNSCALE)), lh = Math.max(1, Math.ceil(h / C2D_LIGHT_DOWNSCALE));
    if (!this.cv || this.cv.width !== lw || this.cv.height !== lh) {
      this.cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(lw, lh) : Object.assign(document.createElement("canvas"), { width: lw, height: lh });
      this.g = this.cv.getContext("2d") as Ctx2D | null;
    }
    const g = this.g; if (!g) return;
    const c = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over";
    g.fillStyle = `rgb(${c(ambient[0])},${c(ambient[1])},${c(ambient[2])})`; g.fillRect(0, 0, lw, lh);
    g.globalCompositeOperation = "lighter";
    const ks = view.s / C2D_LIGHT_DOWNSCALE, kx = view.ox / C2D_LIGHT_DOWNSCALE, ky = view.oy / C2D_LIGHT_DOWNSCALE;
    const cores: Array<[number, number, number, [number, number, number]]> = [];
    for (const L of lights) {
      const fl = lightFlicker(time, L.sx, L.sy, L.flicker); const r = L.r * (1 + 0.035 * fl);
      const px = L.sx * ks + kx, py = L.sy * ks + ky, pr = r * ks; if (pr < 0.5 || px + pr < 0 || px - pr > lw || py + pr * 0.5 < 0 || py - pr * 0.5 > lh) continue;
      const pk = lightPeak(L.color, L.intensity, strength, fl);
      // iso ellipse: draw a circle in a y-squashed transform
      g.setTransform(1, 0, 0, 0.5, px, py);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, pr);
      for (const [t, v] of C2D_FALLOFF_STOPS) gr.addColorStop(t, `rgb(${c(pk[0] * v)},${c(pk[1] * v)},${c(pk[2] * v)})`);
      g.fillStyle = gr; g.fillRect(-pr, -pr, 2 * pr, 2 * pr);
      cores.push([L.sx * view.s + view.ox, L.sy * view.s + view.oy, r * view.s, pk]);
    }
    dst.save(); dst.setTransform(1, 0, 0, 1, 0, 0); dst.globalCompositeOperation = "multiply"; dst.imageSmoothingEnabled = true;
    dst.drawImage(this.cv as CanvasImageSource, 0, 0, lw * C2D_LIGHT_DOWNSCALE, lh * C2D_LIGHT_DOWNSCALE);
    // hot core: the WebGL lightmap goes above 1 (x2 encode) near a fire; canvas clamps, so add a little warm bloom back
    dst.globalCompositeOperation = "lighter";
    for (const [x, y, r, pk] of cores) {
      const cr = r * 0.3; if (cr < 1) continue; dst.setTransform(1, 0, 0, 0.5, x, y);
      const gr = dst.createRadialGradient(0, 0, 0, 0, 0, cr);
      gr.addColorStop(0, `rgba(${c(pk[0])},${c(pk[1])},${c(pk[2])},${(0.22 * strength).toFixed(3)})`); gr.addColorStop(1, "rgba(0,0,0,0)");
      dst.fillStyle = gr; dst.fillRect(-cr, -cr, 2 * cr, 2 * cr);
    }
    dst.restore();
  }
}
