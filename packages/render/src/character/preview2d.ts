/**
 * Canvas2D creator preview (fallback when WebGL2 / createCharacterPreview is unavailable): composites the same paper-doll
 * layer list the renderer draws (AppearanceBinding.resolve -> registry.dirFrame, per-frame anchors, mirrored frames)
 * straight from the PNG sheets, tinting each layer through the tintmask with the renderer's CPU tint reference
 * (layerTintRef = the shader's layerTint), so layers line up exactly as in-game. Integer pixel scale at the device DPR
 * with smoothing off: crisp on high-DPR phones.
 */
import type { AppearanceValue } from "@engine/core";
import { AssetRegistry, type FrameRef } from "@engine/assets";
import type { AtlasSource } from "../assets/atlasManager.js";
import { layerTintRef, type AppearanceBinding, type CharacterDrawLayer } from "./layers.js";
import { facingAngle, FRONT_FACING } from "./preview.js";

/** `dx`/`dy`: ADR-128 head offset (unmirrored frame px) for head-group layers, 0 otherwise. */
export interface PreviewLayer2D { layer: CharacterDrawLayer; ref: FrameRef; url: string; maskUrl?: string | undefined; dx: number; dy: number }
type Img = CanvasImageSource & { width: number; height: number };

/** Back-to-front layers for appearance `a` at facing index k (0..7) and time t (s), with their sheet URLs. */
export function previewLayers2D(registry: AssetRegistry, binding: AppearanceBinding, a: AppearanceValue, k: number, t = 0, sources?: ReadonlyMap<string, AtlasSource>, animName = "idle", facingRad?: number): PreviewLayer2D[] {
  const out: PreviewLayer2D[] = []; const fa = facingRad ?? facingAngle(k); let ho = { x: 0, y: 0 }; const head: number[] = [];
  for (const l of binding.resolve(a as never, fa, {}) as readonly CharacterDrawLayer[]) {
    let s; try { s = registry.sprite(l.sprite); } catch { continue; }
    const anim = s.animations.has(animName) ? animName : s.animations.has("idle") ? "idle" : l.anim;
    const ref = registry.dirFrame(l.sprite, anim, fa, t); const src = sources?.get(ref.atlas.key);
    const m = src?.masks?.tintmask ?? ref.atlas.masks?.tintmask; const maskUrl = Array.isArray(m) ? m[0] : typeof m === "string" ? m : undefined;
    if (l.slot === "body") ho = AssetRegistry.headOffset(ref);
    out.push({ layer: l, ref, url: src?.url ?? ref.atlas.image, maskUrl, dx: 0, dy: 0 }); if (s.group === "head" && l.slot !== "body") head.push(out.length - 1);
  }
  // body may follow back layers (long hair behind the body): apply its head offset once every layer is known
  for (const i of head) { out[i]!.dx = ho.x; out[i]!.dy = ho.y; }
  return out;
}
const rgb = (c: number): [number, number, number] => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];
const MODE = { multiply: 0, add: 1, screen: 2, lerp: 3 } as const;
/** In-place tint of RGBA pixels (layer frame) with its tintmask pixels (R -> tintR, G -> tintG). */
export function tintPixels(px: Uint8ClampedArray, mask: Uint8ClampedArray | undefined, l: CharacterDrawLayer): void {
  const mode = MODE[l.tintMode ?? "multiply"], st = l.tintStrength ?? 1, sat = l.tintSaturation ?? 1, neu = l.tintNeutral ?? 0.78;
  const cr = l.tintR !== undefined ? rgb(l.tintR) : undefined, cg = l.tintG !== undefined ? rgb(l.tintG) : undefined; if (!cr && !cg) return;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue; let c: [number, number, number] = [px[i]! / 255, px[i + 1]! / 255, px[i + 2]! / 255];
    const mr = mask ? mask[i]! / 255 : 1, mg = mask ? mask[i + 1]! / 255 : 0;
    if (cr && mr > 0) c = layerTintRef(c, cr, mode, st, mr, sat, neu);
    if (cg && mg > 0) c = layerTintRef(c, cg, mode, st, mg, sat, neu);
    px[i] = c[0] * 255; px[i + 1] = c[1] * 255; px[i + 2] = c[2] * 255;
  }
}

export interface CharacterPreview2DOptions { registry: AssetRegistry; binding: AppearanceBinding; appearance: AppearanceValue; sources?: ReadonlyMap<string, AtlasSource>; facing?: number; backdrop?: string;
  /** image loader (tests); default HTMLImageElement */ loadImage?: (url: string) => Promise<Img> }

export class CharacterPreview2D {
  facing: number; private a: AppearanceValue; private imgs = new Map<string, Promise<Img | null>>(); private ready = new Map<string, Img | null>();
  private tinted = new Map<string, HTMLCanvasElement | OffscreenCanvas>(); private cssW = 160; private cssH = 200; private dpr = 1; private pick = 0;
  constructor(readonly canvas: HTMLCanvasElement, private o: CharacterPreview2DOptions) { this.a = o.appearance; this.facing = ((o.facing ?? FRONT_FACING) % 8 + 8) % 8; }
  private load(url: string): Promise<Img | null> {
    let p = this.imgs.get(url); if (p) return p;
    const ld = this.o.loadImage ?? ((u: string) => new Promise<Img>((res, rej) => { const im = new Image(); im.decoding = "async"; im.onload = () => res(im); im.onerror = () => rej(new Error(u)); im.src = u; }));
    p = ld(url).then((im) => { this.ready.set(url, im); return im; }, () => { this.ready.set(url, null); return null; }); this.imgs.set(url, p); return p;
  }
  /** Loads every sheet the look needs (all 8 facings) then swaps it in; a newer call supersedes. */
  async setAppearance(a: AppearanceValue): Promise<void> {
    const n = ++this.pick; const urls = new Set<string>();
    for (let k = 0; k < 8; k++) for (const l of previewLayers2D(this.o.registry, this.o.binding, a, k, 0, this.o.sources)) { urls.add(l.url); if (l.maskUrl) urls.add(l.maskUrl); }
    await Promise.all([...urls].map((u) => this.load(u))); if (n === this.pick) { this.a = a; this.tinted.clear(); }
  }
  setFacing(k: number): void { this.facing = ((Math.round(k) % 8) + 8) % 8; }
  rotate(s: number): void { this.setFacing(this.facing + s); }
  resize(cssW: number, cssH: number, dpr = globalThis.devicePixelRatio || 1): void {
    this.cssW = Math.max(1, cssW); this.cssH = Math.max(1, cssH); this.dpr = Math.min(3, dpr);
    this.canvas.width = Math.round(this.cssW * this.dpr); this.canvas.height = Math.round(this.cssH * this.dpr);
    this.canvas.style.width = `${this.cssW}px`; this.canvas.style.height = `${this.cssH}px`;
  }
  /** Integer device-pixel scale fitting a 64 px frame to ~62% of the height (same framing as the WebGL preview). */
  get scale(): number { const s = (this.canvas.height * 0.62) / 64; return s >= 1 ? Math.floor(s) : s; }
  private layerCanvas(p: PreviewLayer2D): CanvasImageSource | null {
    const img = this.ready.get(p.url); if (!img) return null; const r = p.ref, l = p.layer;
    const key = `${p.url}|${r.x},${r.y}|${l.tintR}|${l.tintG}|${l.tintMode}|${l.tintStrength}`; const c0 = this.tinted.get(key); if (c0) return c0;
    const doc = this.canvas.ownerDocument; const c = doc.createElement("canvas"); c.width = r.w; c.height = r.h;
    const g = c.getContext("2d", { willReadFrequently: true }); if (!g) return null; g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    if (l.tintR !== undefined || l.tintG !== undefined) {
      try { const d = g.getImageData(0, 0, r.w, r.h); let mask: Uint8ClampedArray | undefined; const mi = p.maskUrl ? this.ready.get(p.maskUrl) : undefined;
        if (mi) { const mc = doc.createElement("canvas"); mc.width = r.w; mc.height = r.h; const mg = mc.getContext("2d", { willReadFrequently: true })!; mg.drawImage(mi, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); mask = mg.getImageData(0, 0, r.w, r.h).data; }
        tintPixels(d.data, mask, l); g.putImageData(d, 0, 0); } catch { /* tainted canvas: untinted */ }
    }
    this.tinted.set(key, c); return c;
  }
  renderNow(timeSec = 0): void {
    const g = this.canvas.getContext("2d"); if (!g) return; const W = this.canvas.width, H = this.canvas.height, s = this.scale;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); if (this.o.backdrop) { g.fillStyle = this.o.backdrop; g.fillRect(0, 0, W, H); }
    g.imageSmoothingEnabled = false;
    const ox = Math.round(W / 2), oy = Math.round(H * 0.81);
    g.fillStyle = "rgba(0,0,0,.25)"; g.beginPath(); g.ellipse(ox, oy, 14 * s, 5 * s, 0, 0, Math.PI * 2); g.fill();
    for (const p of previewLayers2D(this.o.registry, this.o.binding, this.a, this.facing, timeSec, this.o.sources)) {
      const c = this.layerCanvas(p); if (!c) continue; const r = p.ref;
      g.setTransform(r.flipX ? -s : s, 0, 0, s, ox, oy); g.drawImage(c, Math.round(p.dx - r.anchorX), Math.round(p.dy - r.anchorY));
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
}
