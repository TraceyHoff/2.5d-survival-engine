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
 * - Wearable streaming (VRAM budget): atlases used only by cosmetics wearables are "lazy". They are not loaded at
 *   rebuild; a slot pool (extra layers of the same arrays, sized from the budget left after the resident art) holds
 *   the pages in use. pageReady(sprite) requests a page (fetch + createImageBitmap, resized to the pool scale, own
 *   mip chain) and returns false until it is uploaded, so callers draw a fallback (body only). Pages are
 *   refcounted by LayerCache entries (retainSprite/releaseSprite) and evicted LRU (unreferenced first). Budget and
 *   bytes are tracked by gl/vram.ts VramAccountant (vramStats). Mips are counted in every estimate.
 * - Runtime switching: swapAtlas()/setTheme() replace atlas images (same layout & sprite keys -> same
 *   numeric ids), so ECS data is untouched. Old images are released (ref-counted) after the swap.
 */
import { AnimState as CoreAnimState, ANIM_STATE_NAMES } from "@engine/core";
import { AssetRegistry, type Animation, type Atlas, type FrameRef } from "@engine/assets";
import { STATUS_TINTS, TINT_MODE_INDEX, type StatusTint, type StatusTintName } from "../style.js";
import type { AssetManager } from "@engine/core";
import type { RectTable } from "./texturePacker.js";
import { PageLRU, PRIO_NEAR, VramAccountant, rgbaBytes, type VramStats } from "../gl/vram.js";
import { blockBytes, GL_FORMAT, ktx2Target, loadKtx2, loadKtx2Rgba, type Ktx2Target } from "./ktx2.js";
import type { CompressedTextureSupport } from "../gl/capabilities.js";
import { streamingFallbackKeys } from "../building/modular.js";

/** Held-item hand anchor of one character frame (Art hands.json). */
export interface HandAnchor { x: number; y: number; angle: number; len?: number; behind: boolean }
export type MaskName = "sheen" | "sway" | "tintmask";
/** Frame-table flag bits (low 4 bits of the flags float; tint row = flags >> 4). */
export const FrameBits = { Emissive: 1, Sheen: 2, Sway: 4, TintMask: 8 } as const;
/**
 * Where an atlas' images live. `pages` = extra scale pages (1x = url). `masks`: one URL or candidate URLs tried in
 * order (explicit manifest path, then sibling `<atlas>_<mask>.png`, then a fallback folder); missing ones are skipped.
 */
export interface AtlasSource { url: string; emissiveUrl?: string | null; rects?: RectTable; pages?: { scale: number; url: string }[]; masks?: Partial<Record<MaskName, string | string[]>>;
  /** KTX2 twins (Art 211785f): colour page (ETC1S) and masks (UASTC). Used for the streamed wearable pool when a transcode target exists. */
  ktx2?: string; masksKtx2?: Partial<Record<MaskName, string>> }
export type ImageLike = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

/**
 * AnimState.state -> animation names tried in order. Indexed by core's wire-stable AnimState (ADR-093); never use
 * numeric literals here. Unknown / out-of-range states resolve to idle.
 */
const STATE_ANIM_TABLE: Record<CoreAnimState, readonly string[]> = {
  [CoreAnimState.Idle]: ["idle"], [CoreAnimState.Walk]: ["walk"], [CoreAnimState.Run]: ["run", "walk"],
  [CoreAnimState.Attack]: ["attack"], [CoreAnimState.Hurt]: ["hit", "hurt", "idle"], [CoreAnimState.Die]: ["death", "die", "idle"],
  [CoreAnimState.Gather]: ["gather", "idle"], [CoreAnimState.Build]: ["build", "idle"],
  // animals: manifest anims `eat` / `graze`, each falls back to the other, then idle
  [CoreAnimState.Eat]: ["eat", "graze", "idle"], [CoreAnimState.Graze]: ["graze", "eat", "idle"],
  // zombies: zombie_*_shamble / _crawl / _feed (pack wave 2)
  [CoreAnimState.Shamble]: ["shamble", "walk"], [CoreAnimState.Crawl]: ["crawl", "shamble", "walk"], [CoreAnimState.Feed]: ["feed", "attack", "idle"],
  // vehicle riders (ADR-101): `sit`, else idle (the body crops the legs anyway)
  [CoreAnimState.Sit]: ["sit", "idle"],
};
export const STATE_ANIMS: readonly (readonly string[])[] = ANIM_STATE_NAMES.map((_, i) => STATE_ANIM_TABLE[i as CoreAnimState] ?? ["idle"]);
/** @deprecated use core `AnimState` (ADR-093); kept as an alias so render callers read one numbering. */
export { CoreAnimState as AnimStateId };

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
  masks: Partial<Record<MaskName, ImageLike>>; maskUrls: Partial<Record<MaskName, string>>; base: number; count: number; fw: number; fh: number; cols: number; layer: number; px: number; py: number;
  /** streamed wearable page: not loaded at rebuild (see header); w1/h1 = 1x page size */ lazy?: { w1: number; h1: number; state: 0 | 1 | 2; pool: number; prio?: number };
  /** budget tier: cold art is downscaled before hot art (see fitBudget) */ cold?: boolean }
/** One streaming pool (wearables, vehicles): own slot geometry, layers and LRU; all pools share the VRAM accountant. */
interface Pool { k: number; sw: number; sh: number; cols: number; perLayer: number; first: number; layers: number; lru: PageLRU<string>; slotBytes: number; tint: boolean; emis: boolean; cls: PoolClass;
  /** wear pool: its own colour array (poolTex), KTX2-compressed (`fmt` = GL internal format) or RGBA8 (fmt null), `levels` mips only */
  own?: { fmt: number | null; target: Ktx2Target | null; levels: number } }
export type PoolClass = "wear" | "veh" | "bld";
/** Vehicle art pages kept resident at once (one page = one grouped Art sheet, ~1024^2 at 1x): desktop / low memory. */
const VEH_POOL_SLOTS_DESKTOP = 8, VEH_POOL_SLOTS_LOWMEM = 6;
/** Building tier pages (building_t1..t4) resident at once: every tier on desktop; 2 on <=256 MB budgets (a base mixes ~2 tiers). */
const BLD_POOL_SLOTS_DESKTOP = 4, BLD_POOL_SLOTS_LOWMEM = 2;
/** Building tier sheets streamed per tier present nearby (BuildingTierStreamer): `building_t<N>` atlases from files. */
export function isStreamedBuildingAtlas(key: string, url: string): boolean { return /^building_t\d+$/.test(key) && !/^(blob|data):/.test(url); }
/** Art vehicle sheets: `veh_*` atlases loaded from files (the procedural placeholders are blob: URLs and stay resident). */
export function isStreamedVehicleAtlas(key: string, url: string): boolean { return /^veh_/.test(key) && !/^(blob|data):/.test(url); }
/** Minimum streamed pages kept resident at once (working set: ~8 wearables x a few distinct outfits on screen). */
/** Emissive + mask arrays are stored at layerSize >> SIDE_SHIFT (same normalized UVs, 1/4 the bytes). */
export const SIDE_SHIFT: number = 1;
/** Low-memory (mobile) side arrays at 1/4 res: masks / emissive are cold-tier data (lights, tint, sheen), the colour
 *  array stays full res so visible art never gets blurrier to save memory. */
export const SIDE_SHIFT_LOWMEM: number = 2;
const POOL_MIN_SLOTS_DESKTOP = 48, POOL_MIN_SLOTS_LOWMEM = 24, POOL_GAP = 4, PAGE_CONCURRENCY = 6, POOL_PROTECT_FRAMES = 90;
/** 1x wear pool slots when the budget cannot hold minSlots at 1x: the local player's worn set + the nearest neighbour's (~9 layers each); farther characters page by distance priority. */
const WEAR_1X_SLOTS_LOWMEM = 18, WEAR_1X_SLOTS_DESKTOP = 32;

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
    // KTX2 twins sit beside the image: resolve them like the image (the client rewrites image paths of merged packs)
    const img = resolve(a.image); const sib = (p: string): string => (/^(\/|[a-z]+:)/i.test(p) ? p : img.replace(/[^/]*$/, "") + p.replace(/^.*\//, ""));
    const pages = (a.pages ?? []).filter((p) => p.scale !== 1).map((p) => ({ scale: p.scale, url: resolve(p.image) }));
    const masks: Partial<Record<MaskName, string[]>> = {};
    for (const m of ["sheen", "sway", "tintmask"] as const) {
      const c: string[] = []; const explicit = a.masks?.[m];
      if (explicit) c.push(resolve(explicit));
      if (opts.probeSiblings !== false) c.push(resolve(a.image).replace(/(\.[a-z]+)$/i, `_${m}$1`));
      const dir = opts.fallbackMaskDirs?.[m]; if (dir) c.push(`${dir.replace(/\/?$/, "/")}${a.image.replace(/^.*\//, "").replace(/(\.[a-z]+)$/i, `_${m}$1`)}`);
      if (c.length) masks[m] = [...new Set(c)];
    }
    const mk2: Partial<Record<MaskName, string>> = {}; for (const m of ["sheen", "sway", "tintmask"] as const) { const v = a.masksKtx2?.[m as keyof typeof a.masksKtx2]; if (typeof v === "string") mk2[m] = sib(v); }
    out.set(a.key, { url: resolve(a.image), emissiveUrl: a.emissiveImage ? resolve(a.emissiveImage) : null, ...(r ? { rects: r } : {}), ...(pages.length ? { pages } : {}), masks,
      ...(a.ktx2 ? { ktx2: sib(a.ktx2) } : {}), ...(Object.keys(mk2).length ? { masksKtx2: mk2 } : {}) });
  }
  return out;
}

/** 1x1 transparent array (stands in for unused emissive / mask arrays). */
function dummyArray(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  setLevelRange(gl, gl.TEXTURE_2D_ARRAY, 1);
  return t;
}

/** Texture completeness: BASE/MAX_LEVEL = the levels actually allocated; a single level uses LINEAR (no mip filter). */
export function setLevelRange(gl: WebGL2RenderingContext, target: number, levels: number): void {
  gl.texParameteri(target, gl.TEXTURE_BASE_LEVEL, 0);
  gl.texParameteri(target, gl.TEXTURE_MAX_LEVEL, Math.max(0, levels - 1));
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

/** Smallest atlas budget downscale (x0.125 below the old x0.25 floor: phones that refuse 107 MB of arrays). */
export const MIN_ATLAS_DOWNSCALE = 0.125;

export type AtlasTier = "hot" | "cold";
/** Always hot: terrain, bodies/characters, common props, UI and fonts. */
export const HOT_ATLAS_RE = /(^|[_/-])(tiles?|terrain|ground|characters?|bod(y|ies)|base|resources|decor|items|equipment|held|buildings?|openings|furniture|fog|ui|fonts?|sdf)([_@/-]|$)/i;
/** Cold: rare variants, distant LODs, one-shot fx, huge set pieces. Anything matching neither stays hot. */
export const COLD_ATLAS_RE = /(lod\d*|_far|distant|rare|_huge|_big|^fx_|death_bag|zombies_(brute|mummy|pumpkin|runner)|animals_large|critters|wear|cosmetic|hair|hats?|accessor|tops?|bottoms?|shoes|faces?|eyes)/i;
/** Default tier: HOT_ATLAS_RE wins; atlases holding body sprites are hot; COLD_ATLAS_RE or mostly-wearable atlases are cold. */
export function defaultAtlasTier(key: string, opts: { bodies?: boolean; wearShare?: number } = {}): AtlasTier {
  if (opts.bodies || HOT_ATLAS_RE.test(key)) return "hot";
  if (COLD_ATLAS_RE.test(key) || (opts.wearShare ?? 0) >= 0.5) return "cold";
  return "hot";
}

/** Downscale every image of the list by k (colour/emissive smooth, masks pixelated); frame sizes stay in 1x px via a.scale. */
/** Halve emissive + mask images for the half-size side arrays (no-op without createImageBitmap). */
async function halveSide(list: AtlasRT[], shift: number = SIDE_SHIFT): Promise<boolean> {
  if (typeof createImageBitmap !== "function" || shift === 0) return false;
  const k = 1 / (1 << shift);
  const rs = (im: ImageLike, q: "high" | "pixelated") => createImageBitmap(im as ImageBitmapSource, { resizeWidth: Math.max(1, Math.floor(im.width * k)), resizeHeight: Math.max(1, Math.floor(im.height * k)), resizeQuality: q, premultiplyAlpha: "none", colorSpaceConversion: "none" } as ImageBitmapOptions);
  await Promise.all(list.map(async (a) => { if (a.emis) a.emis = await rs(a.emis, "high"); for (const m of Object.keys(a.masks) as MaskName[]) a.masks[m] = await rs(a.masks[m]!, "pixelated"); }));
  return true;
}

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
  /** Wearable pool colour array (compressed when KTX2 is usable); sampled for layers >= poolFirst (shader uPoolFirst). */
  poolTex: WebGLTexture | null = null; poolFirst = 1 << 20;
  private compressedCaps: CompressedTextureSupport | null = null;
  /** GPU compressed-texture support (IsoRenderer passes capabilities.compressed); KTX2 is used only with a transcoder installed. */
  setCompressed(c: CompressedTextureSupport | null): void { this.compressedCaps = c; }
  get ktx2Target(): Ktx2Target | null { return this.compressedCaps ? ktx2Target(this.compressedCaps) : null; }
  /**
   * Device px per 1x texel of nearby characters (camera scale x sprite scale), set every frame by IsoRenderer. The wear
   * pool is stored at the smallest page scale whose texels are still >= 1 device px (never blurrier than the 1:1 mip):
   * magnified (r >= 1) -> 1x with no mip chain (levels never sampled are not allocated).
   */
  charFootprint = 1;
  setCharFootprint(r: number): void { if (r > 0 && Number.isFinite(r)) this.charFootprint = r; }
  wearScale(): number { const r = this.charFootprint; return r > 0.5 ? 1 : r > 0.25 ? 0.5 : 0.25; }
  private wearPool(): Pool | undefined { return this.pools.find((p) => p.cls === "wear"); }
  /** Colour bytes of one layer of the own wear array (vs rgbaBytes(S,S,true) in the shared array). */
  private ownLayerBytes(o: NonNullable<Pool["own"]>): number { let b = 0, s = this.layerSize; for (let l = 0; l < o.levels; l++, s = Math.max(1, s >> 1)) b += o.fmt !== null ? blockBytes(s, s) : s * s * 4; return b; }
  private ownSaving(): number { return this.pools.reduce((t, p) => t + (p.own ? p.layers * (rgbaBytes(this.layerSize, this.layerSize, true) - this.ownLayerBytes(p.own)) : 0), 0); }
  /**
   * Streamed pools (vehicles, then wearables) are the tail layers: give them their own colour array, KTX2-compressed
   * (ETC1S -> probe target, level 0) when every streamed atlas has a KTX2 twin and pages are 1x, else RGBA8. Only the
   * levels that are sampled are allocated: magnified (footprint >= page scale) -> 1 level.
   */
  /** Side-array bytes not allocated for pool layers (sheen/sway always, emissive unless a pool streams emissive). */
  private sideSaving(list: AtlasRT[]): number {
    const h = Math.max(1, this.layerSize >> this.sideShift); const poolLayers = this.pools.reduce((t, p) => t + p.layers, 0);
    const skipped = (["sheen", "sway"] as const).filter((m) => list.some((a) => a.masks[m])).length + (!this.pools.some((p) => p.emis) && list.some((a) => a.emis) ? 1 : 0);
    return poolLayers * skipped * rgbaBytes(h, h, true);
  }
  private planOwn(): void {
    for (const p of this.pools) delete p.own;
    const tail = this.pools.filter((p) => p.cls === "veh" || p.cls === "wear").sort((x, y) => x.first - y.first);
    if (!tail.length) return;
    let at = tail[0]!.first; for (const p of tail) { if (p.first !== at) return; at += p.layers; } if (at !== this.layers) return;
    const t = this.ktx2Target;
    const comp = t !== null && tail.every((p) => p.k === 1) && this.atlases.every((a) => !a.lazy || !tail.includes(this.poolOfA(a)!) || !!a.source.ktx2);
    const levels = comp ? 1 : tail.every((p) => this.charFootprint >= p.k) ? 1 : 2;
    for (const p of tail) {
      p.own = { fmt: comp ? GL_FORMAT[t!][0] : null, target: comp ? t : null, levels };
      let cb = 0; for (let l = 0, w = p.sw, h = p.sh; l < levels; l++, w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) cb += comp ? blockBytes(w, h) : w * h * 4;
      p.slotBytes = p.slotBytes - rgbaBytes(p.sw, p.sh, true) + cb;
    }
  }
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
  /** Stream cosmetics-only atlases through the page pool (false = load everything at rebuild, the old behaviour). */
  streamWearables = true;
  /** Pool sizing (set before setRegistry). Default: the best scale that holds every streamed page, else the best
   *  scale holding minSlots. A creator preview wants sharp art and few pages: { coverAll: false, minSlots: 16 }. */
  poolPolicy: { coverAll: boolean; minSlots?: number } = { coverAll: true };
  /** VRAM accountant (bytes resident / budget / page-ins / evictions); see vramStats. */
  readonly vram: VramAccountant;
  private pools: Pool[] = [];
  /** Stream Art vehicle sheets per vehicle (refcounted by VehicleView through retainSprite/releaseSprite). */
  streamVehicles = true;
  /** Stream building_t1..t4 per tier present nearby (refcounted by IsoRenderer's BuildingTierStreamer). */
  streamBuildingTiers = true;
  /** Bumped on every rebuild (pools / sprite tables replaced): refcount holders re-retain. */
  layoutVersion = 0;
  /** glGetError after each page-in (a CPU/GPU sync). IsoRenderer.syncPoints=false turns it off for honest profiling. */
  syncChecks = true;
  private poolOfA(a: AtlasRT): Pool | undefined { return a.lazy ? this.pools[a.lazy.pool] : undefined; }
  /** Pool may page now (fallback step 1 stops the wearable pool only; vehicles keep their placeholder fallback). */
  /** Wearables off (ladder EvictWearables) still pages in the local player + nearby characters (prio <= PRIO_NEAR). */
  private poolOn(p: Pool, prio = Infinity): boolean { return p.cls !== "wear" || this.wearablesOn || prio <= PRIO_NEAR; }
  private table: Float32Array = new Float32Array(0); private tableDirty0 = -1; private tableDirty1 = -1;
  private tintRowMap = new Map<number, number>();
  private frame = 1; private gen = 0; private inflight = 0; private queue: AtlasRT[] = [];
  private loader: (url: string) => Promise<ImageLike>;

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
  /** Downscale applied to cold-tier atlases (<= downscale). */
  coldDownscale = 1;
  /** Scale of the side (emissive/mask) images vs the colour page (1/2 when halved). */
  private sideScale = 1;
  /** Side-array (emissive / masks) shift for this build: SIDE_SHIFT, or SIDE_SHIFT_LOWMEM on <=256 MB budgets. */
  sideShift: number = SIDE_SHIFT;
  /** How fitBudget met the budget (diag): pool reserve actually kept, hot atlases demoted to cold. */
  fitInfo = { reserveMB: 0, reserveWantedMB: 0, demoted: 0 };
  /** Override the hot/cold budget tier per atlas key (default defaultAtlasTier). */
  atlasTier?: (key: string, info: { bodies: boolean; wearShare: number }) => AtlasTier;
  /** Atlas keys used recently (renderer marks them); always treated hot at the next rebuild. */
  readonly recentlyUsed = new Set<string>();
  /** GL errors seen while allocating/uploading the arrays (diagnostics). */
  uploadErrors: string[] = [];
  private oomFlag = false;
  /** Layer count vs MAX_ARRAY_TEXTURE_LAYERS / size vs MAX_TEXTURE_SIZE, or null when within limits. */
  limitProblem(): string | null {
    const gl = this.gl; const maxL = Number(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)) || 256, maxS = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048;
    if (this.layers > maxL) return `atlas uses ${this.layers} array layers > MAX_ARRAY_TEXTURE_LAYERS ${maxL}`;
    if (this.layerSize > maxS) return `atlas layer ${this.layerSize}px > MAX_TEXTURE_SIZE ${maxS}`;
    return null;
  }
  /** Diagnostics: array layer count, size, downscale, completeness-relevant state, upload errors. */
  get diagInfo(): { layers: number; layerSize: number; downscale: number; levels: number; pool: boolean; errors: string[] } {
    return { layers: this.layers, layerSize: this.layerSize, downscale: this.downscale, levels: this.texLevels || Math.floor(Math.log2(this.layerSize)) + 1, pool: this.pools.length > 0, errors: [...this.uploadErrors] };
  }
  private gpuBytes = 0;
  /** Reports GL out-of-memory on upload (the client overlay listens through IsoRenderer.onError). */
  onError: ((e: { kind: "oom" | "limits"; message: string }) => void) | null = null;
  /** Runtime allocation fault (GL error after an array / page allocation): IsoRenderer escalates its fallback ladder. */
  onFault: ((source: "atlas" | "page", detail: string) => void) | null = null;
  /** Streamed wearable pages enabled (fallback step 1 turns them off: body-only, pool slots emptied). */
  private wearablesOn = true;
  /** Mip levels actually allocated for the colour array (page-ins never upload past them). */
  private texLevels = 0;
  /** Page-ins refused by the driver / the VRAM budget (diagnostics). */
  pageFaults = 0; pageBudgetRefusals = 0;
  get wearablesEnabled(): boolean { return this.wearablesOn; }
  /** Fallback step 1: drop every streamed page and stop paging (layers draw the body-only fallback). */
  setWearables(on: boolean): void {
    if (on === this.wearablesOn) return; this.wearablesOn = on; if (on || !this.pools.some((p) => p.cls === "wear")) return;
    this.gen++; this.queue = this.queue.filter((a) => this.poolOfA(a)?.cls !== "wear");
    for (const a of this.atlases) { const p = this.poolOfA(a); if (!p || p.cls !== "wear" || a.lazy!.state === 0) continue;
      if (a.lazy!.state === 2 && p.lru.prioOf(a.key) <= PRIO_NEAR) continue; // local player / nearby characters stay dressed
      if (a.lazy!.state === 2) { p.lru.remove(a.key); this.vram.evict(p.slotBytes); } a.lazy!.state = 0; a.layer = -1; this.writeFrames(a, this.table, this.tintRowMap, true); }
    this.vram.pending = this.queue.length;
  }
  /** Fallback step 3: every resident atlas on the cold tier and half the texture budget, then rebuild (frees GPU memory). */
  async forceLowTier(): Promise<void> {
    const prev = this.atlasTier; this.atlasTier = () => "cold"; this.recentlyUsed.clear(); if (!this.tierBudgetMB) { this.tierBudgetMB = this.textureBudgetMB; this.prevTier = prev; }
    this.textureBudgetMB = Math.max(32, Math.floor(this.textureBudgetMB / 2));
    if (!this.registry) return;
    await this.rebuild(this.registry, new Map(this.atlases.map((a) => [a.key, a.source] as [string, AtlasSource])));
  }

  private readonly retiered = new Set<string>();
  private tierBudgetMB = 0; private prevTier: AtlasManager["atlasTier"] | undefined; private retierAt = -Infinity;
  /** Undo forceLowTier (fallback ladder stepping back up once memory freed): default tiers + the original budget. */
  async restoreTier(): Promise<void> {
    if (!this.tierBudgetMB) return; if (this.prevTier) this.atlasTier = this.prevTier; else delete this.atlasTier; this.prevTier = undefined; this.textureBudgetMB = this.tierBudgetMB; this.tierBudgetMB = 0;
    if (this.registry) await this.rebuild(this.registry, new Map(this.atlases.map((a) => [a.key, a.source] as [string, AtlasSource])));
  }
  /** True when an atlas drawn near the camera is stored downscaled (cold tier): a re-tier would make it crisp again. */
  get needsRetier(): boolean {
    const wp = this.wearPool(); if (wp && wp.k <= 1 && wp.k !== this.wearScale() && this.poolScales(this.atlases.filter((a) => a.lazy && this.poolOfA(a)?.cls === "wear")).includes(this.wearScale())) return true; // zoom changed the crisp wear scale
    if (this.coldDownscale >= 1 && this.downscale >= 1) return false;
    return this.atlases.some((a) => !a.lazy && this.recentlyUsed.has(a.key) && !this.retiered.has(a.key) && (a.cold ? this.coldDownscale : this.downscale) < 1);
  }
  /** Rebuild so recently drawn atlases move to the hot (full-res) tier; at most once per `minGap` frames. */
  async retier(frame: number, minGap = 600): Promise<boolean> {
    if (!this.registry || frame - this.retierAt < minGap || !this.needsRetier) return false;
    this.retierAt = frame; for (const k of this.recentlyUsed) this.retiered.add(k); // each atlas triggers at most one re-tier (no rebuild loop when the budget cannot hold it at full res)
    await this.rebuild(this.registry, new Map(this.atlases.map((a) => [a.key, a.source] as [string, AtlasSource])));
    return true;
  }

  constructor(private gl: WebGL2RenderingContext, private assets: AssetManager, opts: { layerSize?: number; imageLoader?: (url: string) => Promise<ImageLike>; textureBudgetMB?: number } = {}) {
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.layerSize = Math.min(opts.layerSize ?? 2048, max || 2048);
    this.textureBudgetMB = opts.textureBudgetMB ?? 768;
    this.vram = new VramAccountant(this.textureBudgetMB * 1048576);
    this.loader = opts.imageLoader ?? defaultImageLoader;
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
    const changes = this.atlases.some((a) => !a.lazy && this.pickScale(this.registry!.atlases.get(a.key)!, a.source) !== a.scale / (a.cold ? this.coldDownscale : this.downscale));
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
    const list: AtlasRT[] = []; const lazyList: AtlasRT[] = [];
    const lazyKeys = this.streamWearables ? wearableOnlyAtlases(registry) : new Set<string>();
    const vehKeys = new Set<string>(); if (this.streamVehicles) for (const a of registry.atlases.values()) { const src = sources.get(a.key); if (src && !lazyKeys.has(a.key) && isStreamedVehicleAtlas(a.key, src.url)) vehKeys.add(a.key); }
    const bldKeys = new Set<string>(); if (this.streamBuildingTiers) for (const a of registry.atlases.values()) { const src = sources.get(a.key); if (src && !lazyKeys.has(a.key) && !vehKeys.has(a.key) && isStreamedBuildingAtlas(a.key, src.url)) bldKeys.add(a.key); }
    await Promise.all([...registry.atlases.values()].map(async (a) => {
      const src = sources.get(a.key); if (!src) throw new Error(`no image source for atlas "${a.key}"`);
      if (lazyKeys.has(a.key) || vehKeys.has(a.key) || bldKeys.has(a.key)) {
        let w1 = a.columns * a.frameW, h1 = a.rows * a.frameH;
        if (src.rects?.length) { w1 = 0; h1 = 0; for (const r of src.rects) { w1 = Math.max(w1, r.x + r.w); h1 = Math.max(h1, r.y + r.h); } }
        lazyList.push({ key: a.key, id: a.id, source: src, img: null, emis: null, scale: 1, masks: {}, maskUrls: {}, base: 0, count: src.rects ? src.rects.length : a.columns * a.rows, fw: a.frameW, fh: a.frameH, cols: a.columns, layer: -1, px: 0, py: 0, lazy: { w1, h1, state: 0, pool: vehKeys.has(a.key) ? 1 : bldKeys.has(a.key) ? 2 : 0 } });
        return;
      }
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
    list.sort((a, b) => a.id - b.id); lazyList.sort((a, b) => a.id - b.id);
    this.gen++; this.queue = []; this.pools = []; this.layoutVersion++; this.fallbackCache.clear();
    const lowMem = this.textureBudgetMB <= 256; this.sideShift = lowMem ? SIDE_SHIFT_LOWMEM : SIDE_SHIFT;
    const groups: { cls: PoolClass; lazy: AtlasRT[]; minSlots: number; cap: boolean }[] = [];
    const wear = lazyList.filter((a) => a.lazy!.pool === 0), veh = lazyList.filter((a) => a.lazy!.pool === 1), bld = lazyList.filter((a) => a.lazy!.pool === 2);
    // building tiers first: main colour array (never the compressed tail of vehicle/wear pools)
    if (bld.length) groups.push({ cls: "bld", lazy: bld, minSlots: Math.min(bld.length, lowMem ? BLD_POOL_SLOTS_LOWMEM : BLD_POOL_SLOTS_DESKTOP), cap: true });
    // vehicles first: the wear pool's layers come last so they can live in their own (compressed) array
    if (veh.length) groups.push({ cls: "veh", lazy: veh, minSlots: Math.min(veh.length, lowMem ? VEH_POOL_SLOTS_LOWMEM : VEH_POOL_SLOTS_DESKTOP), cap: true });
    if (wear.length) groups.push({ cls: "wear", lazy: wear, minSlots: Math.min(wear.length, this.poolPolicy.minSlots ?? (lowMem ? POOL_MIN_SLOTS_LOWMEM : POOL_MIN_SLOTS_DESKTOP)), cap: false });
    // vehicles are visible art: their pool keeps a full-res (1x) working set that fitBudget never trades away; the
    // wearables pool is the streaming tier and may shrink (more paging) before any visible art is blurred
    const keep = groups.filter((g) => g.cls !== "wear").reduce((t, g) => t + this.poolReserveBytes(g.lazy, g.minSlots, list, 1), 0);
    const reserve = keep + groups.filter((g) => g.cls === "wear").reduce((t, g) => t + this.poolReserveBytes(g.lazy, g.minSlots, list), 0);
    this.registryForTier = registry; await this.fitBudget(list, reserve, keep); this.sideScale = (await halveSide(list, this.sideShift)) ? 1 / (1 << this.sideShift) : 1;
    const layout = (): void => { this.pack(list); this.pools = []; for (const g of groups) this.planPool(g.lazy, g.minSlots, list, g.cls, g.cap); let b = this.totalFrames; for (const a of lazyList) { a.base = b; b += a.count; } this.totalFrames = b; };
    layout();
    const all = [...list, ...lazyList];
    this.upload(list, this.frameTintRows(registry, all), all);
    const lim = this.limitProblem(); if (lim) { this.uploadErrors.push(lim); console.error("[render] " + lim); this.onError?.({ kind: "limits", message: lim }); }
    while ((this.oomFlag || this.gl.getError() === this.gl.OUT_OF_MEMORY) && this.downscale > MIN_ATLAS_DOWNSCALE) {
      this.oomFlag = false;
      // the driver refused the arrays: halve again and re-upload (once per step)
      const msg = `atlas upload out of GPU memory at ${this.gpuMB()} MB (downscale ${this.downscale}); retrying at ${this.downscale / 2}`;
      console.warn("[render] " + msg); this.onError?.({ kind: "oom", message: msg });
      await scaleList(list, 0.5); this.downscale /= 2; this.coldDownscale = Math.max(MIN_ATLAS_DOWNSCALE / 2, this.coldDownscale / 2); layout(); this.upload(list, this.frameTintRows(registry, all), all);
    }
    if (this.oomFlag) { this.oomFlag = false; const msg = `atlas arrays still out of GPU memory at the minimum downscale x${this.downscale}`; this.uploadErrors.push(msg); this.onFault?.("atlas", msg); }
    list.push(...lazyList);
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
    this.usedMark = new Uint8Array(list.length); this.atlases = list; this.atlasById = new Map(list.map((a) => [a.id, a])); this.sprites = sprites; this.registry = registry; this.resolveSway(); this.resolveVariants(); this.resolveRoofs(); this.resolveHands();
    this.uploadTints();
    this.maskPixels.clear();
    this.held = held; this.version++;
    for (const [k, u] of prevHeld) this.assets.release(k, u);
  }

  private gpuMB(): number { return Math.round(this.gpuBytes / 1048576); }
  /** Estimated bytes of the atlas arrays for a packing (colour + emissive + present masks, full mip chains). */
  private estimate(list: AtlasRT[]): number {
    return this.layerBytes(list) * this.layers;
  }
  /** Arrays allocated for a list (colour + emissive + masks present; pool pages add a tint mask array). */
  private arrayCount(list: AtlasRT[], poolTint = this.pools.some((p) => p.tint), poolEmis = this.pools.some((p) => p.emis)): number {
    return 1 + (poolEmis || list.some((a) => a.emis) ? 1 : 0) + (["sheen", "sway"] as const).filter((m) => list.some((a) => a.masks[m])).length + (poolTint || list.some((a) => a.masks.tintmask) ? 1 : 0);
  }
  /** Bytes of one layer across every allocated array, full mip chain included. */
  private layerBytes(list: AtlasRT[], poolTint?: boolean, poolEmis?: boolean): number { const h = Math.max(1, this.layerSize >> this.sideShift); return rgbaBytes(this.layerSize, this.layerSize, true) + rgbaBytes(h, h, true) * (this.arrayCount(list, poolTint, poolEmis) - 1); }
  private poolGeom(lazy: AtlasRT[], k: number): { sw: number; sh: number; cols: number; perLayer: number } {
    const S = this.layerSize; const w1 = Math.max(...lazy.map((a) => a.lazy!.w1)), h1 = Math.max(...lazy.map((a) => a.lazy!.h1));
    const sw = Math.max(1, Math.ceil(w1 * k)), sh = Math.max(1, Math.ceil(h1 * k));
    const cols = Math.floor((S + POOL_GAP) / (sw + POOL_GAP)), rows = Math.floor((S + POOL_GAP) / (sh + POOL_GAP));
    return { sw, sh, cols, perLayer: cols * rows };
  }
  /** Pool scales to try, best first: the 2x page (when the quality tier asks for it), 1x, 0.5, 0.25 (low-end layer size shrinks these too). */
  private poolScales(lazy: AtlasRT[]): number[] {
    const has2 = this.pageScale >= 2 && lazy.every((a) => a.source.pages?.some((p) => p.scale === 2));
    return (has2 ? [2, 1, 0.5, 0.25] : [1, 0.5, 0.25]).filter((k) => this.poolGeom(lazy, k).perLayer > 0);
  }
  /** Budget held back for the pool before the resident art is downscaled: minSlots at the smallest workable scale. */
  private poolReserveBytes(lazy: AtlasRT[], minSlots: number, resident: AtlasRT[], k?: number): number {
    const tint = this.pools.some((p) => p.tint) || lazy.some((a) => a.source.masks?.tintmask), emis = lazy.some((a) => a.source.emissiveUrl);
    const ks = this.poolScales(lazy); if (!ks.length) return 0;
    const g = this.poolGeom(lazy, k !== undefined && ks.includes(k) ? k : ks.includes(0.5) ? 0.5 : ks[ks.length - 1]!);
    return Math.ceil(minSlots / g.perLayer) * this.layerBytes(resident, tint, emis);
  }
  /**
   * Choose pool scale + layer count from the budget left after the packed resident layers (and earlier pools); appends
   * the pool layers. `cap`: never more layers than minSlots needs (vehicles: a small working set, refcounted per
   * vehicle; the 2x page only when that still leaves half the free layers).
   */
  private planPool(lazy: AtlasRT[], minSlots: number, resident: AtlasRT[], cls: PoolClass = "wear", cap = false): void {
    if (!lazy.length) return;
    const tint = lazy.some((a) => a.source.masks?.tintmask), emis = cls !== "wear" && lazy.some((a) => a.source.emissiveUrl);
    const anyTint = tint || this.pools.some((p) => p.tint), anyEmis = emis || this.pools.some((p) => p.emis);
    const per = this.layerBytes(resident, anyTint, anyEmis); const budget = this.textureBudgetMB * 1048576;
    const freeLayers = Math.max(0, Math.min(this.maxLayers - this.layers, Math.floor((budget - per * this.layers) / per)));
    const sh = this.sideShift; const slotBytes = (g: { sw: number; sh: number }) => rgbaBytes(g.sw, g.sh, true) + rgbaBytes(Math.max(1, g.sw >> sh), Math.max(1, g.sh >> sh), true) * ((tint ? 1 : 0) + (emis ? 1 : 0)); // side arrays at layerSize >> sideShift
    const mk = (k: number, g: ReturnType<AtlasManager["poolGeom"]>, layers: number): Pool => ({ k, ...g, first: this.layers, layers, lru: new PageLRU<string>(layers * g.perLayer, POOL_PROTECT_FRAMES), slotBytes: slotBytes(g), tint, emis, cls });
    let pick: Pool | null = null;
    if (cap) {
      for (const k of this.poolScales(lazy)) {
        const g = this.poolGeom(lazy, k); const layers = Math.ceil(minSlots / g.perLayer);
        if (layers > (k > 1 ? Math.floor(freeLayers / 2) : freeLayers)) continue;
        pick = mk(k, g, layers); break;
      }
    } else {
      // Character wearables are never planned below 1x: a downscaled wear pool is what made mobile characters blurry
      // blobs (0.25x, 12 slots). Memory pressure is met by fewer slots (distance-priority eviction), not by blur.
      const wk = this.wearScale(); const ks = this.poolScales(lazy).filter((k) => cls !== "wear" || k >= wk);
      // 1) the best scale whose pool holds every streamed page (no misses at all), 2) else the best scale holding minSlots
      if (this.poolPolicy.coverAll) for (const k of ks) {
        const g = this.poolGeom(lazy, k); const layers = Math.ceil(lazy.length / g.perLayer);
        if (layers > freeLayers) continue;
        pick = mk(k, g, layers); break;
      }
      if (!pick) for (const k of ks) {
        const g = this.poolGeom(lazy, k);
        const layers = Math.min(freeLayers, Math.ceil(lazy.length / g.perLayer));
        if (layers <= 0) continue;
        pick = mk(k, g, layers); if (pick.lru.capacity >= minSlots) break;
      }
      if (cls === "wear" && (!pick || pick.lru.capacity < minSlots)) {
        // 1x wear pool holding minSlots even over budget (reported by vramStats.withinBudget) - the local player and
        // nearby characters must always be fully dressed at full res
        const k1 = ks.includes(wk) ? wk : 1; const g = this.poolGeom(lazy, k1); const n = Math.min(minSlots, this.textureBudgetMB <= 256 ? WEAR_1X_SLOTS_LOWMEM : WEAR_1X_SLOTS_DESKTOP);
        if (!pick || pick.k < wk || pick.lru.capacity < n) pick = mk(k1, g, Math.max(1, Math.ceil(n / g.perLayer)));
      }
    }
    if (!pick && freeLayers <= 0) {
      // no budget left at all: one layer at the smallest scale (over budget is reported by vramStats.withinBudget)
      const ks = this.poolScales(lazy); const k = ks[ks.length - 1]; if (k === undefined) return;
      pick = mk(k, this.poolGeom(lazy, k), 1);
    }
    if (!pick) return;
    const idx = this.pools.length; this.pools.push(pick); this.layers += pick.layers;
    for (const a of lazy) { a.scale = pick.k; a.lazy!.state = 0; a.lazy!.pool = idx; a.layer = -1; }
  }
  /**
   * Hot/cold budget fit. Hot atlases (terrain, bodies, common props, UI, recently used) keep the largest scale; cold ones
   * (rare variants, distant LODs, one-shot fx, unreferenced) are shrunk first. Tries (hot, cold) best-first: hot 1 with cold
   * 1..MIN, then hot 0.5 with cold 0.5..MIN, ... Atlases larger than a layer are always shrunk.
   */
  private async fitBudget(list: AtlasRT[], reserveBytes = 0, keepBytes = 0): Promise<void> {
    const S = this.layerSize; const full = this.textureBudgetMB * 1048576;
    this.classify(list);
    const cap = (a: AtlasRT) => { let d = 1; const t = Math.max(a.img!.width, a.img!.height) / S; while (d > 1 / Math.max(1, t)) d /= 2; return d; };
    const caps = list.map(cap);
    const dims = (h: number, c: number) => list.map((a, i) => { const k = Math.min(caps[i]!, a.cold ? c : h); return { ...a, img: { width: Math.max(1, Math.floor(a.img!.width * k)), height: Math.max(1, Math.floor(a.img!.height * k)) } as ImageLike }; });
    const fits = (h: number, budget: number): number | null => {
      const anyCold = list.some((a) => a.cold);
      for (let c = h; c >= MIN_ATLAS_DOWNSCALE; c /= 2) { this.pack(dims(h, c)); if (this.estimate(list) <= budget) return c; if (!anyCold) break; }
      return null;
    };
    // Blur-safe order: visible (hot) art keeps full res. Memory comes from (1) shrinking cold atlases, (2) a smaller
    // streaming-pool reserve (the pools then page more often instead of blurring resident art), (3) demoting hot
    // atlases that were not drawn recently to cold, and only then (4) halving the hot tier.
    let best: [number, number] | null = null; let keptReserve = reserveBytes; let demoted = 0;
    for (const r of [reserveBytes, keepBytes + (reserveBytes - keepBytes) / 2, keepBytes + (reserveBytes - keepBytes) / 4, keepBytes]) { const c = fits(1, full - r); if (c !== null) { best = [1, c]; keptReserve = r; break; } }
    if (!best && this.recentlyUsed.size) {
      const idle = list.filter((a) => !a.cold && !this.recentlyUsed.has(a.key)).sort((a, b) => b.img!.width * b.img!.height - a.img!.width * a.img!.height);
      for (const a of idle) { a.cold = true; demoted++; const c = fits(1, full - keepBytes); if (c !== null) { best = [1, c]; keptReserve = keepBytes; break; } }
    }
    if (!best) {
      keptReserve = 0;
      for (let h = 0.5; h >= MIN_ATLAS_DOWNSCALE && !best; h /= 2) { const c = fits(h, full); if (c !== null) best = [h, c]; }
    }
    const [h, c] = best ?? [MIN_ATLAS_DOWNSCALE, MIN_ATLAS_DOWNSCALE];
    this.downscale = h; this.coldDownscale = c;
    this.fitInfo = { reserveMB: Math.round(keptReserve / 1048576), reserveWantedMB: Math.round(reserveBytes / 1048576), demoted };
    this.pack(dims(h, c));
    if (h < 1) {
      const nc = list.filter((a) => a.cold).length;
      console.warn(`[render] atlas arrays over the ${this.textureBudgetMB} MB GPU budget at full res: hot x${h} (${list.length - nc} atlases), cold x${c} (${nc}) (~${Math.round(this.estimate(list) / 1048576)} MB)`);
    }
    await Promise.all(list.map((a, i) => { const k = Math.min(caps[i]!, a.cold ? c : h); return k < 1 ? scaleList([a], k) : undefined; }));
  }
  /** Tier every resident atlas (see defaultAtlasTier / atlasTier / recentlyUsed). */
  private classify(list: AtlasRT[]): void {
    const reg = this.registryForTier; const wear = new Map<string, [number, number]>(); const bodies = new Set<string>();
    if (reg) {
      const ws = wearableSpriteIds(reg);
      for (const sp of reg.allSprites()) { const e = wear.get(sp.atlas.key) ?? [0, 0]; e[1]++; if (ws.has(sp.id)) e[0]++; wear.set(sp.atlas.key, e); if (/body|bodies/i.test(sp.key ?? "")) bodies.add(sp.atlas.key); }
    }
    for (const a of list) {
      const e = wear.get(a.key); const info = { bodies: bodies.has(a.key), wearShare: e && e[1] ? e[0] / e[1] : 0 };
      a.cold = !this.recentlyUsed.has(a.key) && (this.atlasTier ?? defaultAtlasTier)(a.key, info) === "cold";
    }
  }
  private registryForTier: AssetRegistry | null = null;
  /** Hot/cold split of the resident atlases (keys) after the last rebuild. */
  get tiers(): { hot: string[]; cold: string[]; hotScale: number; coldScale: number } {
    const r = this.atlases.filter((a) => !a.lazy);
    return { hot: r.filter((a) => !a.cold).map((a) => a.key), cold: r.filter((a) => a.cold).map((a) => a.key), hotScale: this.downscale, coldScale: this.coldDownscale };
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
    const ms = this.sideScale; // side masks are stored at half size
    for (let tries = 0; tries < 24; tries++) {
      const x = Math.floor(rnd() * fw), y = Math.floor(rnd() * fh);
      const mx = Math.min(px.w - 1, Math.floor((fx + x) * ms)), my = Math.min(px.h - 1, Math.floor((fy + y) * ms)); const o = (my * px.w + mx) * 4;
      if (px.data[o + 2]! > 127 && px.data[o + 3]! > 0) return [x / k - s.anchorX, y / k - s.anchorY];
    }
    return null;
  }

  private upload(list: AtlasRT[], tintRows: Map<number, number> = new Map(), all: AtlasRT[] = list): void {
    this.tintRowMap = tintRows;
    const gl = this.gl;
    // side arrays (emissive/masks) at half size: images were halved in halveSide(); offsets shift with them
    const sub = (im: ImageLike, a: AtlasRT) => { const x = a.px >> this.sideShift, y = a.py >> this.sideShift, H = this.layerSize >> this.sideShift;
      const w = Math.min(im.width, H - x), h = Math.min(im.height, H - y); if (w <= 0 || h <= 0) return;
      if (w !== im.width || h !== im.height) { this.uploadErrors.push(`side image ${a.key} ${im.width}x${im.height} clipped`); return; }
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, a.layer, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, im as TexImageSource); };
    this.planOwn();
    const owned = this.pools.filter((p) => p.own); const own = owned[0];
    const ownLayers = owned.reduce((t, p) => t + p.layers, 0);
    const colourLayers = Math.max(1, this.layers - ownLayers);
    // streamed pool layers (the tail) never carry sheen/sway masks (and emissive only for vehicle pools): those side
    // arrays stop at the first pool layer (their flag bits are never set for pool pages, so they are never sampled there)
    const firstPool = this.pools.length ? Math.min(...this.pools.map((p) => p.first)) : this.layers;
    const residentLayers = Math.max(1, firstPool);
    const mk = (side = false, nLayers?: number): WebGLTexture => {
      const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      const S = side ? Math.max(1, this.layerSize >> this.sideShift) : this.layerSize;
      const levels = Math.floor(Math.log2(S)) + 1;
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, S, S, nLayers ?? (side ? this.layers : colourLayers)); if (!side) this.texLevels = levels;
      const err = gl.getError(); if (err !== gl.NO_ERROR) { this.uploadErrors.push(`texStorage3D ${S}x${S}x${this.layers} levels ${levels}: 0x${err.toString(16)}`); if (err === gl.OUT_OF_MEMORY) this.oomFlag = true; }
      setLevelRange(gl, gl.TEXTURE_2D_ARRAY, levels);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    if (this.tex) gl.deleteTexture(this.tex); if (this.emisTex) gl.deleteTexture(this.emisTex);
    for (const t of [this.sheenTex, this.swayTex, this.tintMaskTex]) if (t) gl.deleteTexture(t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this.tex = mk();
    if (this.poolTex) gl.deleteTexture(this.poolTex);
    if (own) {
      const o = own.own!; const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, o.levels, o.fmt ?? gl.RGBA8, this.layerSize, this.layerSize, ownLayers);
      const err = gl.getError(); if (err !== gl.NO_ERROR) { this.uploadErrors.push(`pool texStorage3D ${o.fmt ?? "RGBA8"} x${ownLayers}: 0x${err.toString(16)}`); if (err === gl.OUT_OF_MEMORY) this.oomFlag = true; }
      setLevelRange(gl, gl.TEXTURE_2D_ARRAY, o.levels);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.poolTex = t; this.poolFirst = own.first;
    } else { for (const p of this.pools) delete p.own; this.poolTex = dummyArray(gl); this.poolFirst = 1 << 20; }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    for (const a of list) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, a.px, a.py, a.layer, a.img!.width, a.img!.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, a.img as TexImageSource);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    this.hasEmissive = list.some((a) => a.emis) || this.pools.some((p) => p.emis);
    this.emisTex = this.hasEmissive ? mk(true, this.pools.some((p) => p.emis) ? this.layers : residentLayers) : dummyArray(gl); // emissive is gated by a frame flag: no full array when unused
    const sideSave = this.sideSaving(list);
    this.gpuBytes = this.estimate(list) - this.ownSaving() - sideSave;
    const poolBytes = this.pools.reduce((t, p) => t + p.layers * this.layerBytes(list), 0) - this.ownSaving() - sideSave;
    this.vram.budgetBytes = this.textureBudgetMB * 1048576; this.vram.setResident(this.gpuBytes - poolBytes, poolBytes);
    this.vram.pageSlots = this.pools.reduce((t, p) => t + p.lru.capacity, 0); this.vram.pending = 0;
    for (const a of list) if (a.emis) sub(a.emis, a);
    if (this.hasEmissive) gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    // mask arrays: full layout only when some atlas has that mask, else a 1x1 dummy (never sampled: flag bit unset)
    const maskArray = (m: MaskName): WebGLTexture => {
      if (!list.some((a) => a.masks[m]) && !(m === "tintmask" && this.pools.some((p) => p.tint))) {
        const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        setLevelRange(gl, gl.TEXTURE_2D_ARRAY, 1);
        return t;
      }
      const t = mk(true, m === "tintmask" ? this.layers : residentLayers);
      for (const a of list) { const im = a.masks[m]; if (im) sub(im, a); }
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      return t;
    };
    this.sheenTex = maskArray("sheen"); this.swayTex = maskArray("sway"); this.tintMaskTex = maskArray("tintmask");
    // frame table
    const n = Math.max(1, this.totalFrames); const rows = Math.ceil(n / TABLE_W);
    const data = new Float32Array(TABLE_W * 2 * rows * 4); this.table = data; this.tableDirty0 = this.tableDirty1 = -1;
    void all;
    for (const a of list) this.writeFrames(a, data, tintRows);
    if (this.frameTex) gl.deleteTexture(this.frameTex);
    const ft = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, ft);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TABLE_W * 2, rows, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.frameTex = ft;
  }

  /** Frame-table rows of one atlas at its packed position (or zeroed when `clear`: a streamed page that is not resident). */
  private writeFrames(a: AtlasRT, data: Float32Array, tintRows: Map<number, number>, clear = false): void {
    const S = this.layerSize;
    if (clear) { data.fill(0, a.base * 8, (a.base + a.count) * 8); this.markTable(a); return; }
    for (let f = 0; f < a.count; f++) {
      const r = a.source.rects?.[f];
      const x = r ? r.x : (f % a.cols) * a.fw, y = r ? r.y : Math.floor(f / a.cols) * a.fh;
      const w = r ? r.w : a.fw, h = r ? r.h : a.fh; const k = a.scale;
      const o = (a.base + f) * 8;
      data[o] = (a.px + x * k) / S; data[o + 1] = (a.py + y * k) / S; data[o + 2] = (a.px + (x + w) * k) / S; data[o + 3] = (a.py + (y + h) * k) / S;
      const bits = (a.emis ? FrameBits.Emissive : 0) | (a.masks.sheen ? FrameBits.Sheen : 0) | (a.masks.sway ? FrameBits.Sway : 0) | (a.masks.tintmask ? FrameBits.TintMask : 0);
      data[o + 4] = w; data[o + 5] = h; data[o + 6] = a.layer; data[o + 7] = bits + (tintRows.get(a.base + f) ?? 0) * 16;
    }
    if (a.lazy) this.markTable(a);
  }
  private markTable(a: AtlasRT): void {
    const r0 = Math.floor(a.base / TABLE_W), r1 = Math.floor((a.base + Math.max(1, a.count) - 1) / TABLE_W);
    this.tableDirty0 = this.tableDirty0 < 0 ? r0 : Math.min(this.tableDirty0, r0); this.tableDirty1 = Math.max(this.tableDirty1, r1);
  }

  // ---- wearable page streaming -------------------------------------------------------------------------------------

  /** Once per frame before drawing: advances the LRU clock and uploads frame-table rows patched by page-ins/evictions. */
  beginFrame(): void {
    this.frame++;
    if (this.tableDirty0 < 0 || !this.frameTex) return;
    const gl = this.gl; const r0 = this.tableDirty0, n = this.tableDirty1 - r0 + 1;
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, TABLE_W * 2, n, gl.RGBA, gl.FLOAT, this.table.subarray(r0 * TABLE_W * 8, (r0 + n) * TABLE_W * 8));
    this.tableDirty0 = this.tableDirty1 = -1;
  }
  private lazyOf(spriteId: number): AtlasRT | null { const s = this.sprites[spriteId]; if (!s) return null; const a = this.atlases[s.atlasIdx]; return a?.lazy ? a : null; }
  /** True when the sprite's art can be drawn now. Streamed pages are touched (LRU) and requested when missing. */
  pageReady(spriteId: number, prio = Infinity): boolean {
    const a = this.lazyOf(spriteId); if (!a) return true;
    const p = this.poolOfA(a); if (!p || !this.poolOn(p, prio)) { this.vram.misses++; return false; }
    if (a.lazy!.state === 2 && p.lru.touch(a.key, this.frame, prio)) return true;
    this.vram.misses++; this.request(a, prio); return false;
  }
  /** Residency of a sprite's page for ?diag: "resident" | "loading" | "missing" | "resident" (non-streamed) + pool scale. */
  pageInfo(spriteId: number): { state: "resident" | "loading" | "missing"; scale: number; streamed: boolean } {
    const a = this.lazyOf(spriteId); const s = this.sprites[spriteId]; const r = s ? this.atlases[s.atlasIdx] : undefined;
    if (!a) return { state: "resident", scale: r?.scale ?? 1, streamed: false };
    const p = this.poolOfA(a); return { state: a.lazy!.state === 2 ? "resident" : a.lazy!.state === 1 ? "loading" : "missing", scale: p?.k ?? 0, streamed: true };
  }
  /** Page refcount (+1) for a sprite's atlas; held pages are evicted only after unreferenced ones. Prefetches. */
  retainSprite(spriteId: number): void { const a = this.lazyOf(spriteId); const p = a && this.poolOfA(a); if (!a || !p) return; p.lru.retain(a.key); this.request(a); }
  releaseSprite(spriteId: number): void { const a = this.lazyOf(spriteId); const p = a && this.poolOfA(a); if (a && p) p.lru.release(a.key); }
  /** Mark a drawn sprite's atlas as recently used: it is classified hot at the next rebuild (budget / fallback refit). */
  markUsed(spriteId: number): void { const s = this.sprites[spriteId]; if (!s) return; const a = this.atlases[s.atlasIdx]; if (a && !a.lazy && this.usedMark[s.atlasIdx] !== 1) { this.usedMark[s.atlasIdx] = 1; this.recentlyUsed.add(a.key); } }
  private usedMark = new Uint8Array(0);
  /** Pool class of a sprite's streamed page ("wear" | "veh"), or null when resident. */
  streamClass(spriteId: number): PoolClass | null { const a = this.lazyOf(spriteId); return a ? this.poolOfA(a)?.cls ?? null : null; }
  /** Request pages for these sprites (e.g. a creator preview selection); resolves when all are resident or failed. */
  async prefetch(spriteIds: Iterable<number>): Promise<void> {
    const want = [...new Set([...spriteIds].map((id) => this.lazyOf(id)).filter((a): a is AtlasRT => !!a))];
    for (const a of want) this.request(a);
    const g = this.gen;
    for (let i = 0; i < 600 && g === this.gen && want.some((a) => a.lazy!.state === 1 || this.queue.includes(a)); i++) await new Promise((r) => setTimeout(r, 16));
  }
  /** Atlas key of a sprite's streamed page (null when resident / not streamed). */
  pageKey(spriteId: number): string | null { return this.lazyOf(spriteId)?.key ?? null; }
  /** Streamed wearable atlases resident / known. */
  isStreamed(spriteId: number): boolean { return !!this.lazyOf(spriteId); }
  get vramStats(): VramStats & { pools: { cls: PoolClass; scale: number; slots: number; layers: number; resident: number; slotMB: number }[]; poolScale: number; layerSize: number; downscale: number; coldDownscale: number; hotAtlases: number; coldAtlases: number } {
    return { ...this.vram.stats(), poolScale: this.pools[0]?.k ?? 0, pools: this.pools.map((p) => ({ cls: p.cls, scale: p.k, slots: p.lru.capacity, layers: p.layers, resident: p.lru.size, slotMB: +(p.slotBytes / 1048576).toFixed(1) })), layerSize: this.layerSize, downscale: this.downscale, coldDownscale: this.coldDownscale, hotAtlases: this.tiers.hot.length, coldAtlases: this.tiers.cold.length };
  }
  private request(a: AtlasRT, prio = Infinity): void {
    const p = this.poolOfA(a); if (!p || !this.poolOn(p, prio) || a.lazy!.state !== 0) return;
    const qi = this.queue.indexOf(a);
    if (qi >= 0) { if (prio < (a.lazy!.prio ?? Infinity)) { a.lazy!.prio = prio; this.queue.splice(qi, 1); this.enqueue(a); } return; }
    if (!p.lru.canAllocate(a.key, this.frame, prio)) return; // every slot holds a nearer page in use: keep the fallback, retry later
    a.lazy!.prio = prio; this.enqueue(a); this.vram.pending = this.queue.length + this.inflight; this.pump();
  }
  /** Insert by priority (local player first, then by distance). */
  private enqueue(a: AtlasRT): void { const pr = a.lazy!.prio ?? Infinity; let i = this.queue.length; while (i > 0 && (this.queue[i - 1]!.lazy!.prio ?? Infinity) > pr) i--; this.queue.splice(i, 0, a); }
  private pump(): void {
    while (this.inflight < PAGE_CONCURRENCY && this.queue.length) {
      const a = this.queue.shift()!; const g = this.gen;
      const pr = a.lazy!.prio ?? Infinity; const p = this.poolOfA(a); if (!p || !this.poolOn(p, pr) || !p.lru.canAllocate(a.key, this.frame, pr)) continue;
      a.lazy!.state = 1; this.inflight++;
      this.pageIn(a, g).catch((e: unknown) => { console.warn(`[render] page-in ${a.key} failed`, e); if (g === this.gen) a.lazy!.state = 0; })
        .finally(() => { this.inflight--; this.vram.pending = this.queue.length + this.inflight; this.pump(); });
    }
  }
  private async pageIn(a: AtlasRT, g: number): Promise<void> {
    const p = this.poolOfA(a)!; const src = a.source;
    if (p.own) return this.pageInOwn(a, g, p);
    const url = p.k >= 2 ? src.pages!.find((q) => q.scale === 2)!.url : src.url;
    const tintUrls = src.masks?.tintmask === undefined ? [] : Array.isArray(src.masks.tintmask) ? src.masks.tintmask : [src.masks.tintmask];
    const [img, tint, emi] = await Promise.all([this.loader(url), (async () => { if (!p.tint) return null; for (const u of tintUrls) { try { return await this.loader(u); } catch { /* next */ } } return null; })(),
      (async () => { if (!p.emis || !src.emissiveUrl) return null; try { return await this.loader(src.emissiveUrl); } catch { return null; } })()]);
    if (g !== this.gen) return;
    const W = Math.max(1, Math.round(a.lazy!.w1 * p.k)), H = Math.max(1, Math.round(a.lazy!.h1 * p.k));
    const chain = async (im: ImageLike, q: "high" | "pixelated"): Promise<ImageLike[]> => {
      const out: ImageLike[] = []; let w = W, h = H; let cur = im;
      const levels = Math.floor(Math.log2(this.layerSize)) + 1;
      for (let l = 0; l < levels; l++) {
        if (cur.width !== w || cur.height !== h) cur = await createImageBitmap(cur as ImageBitmapSource, { resizeWidth: w, resizeHeight: h, resizeQuality: q, premultiplyAlpha: "none", colorSpaceConversion: "none" } as ImageBitmapOptions);
        out.push(cur); if (w === 1 && h === 1) break; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      }
      return out;
    };
    const [cc, tc, ec] = await Promise.all([chain(img, "high"), tint ? chain(tint, "pixelated") : Promise.resolve(null), emi ? chain(emi, "high") : Promise.resolve(null)]);
    if (g !== this.gen) return;
    if ((a.lazy!.prio ?? Infinity) > PRIO_NEAR && !this.vram.canPageIn(p.slotBytes)) { this.pageBudgetRefusals++; a.lazy!.state = 0; return; } // pages count against the budget
    const slot = p.lru.allocate(a.key, this.frame, a.lazy!.prio ?? Infinity);
    if (!slot) { a.lazy!.state = 0; return; } // pool full of pages drawn this frame: retried on next pageReady
    if (slot.evicted !== undefined) {
      const ev = this.atlases.find((x) => x.key === slot.evicted);
      if (ev?.lazy) { ev.lazy.state = 0; ev.layer = -1; this.writeFrames(ev, this.table, this.tintRowMap, true); }
      this.vram.evict(p.slotBytes);
    }
    const layer = p.first + Math.floor(slot.slot / p.perLayer), si = slot.slot % p.perLayer;
    const px = (si % p.cols) * (p.sw + POOL_GAP), py = Math.floor(si / p.cols) * (p.sh + POOL_GAP);
    const gl = this.gl; gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const pre = this.syncChecks ? gl.getError() : gl.NO_ERROR; if (pre === gl.OUT_OF_MEMORY) this.onFault?.("page", `GL_OUT_OF_MEMORY pending before page-in ${a.key}`);
    const maxL = this.texLevels || Math.floor(Math.log2(this.layerSize)) + 1;
    const put = (tex: WebGLTexture | null, levels: ImageLike[], cap: number) => {
      if (!tex) return; gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      levels.slice(0, cap).forEach((im, l) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, px >> l, py >> l, layer, im.width, im.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, im as TexImageSource));
    };
    put(this.tex, cc, maxL);
    if (tc && this.tintMaskTex) { gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tintMaskTex); tc.slice(this.sideShift, this.sideShift + Math.max(1, maxL - this.sideShift)).forEach((im, l) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, px >> (l + this.sideShift), py >> (l + this.sideShift), layer, im.width, im.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, im as TexImageSource)); }
    // emissive (vehicle lights): cold tier, stored like the tint mask at side resolution (layerSize >> this.sideShift)
    if (ec && this.emisTex) { gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.emisTex); ec.slice(this.sideShift, this.sideShift + Math.max(1, maxL - this.sideShift)).forEach((im, l) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, px >> (l + this.sideShift), py >> (l + this.sideShift), layer, im.width, im.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, im as TexImageSource)); }
    for (const im of [...cc, ...(tc ?? []), ...(ec ?? [])]) if (im !== img && im !== tint && im !== emi && typeof (im as ImageBitmap).close === "function") (im as ImageBitmap).close();
    for (const im of [img, tint, emi]) if (im && typeof (im as ImageBitmap).close === "function") (im as ImageBitmap).close();
    const err = this.syncChecks ? gl.getError() : gl.NO_ERROR;
    if (err !== gl.NO_ERROR) {
      // the driver refused the upload (Mali commits pages lazily: OOM shows up here, not at texStorage3D); free the slot,
      // keep the body-only fallback and report so the renderer steps down its fallback ladder
      p.lru.remove(a.key); a.lazy!.state = 0; a.layer = -1; this.pageFaults++;
      const msg = `page-in ${a.key}: ${err === gl.OUT_OF_MEMORY ? "OUT_OF_MEMORY" : "0x" + err.toString(16)}`;
      if (this.uploadErrors.length < 32) this.uploadErrors.push(msg); this.onFault?.("page", msg); return;
    }
    a.layer = layer; a.px = px; a.py = py; a.scale = p.k;
    a.masks = tc ? { tintmask: { width: W, height: H } as ImageLike } : {}; // flag only (CPU pixels released)
    a.emis = ec ? ({ width: W, height: H } as ImageLike) : null; // flag only
    this.writeFrames(a, this.table, this.tintRowMap);
    a.lazy!.state = 2; this.vram.pageIn(p.slotBytes);
  }

  /** KTX2 page-ins (compressed colour) and KTX2 mask decodes, PNG fallbacks (diag). */
  ktx2Stats = { colour: 0, masks: 0, pngFallback: 0, failed: 0 };
  /**
   * Page-in for the wear pool's own array: colour from KTX2 (ETC1S -> probe target, compressedTexSubImage3D, level 0 only)
   * or PNG (RGBA8, only the allocated levels); tint mask from the UASTC KTX2 twin (decoded to RGBA, side resolution) or PNG.
   */
  private async pageInOwn(a: AtlasRT, g: number, p: Pool): Promise<void> {
    const src = a.source; const o = p.own!; const gl = this.gl;
    const W = Math.max(1, Math.round(a.lazy!.w1 * p.k)), H = Math.max(1, Math.round(a.lazy!.h1 * p.k));
    const tintUrls = src.masks?.tintmask === undefined ? [] : Array.isArray(src.masks.tintmask) ? src.masks.tintmask : [src.masks.tintmask];
    const bmp = (im: ImageLike | ImageData, w: number, h: number, q: "high" | "pixelated") => createImageBitmap(im as ImageBitmapSource, { resizeWidth: w, resizeHeight: h, resizeQuality: q, premultiplyAlpha: "none", colorSpaceConversion: "none" } as ImageBitmapOptions);
    const colourP = (async (): Promise<{ kt: Awaited<ReturnType<typeof loadKtx2>>; levels: ImageLike[] }> => {
      if (o.fmt !== null && src.ktx2 && this.compressedCaps) { const kt = await loadKtx2(src.ktx2, this.compressedCaps, false); if (kt && kt.target === o.target) return { kt, levels: [] }; }
      if (o.fmt !== null) return { kt: null, levels: [] }; // compressed array cannot take RGBA: page fails (body-only)
      const im = await this.loader(src.url); const out: ImageLike[] = []; let w = W, h = H, cur: ImageLike = im;
      for (let l = 0; l < o.levels; l++) { if (cur.width !== w || cur.height !== h) cur = await bmp(cur, w, h, "high"); out.push(cur); w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
      return { kt: null, levels: out };
    })();
    const sideW = Math.max(1, W >> this.sideShift), sideH = Math.max(1, H >> this.sideShift);
    const tintP = (async (): Promise<ImageLike[] | null> => {
      if (!p.tint) return null;
      let base: ImageLike | null = null;
      const k2 = src.masksKtx2?.tintmask; if (k2) { const r = await loadKtx2Rgba(k2); if (r) { base = await bmp(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), sideW, sideH, "pixelated"); this.ktx2Stats.masks++; } }
      if (!base) for (const u of tintUrls) { try { base = await this.loader(u); break; } catch { /* next */ } }
      if (!base) return null;
      const out: ImageLike[] = []; let w = sideW, h = sideH, cur = base; const n = Math.floor(Math.log2(Math.max(1, this.layerSize >> this.sideShift))) + 1;
      for (let l = 0; l < n; l++) { if (cur.width !== w || cur.height !== h) cur = await bmp(cur, w, h, "pixelated"); out.push(cur); if (w === 1 && h === 1) break; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
      return out;
    })();
    const emisP = (async (): Promise<ImageLike[] | null> => {
      if (!p.emis || !src.emissiveUrl) return null; let cur: ImageLike; try { cur = await this.loader(src.emissiveUrl); } catch { return null; }
      const out: ImageLike[] = []; let w = sideW, h = sideH; const n = Math.floor(Math.log2(Math.max(1, this.layerSize >> this.sideShift))) + 1;
      for (let l = 0; l < n; l++) { if (cur.width !== w || cur.height !== h) cur = await bmp(cur, w, h, "high"); out.push(cur); if (w === 1 && h === 1) break; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
      return out;
    })();
    const [col, tc, ec] = await Promise.all([colourP, tintP, emisP]);
    if (g !== this.gen) return;
    if (!col.kt && !col.levels.length) { this.ktx2Stats.failed++; a.lazy!.state = 0; return; }
    if (col.kt) this.ktx2Stats.colour++; else if (src.ktx2 && this.ktx2Target) this.ktx2Stats.pngFallback++;
    if ((a.lazy!.prio ?? Infinity) > PRIO_NEAR && !this.vram.canPageIn(p.slotBytes)) { this.pageBudgetRefusals++; a.lazy!.state = 0; return; }
    const slot = p.lru.allocate(a.key, this.frame, a.lazy!.prio ?? Infinity);
    if (!slot) { a.lazy!.state = 0; return; }
    if (slot.evicted !== undefined) {
      const ev = this.atlases.find((x) => x.key === slot.evicted);
      if (ev?.lazy) { ev.lazy.state = 0; ev.layer = -1; this.writeFrames(ev, this.table, this.tintRowMap, true); }
      this.vram.evict(p.slotBytes);
    }
    const layer = p.first + Math.floor(slot.slot / p.perLayer), si = slot.slot % p.perLayer;
    const px = (si % p.cols) * (p.sw + POOL_GAP), py = Math.floor(si / p.cols) * (p.sh + POOL_GAP);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (this.syncChecks) gl.getError();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.poolTex);
    if (col.kt) {
      const w4 = Math.min(this.layerSize - px, Math.ceil(col.kt.width / 4) * 4), h4 = Math.min(this.layerSize - py, Math.ceil(col.kt.height / 4) * 4);
      gl.compressedTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, px, py, layer - this.poolFirst, w4, h4, 1, o.fmt!, col.kt.levels[0]!);
    } else col.levels.forEach((im, l) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, px >> l, py >> l, layer - this.poolFirst, im.width, im.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, im as TexImageSource));
    if (tc && this.tintMaskTex) { gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tintMaskTex); tc.forEach((im, l) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, px >> (l + this.sideShift), py >> (l + this.sideShift), layer, im.width, im.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, im as TexImageSource)); }
    if (ec && this.emisTex) { gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.emisTex); ec.forEach((im, l) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, px >> (l + this.sideShift), py >> (l + this.sideShift), layer, im.width, im.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, im as TexImageSource)); }
    for (const im of [...col.levels, ...(tc ?? []), ...(ec ?? [])]) if (typeof (im as ImageBitmap).close === "function") (im as ImageBitmap).close();
    const err = this.syncChecks ? gl.getError() : gl.NO_ERROR;
    if (err !== gl.NO_ERROR) {
      p.lru.remove(a.key); a.lazy!.state = 0; a.layer = -1; this.pageFaults++;
      const msg = `page-in ${a.key}${col.kt ? " (ktx2 " + o.target + ")" : ""}: ${err === gl.OUT_OF_MEMORY ? "OUT_OF_MEMORY" : "0x" + err.toString(16)}`;
      if (this.uploadErrors.length < 32) this.uploadErrors.push(msg); this.onFault?.("page", msg); return;
    }
    a.layer = layer; a.px = px; a.py = py; a.scale = p.k;
    a.masks = tc ? { tintmask: { width: W, height: H } as ImageLike } : {};
    a.emis = ec ? ({ width: W, height: H } as ImageLike) : null;
    this.writeFrames(a, this.table, this.tintRowMap);
    a.lazy!.state = 2; this.vram.pageIn(p.slotBytes);
  }
  /** Wear pool storage for ?diag. */
  get wearPoolInfo(): string { const p = this.wearPool(); if (!p) return "none"; const o = p.own; const v = this.pools.find((q) => q.cls === "veh"); return `${v ? `veh x${v.k} ${v.lru.capacity} slots ${(v.slotBytes / 1048576).toFixed(1)}MB/slot; ` : ""}wear x${p.k} ${p.lru.capacity} slots ${(p.slotBytes / 1048576).toFixed(1)}MB/slot, ${o ? (o.fmt !== null ? `KTX2->${o.target}` : "RGBA8") + ` ${o.levels} lvl` : "shared RGBA8"}; ktx2 target ${this.ktx2Target ?? "none"}; ktx2 pages ${this.ktx2Stats.colour}, masks ${this.ktx2Stats.masks}, png fallback ${this.ktx2Stats.pngFallback}, failed ${this.ktx2Stats.failed}; footprint ${this.charFootprint.toFixed(2)} px/texel`; }

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

  /**
   * Sprite to draw instead of a streamed `<piece>@tier<N>` sprite whose page is not resident yet (ADR-104 lookup order
   * reversed for streaming): bare key, another already-resident tier, then the family default. -1 = nothing drawable.
   * Non-streamed results are cached; a resident other tier is used only while it stays resident.
   */
  buildingFallback(spriteId: number, prio = Infinity): number {
    const reg = this.registry; if (!reg) return -1;
    const c = this.fallbackCache.get(spriteId); if (c !== undefined) return c;
    let piece: string | undefined; try { piece = reg.sprite(spriteId).building?.piece; } catch { piece = undefined; }
    if (!piece) return -1;
    let resident = -1;
    for (const k of streamingFallbackKeys(piece)) {
      const id = reg.spriteForPiece(k); if (id === undefined || id === spriteId) continue;
      if (!this.lazyOf(id)) { this.fallbackCache.set(spriteId, id); return id; }
      if (resident < 0 && this.lazyOf(id)!.lazy!.state === 2 && this.pageReady(id, prio)) resident = id;
    }
    if (resident >= 0) return resident;
    return -1;
  }
  private fallbackCache = new Map<number, number>();
  /** Crack overlay of a building sprite (manifest building.crackOverlay, e.g. bld_crack), or -1. */
  crackOverlayOf(spriteId: number): number { const r = this.registry; if (!r) return -1; try { return r.sprite(spriteId).building?.crackOverlay ?? -1; } catch { return -1; } }
  /** Sprite-level attach point (px from pivot, 1x, unmirrored) or undefined. */
  attachOf(spriteId: number, name: string): { x: number; y: number } | undefined { const r = this.registry; if (!r) return undefined; try { return r.sprite(spriteId).attach?.[name]; } catch { return undefined; } }

  /** Footprint/layer of a building sprite (null for non-building sprites). Rotation 1/3 swaps w/h. */
  pieceInfo(spriteId: number): { fw: number; fh: number; layer: number } | null { const b = this.sprites[spriteId]?.building; return b ? { fw: b.fw, fh: b.fh, layer: b.layer } : null; }

  /** Animation index of `name` on a sprite (-1 = unknown; resolve() then uses the first animation's frame list). */
  animIndex(spriteId: number, name: string): number { const s = this.sprites[spriteId]; if (!s) return -1; const i = s.anims.findIndex((a) => a.name === name); return i < 0 ? 0 : i; }
  animName(spriteId: number, anim: number): string | undefined { return this.sprites[spriteId]?.anims[anim]?.name; }
  stateAnim(spriteId: number, state: number): number { const s = this.sprites[spriteId]; return s ? s.stateAnim[state] ?? s.stateAnim[CoreAnimState.Idle] ?? 0 : 0; }

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

/** Atlases whose sprites are only referenced as cosmetics wearable art (not bodies, not world sprites). */
/** Sprite ids referenced by cosmetic wearables (hair, hats, tops, ...). */
export function wearableSpriteIds(registry: AssetRegistry): Set<number> {
  const cat = registry.cosmetics as unknown as { bySlot?: (s: string) => unknown[]; size?: number } | undefined;
  const wear = new Set<number>(); if (!cat?.bySlot || !cat.size) return wear;
  const walk = (v: unknown, depth: number): void => {
    if (!v || typeof v !== "object" || depth > 6) return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (k === "sprite" && typeof x === "number") wear.add(x); else walk(x, depth + 1); }
  };
  for (const s of ["hair", "hat", "accessory", "top", "bottom", "shoes", "face", "eyes"]) for (const w of cat.bySlot(s)) walk(w, 0);
  return wear;
}

export function wearableOnlyAtlases(registry: AssetRegistry): Set<string> {
  const cat = registry.cosmetics as unknown as { bySlot?: (s: string) => unknown[]; bodySprite?: (b: string) => { sprite: number } | undefined; size?: number } | undefined;
  const out = new Set<string>(); if (!cat?.bySlot || !cat.size) return out;
  const wear = new Set<number>();
  const walk = (v: unknown, depth: number): void => {
    if (!v || typeof v !== "object" || depth > 6) return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (k === "sprite" && typeof x === "number") wear.add(x); else walk(x, depth + 1); }
  };
  for (const s of ["hair", "hat", "accessory", "top", "bottom", "shoes", "face", "eyes"]) for (const w of cat.bySlot(s)) walk(w, 0);
  const atlasOf = new Map<number, string>(); for (const s of registry.allSprites()) atlasOf.set(s.id, s.atlas.key);
  for (const id of wear) { const k = atlasOf.get(id); if (k) out.add(k); }
  // an atlas shared with anything else (bodies, mirrors, world props) stays resident
  for (const s of registry.allSprites()) if (!wear.has(s.id)) out.delete(s.atlas.key);
  return out;
}

export interface ResolvedFrame { entry: number; w: number; h: number; ax: number; ay: number; hasDamageFrames: boolean; /** draw mirrored (mirror rotationArt) */ flipX: boolean;
  /** source sprite id / atlas frame index / anim name (resolve() only; -1 / "" otherwise): frameMeta anchor lookup */ sprite: number; frame: number; anim: string }
export const newResolved = (): ResolvedFrame => ({ entry: 0, w: 0, h: 0, ax: 0, ay: 0, hasDamageFrames: false, flipX: false, sprite: -1, frame: -1, anim: "" });
