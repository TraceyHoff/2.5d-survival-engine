/**
 * ADR-214: draws the particle pool + screen cues on one overlay canvas above the scene (both renderers). Shapes are
 * baked white once, tinted per (shape, colour, light level) lazily into exactly two fixed-size atlas canvases: one emissive
 * (full light, additive particles) and one for the current day/night ambient level, re-tinted in place when the level
 * changes (no per-level canvases, no per-sprite resources: texture memory is a hard constant). The overlay backing store
 * is capped at ~1080p pixels whatever the window size/DPR (soft effects upscale invisibly) and shrunk to 1x1 when the layer
 * is off or hidden; texBytes() accounts every canvas this layer owns. Screen layers are full-screen washes only (vignette, flicker, fog roll, flash, god rays)
 * - never rectangles over characters. Canvas2D (no weather/VFX pipeline) also gets stateless rain/snow streaks and
 * flickering fire glows.
 */
import { Shape, SHAPES, PF, type ParticlePool } from "./pool.js";
import { PALETTE, C } from "./palette.js";
import type { Fx } from "./effects.js";

export interface CamLike { x: number; y: number; drawZoom: number }
export interface DrawEnv {
  cam: CamLike; w: number; h: number; dpr: number; time: number;
  /** linear ambient (0..1+) and fog colour of the current day/weather lighting */ ambient: readonly number[]; fog: readonly number[]; daylight: number;
  canvasFallback: boolean; weather: { kind: number; intensity: number; windDir: number }; indoors: boolean;
  glows: Float32Array; glowCount: number; vignette: boolean; flicker: boolean;
}
const SPR = 32, LEVELS = 6, VIG_MAX = 4;
/** Hard cap on overlay backing-store pixels (1920x1080): ~8.3 MB whatever the window / DPR (4K at DPR 2 would be 33 MB). */
export const FX_MAX_PIXELS = 1920 * 1080;
/** Overlay resolution scale (backing px per CSS px) under the pixel cap. */
export const fxScale = (w: number, h: number, dpr: number, max = FX_MAX_PIXELS): number => { const px = w * h * dpr * dpr; return px > max && px > 0 ? Math.sqrt(max / (w * h)) : dpr; };
const release = (c: Cv | undefined): void => { if (c) { c.width = 0; c.height = 0; } };
const px4 = (c: Cv | undefined): number => (c ? c.width * c.height * 4 : 0);
/** Precomputed fill strings (no per-frame template strings). */
const RGB = PALETTE.map((c) => `rgb(${c[0]},${c[1]},${c[2]})`);
const Q = 32; // weather / fog style quantisation steps
const RAIN = Array.from({ length: Q + 1 }, (_, i) => `rgba(190,210,230,${((0.38 * (0.35 + 0.65 * (i / Q)) + 0.08)).toFixed(3)})`);
const SNOW = Array.from({ length: Q + 1 }, (_, i) => `rgba(240,245,255,${(0.75 * (0.35 + 0.65 * (i / Q))).toFixed(3)})`);
type Cv = HTMLCanvasElement | OffscreenCanvas; type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const mk = (w: number, h: number): Cv => { if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h); const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

function bakeShape(s: number): Cv {
  const c = mk(SPR, SPR), g = c.getContext("2d") as Ctx, m = SPR / 2;
  const radial = (stops: [number, number][]): void => { const gr = g.createRadialGradient(m, m, 0, m, m, m); for (const [o, a] of stops) gr.addColorStop(o, `rgba(255,255,255,${a})`); g.fillStyle = gr; g.fillRect(0, 0, SPR, SPR); };
  g.fillStyle = "#fff";
  switch (s) {
    case Shape.Glow: case Shape.Beam: radial([[0, 1], [0.25, 0.75], [0.6, 0.18], [1, 0]]); break;
    case Shape.Spark: case Shape.Streak: radial([[0, 1], [0.35, 0.9], [0.7, 0.25], [1, 0]]); break;
    case Shape.Smoke: radial([[0, 0.85], [0.45, 0.55], [0.8, 0.14], [1, 0]]); break;
    case Shape.Flame: { const gr = g.createRadialGradient(m, m * 1.3, 0, m, m * 1.1, m); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.5, "rgba(255,255,255,0.5)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.beginPath(); g.moveTo(m, 1); g.bezierCurveTo(m + m * 0.9, m * 0.9, m + m * 0.8, SPR - 2, m, SPR - 2); g.bezierCurveTo(m - m * 0.8, SPR - 2, m - m * 0.9, m * 0.9, m, 1); g.fill(); break; }
    case Shape.Shard: g.beginPath(); g.moveTo(m, 3); g.lineTo(SPR - 5, m + 4); g.lineTo(m - 2, SPR - 4); g.lineTo(5, m - 2); g.closePath(); g.fill(); g.fillStyle = "rgba(0,0,0,0.28)"; g.beginPath(); g.moveTo(m, 3); g.lineTo(SPR - 5, m + 4); g.lineTo(m, m); g.closePath(); g.fill(); break;
    case Shape.Drop: g.beginPath(); g.ellipse(m, m, m * 0.45, m * 0.7, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = "rgba(255,255,255,0.6)"; g.beginPath(); g.arc(m - 3, m - 4, 3, 0, Math.PI * 2); g.fill(); break;
    case Shape.Leaf: g.beginPath(); g.ellipse(m, m, m * 0.85, m * 0.42, 0.5, 0, Math.PI * 2); g.fill(); g.strokeStyle = "rgba(0,0,0,0.3)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(4, m + 6); g.lineTo(SPR - 4, m - 6); g.stroke(); break;
    case Shape.Star: { radial([[0, 0.9], [0.2, 0.4], [0.5, 0]]); g.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, r = k & 1 ? m * 0.16 : m * 0.98; g.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r); } g.closePath(); g.fill(); break; }
    case Shape.Ring: g.strokeStyle = "#fff"; g.lineWidth = 2.2; g.shadowColor = "#fff"; g.shadowBlur = 3; g.beginPath(); g.arc(m, m, m - 3, 0, Math.PI * 2); g.stroke(); break;
    default: radial([[0, 1], [1, 0]]);
  }
  return c;
}

export class FxDraw {
  readonly canvas: HTMLCanvasElement; private g: CanvasRenderingContext2D;
  /** atlas[0] = emissive (LEVELS-1), atlas[1] = current ambient level (slotLevel); filled indexed (cell * 2 + slot). */
  private base: Cv[] = []; private atlas: (Cv | undefined)[] = [undefined, undefined]; private slotLevel = -1; private filled = new Uint8Array(SHAPES * PALETTE.length * 2); private scratch: Cv | undefined;
  private fogKey = -1; private fogStyle = "#888";
  /** current atlas cell (set by sprite()) */ private cx = 0; private cy = 0;
  private vig = new Map<number, Cv>(); private beam: Cv | undefined; private fogBlob: Cv | undefined;
  private bw = 0; private bh = 0; private dirty = true; private warmK = 0;
  /** Bake a few tinted sprites per call (idle frames) so first-use never hitches mid-fight. Returns true when done. */
  prewarm(amb: number, max = 24): boolean {
    const level = Math.max(0, Math.min(LEVELS - 1, Math.round(Math.min(1, amb) * (LEVELS - 1))));
    const total = SHAPES * PALETTE.length * 2; let made = 0;
    while (this.warmK < total && made < max) { const k = this.warmK++, lv = k & 1 ? LEVELS - 1 : level, j = k >> 1, sh = j % SHAPES, col = (j / SHAPES) | 0;
      const slot = lv === LEVELS - 1 ? 0 : 1; if (!this.filled[(sh * PALETTE.length + col) * 2 + slot] || (slot === 1 && this.slotLevel !== lv)) { this.sprite(sh, col, lv); made++; } }
    return this.warmK >= total;
  }
  constructor(root: HTMLElement, private readonly maxPixels = FX_MAX_PIXELS) {
    const c = document.createElement("canvas"); c.id = "vfx-fx";
    c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2"; root.appendChild(c);
    this.canvas = c; this.g = c.getContext("2d")!;
  }
  /** Drop the overlay backing store to 1x1 (layer off / hidden); draw() regrows it on demand. */
  shrink(): void { if (this.bw !== 1 || this.bh !== 1) { this.canvas.width = 1; this.canvas.height = 1; this.bw = 1; this.bh = 1; this.dirty = false; } }
  /** Bytes of canvas backing store this layer owns right now (overlay + atlases + baked sources). */
  texBytes(): number {
    let n = this.bw * this.bh * 4 + px4(this.atlas[0]) + px4(this.atlas[1]) + px4(this.scratch) + px4(this.beam) + px4(this.fogBlob);
    for (let i = 0; i < this.base.length; i++) n += px4(this.base[i]); this.vig.forEach(this.vigBytes); n += this.vb; this.vb = 0; return n;
  }
  private vb = 0; private readonly vigBytes = (c: Cv): void => { this.vb += px4(c); };
  dispose(): void {
    this.canvas.width = 0; this.canvas.height = 0; this.canvas.remove(); this.bw = this.bh = 0;
    release(this.atlas[0]); release(this.atlas[1]); release(this.scratch); release(this.beam); release(this.fogBlob);
    for (let i = 0; i < this.base.length; i++) release(this.base[i]); this.vig.forEach(release); this.vig.clear();
    this.atlas[0] = this.atlas[1] = this.scratch = this.beam = this.fogBlob = undefined; this.base.length = 0; this.filled.fill(0); this.slotLevel = -1; this.warmK = 0;
  }
  /** Select (baking on first use) the atlas cell for (shape, colour, level); returns the level's atlas. */
  private sprite(shape: number, col: number, level: number): Cv {
    const slot = level === LEVELS - 1 ? 0 : 1; this.cx = shape * SPR; this.cy = col * SPR;
    if (slot === 1 && this.slotLevel !== level) { this.slotLevel = level; for (let i = 1; i < this.filled.length; i += 2) this.filled[i] = 0; } // re-tint in place
    const k = (shape * PALETTE.length + col) * 2 + slot;
    const at = this.atlas[slot] ?? (this.atlas[slot] = mk(SHAPES * SPR, PALETTE.length * SPR)); if (this.filled[k]) return at;
    const b = this.base[shape] ?? (this.base[shape] = bakeShape(shape)), s = this.scratch ?? (this.scratch = mk(SPR, SPR)), g = s.getContext("2d") as Ctx;
    const pc = PALETTE[col] ?? PALETTE[0]!, r = pc[0], gg = pc[1], bb = pc[2]; const l = level === LEVELS - 1 ? 1 : 0.22 + (level / (LEVELS - 1)) * 0.78;
    const night = 1 - l; // moonlit shift toward blue at low light
    g.globalCompositeOperation = "copy"; g.drawImage(b as CanvasImageSource, 0, 0); g.globalCompositeOperation = "source-in";
    g.fillStyle = `rgb(${Math.round(r * l * (1 - night * 0.25))},${Math.round(gg * l * (1 - night * 0.1))},${Math.round(bb * l + night * 40)})`; g.fillRect(0, 0, SPR, SPR);
    if (shape === Shape.Shard) { g.globalCompositeOperation = "source-atop"; g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.moveTo(SPR / 2, 3); g.lineTo(SPR - 5, SPR / 2 + 4); g.lineTo(SPR / 2, SPR / 2); g.closePath(); g.fill(); }
    g.globalCompositeOperation = "source-over";
    const ag = at.getContext("2d") as Ctx; ag.clearRect(this.cx, this.cy, SPR, SPR); ag.drawImage(s as CanvasImageSource, this.cx, this.cy);
    this.filled[k] = 1; return at;
  }
  /** drawImage of the current atlas cell. */
  private blit(g: CanvasRenderingContext2D, img: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void { g.drawImage(img, this.cx + 0.5, this.cy + 0.5, SPR - 1, SPR - 1, dx, dy, dw, dh); }
  private vignette(col: number): Cv {
    let v = this.vig.get(col); if (v) return v;
    if (this.vig.size >= VIG_MAX) { const it = this.vig.keys().next(); if (!it.done) { release(this.vig.get(it.value)); this.vig.delete(it.value); } } // bounded (event-time only)
    v = mk(256, 256); const g = v.getContext("2d") as Ctx; const [r, gg, b] = PALETTE[col] ?? [0, 0, 0];
    const gr = g.createRadialGradient(128, 128, 40, 128, 128, 182); gr.addColorStop(0, `rgba(${r},${gg},${b},0)`); gr.addColorStop(0.55, `rgba(${r},${gg},${b},0.25)`); gr.addColorStop(1, `rgba(${r},${gg},${b},1)`);
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); this.vig.set(col, v); return v;
  }

  /** Draw everything; returns the number of particles drawn. */
  draw(fx: Fx, e: DrawEnv): number {
    const c = this.canvas, dpr = fxScale(e.w, e.h, e.dpr, this.maxPixels), bw = Math.max(1, Math.round(e.w * dpr)), bh = Math.max(1, Math.round(e.h * dpr));
    if (bw !== this.bw || bh !== this.bh) { c.width = bw; c.height = bh; this.bw = bw; this.bh = bh; }
    const g = this.g;
    // idle skip: nothing alive and no screen layer -> leave the (already clear) canvas untouched
    const idle = fx.pool.count === 0 && e.glowCount === 0 && fx.rays <= 0.02 && fx.flash <= 0.005 && fx.fogAmt <= 0.01 && fx.flickerDark <= 0.003 && !(e.vignette && (fx.hurt > 0.005 || fx.lowHp > 0 || fx.dread > 0.005)) && !(e.canvasFallback && e.weather.intensity > 0 && e.weather.kind >= 1 && e.weather.kind <= 3);
    if (idle) { if (this.dirty) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, bw, bh); this.dirty = false; } return 0; }
    this.dirty = true; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, bw, bh);
    const p = fx.pool, z = e.cam.drawZoom * dpr, ox = bw / 2 - e.cam.x * z, oy = bh / 2 - e.cam.y * z;
    const amb = Math.max(e.ambient[0] ?? 1, e.ambient[1] ?? 1, e.ambient[2] ?? 1), level = Math.max(0, Math.min(LEVELS - 1, Math.round(Math.min(1, amb) * (LEVELS - 1))));
    if (e.canvasFallback && !e.indoors) this.weather(g, e, bw, bh, dpr);
    let n = 0;
    if (p.count) { n += this.pass(g, p, false, z, ox, oy, level, e.time, bw, bh); g.globalCompositeOperation = "lighter"; n += this.pass(g, p, true, z, ox, oy, level, e.time, bw, bh); }
    g.globalCompositeOperation = "lighter";
    if (e.canvasFallback) for (let i = 0; i < e.glowCount; i++) { // flickering fire glow (WebGL2's light pass already flickers)
      const o = i * 4, x = e.glows[o]!, y = e.glows[o + 1]!, gz = e.glows[o + 2]!, k = e.glows[o + 3]!;
      const sx = (x - y) * 32 * z + ox, sy = ((x + y) * 16 - gz * 16) * z + oy, f = 0.78 + 0.14 * Math.sin(e.time * 9.1 + i * 2.3) + 0.08 * Math.sin(e.time * 23.7 + i);
      const r = (k > 0.7 ? 120 : 60) * z * f; g.globalAlpha = (0.18 + 0.25 * (1 - e.daylight)) * k * f; this.blit(g, this.sprite(Shape.Glow, C.Fire, LEVELS - 1) as CanvasImageSource, sx - r, sy - r, r * 2, r * 2);
    }
    // god rays: low sun, outdoors, clear
    if (fx.rays > 0.02 && !e.indoors) {
      const b = this.beam ?? (this.beam = this.bakeBeam()); const a = fx.rays * 0.07;
      for (let k = 0; k < 5; k++) { const x = (0.08 + k * 0.21 + 0.03 * Math.sin(e.time * 0.11 + k * 1.7)) * bw, wdt = (0.06 + 0.04 * ((k * 37) % 3)) * bw;
        g.globalAlpha = a * (0.6 + 0.4 * Math.sin(e.time * 0.23 + k * 2.1)); g.setTransform(1, 0, -0.45, 1, x, 0); g.drawImage(b as CanvasImageSource, 0, 0, wdt, bh); }
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    // flash
    if (fx.flash > 0.005) { g.globalAlpha = Math.min(0.45, fx.flash); g.fillStyle = RGB[fx.flashColor] ?? RGB[0]!; g.fillRect(0, 0, bw, bh); }
    g.globalCompositeOperation = "source-over";
    // fog roll-in (horde / nightfall)
    if (fx.fogAmt > 0.01 && !e.indoors) {
      const fb = this.fogBlob ?? (this.fogBlob = this.bakeFog()), tint = this.fogTint(e.fog);
      g.globalAlpha = 1; for (let k = 0; k < 7; k++) {
        const u = ((e.time * (0.012 + k * 0.003) + k * 0.31) % 1.4) - 0.2, x = u * bw, y = bh * (0.15 + (k % 4) * 0.24), rw = bw * 0.6, rh = bh * 0.32;
        g.globalAlpha = fx.fogAmt * 0.45; g.drawImage(fb as CanvasImageSource, x - rw / 2, y - rh / 2, rw, rh);
      }
      g.globalCompositeOperation = "source-atop"; g.globalAlpha = 0.8; g.fillStyle = tint; g.fillRect(0, 0, bw, bh); g.globalCompositeOperation = "source-over";
    }
    if (fx.flickerDark > 0.003) { g.globalAlpha = fx.flickerDark; g.fillStyle = "#05070c"; g.fillRect(0, 0, bw, bh); }
    if (e.vignette) {
      const beat = fx.pulsePhase < 0.12 ? Math.sin((fx.pulsePhase / 0.12) * Math.PI) : fx.pulsePhase > 0.2 && fx.pulsePhase < 0.3 ? 0.6 * Math.sin(((fx.pulsePhase - 0.2) / 0.1) * Math.PI) : 0;
      const hurtA = Math.min(0.75, fx.hurt * 0.6) + fx.lowHp * (0.22 + 0.33 * beat);
      if (hurtA > 0.005) { g.globalAlpha = Math.min(0.85, hurtA); g.drawImage(this.vignette(fx.lowHp > fx.hurt ? C.Blood : fx.hurtColor) as CanvasImageSource, 0, 0, bw, bh); }
      if (fx.dread > 0.005) { g.globalAlpha = fx.dread * 0.45; g.drawImage(this.vignette(C.Soot) as CanvasImageSource, 0, 0, bw, bh); }
    }
    g.globalAlpha = 1;
    return n;
  }

  /** Fog tint, quantised to 5 bits/channel and rebuilt only when it changes (no per-frame string). */
  private fogTint(f: readonly number[]): string {
    const r = Math.round(Math.min(1, (f[0] ?? 0.5) * 1.1) * 31), g = Math.round(Math.min(1, (f[1] ?? 0.5) * 1.1) * 31), b = Math.round(Math.min(1, (f[2] ?? 0.5) * 1.15) * 31), k = (r << 10) | (g << 5) | b;
    if (k !== this.fogKey) { this.fogKey = k; this.fogStyle = `rgb(${Math.round(r * 255 / 31)},${Math.round(g * 255 / 31)},${Math.round(b * 255 / 31)})`; }
    return this.fogStyle;
  }
  private pass(g: CanvasRenderingContext2D, p: ParticlePool, add: boolean, z: number, ox: number, oy: number, level: number, time: number, bw: number, bh: number): number {
    const { px, py, pz, vx, vy, vz, age, life, s0, s1, a0, rot, vrot, x2, y2, z2, shape, color, flags } = p; let n = 0;
    for (let i = 0; i < p.count; i++) {
      const f = flags[i]!; if (((f & PF.Add) !== 0) !== add) continue;
      const sh = shape[i]!, t = age[i]! / life[i]!; const x = px[i]!, y = py[i]!;
      const sx = (x - y) * 32 * z + ox, sy = ((x + y) * 16 - pz[i]! * 16) * z + oy;
      if (sx < -200 || sy < -200 || sx > bw + 200 || sy > bh + 200) continue;
      let a = a0[i]!;
      if (sh === Shape.Smoke) a *= Math.min(1, t * 8) * (1 - t) * (1 - t) * 1.4; else if (sh === Shape.Glow || sh === Shape.Star || sh === Shape.Flame || sh === Shape.Beam) a *= 1 - t * t; else a *= t < 0.75 ? 1 : (1 - t) * 4;
      if (f & PF.FadeIn) a *= Math.min(1, t * 6);
      if (f & PF.Blink) a *= 0.45 + 0.55 * Math.sin(time * (vrot[i]! || 6) * 2 + i);
      if (a <= 0.01) continue;
      const size = (s0[i]! + (s1[i]! - s0[i]!) * t) * z, spr = this.sprite(sh, color[i]!, add ? LEVELS - 1 : level) as CanvasImageSource;
      g.globalAlpha = a > 1 ? 1 : a; n++;
      if (sh === Shape.Arc) { this.arc(g, i, p, sx, sy, z, t, spr); continue; }
      if (sh === Shape.Streak) {
        let tx: number, ty: number;
        if (x2[i]! || y2[i]! || z2[i]!) { const hx = x2[i]!, hy = y2[i]!; const k = Math.min(1, 0.25 + t * 1.6); tx = (hx - x) * (1 - k) + x; ty = (hy - y) * (1 - k) + y;
          const ex = (tx - ty) * 32 * z + ox, ey = ((tx + ty) * 16 - (z2[i]! + (pz[i]! - z2[i]!) * k) * 16) * z + oy; this.line(g, ex, ey, sx, sy, Math.max(1.2, size), spr); }
        else { const ex = sx - (vx[i]! - vy[i]!) * 32 * z * 0.06, ey = sy - ((vx[i]! + vy[i]!) * 16 - vz[i]! * 16) * z * 0.06; this.line(g, ex, ey, sx, sy, Math.max(1.2, size), spr); }
        continue;
      }
      if (sh === Shape.Beam) { const hgt = 150 * z * (0.6 + t * 0.6), wd = size; this.blit(g, spr, sx - wd / 2, sy - hgt, wd, hgt + wd * 0.3); continue; }
      if (f & PF.Stretch) {
        const svx = (vx[i]! - vy[i]!) * 32, svy = (vx[i]! + vy[i]!) * 16 - vz[i]! * 16, sp = Math.hypot(svx, svy);
        if (sp > 4) { const len = Math.min(size * 6, size + sp * 0.035 * z); this.line(g, sx - (svx / sp) * len, sy - (svy / sp) * len, sx, sy, size, spr); continue; }
      }
      if (sh === Shape.Ring) { const r = size; if (f & PF.Flat) this.blit(g, spr, sx - r, sy - r * 0.5, r * 2, r); else this.blit(g, spr, sx - r, sy - r, r * 2, r * 2); continue; }
      const r0 = rot[i]!;
      if (r0 !== 0 && (sh === Shape.Shard || sh === Shape.Leaf || sh === Shape.Star)) { const c = Math.cos(r0), s = Math.sin(r0), sq = sh === Shape.Leaf ? 0.6 + 0.4 * Math.sin(r0 * 1.7) : 1;
        g.setTransform(c * size, s * size, -s * size * sq, c * size * sq, sx, sy); this.blit(g, spr, -0.5, -0.5, 1, 1); g.setTransform(1, 0, 0, 1, 0, 0); continue; }
      if (sh === Shape.Flame) { this.blit(g, spr, sx - size / 2, sy - size * 0.8, size, size * 1.2); continue; }
      this.blit(g, spr, sx - size / 2, sy - size / 2, size, size);
    }
    g.setTransform(1, 0, 0, 1, 0, 0); return n;
  }
  private line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, spr: CanvasImageSource): void {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, c = dx / len, s = dy / len;
    g.setTransform(c, s, -s, c, x0, y0); this.blit(g, spr, -w / 2, -w / 2, len + w, w); g.setTransform(1, 0, 0, 1, 0, 0);
  }
  /** Melee swing: a crescent of sprite stamps along an iso ellipse in front of the attacker, swept over its life. */
  private arc(g: CanvasRenderingContext2D, i: number, p: ParticlePool, sx: number, sy: number, z: number, t: number, spr: CanvasImageSource): void {
    const a0 = p.rot[i]!, sweep = p.x2[i]!, rad = p.y2[i]!, head = Math.min(1, t * 2.2), tail = Math.max(0, t * 2.2 - 0.9), steps = 9, base = g.globalAlpha;
    for (let k = 0; k <= steps; k++) { const u = tail + (head - tail) * (k / steps), a = a0 + sweep * u;
      const wx = Math.cos(a) * rad, wy = Math.sin(a) * rad, ex = sx + (wx - wy) * 32 * z, ey = sy + (wx + wy) * 16 * z;
      const w = (3 + 9 * (k / steps)) * z; g.globalAlpha = base * (0.25 + 0.75 * (k / steps)); this.blit(g, spr, ex - w, ey - w * 0.6, w * 2, w * 1.2); }
  }
  private bakeBeam(): Cv { const c = mk(32, 256), g = c.getContext("2d") as Ctx; const gr = g.createLinearGradient(0, 0, 32, 0);
    gr.addColorStop(0, "rgba(255,236,190,0)"); gr.addColorStop(0.5, "rgba(255,236,190,1)"); gr.addColorStop(1, "rgba(255,236,190,0)"); g.fillStyle = gr; g.fillRect(0, 0, 32, 256);
    g.globalCompositeOperation = "destination-in"; const v = g.createLinearGradient(0, 0, 0, 256); v.addColorStop(0, "rgba(0,0,0,1)"); v.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = v; g.fillRect(0, 0, 32, 256); return c; }
  private bakeFog(): Cv { const c = mk(128, 64), g = c.getContext("2d") as Ctx; g.setTransform(1, 0, 0, 0.5, 0, 0); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(0.6, "rgba(255,255,255,0.4)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return c; }
  /** Canvas2D fallback rain / snow: stateless streaks hashed from index + time (no per-drop state). */
  private weather(g: CanvasRenderingContext2D, e: DrawEnv, bw: number, bh: number, dpr: number): void {
    const k = e.weather.kind, it = Math.max(0, Math.min(1, e.weather.intensity)); if (!(k === 1 || k === 2 || k === 3) || it <= 0) return;
    const snow = k === 3, n = Math.round((snow ? 220 : k === 2 ? 420 : 280) * (0.3 + it * 0.7)), wx = Math.cos(e.weather.windDir) * (k === 2 ? 0.35 : 0.18);
    g.globalCompositeOperation = "source-over";
    const st = (snow ? SNOW : RAIN)[Math.round(Math.max(0, Math.min(1, e.daylight)) * Q)]!; g.strokeStyle = st; g.fillStyle = st; g.lineWidth = snow ? 0 : 1.1 * dpr; g.globalAlpha = 1;
    const speed = snow ? 0.12 : 1.5, len = (snow ? 0 : k === 2 ? 26 : 18) * dpr; g.beginPath();
    for (let i = 0; i < n; i++) {
      const h1 = ((i * 2654435761) >>> 0) / 4294967296, h2 = ((i * 2246822519 + 3266489917) >>> 0) / 4294967296, sp = speed * (0.75 + h2 * 0.5);
      const v = (h2 + e.time * sp) % 1, y = v * (bh + len) - len, x = ((h1 + wx * v + (snow ? 0.01 * Math.sin(e.time * 1.3 + i) : 0)) % 1 + 1) % 1 * bw;
      if (snow) { const r = (1 + h1 * 1.6) * dpr; g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); } else { g.moveTo(x, y); g.lineTo(x + wx * len, y + len); }
    }
    if (snow) g.fill(); else g.stroke();
  }
}
