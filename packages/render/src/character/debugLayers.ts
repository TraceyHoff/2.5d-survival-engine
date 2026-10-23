/**
 * DEBUG ONLY: placeholder paper-doll layer art cut from the pack's single-piece character sheets (player /
 * player_b / player_c), so layered rendering, tinting and the creator preview can be exercised before Art & Assets
 * ships real layer atlases. Each output layer is a greyscale shading sheet + a tintmask (R = primary, G = secondary)
 * on the SAME frame grid as the source, so anchors and animations are shared with the body.
 *
 * Segmentation is heuristic: per frame, the opaque bounding box is cut into height bands (hair / top / bottom /
 * shoes) and skin is detected by hue. The hat and scarf are synthesized from the hair/top bands. Not production art.
 */
export interface Rgba { width: number; height: number; data: Uint8ClampedArray }
export const DEBUG_LAYER_NAMES = ["body", "hair", "hair_hat", "hat", "accessory", "top", "bottom", "shoes"] as const;
export type DebugLayerName = (typeof DEBUG_LAYER_NAMES)[number];
export interface DebugLayerSheet { shade: Rgba; mask: Rgba }

function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d > 0) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, mx === 0 ? 0 : d / mx, mx / 255];
}
const blank = (w: number, h: number): Rgba => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

export type SkinTest = (h: number, s: number, v: number) => boolean;
/** light/medium skin (pack player / player_b) */
export const SKIN_LIGHT: SkinTest = (h, s, v) => (h < 0.12 || h > 0.97) && s > 0.18 && s < 0.55 && v > 0.6;
/** darker skin (pack player_c) */
export const SKIN_DARK: SkinTest = (h, s, v) => h < 0.1 && s > 0.3 && v > 0.25 && v < 0.8;
/** Head/torso/legs/feet bands as fractions of each frame's opaque height (chibi proportions: big head). */
export const DEBUG_BANDS = { hat: 0.2, head: 0.5, scarf: 0.57, top: 0.76, bottom: 0.9 };

export function segmentCharacterSheet(src: Rgba, frameW: number, frameH: number, skinTest: SkinTest = SKIN_LIGHT): Record<DebugLayerName, DebugLayerSheet> {
  const B = DEBUG_BANDS;
  const { width: W, height: H, data: d } = src;
  const out = {} as Record<DebugLayerName, DebugLayerSheet>;
  for (const n of DEBUG_LAYER_NAMES) out[n] = { shade: blank(W, H), mask: blank(W, H) };
  const put = (n: DebugLayerName, p: number, grey: number, a: number, mr: number, mg: number): void => {
    const s = out[n].shade.data, m = out[n].mask.data;
    s[p] = s[p + 1] = s[p + 2] = grey; s[p + 3] = a; m[p] = mr; m[p + 1] = mg; m[p + 2] = 0; m[p + 3] = a;
  };
  for (let cy = 0; cy + frameH <= H; cy += frameH) for (let cx = 0; cx + frameW <= W; cx += frameW) {
    let y0 = frameH, y1 = -1;
    for (let y = 0; y < frameH; y++) for (let x = 0; x < frameW; x++) if (d[((cy + y) * W + cx + x) * 4 + 3]! > 96) { if (y < y0) y0 = y; y1 = y; }
    if (y1 < 0) continue;
    const bh = y1 - y0 + 1;
    const hatBottom = y0 + Math.floor(B.hat * bh); // last hat row (brim -> G)
    for (let y = y0; y <= y1; y++) for (let x = 0; x < frameW; x++) {
      const p = ((cy + y) * W + cx + x) * 4; const a = d[p + 3]!; if (a <= 96) continue;
      const [h, s, v] = hsv(d[p]!, d[p + 1]!, d[p + 2]!); const r = (y - y0) / bh;
      const grey = Math.min(255, Math.round(40 + v * 235));
      const skin = skinTest(h, s, v);
      if (v < 0.16) { const c = out.body.shade.data; c[p] = d[p]!; c[p + 1] = d[p + 1]!; c[p + 2] = d[p + 2]!; c[p + 3] = a; out.body.mask.data[p + 3] = a; continue; }
      if (skin && r > 0.1) { put("body", p, grey, a, 255, 0); continue; }
      // undergarment: neutral grey on the body (untinted) wherever clothing sits
      put("body", p, Math.round(90 + v * 80), a, 0, 0);
      if (r < B.head) {
        put("hair", p, grey, a, 255, 0);
        if (r >= B.hat) put("hair_hat", p, grey, a, 255, 0);
        if (r < B.hat + 0.01) put("hat", p, grey, a, y >= hatBottom - 1 ? 0 : 255, y >= hatBottom - 1 ? 255 : 0);
      } else if (r < B.top) {
        put("top", p, grey, a, 255, 0);
        if (r < B.scarf) put("accessory", p, grey, a, ((x >> 1) & 1) ? 255 : 0, ((x >> 1) & 1) ? 0 : 255);
      } else if (r < B.bottom) put("bottom", p, grey, a, 255, 0);
      else put("shoes", p, grey, a, 255, 0);
    }
    // hat crown: one row above the head so it reads as a hat, not hair
    for (let x = 0; x < frameW; x++) {
      const pb = ((cy + y0) * W + cx + x) * 4; if (y0 < 1 || out.hat.shade.data[pb + 3]! === 0) continue;
      const pa = pb - W * 4; out.hat.shade.data.set([200, 200, 200, 255], pa); out.hat.mask.data.set([255, 0, 0, 255], pa);
    }
  }
  return out;
}
