/**
 * Canvas2DRenderer: sprite fallback when WebGL2 cannot be created (console browsers after a GPU reset, WebGL blocked for
 * the origin, software-only devices). Draws the REAL sprite art from the same manifest + atlas PNGs and the same view
 * World IsoView fills for IsoRenderer: terrain diamonds, depth-sorted sprites (Transform + Sprite + AnimState), and a
 * day/night ambient overlay with additive light glows. No bloom, lightmap, masks, wearables or building piece visuals.
 *
 * Presents the subset of the IsoRenderer surface the client uses (camera, capabilities, atlas.setRegistry, bindGameplay,
 * loadLook, resize, render, tilemap, setFocusEntity, diagReport) so IsoView can drive either one.
 */
import { Transform, PrevTransform, type World, type Entity } from "@engine/core";
import { worldToScreen, DEFAULT_ISO, CHUNK_SIZE, type TileMap } from "@engine/world";
import type { AssetRegistry } from "@engine/assets";
import { IsoCamera } from "./camera.js";
import { Sprite, LightSource } from "./components.js";
import { frameAnim } from "./frame-select.js";
import { SpriteFlag } from "./ids.js";
import { STATE_ANIMS, type AtlasSource } from "./assets/atlasManager.js";
import { computeDayLighting, dimForWeather } from "./timeOfDay.js";
import { weatherTargets } from "./weather.js";
import { readDayFraction, readDayNumber, readWeather } from "./env.js";
import { newStats, type FrameStats } from "./gl/util.js";
import type { GameplayBindings } from "./sprites.js";

export type FallbackRendererKind = "webgl2" | "canvas2d" | "debug";
export interface ContextProbe { (kind: "webgl2" | "2d"): unknown }
/** Pick the renderer for a device: WebGL2 (IsoRenderer) -> Canvas2D sprites -> debug dots. Probes a FRESH canvas so a
 *  lost/blocked context on #game cannot poison the probe. */
export function chooseRenderer(probe: ContextProbe, opts: { forceDebug?: boolean; forceCanvas?: boolean } = {}): FallbackRendererKind {
  if (opts.forceDebug) return "debug";
  const ok = (k: "webgl2" | "2d"): boolean => { try { return !!probe(k); } catch { return false; } };
  if (!opts.forceCanvas && ok("webgl2")) return "webgl2";
  if (ok("2d")) return "canvas2d";
  return "debug";
}

const TILE_COLORS = ["#1b1f1a", "#3f7a3a", "#4f8a43", "#7a6440", "#2d5d8a", "#c8b47a", "#6b6b6b", "#e8eef0"];

export class Canvas2DRenderer {
  readonly kind = "canvas2d" as const;
  readonly ctx: CanvasRenderingContext2D;
  readonly camera = new IsoCamera(DEFAULT_ISO);
  readonly capabilities = { renderer: "Canvas2D (no WebGL2)", vendor: "", mobile: false, lowEnd: true, basicAdapter: false, console: false, safe: true, flags: ["lowend"] as string[], fallbacks: ["Canvas2D sprite renderer (WebGL2 unavailable)"], problems: [] as string[], textureBudgetMB: 0 };
  readonly settings = { lights: true, shadows: true, weather: false, fog: false };
  stats: FrameStats = newStats();
  tilemap: TileMap | undefined;
  bindings: GameplayBindings = {};
  readonly vram = undefined;
  readonly gl = undefined;
  private registry: AssetRegistry | undefined;
  private sources = new Map<string, AtlasSource>();
  private images = new Map<string, HTMLImageElement | ImageBitmap | null>();
  private focus = -1; private t0 = performance.now(); private w = 0; private h = 0;
  /** Image loader (tests inject one). */
  loadImage: (url: string) => Promise<HTMLImageElement | ImageBitmap> = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(url)); i.src = url; });
  readonly atlas = {
    setRegistry: async (r: AssetRegistry, s: Map<string, AtlasSource>): Promise<void> => { this.registry = r; this.sources = s; },
    setPieceVariants: (_p: unknown): void => {}, setHands: (_a: string, _h: unknown): void => {},
  };

  constructor(readonly canvas: HTMLCanvasElement, ctx?: CanvasRenderingContext2D | null) {
    const c = ctx ?? canvas.getContext("2d", { alpha: false }); if (!c) throw new Error("Canvas2D unavailable");
    this.ctx = c;
  }
  bindGameplay(b: GameplayBindings): void { this.bindings = b; }
  setFocusEntity(e: number): void { this.focus = e; }
  setQualityPreset(_p: unknown): void {}
  async loadLook(_url: string): Promise<{ warnings: string[]; loaded: string[] }> { return { warnings: [], loaded: [] }; }
  resize(cssW: number, cssH: number, dpr: number): void {
    if (!(cssW > 0) || !(cssH > 0)) return;
    const d = Math.min(dpr, 1.5); this.w = Math.round(cssW * d); this.h = Math.round(cssH * d);
    this.canvas.width = this.w; this.canvas.height = this.h; this.camera.setViewport(this.w, this.h, d);
  }
  diagReport(): string { return `renderer: Canvas2D sprites (WebGL2 unavailable); images ${[...this.images.values()].filter(Boolean).length}/${this.images.size}; draws ${this.stats.drawCalls}`; }
  dispose(): void {}

  /** Atlas image for an atlas key (PNG at scale 1), loaded on first use; null while loading / failed. */
  image(atlasKey: string): HTMLImageElement | ImageBitmap | null {
    if (this.images.has(atlasKey)) return this.images.get(atlasKey)!;
    this.images.set(atlasKey, null);
    const src = this.sources.get(atlasKey); if (src) this.loadImage(src.url).then((i) => this.images.set(atlasKey, i), () => undefined);
    return null;
  }

  render(world: World, alpha: number): void {
    const g = this.ctx, cam = this.camera, s = cam.scale; const stats = (this.stats = newStats());
    const time = (performance.now() - this.t0) / 1000; const wr = readWeather(world), wt = weatherTargets(wr.kind, wr.intensity); // ADR-115: same curve + weather dimming as WebGL2 (no smoothing state: cheap)
    const day = dimForWeather(computeDayLighting(readDayFraction(world), readDayNumber(world)), { overcast: Math.max(wt.rain, wt.fog, wt.snow * 0.7), storm: wt.storm });
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    g.fillStyle = rgb(day.sky); g.fillRect(0, 0, this.w, this.h);
    g.setTransform(s, 0, 0, s, this.w / 2 - cam.x * s, this.h / 2 - cam.y * s); g.imageSmoothingEnabled = s < 1;
    const iso = DEFAULT_ISO; const tw = iso.tileW, th = iso.tileH;
    // terrain: diamonds around the camera
    const tm = this.tilemap; const c = cam.cssToWorld(cam.viewW / cam.dpr / 2, cam.viewH / cam.dpr / 2);
    const R = Math.ceil(Math.max(this.w, this.h) / (s * th)) + 2;
    if (tm) for (let y = Math.floor(c.y) - R; y < c.y + R; y++) for (let x = Math.floor(c.x) - R; x < c.x + R; x++) {
      const t = tm.getTile(x, y); if (!t && !tm.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE))) continue;
      const p = worldToScreen(x, y, 0, iso); g.fillStyle = TILE_COLORS[t % TILE_COLORS.length]!;
      g.beginPath(); g.moveTo(p.sx, p.sy - th / 2); g.lineTo(p.sx + tw / 2, p.sy); g.lineTo(p.sx, p.sy + th / 2); g.lineTo(p.sx - tw / 2, p.sy); g.fill(); stats.tiles++;
    }
    // sprites: gather, sort by iso depth (screen y of the foot), draw
    const reg = this.registry; const items: { e: Entity; sx: number; sy: number; depth: number }[] = [];
    if (reg && world.isRegistered(Sprite)) for (const e of world.query([Transform, Sprite])) {
      const cur = world.get(e, Transform)!; const prev = world.get(e, PrevTransform) ?? cur;
      const x = prev.x + (cur.x - prev.x) * alpha, y = prev.y + (cur.y - prev.y) * alpha, z = prev.z + (cur.z - prev.z) * alpha;
      const p = worldToScreen(x, y, z, iso); const flat = (world.get(e, Sprite)!.flags & SpriteFlag.Flat) !== 0;
      items.push({ e, sx: p.sx, sy: p.sy, depth: flatSortDepth(x + y, flat) });
    }
    items.sort((a, b) => a.depth - b.depth); // Flat ground decals (roads) first: always under feet and entities
    const an = this.bindings.animState; const tick = world.tick;
    for (const it of items) {
      const sp = world.get(it.e, Sprite)!; if (sp.scale > 0 && sp.scale < 0.01) continue;
      let anim = "idle"; let tAnim = time;
      const fa = frameAnim(sp.frameId); if (fa >= 0) { try { anim = reg!.sprite(sp.spriteId).animList[fa]?.name ?? "idle"; } catch { /* unknown sprite */ } tAnim = 0; }
      if (an && world.has(it.e, an)) { const a = world.get(it.e, an)!; const names = STATE_ANIMS[a.state] ?? ["idle"]; let def; try { def = reg!.sprite(sp.spriteId); } catch { def = undefined; }
        anim = names.find((n) => def?.animations.has(n)) ?? "idle"; tAnim = Math.max(0, (tick - a.startTick) / 20) * (this.bindings.animRate?.(it.e, a.state) ?? 1); }
      let f; try { f = reg!.dirFrame(sp.spriteId, anim, world.get(it.e, Transform)!.facing, tAnim); } catch { continue; }
      const img = this.image(f.atlas.key); if (!img) continue;
      const k = sp.scale || 1; const dw = f.w * k, dh = f.h * k;
      g.save(); g.translate(it.sx, it.sy); if (f.flipX) g.scale(-1, 1);
      g.drawImage(img, f.x, f.y, f.w, f.h, -f.anchorX * k, -f.anchorY * k, dw, dh); g.restore(); stats.sprites++; stats.drawCalls++;
    }
    // ambient (multiply) + lights (additive glows)
    g.setTransform(1, 0, 0, 1, 0, 0);
    const a = day.ambient; if (a[0] + a[1] + a[2] < 2.9) { g.globalCompositeOperation = "multiply"; g.fillStyle = rgb(a.map((v) => Math.min(1, v)) as [number, number, number]); g.fillRect(0, 0, this.w, this.h); }
    if (world.isRegistered(LightSource)) {
      g.globalCompositeOperation = "lighter"; g.setTransform(s, 0, 0, s, this.w / 2 - cam.x * s, this.h / 2 - cam.y * s);
      for (const e of world.query([Transform, LightSource])) {
        const L = world.get(e, LightSource)!; if (!(L.intensity > 0)) continue; const t = world.get(e, Transform)!; const p = worldToScreen(t.x, t.y, t.z, iso);
        const r = L.radius * tw * 0.5; const gr = g.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r);
        gr.addColorStop(0, `rgba(${L.r * 255 | 0},${L.g * 255 | 0},${L.b * 255 | 0},${Math.min(0.6, L.intensity * 0.4 * (1 - day.daylight * 0.8))})`); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr; g.fillRect(p.sx - r, p.sy - r, 2 * r, 2 * r);
      }
    }
    g.globalCompositeOperation = "source-over"; void this.focus;
  }
}
const rgb = (c: readonly number[]): string => `rgb(${Math.round(Math.min(1, c[0]!) * 255)},${Math.round(Math.min(1, c[1]!) * 255)},${Math.round(Math.min(1, c[2]!) * 255)})`;

/** Canvas2D sort key: Flat ground decals (roads, ADR-119) draw in a layer below every upright sprite, in iso order. */
export const flatSortDepth = (isoDepth: number, flat: boolean): number => (flat ? isoDepth - 1e7 : isoDepth);
