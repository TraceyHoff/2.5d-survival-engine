/**
 * AtlasManager: GPU side of the @engine/assets registry.
 *
 * - Loads atlas images (and optional `<atlas>_emissive.png` masks) through core's ref-counted
 *   AssetManager, packs every atlas image into layers of ONE RGBA8 TEXTURE_2D_ARRAY (default 2048²,
 *   mipmapped) plus a parallel emissive array with the identical layout, so all sprites from all
 *   atlases draw in a single instanced call.
 * - Scale pages (Atlas.pages, ADR-070): the page for the current quality tier's target scale is picked with
 *   AssetRegistry.pickPage(atlas, scale) and packed instead of the 1x image; frame sizes stay in 1x px, only the
 *   uv rect changes. Mask pages (Atlas.masks emissive/sheen/sway/tintmask) share the 1x layout and are sampled by
 *   the same UVs: they are resized to the chosen page on upload, so one mask covers every scale.
 * - Status tint table (RGBA32F, 8 texels/row): row 0 = global status tints (render_tuning), one row per sprite with
 *   SpriteDef.tints overrides. The row index rides in the frame table flags.
 * - Builds a frame table (RGBA32F texture, 2 texels/entry: uv rect, size+layer+flags; flags = mask bits | tintRow << 4)
 *   indexed by `atlasBase[atlasId] + frameIndex`. Grid atlases use the manifest grid; TexturePacker
 *   atlases supply a RectTable (see texturePacker.ts).
 * - Precomputes per-sprite animation tables at load time so render-time resolution is array math
 *   (never string lookups).
 * - Runtime switching: swapAtlas()/setTheme() replace atlas images (same layout & sprite keys -> same
 *   numeric ids), so ECS data is untouched. Old images are released (ref-counted) after the swap.
 */
import { AssetRegistry, type Animation, type Atlas, type FrameRef } from "@engine/assets";
import { STATUS_TINTS, TINT_MODE_INDEX, type StatusTint, type StatusTintName } from "../style.js";
import type { AssetManager } from "@engine/core";
import type { RectTable } from "./texturePacker.js";

/** Held-item hand anchor of one character frame (Art hands.json). */
export interface HandAnchor { x: number; y: number; angle: number; len?: number; behind: boolean }
export type MaskName = "sheen" | "sway" | "tintmask";
/** Frame-table flag bits (low 4 bits of the flags float; tint row = flags >> 4). */
export const FrameBits = { Emissive: 1, Sheen: 2, Sway: 4, TintMask: 8 } as const;
/**
 * Where an atlas' images live. `pages` = extra scale pages (1x = url). `masks`: one URL or candidate URLs tried in
 * order (explicit manifest path, then sibling `<atlas>_<mask>.png`, then a fallback folder); missing ones are skipped.
 */
export interface AtlasSource { url: string; emissiveUrl?: string | null; rects?: RectTable; pages?: { scale: number; url: string }[]; masks?: Partial<Record<MaskName, string | string[]>> }
export type ImageLike = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

/** AnimState.state -> animation names tried in order (first animation is the final fallback). */
export const STATE_ANIMS: readonly (readonly string[])[] = [
  ["idle"], ["walk"], ["run", "walk"], ["attack"], ["hit", "hurt", "idle"], ["death", "idle"], ["shamble", "walk"],
  // 7 crawl, 8 feed (gameplay AnimState; zombie_*_crawl / zombie_*_feed in pack wave 2)
  ["crawl", "shamble", "walk"], ["feed", "attack", "idle"],
];
export const enum AnimStateId { Idle = 0, Walk = 1, Run = 2, Attack = 3, Hit = 4, Death = 5, Shamble = 6, Crawl = 7, Feed = 8 }

interface SpriteRT {
  atlasIdx: number; anchorX: number; anchorY: number;
  anims: Animation[];
  /** state -> index into anims */
  stateAnim: Int16Array;
  /** "damaged"/"damage1.." frames for build pieces: list of frame indices per stage (stage 0 = idle). */
  damage: number[];
  /** From the manifest's `building` block: footprint, layer, frames[rotation][damageStage]. */
  building?: { fw: number; fh: number; layer: number; frames: number[][] };
}
interface AtlasRT { key: string; id: number; source: AtlasSource; img: ImageLike | null; emis: ImageLike | null; scale: number;
  masks: Partial<Record<MaskName, ImageLike>>; maskUrls: Partial<Record<MaskName, string>>; base: number; count: number; fw: number; fh: number; cols: number; layer: number; px: number; py: number }

export interface SwayParams { amp: number; freq: number; stiffness: number }
/** Read optional per-sprite `sway: {amp, freq, stiffness}` blocks from raw manifest JSON (loadManifest ignores them). */
export function swayFromManifest(json: unknown): { table: Record<string, SwayParams>; issues: string[] } {
  const table: Record<string, SwayParams> = {}; const issues: string[] = [];
  const sprites = (json as { sprites?: unknown[] } | null)?.sprites; if (!Array.isArray(sprites)) return { table, issues };
  for (const sp of sprites as { key?: string; sway?: Partial<SwayParams> }[]) {
    if (!sp?.sway || !sp.key) continue; const w = sp.sway;
    if (![w.amp, w.freq].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) { issues.push(`${sp.key}: bad sway`); continue; }
    table[sp.key] = { amp: w.amp!, freq: w.freq!, stiffness: typeof w.stiffness === "number" ? w.stiffness : 0.5 };
  }
  return { table, issues };
}
export interface AtlasStats { layers: number; layerSize: number; /** atlas images scaled by this to fit the GPU memory budget (1 = full res) */ downscale: number; gpuMB: number; atlases: number; frames: number; sprites: number; version: number }

const TABLE_W = 1024; // entries per frame-table row

/**
 * Image sources for every atlas of a manifest-loaded registry: scale pages (Atlas.pages) and masks (Atlas.masks).
 * `resolve` maps a manifest image path to a URL (default: relative to the manifest URL). Masks the manifest does not
 * name are looked up as siblings `<atlas image stem>_<mask>.png` and then under `fallbackMaskDirs[mask]`.
 */
export function sourcesFromManifest(registry: AssetRegistry, manifestUrl: string, rects: Record<string, RectTable> = {},
  opts: { resolve?: (path: string) => string; fallbackMaskDirs?: Partial<Record<MaskName, string>>; probeSiblings?: boolean } = {}): Map<string, AtlasSource> {
  const base = manifestUrl.replace(/[^/]*$/, "");
  const resolve = opts.resolve ?? ((p: string) => (/^(\/|[a-z]+:)/i.test(p) ? p : base + p));
  const out = new Map<string, AtlasSource>();
  for (const a of registry.atlases.values()) {
    const r = rects[a.key];
    const pages = (a.pages ?? []).filter((p) => p.scale !== 1).map((p) => ({ scale: p.scale, url: resolve(p.image) }));
    const masks: Partial<Record<MaskName, string[]>> = {};
    for (const m of ["sheen", "sway", "tintmask"] as const) {
      const c: string[] = []; const explicit = a.masks?.[m];
      if (explicit) c.push(resolve(explicit));
      if (opts.probeSiblings !== false) c.push(resolve(a.image).replace(/(\.[a-z]+)$/i, `_${m}$1`));
      const dir = opts.fallbackMaskDirs?.[m]; if (dir) c.push(`${dir.replace(/\/?$/, "/")}${a.image.replace(/^.*\//, "").replace(/(\.[a-z]+)$/i, `_${m}$1`)}`);
      if (c.length) masks[m] = [...new Set(c)];
    }
    out.set(a.key, { url: resolve(a.image), emissiveUrl: a.emissiveImage ? resolve(a.emissiveImage) : null, ...(r ? { rects: r } : {}), ...(pages.length ? { pages } : {}), masks });
  }
  return out;
}

/** 1x1 transparent array (stands in for unused emissive / mask arrays). */
function dummyArray(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  return t;
}

/** Downscale every image of the list by k (colour/emissive smooth, masks pixelated); frame sizes stay in 1x px via a.scale. */
async function scaleList(list: AtlasRT[], k: number): Promise<void> {
  if (typeof createImageBitmap !== "function") return;
  const rs = (im: ImageLike, q: "high" | "pixelated") => createImageBitmap(im as ImageBitmapSource, { resizeWidth: Math.max(1, Math.floor(im.width * k)), resizeHeight: Math.max(1, Math.floor(im.height * k)), resizeQuality: q, premultiplyAlpha: "none", colorSpaceConversion: "none" } as ImageBitmapOptions);
  await Promise.all(list.map(async (a) => {
    a.img = await rs(a.img!, "high"); if (a.emis) a.emis = await rs(a.emis, "high");
    for (const m of Object.keys(a.masks) as MaskName[]) a.masks[m] = await rs(a.masks[m]!, "pixelated");
    a.scale *= k;
  }));
}

/** Resize a mask to the chosen page size (masks share the 1x layout; sampled by the same UVs). null when impossible. */
async function fitToPage(img: ImageLike, w: number, h: number): Promise<ImageLike | null> {
  if (img.width === w && img.height === h) return img;
  if (typeof createImageBitmap !== "function") return null;
  if (Math.abs(img.width / img.height - w / h) > 0.01) return null; // not the same layout
  return createImageBitmap(img as ImageBitmapSource, { resizeWidth: w, resizeHeight: h, resizeQuality: "pixelated", premultiplyAlpha: "none", colorSpaceConversion: "none" } as ImageBitmapOptions);
}

export async function defaultImageLoader(url: string): Promise<ImageLike> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image fetch failed ${res.status}: ${url}`);
  return createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

export class AtlasManager {
  readonly layerSize: number;
  tex: WebGLTexture | null = null;
  emisTex: WebGLTexture | null = null;
  /** sheen (R sheen, G darken, B drip spawn), sway weight (R) and tint mask arrays, same layout as `tex`. */
  sheenTex: WebGLTexture | null = null; swayTex: WebGLTexture | null = null; tintMaskTex: WebGLTexture | null = null;
  /** Status tint table (see header). */
  tintTex: WebGLTexture | null = null;
  frameTex: WebGLTexture | null = null;
  /** Target page scale (quality tier x dpr x zoom); pages are chosen with AssetRegistry.pickPage. */
  private pageScale = 1;
  private statusTints: Record<StatusTintName, StatusTint> | null = null;
  private tintRows: (Record<string, { color: number; strength: number; mode: string; saturation?: number }> | null)[] = [null];
  private maskPixels = new Map<string, { w: number; h: number; data: Uint8ClampedArray } | null>();
  registry: AssetRegistry | null = null;
  /** Bumped on every successful (re)build. */
  version = 0;
  private atlases: AtlasRT[] = [];
  private atlasById = new Map<number, AtlasRT>();
  private sprites: (SpriteRT | undefined)[] = [];
  private held: [string, string][] = []; // (kind,url) pairs held in AssetManager
  private themes = new Map<string, Record<string, AtlasSource>>();
  private baseSources = new Map<string, AtlasSource>();
  private layers = 0; private maxLayers = 256;
  private totalFrames = 0;
  private hasEmissive = false;
  static readonly IMAGE_KIND = "render:image";
  private swayByKey = new Map<string, SwayParams>();
  private swayById: (Float32Array | undefined)[] = [];

  /** Per-sprite wind sway overrides {amp px at frame top, freq Hz, stiffness 0..1 (higher = stiffer)}; SpriteDef.sway is the default source. */
  setSway(table: Record<string, SwayParams>): void { for (const [k, v] of Object.entries(table)) this.swayByKey.set(k, v); this.resolveSway(); }
  swayOf(spriteId: number): Float32Array | undefined { return this.swayById[spriteId]; }
  private resolveSway(): void {
    this.swayById = [];
    if (!this.registry) return;
    // SpriteDef.sway (manifest) is the source; setSway() entries override per key
    for (const sp of this.registry.allSprites()) if (sp.sway) this.swayById[sp.id] = new Float32Array([sp.sway.amp, sp.sway.freq, sp.sway.stiffness]);
    for (const [k, v] of this.swayByKey) { const id = this.registry.ids.sprites.tryId(k); if (id !== undefined) this.swayById[id] = new Float32Array([v.amp, v.freq, v.stiffness]); }
  }

  /** GPU memory budget for the atlas texture arrays (MB); over budget -> images are downscaled (0.5, 0.25). */
  textureBudgetMB: number;
  /** Current budget downscale (1 = full res). */
  downscale = 1;
  private gpuBytes = 0;
  /** Reports GL out-of-memory on upload (the client overlay listens through IsoRenderer.onError). */
  onError: ((e: { kind: "oom"; message: string }) => void) | null = null;

  constructor(private gl: WebGL2RenderingContext, private assets: AssetManager, opts: { layerSize?: number; imageLoader?: (url: string) => Promise<ImageLike>; textureBudgetMB?: number } = {}) {
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.layerSize = Math.min(opts.layerSize ?? 2048, max || 2048);
    this.textureBudgetMB = opts.textureBudgetMB ?? 768;
    this.maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
    assets.registerLoader<ImageLike>(AtlasManager.IMAGE_KIND, opts.imageLoader ?? defaultImageLoader);
  }

  get stats(): AtlasStats { return { layers: this.layers, layerSize: this.layerSize, downscale: this.downscale, gpuMB: Math.round(this.gpuBytes / 1048576), atlases: this.atlases.length, frames: this.totalFrames, sprites: this.sprites.filter(Boolean).length, version: this.version }; }

  /** Install a registry and where its atlas images live. Resolves once GPU data is ready. */
  async setRegistry(registry: AssetRegistry, sources: Map<string, AtlasSource> | Record<string, AtlasSource>): Promise<void> {
    this.baseSources = new Map(sources instanceof Map ? sources : Object.entries(sources));
    for (const k of registry.atlases.keys()) if (!this.baseSources.has(k)) throw new Error(`no image source for atlas "${k}"`);
    await this.rebuild(registry, this.baseSources);
  }

  /** Register a theme: per-atlas overrides with identical layout (e.g. a player skin set or a whole visual theme). */
  registerTheme(name: string, overrides: Record<string, AtlasSource>): void { this.themes.set(name, overrides); }

  /** Activate a theme (or null for base). Sprite/frame ids are unchanged, so ECS data needs no rebuild. */
  async setTheme(name: string | null): Promise<void> {
    if (!this.registry) throw new Error("setTheme before setRegistry");
    const merged = new Map(this.baseSources);
    if (name !== null) { const t = this.themes.get(name); if (!t) throw new Error(`unknown theme ${name}`); for (const [k, v] of Object.entries(t)) merged.set(k, v); }
    await this.rebuild(this.registry, merged);
  }

  /**
   * Quality-tier page selection: atlases with scale pages use AssetRegistry.pickPage(atlas, scale). Rebuilds (async)
   * when the choice changes. Pages that do not fit a layer fall back to the next smaller page.
   */
  async setPageScale(scale: number): Promise<boolean> {
    const s = scale >= 1.5 ? 2 : 1; if (s === this.pageScale) return false;
    this.pageScale = s;
    if (!this.registry) return false;
    const changes = this.atlases.some((a) => this.pickScale(this.registry!.atlases.get(a.key)!, a.source) !== a.scale / this.downscale);
    if (!changes) return false;
    await this.rebuild(this.registry, new Map(this.atlases.map((a) => [a.key, a.source] as [string, AtlasSource])));
    return true;
  }
  get currentPageScale(): number { return this.pageScale; }
  private pickScale(atlas: Atlas | undefined, src: AtlasSource): number {
    if (!src.pages?.length || !atlas) return 1;
    const want = atlas.pages?.length ? AssetRegistry.pickPage(atlas, this.pageScale).scale : this.pageScale;
    const ok = (k: number) => k === 1 || ((src.pages!.some((p) => p.scale === k)) && atlas.columns * atlas.frameW * k <= this.layerSize && atlas.rows * atlas.frameH * k <= this.layerSize);
    for (const k of [...new Set([want, ...src.pages.map((p) => p.scale).filter((k) => k < want).sort((a, b) => b - a), 1])]) if (ok(k)) return k;
    return 1;
  }

  /** Global status tints (row 0 of the tint table). Per-sprite SpriteDef.tints override by name. */
  setStatusTints(t: Record<StatusTintName, StatusTint>): void { this.statusTints = t; if (this.registry) this.uploadTints(); }

  /** Replace the image of one atlas (same layout). */
  async swapAtlas(atlasKey: string, source: AtlasSource): Promise<void> {
    if (!this.registry) throw new Error("swapAtlas before setRegistry");
    const merged = new Map(this.atlases.map((a) => [a.key, a.source] as [string, AtlasSource])); merged.set(atlasKey, source);
    await this.rebuild(this.registry, merged);
  }

  private async rebuild(registry: AssetRegistry, sources: Map<string, AtlasSource>): Promise<void> {
    const prevHeld = this.held; const held: [string, string][] = [];
    const load = async (url: string): Promise<ImageLike> => { held.push([AtlasManager.IMAGE_KIND, url]); return this.assets.load<ImageLike>(AtlasManager.IMAGE_KIND, url); };
    const loadOpt = async (url: string | null | undefined): Promise<ImageLike | null> => {
      if (!url) return null;
      try { return await load(url); } catch { held.pop(); this.assets.release(AtlasManager.IMAGE_KIND, url); return null; }
    };
    const firstOf = async (c: string | string[] | undefined): Promise<[ImageLike | null, string | undefined]> => {
      for (const u of c === undefined ? [] : Array.isArray(c) ? c : [c]) { const im = await loadOpt(u); if (im) return [im, u]; }
      return [null, undefined];
    };
    const list: AtlasRT[] = [];
    await Promise.all([...registry.atlases.values()].map(async (a) => {
      const src = sources.get(a.key); if (!src) throw new Error(`no image source for atlas "${a.key}"`);
      let scale = this.pickScale(a, src);
      const pageUrl = scale === 1 ? src.url : src.pages!.find((p) => p.scale === scale)!.url;
      let [img, emis] = await Promise.all([loadOpt(pageUrl), loadOpt(src.emissiveUrl)]);
      if (!img) { scale = 1; img = await load(src.url); }
      const masks: AtlasRT["masks"] = {}; const maskUrls: AtlasRT["maskUrls"] = {};
      for (const m of ["sheen", "sway", "tintmask"] as const) { const [im, u] = await firstOf(src.masks?.[m]); if (im && u) { masks[m] = im; maskUrls[m] = u; } }
      // masks (and the 1x emissive page) are resized to the chosen page so they line up under the same UVs
      if (emis) emis = await fitToPage(emis, img.width, img.height);
      for (const m of Object.keys(masks) as MaskName[]) { const f = await fitToPage(masks[m]!, img.width, img.height); if (f) masks[m] = f; else { delete masks[m]; delete maskUrls[m]; } }
      list.push({ key: a.key, id: a.id, source: src, img, emis, scale, masks, maskUrls, base: 0, count: src.rects ? src.rects.length : a.columns * a.rows, fw: a.frameW, fh: a.frameH, cols: a.columns, layer: 0, px: 0, py: 0 });
    }));
    list.sort((a, b) => a.id - b.id);
    await this.fitBudget(list);
    this.pack(list);
    this.upload(list, this.frameTintRows(registry, list));
    if (this.gl.getError() === this.gl.OUT_OF_MEMORY && this.downscale > 0.25) {
      // the driver refused the arrays: halve again and re-upload (once per step)
      const msg = `atlas upload out of GPU memory at ${this.gpuMB()} MB (downscale ${this.downscale}); retrying at ${this.downscale / 2}`;
      console.warn("[render] " + msg); this.onError?.({ kind: "oom", message: msg });
      await scaleList(list, 0.5); this.downscale /= 2; this.pack(list); this.upload(list, this.frameTintRows(registry, list));
    }
    // sprite runtime tables
    const sprites: (SpriteRT | undefined)[] = [];
    for (const s of registry.allSprites()) {
      const id = s.id;
      const at = list.find((a) => a.id === s.atlas.id); if (!at) continue;
      const stateAnim = new Int16Array(STATE_ANIMS.length);
      STATE_ANIMS.forEach((names, st) => {
        let idx = 0; for (const n of names) { const i = s.animList.findIndex((a) => a.name === n); if (i >= 0) { idx = i; break; } }
        stateAnim[st] = idx;
      });
      const damage: number[] = [];
      const dmgAnim = s.animations.get("damaged");
      for (let st = 1; st <= 3; st++) {
        const named = s.animations.get(`damage${st}`);
        if (named) damage[st] = named.frames[0]!;
        else if (dmgAnim) damage[st] = dmgAnim.frames[Math.min(st - 1, dmgAnim.frames.length - 1)]!;
      }
      const b = s.building;
      sprites[id] = { atlasIdx: list.indexOf(at), anchorX: s.anchor.x, anchorY: s.anchor.y, anims: s.animList, stateAnim, damage,
        ...(b ? { building: { fw: b.footprint.w, fh: b.footprint.h, layer: b.layer, frames: b.frames } } : {}) };
    }
    this.atlases = list; this.atlasById = new Map(list.map((a) => [a.id, a])); this.sprites = sprites; this.registry = registry; this.resolveSway(); this.resolveVariants(); this.resolveRoofs(); this.resolveHands();
    this.uploadTints();
    this.maskPixels.clear();
    this.held = held; this.version++;
    for (const [k, u] of prevHeld) this.assets.release(k, u);
  }

  private gpuMB(): number { return Math.round(this.gpuBytes / 1048576); }
  /** Estimated bytes of the atlas arrays for a packing (colour + emissive + present masks, full mip chains). */
  private estimate(list: AtlasRT[]): number {
    const arrays = 1 + (list.some((a) => a.emis) ? 1 : 0) + (["sheen", "sway", "tintmask"] as const).filter((m) => list.some((a) => a.masks[m])).length;
    return this.layerSize * this.layerSize * 4 * (4 / 3) * this.layers * arrays;
  }
  /** Pick the largest downscale (1, 0.5, 0.25) whose packed arrays fit textureBudgetMB; atlases larger than a layer are always shrunk. */
  private async fitBudget(list: AtlasRT[]): Promise<void> {
    const S = this.layerSize; const budget = this.textureBudgetMB * 1048576;
    const tooBig = Math.max(1, ...list.map((a) => Math.max(a.img!.width, a.img!.height) / S));
    let d = 1; while (d > 1 / tooBig) d /= 2;
    const dims = (k: number) => list.map((a) => ({ ...a, img: { width: Math.max(1, Math.floor(a.img!.width * k)), height: Math.max(1, Math.floor(a.img!.height * k)) } as ImageLike }));
    while (d > 0.25) { this.pack(dims(d)); if (this.estimate(list) <= budget) break; d /= 2; }
    this.downscale = d;
    if (d < 1) {
      this.pack(dims(d)); console.warn(`[render] atlas arrays over the ${this.textureBudgetMB} MB GPU budget at full res: downscaling atlas images x${d} (~${Math.round(this.estimate(list) / 1048576)} MB)`);
      await scaleList(list, d);
    }
  }

  /** Shelf-pack whole atlas images into array layers (2px gutter). */
  private pack(list: AtlasRT[]): void {
    const S = this.layerSize, GAP = 2;
    const order = [...list].sort((a, b) => (b.img ? b.img.height : 0) - (a.img ? a.img.height : 0));
    let layer = 0, x = 0, y = 0, rowH = 0;
    for (const a of order) {
      const w = a.img!.width, h = a.img!.height;
      if (w > S || h > S) throw new Error(`atlas ${a.key} (${w}x${h}) exceeds layer size ${S}`);
      if (x + w > S) { x = 0; y += rowH + GAP; rowH = 0; }
      if (y + h > S) { layer++; x = 0; y = 0; rowH = 0; }
      a.layer = layer; a.px = x; a.py = y; x += w + GAP; rowH = Math.max(rowH, h);
    }
    this.layers = layer + 1;
    let base = 0; for (const a of list) { a.base = base; base += a.count; }
    this.totalFrames = base;
  }

  /** frame entry -> tint row (sprites with SpriteDef.tints get their own row; 0 = globals). */
  private frameTintRows(registry: AssetRegistry, list: AtlasRT[]): Map<number, number> {
    const rows: AtlasManager["tintRows"] = [null]; const map = new Map<number, number>();
    for (const s of registry.allSprites()) {
      const tints = s.tints; // typed SpriteDef.tints (batch 11/12)
      if (!tints || !Object.keys(tints).length) continue;
      const at = list.find((a) => a.id === s.atlas.id); if (!at) continue;
      const row = rows.length; rows.push(tints);
      const mark = (f: number) => { if (f >= 0 && f < at.count) map.set(at.base + f, row); };
      for (const an of s.animList) for (let d = 0; d < an.directions; d++) for (const f of an.frames) mark(f + d * an.dirStride);
      for (const r of s.building?.frames ?? []) for (const f of r) mark(f);
      for (const st of s.building?.states ?? []) for (const r of st) for (const f of r) mark(f);
    }
    this.tintRows = rows;
    return map;
  }

  private uploadTints(): void {
    const gl = this.gl; const rows = this.tintRows; const W = STATUS_TINTS.length * 2;
    const data = new Float32Array(W * rows.length * 4);
    const g = this.statusTints;
    rows.forEach((over, r) => {
      STATUS_TINTS.forEach((name, i) => {
        const o = (r * W + i * 2) * 4; const t = over?.[name]; const d = g?.[name];
        if (t) {
          data[o] = ((t.color >>> 16) & 255) / 255; data[o + 1] = ((t.color >>> 8) & 255) / 255; data[o + 2] = (t.color & 255) / 255; data[o + 3] = t.strength;
          data[o + 4] = TINT_MODE_INDEX[t.mode as keyof typeof TINT_MODE_INDEX] ?? 0; data[o + 5] = t.saturation ?? 1; data[o + 6] = 1;
        } else if (d) {
          data[o] = d.color[0]; data[o + 1] = d.color[1]; data[o + 2] = d.color[2]; data[o + 3] = d.strength;
          data[o + 4] = TINT_MODE_INDEX[d.mode]; data[o + 5] = d.saturation;
        } else { data[o] = data[o + 1] = data[o + 2] = 1; data[o + 3] = 0; data[o + 5] = 1; }
      });
    });
    if (this.tintTex) gl.deleteTexture(this.tintTex);
    const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, rows.length, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.tintTex = t;
  }

  /**
   * A random drip spawn point (sheen mask B > 0.5) of a frame, relative to the pivot in 1x px, or null (no sheen mask /
   * no B pixels / no 2D canvas). Pixels are read once per atlas and cached.
   */
  dripPoint(spriteId: number, entryHint: number, rnd: () => number): [number, number] | null {
    const s = this.sprites[spriteId]; if (!s) return null; const a = this.atlases[s.atlasIdx]!;
    const mask = a.masks.sheen; if (!mask) return null;
    let px = this.maskPixels.get(a.key);
    if (px === undefined) {
      px = null;
      try {
        if (typeof OffscreenCanvas !== "undefined") {
          const c = new OffscreenCanvas(mask.width, mask.height); const g = c.getContext("2d")!; g.drawImage(mask as CanvasImageSource, 0, 0);
          px = { w: mask.width, h: mask.height, data: g.getImageData(0, 0, mask.width, mask.height).data };
        }
      } catch { px = null; }
      this.maskPixels.set(a.key, px);
    }
    if (!px) return null;
    const f = entryHint - a.base; if (f < 0 || f >= a.count) return null;
    const k = a.scale; const r = a.source.rects?.[f];
    const fx = (r ? r.x : (f % a.cols) * a.fw) * k, fy = (r ? r.y : Math.floor(f / a.cols) * a.fh) * k, fw = (r ? r.w : a.fw) * k, fh = (r ? r.h : a.fh) * k;
    for (let tries = 0; tries < 24; tries++) {
      const x = Math.floor(rnd() * fw), y = Math.floor(rnd() * fh);
      const o = ((fy + y) * px.w + fx + x) * 4;
      if (px.data[o + 2]! > 127 && px.data[o + 3]! > 0) return [x / k - s.anchorX, y / k - s.anchorY];
    }
    return null;
  }

  private upload(list: AtlasRT[], tintRows: Map<number, number> = new Map()): void {
    const gl = this.gl; const S = this.layerSize;
    const mk = (): WebGLTexture => {
      const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      const levels = Math.floor(Math.log2(S)) + 1;
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, S, S, this.layers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    if (this.tex) gl.deleteTexture(this.tex); if (this.emisTex) gl.deleteTexture(this.emisTex);
    for (const t of [this.sheenTex, this.swayTex, this.tintMaskTex]) if (t) gl.deleteTexture(t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this.tex = mk();
    for (const a of list) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, a.px, a.py, a.layer, a.img!.width, a.img!.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, a.img as TexImageSource);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    this.hasEmissive = list.some((a) => a.emis);
    this.emisTex = this.hasEmissive ? mk() : dummyArray(gl); // emissive is gated by a frame flag: no full array when unused
    this.gpuBytes = this.estimate(list);
    for (const a of list) if (a.emis) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, a.px, a.py, a.layer, a.emis.width, a.emis.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, a.emis as TexImageSource);
    if (this.hasEmissive) gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    // mask arrays: full layout only when some atlas has that mask, else a 1x1 dummy (never sampled: flag bit unset)
    const maskArray = (m: MaskName): WebGLTexture => {
      if (!list.some((a) => a.masks[m])) {
        const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        return t;
      }
      const t = mk();
      for (const a of list) { const im = a.masks[m]; if (im) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, a.px, a.py, a.layer, im.width, im.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, im as TexImageSource); }
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      return t;
    };
    this.sheenTex = maskArray("sheen"); this.swayTex = maskArray("sway"); this.tintMaskTex = maskArray("tintmask");
    // frame table
    const n = Math.max(1, this.totalFrames); const rows = Math.ceil(n / TABLE_W);
    const data = new Float32Array(TABLE_W * 2 * rows * 4);
    for (const a of list) for (let f = 0; f < a.count; f++) {
      const r = a.source.rects?.[f];
      const x = r ? r.x : (f % a.cols) * a.fw, y = r ? r.y : Math.floor(f / a.cols) * a.fh;
      const w = r ? r.w : a.fw, h = r ? r.h : a.fh; const k = a.scale;
      const o = (a.base + f) * 8;
      data[o] = (a.px + x * k) / S; data[o + 1] = (a.py + y * k) / S; data[o + 2] = (a.px + (x + w) * k) / S; data[o + 3] = (a.py + (y + h) * k) / S;
      const bits = (a.emis ? FrameBits.Emissive : 0) | (a.masks.sheen ? FrameBits.Sheen : 0) | (a.masks.sway ? FrameBits.Sway : 0) | (a.masks.tintmask ? FrameBits.TintMask : 0);
      data[o + 4] = w; data[o + 5] = h; data[o + 6] = a.layer; data[o + 7] = bits + (tintRows.get(a.base + f) ?? 0) * 16;
    }
    if (this.frameTex) gl.deleteTexture(this.frameTex);
    const ft = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, ft);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TABLE_W * 2, rows, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.frameTex = ft;
  }

  get anyEmissive(): boolean { return this.hasEmissive; }

  /**
   * Resolve sprite + animation + facing + time to a frame-table entry and anchor (px). Allocation-free.
   * `anim` < 0 means "frame index `frame` of the first animation" (static sprites / variants).
   * Returns false when the sprite id is unknown.
   */
  resolve(spriteId: number, anim: number, facing: number, timeSec: number, frame: number, out: ResolvedFrame): boolean {
    const s = this.sprites[spriteId]; if (!s) return false;
    const a = this.atlases[s.atlasIdx]!;
    const an = s.anims[anim < 0 ? 0 : anim] ?? s.anims[0]; if (!an) return false;
    let f: number;
    if (anim < 0) f = an.frames[frame % an.frames.length]!;
    else {
      const n = an.frames.length; let i = Math.floor(timeSec * an.fps); i = an.loop ? ((i % n) + n) % n : Math.min(Math.max(0, i), n - 1);
      f = an.frames[i]!;
    }
    f += AssetRegistry.directionIndex(facing, an.directions) * (an.directions > 1 ? an.dirStride : 0);
    this.fill(a, f, s, out); out.sprite = spriteId; out.frame = f; out.anim = an.name ?? "";
    return true;
  }

  /**
   * Resolve a build-piece frame through AssetRegistry.buildingFrame (rotation, damage stage, piece state, mirror
   * rotationArt -> out.flipX). out.hasDamageFrames is false when the stage has no own frame (crack overlay fallback).
   */
  resolvePiece(spriteId: number, variant: number, rotation: number, damage: number, out: ResolvedFrame, state = -1): boolean {
    if (variant > 0) { const g = this.variantById.get(spriteId); if (g?.length) { spriteId = g[variant % g.length]!; variant = 0; } }
    const s = this.sprites[spriteId]; if (!s || !this.registry) return false;
    const a = this.atlases[s.atlasIdx]!;
    if (s.building) {
      const ref = this.registry.buildingFrame(spriteId, rotation, damage, state);
      const intact = damage > 0 ? this.registry.buildingFrame(spriteId, rotation, 0, state) : ref;
      this.fill(a, ref.frame, s, out);
      out.flipX = !!ref.flipX; out.hasDamageFrames = damage > 0 && ref.frame !== intact.frame; return true;
    }
    const an = s.anims[0]; if (!an) return false;
    let f = damage > 0 && s.damage[damage] !== undefined ? s.damage[damage]! : an.frames[variant % an.frames.length]!;
    if (an.directions > 1) f += AssetRegistry.directionIndex((rotation & 3) * (Math.PI / 2), an.directions) * an.dirStride;
    this.fill(a, f, s, out);
    out.hasDamageFrames = damage > 0 && s.damage[damage] !== undefined;
    return true;
  }

  /**
   * Frame-table entries of one animation (for shader-side animation by frame offset, e.g. terrain water).
   * `contiguous` is true when frames[i] = frames[0] + i (then entry = first + floor(t * fps) % count is valid).
   */
  animEntries(spriteId: number, anim = 0): { first: number; count: number; fps: number; contiguous: boolean; w: number; h: number; ax: number; ay: number } | null {
    const s = this.sprites[spriteId]; if (!s) return null; const a = this.atlases[s.atlasIdx]!; const an = s.anims[anim] ?? s.anims[0]; if (!an) return null;
    const contiguous = an.frames.every((f, i) => f === an.frames[0]! + i);
    const r = newResolved(); this.fill(a, an.frames[0]!, s, r);
    return { first: r.entry, count: contiguous ? an.frames.length : 1, fps: an.fps, contiguous, w: r.w, h: r.h, ax: r.ax, ay: r.ay };
  }

  /**
   * BuildPiece.variant groups: base sprite key -> sprite keys by variant index (variant 0 = the base), e.g. Art's
   * pack/piece_variants.json `pieces` or pvp_clan wall looks (`wall` + variant). Unknown keys are reported, not thrown.
   * Building sprites without a group fall back to the variant-th frame of their first animation only when non-building.
   */
  setPieceVariants(table: Record<string, string[]>): string[] {
    this.variantKeys = table; return this.resolveVariants();
  }
  private variantKeys: Record<string, string[]> = {};
  private handsByAtlas = new Map<string, Record<string, HandAnchor>>();
  private handByEntry = new Map<number, HandAnchor>();
  /** Per-frame hand anchors of an atlas (Art `<atlas>.hands.json` `hands`: frame -> {x, y (1x px from frame top-left), angle deg, behind}). */
  setHands(atlasKey: string, json: { hands: Record<string, HandAnchor> }): void { this.handsByAtlas.set(atlasKey, json.hands); this.resolveHands(); }
  /** Hand anchor of a frame-table entry (ResolvedFrame.entry), if its atlas has one for that frame. */
  handAt(entry: number): HandAnchor | undefined { return this.handByEntry.get(entry); }
  /**
   * Hand anchor of a resolved frame (ADR-082): frameMeta `name` (default handR) via AssetRegistry.anchorPoint (pivot-relative,
   * unmirrored here; the caller mirrors with the instance flip), converted to frame top-left px like hands.json. Falls back to
   * Art's legacy `<atlas>.hands.json` only when the frame has no such anchor.
   */
  handOf(r: ResolvedFrame, name = "handR"): HandAnchor | undefined {
    const reg = this.registry;
    if (reg && r.sprite >= 0) {
      const anchors = reg.frameAnchors(r.sprite, r.frame, r.anim || undefined);
      const a = anchors ? AssetRegistry.anchorPoint({ anchors } as FrameRef, name) : undefined;
      if (a) return { x: r.ax + a.x, y: r.ay + a.y, angle: a.angle ?? 0, ...(a.len !== undefined ? { len: a.len } : {}), behind: a.behind ?? false };
    }
    return this.handByEntry.get(r.entry);
  }
  private resolveHands(): void {
    this.handByEntry.clear();
    for (const a of this.atlases) { const hs = this.handsByAtlas.get(a.key); if (!hs) continue; for (const [f, h] of Object.entries(hs)) { const n = Number(f); if (n >= 0 && n < a.count) this.handByEntry.set(a.base + n, h); } }
  }
  private variantById = new Map<number, number[]>();
  private roofById = new Set<number>();
  private resolveVariants(): string[] {
    const issues: string[] = []; this.variantById.clear(); const reg = this.registry; if (!reg) return issues;
    for (const [base, keys] of Object.entries(this.variantKeys)) {
      const b = reg.ids.sprites.tryId(base); if (b === undefined) { issues.push(`piece variants: unknown base ${base}`); continue; }
      const ids = keys.map((k) => { const id = reg.ids.sprites.tryId(k); if (id === undefined) issues.push(`piece variants: unknown ${k}`); return id ?? b; });
      this.variantById.set(b, ids);
    }
    return issues;
  }
  /**
   * Roof pieces: detected from the sprite (building.piece / key `roof*`, Art wave 2 roof_slope/ridge/... tiers), never from
   * the layer number. Roofs sit on the deck layer (gameplay LAYER_DECK = 0) of the level above the walls.
   */
  isRoof(spriteId: number): boolean { return this.roofById.has(spriteId); }
  private resolveRoofs(): void {
    this.roofById.clear(); if (!this.registry) return;
    for (const s of this.registry.allSprites()) if ((s.building?.piece ?? s.key).startsWith("roof")) this.roofById.add(s.id);
  }

  /** Footprint/layer of a building sprite (null for non-building sprites). Rotation 1/3 swaps w/h. */
  pieceInfo(spriteId: number): { fw: number; fh: number; layer: number } | null { const b = this.sprites[spriteId]?.building; return b ? { fw: b.fw, fh: b.fh, layer: b.layer } : null; }

  /** Animation index of `name` on a sprite (-1 = unknown; resolve() then uses the first animation's frame list). */
  animIndex(spriteId: number, name: string): number { const s = this.sprites[spriteId]; if (!s) return -1; const i = s.anims.findIndex((a) => a.name === name); return i < 0 ? 0 : i; }
  animName(spriteId: number, anim: number): string | undefined { return this.sprites[spriteId]?.anims[anim]?.name; }
  stateAnim(spriteId: number, state: number): number { const s = this.sprites[spriteId]; return s ? s.stateAnim[Math.min(state, STATE_ANIMS.length - 1)] ?? 0 : 0; }

  private fill(a: AtlasRT, f: number, s: SpriteRT, out: ResolvedFrame): void {
    const fi = Math.min(Math.max(0, f), a.count - 1);
    const r = a.source.rects?.[fi];
    out.entry = a.base + fi;
    if (r) { out.w = r.w; out.h = r.h; out.ax = r.ax; out.ay = r.ay; }
    else { out.w = a.fw; out.h = a.fh; out.ax = s.anchorX * a.fw; out.ay = s.anchorY * a.fh; }
    out.hasDamageFrames = false; out.flipX = false; out.sprite = -1; out.frame = -1; out.anim = "";
  }

  /** For galleries/tools: every atlas with its frame count and loaded image. */
  listAtlases(): { key: string; id: number; count: number; image: ImageLike | null; emissive: ImageLike | null; rects?: RectTable; fw: number; fh: number; cols: number; scale: number; masks: Partial<Record<MaskName, string>> }[] {
    return this.atlases.map((a) => ({ key: a.key, id: a.id, count: a.count, image: a.img, emissive: a.emis, ...(a.source.rects ? { rects: a.source.rects } : {}), fw: a.fw, fh: a.fh, cols: a.cols, scale: a.scale, masks: { ...a.maskUrls } }));
  }

  dispose(): void {
    for (const [k, u] of this.held) this.assets.release(k, u);
    this.held = [];
    const gl = this.gl; if (this.tex) gl.deleteTexture(this.tex); if (this.emisTex) gl.deleteTexture(this.emisTex); if (this.frameTex) gl.deleteTexture(this.frameTex);
  }
}

export interface ResolvedFrame { entry: number; w: number; h: number; ax: number; ay: number; hasDamageFrames: boolean; /** draw mirrored (mirror rotationArt) */ flipX: boolean;
  /** source sprite id / atlas frame index / anim name (resolve() only; -1 / "" otherwise): frameMeta anchor lookup */ sprite: number; frame: number; anim: string }
export const newResolved = (): ResolvedFrame => ({ entry: 0, w: 0, h: 0, ax: 0, ay: 0, hasDamageFrames: false, flipX: false, sprite: -1, frame: -1, anim: "" });
