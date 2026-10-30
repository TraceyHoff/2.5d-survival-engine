import { reportRenderError } from "./report.js";
/**
 * Canvas2DRenderer: sprite fallback when WebGL2 cannot be created (console browsers after a GPU reset, WebGL blocked for
 * the origin, software-only devices). Draws the REAL sprite art from the same manifest + atlas PNGs and the same view
 * World IsoView fills for IsoRenderer: terrain diamonds, depth-sorted sprites (Transform + Sprite + AnimState), and a
 * day/night lightmap (ambient + iso light ellipses, multiplied; ADR-216), and paper-doll wearables (tinted on the CPU, ADR-128 head offset).
 * No bloom or masks. Building pieces (ADR-197) are painted level by level in a total order, with deck side faces
 * clipped where a neighbouring deck covers them.
 *
 * Presents the subset of the IsoRenderer surface the client uses (camera, capabilities, atlas.setRegistry, bindGameplay,
 * loadLook, resize, render, tilemap, setFocusEntity, diagReport) so IsoView can drive either one.
 */
import { Transform, PrevTransform, entityIndex, getAppearance, type World, type Entity } from "@engine/core";
import { fireAnimTime, hearthParticles, pieceFireFrame, isFireAnim, type HearthParticle } from "./fire-anim.js";
import { previewLayers2D, tintPixels, type PreviewLayer2D } from "./character/preview2d.js";
import { worldToScreen, DEFAULT_ISO, CHUNK_SIZE, floorToTerrainZ, terrainZToFloor, isWaterId, waterShoreTint, type TileMap, type Chunk } from "@engine/world";
import type { AssetRegistry } from "@engine/assets";
import { IsoCamera } from "./camera.js";
import { Sprite, LightSource } from "./components.js";
import { frameAnim } from "./frame-select.js";
import { Canvas2DLightmap, lightRadiusPx, type C2DLight } from "./canvasLight.js";
import { DEFAULT_STYLE } from "./style.js";
import { SpriteFlag } from "./ids.js";
import { STATE_ANIMS, type AtlasSource } from "./assets/atlasManager.js";
import { computeDayLighting, dimForWeather } from "./timeOfDay.js";
import { weatherTargets } from "./weather.js";
import { readDayFraction, readDayNumber, readWeather } from "./env.js";
import { newStats, type FrameStats } from "./gl/util.js";
import type { GameplayBindings } from "./sprites.js";
import { DeckNeighbors, deckTopPx, deckClipPolygon, deckSeamPatches, pieceTieBreak, exactTieBreak, pieceOrder, VERTEX_POST_BIAS } from "./building/deckFaces.js";
import { lCornerArmPiece, lCornerArmPivots, ROT_EXACT_PIVOT, ROT_DECK_LIFT, ROT_VERTEX_POST } from "./building/modular.js";

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

/** Flat ground fill per world tile id (world DEFAULT_BANDS: 1 water, 2 sand, 3 grass, 4 forest, 5 rock; 0 = none). The old
 * table was shifted by one, so grass (3) drew brown, forest blue and water green. */
export const TILE_COLORS = ["#1b1f1a", "#2d5d8a", "#c8b47a", "#4f8a43", "#3f7a3a", "#6b6b6b", "#7a6440", "#e8eef0", "#4f93bf"]; // [8] ADR-181 shallow water (lighter than deep [1])

/** ADR-145: snap a sprite origin to a whole device pixel (x*s + o integer) so nearest-neighbour pixel art keeps even texel widths. */
export function snapPx(v: number, s: number, o: number): number { return s >= 1 ? (Math.round(v * s + o) - o) / s : v; }

/** ADR-182: water colour from deep (#3484bc) toward shallow (#4f93bf) by shore tint 0..1. */
/** ADR-184: deep blue -> shore turquoise (same endpoints as the WebGL2 mesh). */
export const C2D_DEEP = [0x18, 0x46, 0x90] as const, C2D_SHALLOW = [0x5c, 0xd0, 0xd0] as const;
export function waterRgb(k: number): [number, number, number] { const m = (j: 0 | 1 | 2): number => Math.round(C2D_DEEP[j] + (C2D_SHALLOW[j] - C2D_DEEP[j]) * k); return [m(0), m(1), m(2)]; }
export class Canvas2DRenderer {
  readonly kind = "canvas2d" as const;
  readonly ctx: CanvasRenderingContext2D;
  readonly camera = new IsoCamera(DEFAULT_ISO);
  readonly capabilities = { renderer: "Canvas2D (no WebGL2)", vendor: "", mobile: false, lowEnd: true, basicAdapter: false, console: false, safe: true, flags: ["lowend"] as string[], fallbacks: ["Canvas2D sprite renderer (WebGL2 unavailable)"], problems: [] as string[], textureBudgetMB: 0 };
  readonly settings = { lights: true, shadows: true, weather: false, fog: false };
  stats: FrameStats = newStats();
  tilemap: TileMap | undefined;
  private tintCache = new WeakMap<Chunk, { stamp: string; t: Float32Array }>(); private waterCanvas: HTMLCanvasElement | undefined;
  bindings: GameplayBindings = {};
  readonly vram = undefined;
  readonly gl = undefined;
  private registry: AssetRegistry | undefined;
  private sources = new Map<string, AtlasSource>();
  private images = new Map<string, HTMLImageElement | ImageBitmap | null>();
  private focus = -1; private w = 0; private h = 0;
  private readonly lightmap = new Canvas2DLightmap();
  /** ADR-214: renderer-clock rate (hit-stop); the clock accumulates scaled frame time instead of reading wall time. */
  timeScale = 1; private clock = 0; private clockAt = -1;
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
    const src = this.sources.get(atlasKey); if (src) this.loadImage(src.url).then((i) => this.images.set(atlasKey, i), (e: unknown) => reportRenderError(`canvas2d atlas load ${src.url}`, e));
    return null;
  }

  /** Image by URL (tint masks), loaded on first use; null while loading / failed. */
  private urlImage(url: string): HTMLImageElement | ImageBitmap | null {
    const k = `url:${url}`; if (this.images.has(k)) return this.images.get(k)!;
    this.images.set(k, null); this.loadImage(url).then((i) => this.images.set(k, i), (e: unknown) => reportRenderError(`canvas2d image load ${url}`, e)); return null;
  }
  private tinted = new Map<string, CanvasImageSource>();
  /** A paper-doll layer's frame, tinted through its tintmask (cached); the raw sheet when untinted or no DOM canvas. */
  private layerImage(p: PreviewLayer2D): { img: CanvasImageSource; x: number; y: number } | null {
    const img = this.image(p.ref.atlas.key); if (!img) return null; const r = p.ref, l = p.layer;
    if ((l.tintR === undefined && l.tintG === undefined) || typeof document === "undefined") return { img, x: r.x, y: r.y };
    const key = `${r.atlas.key}|${r.x},${r.y},${r.w},${r.h}|${l.tintR}|${l.tintG}|${l.tintMode}|${l.tintStrength}`; const c0 = this.tinted.get(key); if (c0) return { img: c0, x: 0, y: 0 };
    const mi = p.maskUrl ? this.urlImage(p.maskUrl) : null; if (p.maskUrl && !mi) return { img, x: r.x, y: r.y };
    const c = document.createElement("canvas"); c.width = r.w; c.height = r.h; const g = c.getContext("2d", { willReadFrequently: true }); if (!g) return { img, x: r.x, y: r.y };
    g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    try { const d = g.getImageData(0, 0, r.w, r.h); let mask: Uint8ClampedArray | undefined;
      if (mi) { const mc = document.createElement("canvas"); mc.width = r.w; mc.height = r.h; const mg = mc.getContext("2d", { willReadFrequently: true })!; mg.drawImage(mi, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); mask = mg.getImageData(0, 0, r.w, r.h).data; }
      tintPixels(d.data, mask, l); g.putImageData(d, 0, 0); } catch { /* tainted: untinted */ }
    if (this.tinted.size > 512) this.tinted.clear(); this.tinted.set(key, c); return { img: c, x: 0, y: 0 };
  }

  /** ADR-184: cached per-chunk shore tints (re-derived when this chunk or a neighbour changes). */
  private chunkTint(tm: TileMap, ch: Chunk): Float32Array {
    let st = ""; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = tm.getChunk(ch.cx + dx, ch.cy + dy); st += n ? n.version + "," : "x,"; }
    const hit = this.tintCache.get(ch); if (hit && hit.stamp === st) return hit.t;
    const t = new Float32Array(CHUNK_SIZE * CHUNK_SIZE); const at = (a: number, b: number): number => tm.getTile(a, b);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) for (let lx = 0; lx < CHUNK_SIZE; lx++) t[ly * CHUNK_SIZE + lx] = waterShoreTint(at, ch.cx * CHUNK_SIZE + lx, ch.cy * CHUNK_SIZE + ly);
    this.tintCache.set(ch, { stamp: st, t }); return t;
  }
  /**
   * ADR-184: water as one image, 1 px per tile (land = full shore tint so the blend under sand is turquoise), drawn
   * through the iso affine with bilinear smoothing: a continuous shore->deep gradient instead of one fill per tile.
   */
  private drawWater(tm: TileMap, x0: number, y0: number, n: number): void {
    if (typeof document === "undefined") return;
    const cv = (this.waterCanvas ??= document.createElement("canvas")); if (cv.width !== n || cv.height !== n) { cv.width = n; cv.height = n; }
    const wg = cv.getContext("2d"); if (!wg) return; const img = wg.createImageData(n, n); const d = img.data; let any = false;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = x0 + i, y = y0 + j; const ch = tm.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)); if (!ch) continue;
      const li = (((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE) * CHUNK_SIZE + (((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE); const id = ch.tiles[li]!;
      const k = isWaterId(id) ? (any = true, this.chunkTint(tm, ch)[li]!) : 1; const c = waterRgb(k); const o = (j * n + i) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    if (!any) return; wg.putImageData(img, 0, 0);
    const g = this.ctx; const iso = DEFAULT_ISO; const o = worldToScreen(x0 - 0.5, y0 - 0.5, 0, iso);
    const a = worldToScreen(x0 + 0.5, y0 - 0.5, 0, iso), b = worldToScreen(x0 - 0.5, y0 + 0.5, 0, iso);
    g.save(); g.transform(a.sx - o.sx, a.sy - o.sy, b.sx - o.sx, b.sy - o.sy, o.sx, o.sy); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(cv, 0, 0); g.restore();
  }

  private decks = new DeckNeighbors();
  /** ADR-197: building pieces as painter items: level-major, decks under their floor's uprights, iso order, unique tie-break. */
  gatherPieces(world: World, reg: AssetRegistry, time = this.clock): C2DPiece[] {
    const bpd = this.bindings.buildPiece; if (!bpd || !world.isRegistered(bpd)) return [];
    const iso = DEFAULT_ISO; const hw = iso.tileW / 2, hh = iso.tileH / 2; const raw: { e: Entity; ax: number; ay: number; fw: number; fh: number; level: number; layer: number; z: number; vis: number; rot: number; dmg: number; ghost: boolean; deck: boolean; top: number | undefined; px: number; py: number }[] = [];
    this.decks.clear();
    for (const e of world.query([bpd, Transform])) {
      const b = world.get(e, bpd)!; const t = world.get(e, Transform)!; let sd; try { sd = reg.sprite(b.visualId); } catch { continue; } if (!sd.building) continue;
      const rot = b.rotation & 3; const fw = rot & 1 ? sd.building.footprint.h : sd.building.footprint.w, fh = rot & 1 ? sd.building.footprint.w : sd.building.footprint.h;
      const roof = (sd.building.piece ?? sd.key).startsWith("roof"); const deck = b.layer === 0 && !roof; const top = deck ? deckTopPx(sd.key) : undefined;
      const r = { e, ax: Math.floor(t.x), ay: Math.floor(t.y), fw, fh, level: b.level, layer: b.layer, z: floorToTerrainZ(b.level, t.z), vis: b.visualId, rot: b.rotation, dmg: b.damageStage, ghost: b.ghost > 0, deck, top, px: t.x, py: t.y };
      raw.push(r); if (deck && !r.ghost && top !== undefined) this.decks.add(r.ax, r.ay, fw, fh, r.level, top);
      // ADR-211: an L corner = its tier's straight wall on both arm edges (same pivots/flags as an edge wall) + the post art
      const armKey = lCornerArmPiece(sd.building.piece); const arm = armKey ? reg.spriteForPiece(armKey) : undefined;
      if (arm !== undefined) { let ad; try { ad = reg.sprite(arm); } catch { ad = undefined; }
        if (ad?.building) for (const a of lCornerArmPivots(t.x, t.y, b.rotation)) {
          const afw = a.rot & 1 ? ad.building.footprint.h : ad.building.footprint.w, afh = a.rot & 1 ? ad.building.footprint.w : ad.building.footprint.h;
          raw.push({ ...r, ax: Math.floor(a.x), ay: Math.floor(a.y), fw: afw, fh: afh, layer: 1, vis: arm, rot: a.rot | ROT_EXACT_PIVOT | ROT_DECK_LIFT, deck: false, top: undefined, px: a.x, py: a.y });
        } }
    }
    const out: C2DPiece[] = [];
    for (const r of raw) {
      // ADR-218: piece state (bonfire "unlit") + lit fires play their idle flame loop on the render clock (per-entity phase)
      const fire = this.bindings.pieceLit?.(r.e); const pst = this.bindings.pieceState?.(r.e) ?? -1;
      let f; try { f = pieceFireFrame(reg, r.vis, r.rot & 3, r.dmg, pst, fire, r.ghost, time, entityIndex(r.e)); } catch { continue; } const img = this.image(f.atlas.key); if (!img) continue;
      // ADR-210: exact pivot (edge midpoint / vertex / tri centroid) and deck-top lift, mirroring the WebGL2 path
      const exact = (r.rot & ROT_EXACT_PIVOT) !== 0; const pvx = exact ? r.px : r.ax + r.fw / 2, pvy = exact ? r.py : r.ay + r.fh / 2;
      const lift = r.rot & ROT_DECK_LIFT ? (exact ? this.decks.topNear(pvx, pvy, r.level) : this.decks.topOver(r.ax, r.ay, r.fw, r.fh, r.level)) : 0;
      const p0 = worldToScreen(pvx, pvy, r.z, iso); const p = { sx: p0.sx, sy: p0.sy - lift };
      const mask = r.top === undefined || exact ? 0 : this.decks.mask(r.ax, r.ay, r.fw, r.fh, r.level, r.top);
      const isoD = (exact ? pvx + pvy - 1 : r.ax + r.fw - 1 + r.ay + r.fh - 1) + r.layer * 0.01 + (exact ? exactTieBreak(pvx, pvy, r.ghost) : pieceTieBreak(r.ax, r.ay, r.ghost)) + (r.rot & ROT_VERTEX_POST ? VERTEX_POST_BIAS : 0);
      out.push({ e: r.e, sx: p.sx, sy: p.sy, depth: r.level * LEVEL_DEPTH + (r.deck ? DECK_DEPTH : 0) + isoD, ord: pieceOrder(r.level, r.layer, r.ax, r.ay) * 2 + (r.ghost ? 1 : 0), img, f,
        clip: mask ? deckClipPolygon(r.fw, r.fh, mask, r.top!, hw, hh) : undefined, seams: mask ? deckSeamPatches(r.fw, r.fh, mask, r.top!, hw, hh) : undefined, ghost: r.ghost, hearth: fire === 2 && !r.ghost && r.dmg === 0 });
    }
    return out;
  }
  private hearthBuf: HearthParticle[] = [];
  /** ADR-218: stateless embers (additive) + smoke puffs over a lit hearth (Canvas2D has no particle layer). */
  private drawHearth(sx: number, sy: number, time: number, seed: number, s: number, ox: number, oy: number): void {
    const g = this.ctx; const ps = hearthParticles(time, seed, 9, DEFAULT_ISO.tileW, this.hearthBuf);
    g.save(); g.translate(snapPx(sx, s, ox), snapPx(sy, s, oy));
    for (const p of ps) {
      if (p.alpha <= 0.01) continue;
      g.globalCompositeOperation = p.ember ? "lighter" : "source-over"; g.globalAlpha = Math.min(1, p.alpha);
      g.fillStyle = p.ember ? "rgb(255,170,60)" : "rgb(120,116,110)";
      g.beginPath(); g.arc(p.dx, p.dy, p.size, 0, Math.PI * 2); g.fill(); this.stats.drawCalls++;
    }
    g.restore();
  }
  private drawPiece(pc: C2DPiece, s: number, ox: number, oy: number): void {
    const g = this.ctx; const f = pc.f; g.save(); g.translate(snapPx(pc.sx, s, ox), snapPx(pc.sy, s, oy));
    if (pc.clip) { g.beginPath(); pc.clip.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.clip(); }
    if (pc.ghost) g.globalAlpha = 0.6;
    if (f.flipX) g.scale(-1, 1);
    g.drawImage(pc.img, f.x, f.y, f.w, f.h, -f.anchorX, -f.anchorY, f.w, f.h); g.restore(); this.stats.sprites++; this.stats.drawCalls++;
    if (pc.seams) for (const sp of pc.seams) { // ADR-210 connected top: closed-side border bands repainted from the interior
      g.save(); g.translate(snapPx(pc.sx, s, ox), snapPx(pc.sy, s, oy));
      g.beginPath(); sp.poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.clip();
      if (pc.ghost) g.globalAlpha = 0.6;
      g.translate(-sp.dx, -sp.dy); if (f.flipX) g.scale(-1, 1);
      g.drawImage(pc.img, f.x, f.y, f.w, f.h, -f.anchorX, -f.anchorY, f.w, f.h); g.restore(); this.stats.drawCalls++;
    }
  }

  render(world: World, alpha: number): void {
    const g = this.ctx, cam = this.camera, s = cam.scale; const stats = (this.stats = newStats());
    const nowMs = performance.now(); if (this.clockAt >= 0) this.clock += Math.min(0.1, (nowMs - this.clockAt) / 1000) * (this.timeScale > 0 ? Math.min(1, this.timeScale) : 1); this.clockAt = nowMs; const time = this.clock; const wr = readWeather(world), wt = weatherTargets(wr.kind, wr.intensity); // ADR-115: same curve + weather dimming as WebGL2 (no smoothing state: cheap)
    const day = dimForWeather(computeDayLighting(readDayFraction(world), readDayNumber(world)), { overcast: Math.max(wt.rain, wt.fog, wt.snow * 0.7), storm: wt.storm });
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    g.fillStyle = rgb(day.sky); g.fillRect(0, 0, this.w, this.h);
    const ox = Math.round(this.w / 2 - cam.x * s), oy = Math.round(this.h / 2 - cam.y * s); g.setTransform(s, 0, 0, s, ox, oy); g.imageSmoothingEnabled = s < 1; // ADR-197: whole-pixel camera origin
    const iso = DEFAULT_ISO; const tw = iso.tileW, th = iso.tileH;
    // terrain: diamonds around the camera
    const tm = this.tilemap; const c = cam.cssToWorld(cam.viewW / cam.dpr / 2, cam.viewH / cam.dpr / 2);
    const R = Math.ceil(Math.max(this.w, this.h) / (s * th)) + 2;
    if (tm) this.drawWater(tm, Math.floor(c.x) - R, Math.floor(c.y) - R, 2 * R + 1); // ADR-184: smooth gradient under the land diamonds
    if (tm) for (let y = Math.floor(c.y) - R; y < c.y + R; y++) for (let x = Math.floor(c.x) - R; x < c.x + R; x++) {
      let t = tm.getTile(x, y); if (!t && !tm.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE))) continue;
      if (isWaterId(t)) { stats.tiles++; continue; }
      const p = worldToScreen(x, y, 0, iso); g.fillStyle = TILE_COLORS[t % TILE_COLORS.length]!;
      g.beginPath(); g.moveTo(p.sx, p.sy - th / 2); g.lineTo(p.sx + tw / 2, p.sy); g.lineTo(p.sx, p.sy + th / 2); g.lineTo(p.sx - tw / 2, p.sy); g.fill(); stats.tiles++;
    }
    // sprites: gather, sort by iso depth (screen y of the foot), draw
    const reg = this.registry; const items: { e: Entity; sx: number; sy: number; depth: number; ord: number; pc?: C2DPiece }[] = [];
    if (reg && world.isRegistered(Sprite)) for (const e of world.query([Transform, Sprite])) {
      const cur = world.get(e, Transform)!; const prev = world.get(e, PrevTransform) ?? cur;
      const x = prev.x + (cur.x - prev.x) * alpha, y = prev.y + (cur.y - prev.y) * alpha, z = prev.z + (cur.z - prev.z) * alpha;
      const p = worldToScreen(x, y, z, iso); const flat = (world.get(e, Sprite)!.flags & SpriteFlag.Flat) !== 0;
      const lvl = z >= FLOOR_Z - 1e-6 ? terrainZToFloor(z, 0) : 0;
      items.push({ e, sx: p.sx, sy: p.sy, depth: lvl * LEVEL_DEPTH + flatSortDepth(x + y, flat), ord: 1e15 + e });
    }
    if (reg) for (const pc of this.gatherPieces(world, reg)) items.push({ e: pc.e, sx: pc.sx, sy: pc.sy, depth: pc.depth, ord: pc.ord, pc });
    items.sort((a, b) => (a.depth - b.depth) || (a.ord - b.ord)); // ADR-197: total order (no equal-key coin flips) // Flat ground decals (roads) first: always under feet and entities
    const an = this.bindings.animState; const tick = world.tick;
    for (const it of items) {
      if (it.pc) { this.drawPiece(it.pc, s, ox, oy); if (it.pc.hearth) this.drawHearth(it.pc.sx, it.pc.sy, time, entityIndex(it.e), s, ox, oy); continue; }
      const sp = world.get(it.e, Sprite)!; if (sp.scale > 0 && sp.scale < 0.01) continue;
      let anim = "idle"; let tAnim = time;
      const fa = frameAnim(sp.frameId); if (fa >= 0) { try { anim = reg!.sprite(sp.spriteId).animList[fa]?.name ?? "idle"; } catch { /* unknown sprite */ } tAnim = 0; }
      if (an && world.has(it.e, an)) { const a = world.get(it.e, an)!; const names = STATE_ANIMS[a.state] ?? ["idle"]; let def; try { def = reg!.sprite(sp.spriteId); } catch { def = undefined; }
        anim = names.find((n) => def?.animations.has(n)) ?? "idle"; tAnim = Math.max(0, (tick - a.startTick) / 20) * (this.bindings.animRate?.(it.e, a.state) ?? 1); }
      // ADR-218: a lit fire sprite (station bonfire) loops its flame at its own phase, with embers + smoke
      const litB = this.bindings.lit; let hearth = false;
      if (fa < 0 && !(an && world.has(it.e, an)) && litB && world.isRegistered(litB) && world.has(it.e, litB) && (world.get(it.e, litB) as { lit?: number }).lit) {
        let def; try { def = reg!.sprite(sp.spriteId); } catch { def = undefined; }
        if (def && isFireAnim(def)) { anim = "idle"; tAnim = fireAnimTime(time, entityIndex(it.e)); hearth = true; }
      }
      const facing = world.get(it.e, Transform)!.facing; const k = sp.scale || 1;
      // ADR-134 flinch: brief brightness flash + tilt about the foot (same bindings as WebGL's hitFlash)
      const hf = this.bindings.hitFlash?.(it.e) ?? 0; const tilt = this.bindings.hitTilt?.(it.e) ?? 0;
      const fx = (): void => { if (tilt) g.rotate(tilt); if (hf > 0) g.filter = `brightness(${(1 + 2.5 * Math.min(1, hf)).toFixed(2)})`; };
      // paper doll (same layer list + per-frame anchors as the creator's 2D preview; head layers follow the body's head anchor)
      const apB = this.bindings.appearance; const look = apB && world.has(it.e, apB.def) ? getAppearance(world, it.e) : undefined;
      if (look && apB) {
        let ls: PreviewLayer2D[] = []; try { ls = previewLayers2D(reg!, apB, look, 0, tAnim, this.sources, anim, facing); } catch { ls = []; }
        if (ls.length) {
          for (const p of ls) { const li = this.layerImage(p); if (!li) continue; const r = p.ref;
            g.save(); g.translate(snapPx(it.sx, s, ox), snapPx(it.sy, s, oy)); fx(); if (r.flipX) g.scale(-1, 1);
            g.drawImage(li.img, li.x, li.y, r.w, r.h, (p.dx - r.anchorX) * k, (p.dy - r.anchorY) * k, r.w * k, r.h * k); g.restore(); stats.drawCalls++; }
          stats.sprites++; continue;
        }
      }
      let f; try { f = reg!.dirFrame(sp.spriteId, anim, facing, tAnim); } catch { continue; }
      const img = this.image(f.atlas.key); if (!img) continue;
      const dw = f.w * k, dh = f.h * k;
      g.save(); g.translate(snapPx(it.sx, s, ox), snapPx(it.sy, s, oy)); fx(); if (f.flipX) g.scale(-1, 1);
      g.drawImage(img, f.x, f.y, f.w, f.h, -f.anchorX * k, -f.anchorY * k, dw, dh); g.restore(); stats.sprites++; stats.drawCalls++;
      if (hearth) this.drawHearth(it.sx, it.sy, time, entityIndex(it.e), s, ox, oy);
    }
    // ADR-216: real lightmap (ambient + additive iso light ellipses) multiplied onto the scene, like the WebGL LightPass
    g.setTransform(1, 0, 0, 1, 0, 0);
    const a = day.ambient;
    if (a[0] + a[1] + a[2] < 2.9) {
      const lights: C2DLight[] = [];
      if (this.settings.lights && world.isRegistered(LightSource)) for (const e of world.query([Transform, LightSource])) {
        const L = world.get(e, LightSource)!; if (!(L.intensity > 0) || !(L.radius > 0)) continue; const t = world.get(e, Transform)!; const p = worldToScreen(t.x, t.y, t.z, iso);
        lights.push({ sx: p.sx, sy: p.sy, r: lightRadiusPx(L.radius, tw), color: [L.r, L.g, L.b], intensity: L.intensity, flicker: L.flicker });
      }
      stats.lights = lights.length;
      this.lightmap.apply(g, this.w, this.h, { s, ox: this.w / 2 - cam.x * s, oy: this.h / 2 - cam.y * s }, a, C2D_DAYLIGHT_LIGHT_SCALE + (1 - C2D_DAYLIGHT_LIGHT_SCALE) * day.glow, time, lights);
    }
    g.globalCompositeOperation = "source-over"; void this.focus;
  }
}
const FLOOR_Z = floorToTerrainZ(1, 0);
const C2D_DAYLIGHT_LIGHT_SCALE = DEFAULT_STYLE.daylightLightScale;
/** Painter layers: everything on floor N draws after floor N-1; decks draw below the uprights of their own floor. */
const LEVEL_DEPTH = 1e6, DECK_DEPTH = -5e5;
interface C2DPiece { e: Entity; sx: number; sy: number; depth: number; ord: number; img: CanvasImageSource; f: { x: number; y: number; w: number; h: number; anchorX: number; anchorY: number; flipX?: boolean }; clip: [number, number][] | undefined; seams?: { poly: [number, number][]; dx: number; dy: number }[] | undefined; ghost: boolean; hearth?: boolean }
const rgb = (c: readonly number[]): string => `rgb(${Math.round(Math.min(1, c[0]!) * 255)},${Math.round(Math.min(1, c[1]!) * 255)},${Math.round(Math.min(1, c[2]!) * 255)})`;

/** Canvas2D sort key: Flat ground decals (roads, ADR-119) draw in a layer below every upright sprite, in iso order. */
export const flatSortDepth = (isoDepth: number, flat: boolean): number => (flat ? isoDepth - 1e7 : isoDepth);
