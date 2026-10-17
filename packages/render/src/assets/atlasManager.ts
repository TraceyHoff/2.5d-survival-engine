/**
 * AtlasManager: GPU side of the @engine/assets registry.
 *
 * - Loads atlas images (and optional `<atlas>_emissive.png` masks) through core's ref-counted
 *   AssetManager, packs every atlas image into layers of ONE RGBA8 TEXTURE_2D_ARRAY (default 2048²,
 *   mipmapped) plus a parallel emissive array with the identical layout, so all sprites from all
 *   atlases draw in a single instanced call.
 * - Builds a frame table (RGBA32F texture, 2 texels/entry: uv rect, size+layer+emissive flag)
 *   indexed by `atlasBase[atlasId] + frameIndex`. Grid atlases use the manifest grid; TexturePacker
 *   atlases supply a RectTable (see texturePacker.ts).
 * - Precomputes per-sprite animation tables at load time so render-time resolution is array math
 *   (never string lookups).
 * - Runtime switching: swapAtlas()/setTheme() replace atlas images (same layout & sprite keys -> same
 *   numeric ids), so ECS data is untouched. Old images are released (ref-counted) after the swap.
 */
import { AssetRegistry, type Animation } from "@engine/assets";
import type { AssetManager } from "@engine/core";
import type { RectTable } from "./texturePacker.js";

export interface AtlasSource { url: string; emissiveUrl?: string | null; rects?: RectTable }
export type ImageLike = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

/** AnimState.state -> animation names tried in order (first animation is the final fallback). */
export const STATE_ANIMS: readonly (readonly string[])[] = [
  ["idle"], ["walk"], ["run", "walk"], ["attack"], ["hit", "hurt", "idle"], ["death", "idle"], ["shamble", "walk"],
];
export const enum AnimStateId { Idle = 0, Walk = 1, Run = 2, Attack = 3, Hit = 4, Death = 5, Shamble = 6 }

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
interface AtlasRT { key: string; id: number; source: AtlasSource; img: ImageLike | null; emis: ImageLike | null; base: number; count: number; fw: number; fh: number; cols: number; layer: number; px: number; py: number }

export interface SwayParams { amp: number; freq: number; stiffness: number }
/** Read optional per-sprite `sway: {amp, freq, stiffness}` blocks from raw manifest JSON (loadManifest ignores them). */
export function swayFromManifest(json: unknown): { table: Record<string, SwayParams>; issues: string[] } {
  const table: Record<string, SwayParams> = {}; const issues: string[] = [];
  const sprites = (json as { sprites?: unknown[] } | null)?.sprites; if (!Array.isArray(sprites)) return { table, issues };
  for (const sp of sprites as { key?: string; sway?: Partial<SwayParams> }[]) {
    if (!sp?.sway || !sp.key) continue; const w = sp.sway;
    if (![w.amp, w.freq].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) { issues.push(`${sp.key}: bad sway`); continue; }
    table[sp.key] = { amp: w.amp!, freq: w.freq!, stiffness: typeof w.stiffness === "number" ? w.stiffness : 1.5 };
  }
  return { table, issues };
}
export interface AtlasStats { layers: number; layerSize: number; atlases: number; frames: number; sprites: number; version: number }

const TABLE_W = 1024; // entries per frame-table row

/** Image sources for every atlas of a manifest-loaded registry, relative to the manifest URL (emissive pages included). */
export function sourcesFromManifest(registry: AssetRegistry, manifestUrl: string, rects: Record<string, RectTable> = {}): Map<string, AtlasSource> {
  const base = manifestUrl.replace(/[^/]*$/, "");
  const out = new Map<string, AtlasSource>();
  for (const a of registry.atlases.values()) {
    const r = rects[a.key];
    out.set(a.key, { url: base + a.image, emissiveUrl: a.emissiveImage ? base + a.emissiveImage : null, ...(r ? { rects: r } : {}) });
  }
  return out;
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
  frameTex: WebGLTexture | null = null;
  registry: AssetRegistry | null = null;
  /** Bumped on every successful (re)build. */
  version = 0;
  private atlases: AtlasRT[] = [];
  private atlasById = new Map<number, AtlasRT>();
  private sprites: (SpriteRT | undefined)[] = [];
  private held: [string, string][] = []; // (kind,url) pairs held in AssetManager
  private themes = new Map<string, Record<string, AtlasSource>>();
  private baseSources = new Map<string, AtlasSource>();
  private layers = 0;
  private totalFrames = 0;
  private hasEmissive = false;
  static readonly IMAGE_KIND = "render:image";
  private swayByKey = new Map<string, SwayParams>();
  private swayById: (Float32Array | undefined)[] = [];

  /** Per-sprite wind sway {amp px, freq Hz, stiffness} (from the manifest's optional `sway` blocks, see swayFromManifest). */
  setSway(table: Record<string, SwayParams>): void { for (const [k, v] of Object.entries(table)) this.swayByKey.set(k, v); this.resolveSway(); }
  swayOf(spriteId: number): Float32Array | undefined { return this.swayById[spriteId]; }
  private resolveSway(): void {
    this.swayById = [];
    if (!this.registry) return;
    for (const [k, v] of this.swayByKey) { const id = this.registry.ids.sprites.tryId(k); if (id !== undefined) this.swayById[id] = new Float32Array([v.amp, v.freq, v.stiffness]); }
  }

  constructor(private gl: WebGL2RenderingContext, private assets: AssetManager, opts: { layerSize?: number; imageLoader?: (url: string) => Promise<ImageLike> } = {}) {
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.layerSize = Math.min(opts.layerSize ?? 2048, max);
    assets.registerLoader<ImageLike>(AtlasManager.IMAGE_KIND, opts.imageLoader ?? defaultImageLoader);
  }

  get stats(): AtlasStats { return { layers: this.layers, layerSize: this.layerSize, atlases: this.atlases.length, frames: this.totalFrames, sprites: this.sprites.filter(Boolean).length, version: this.version }; }

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
    const list: AtlasRT[] = [];
    await Promise.all([...registry.atlases.values()].map(async (a) => {
      const src = sources.get(a.key); if (!src) throw new Error(`no image source for atlas "${a.key}"`);
      const [img, emis] = await Promise.all([load(src.url), loadOpt(src.emissiveUrl)]);
      list.push({ key: a.key, id: a.id, source: src, img, emis, base: 0, count: src.rects ? src.rects.length : a.columns * a.rows, fw: a.frameW, fh: a.frameH, cols: a.columns, layer: 0, px: 0, py: 0 });
    }));
    list.sort((a, b) => a.id - b.id);
    this.pack(list);
    this.upload(list);
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
    this.atlases = list; this.atlasById = new Map(list.map((a) => [a.id, a])); this.sprites = sprites; this.registry = registry; this.resolveSway();
    this.held = held; this.version++;
    for (const [k, u] of prevHeld) this.assets.release(k, u);
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

  private upload(list: AtlasRT[]): void {
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
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this.tex = mk();
    for (const a of list) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, a.px, a.py, a.layer, a.img!.width, a.img!.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, a.img as TexImageSource);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    this.emisTex = mk();
    this.hasEmissive = list.some((a) => a.emis);
    for (const a of list) if (a.emis) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, a.px, a.py, a.layer, a.emis.width, a.emis.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, a.emis as TexImageSource);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    // frame table
    const n = Math.max(1, this.totalFrames); const rows = Math.ceil(n / TABLE_W);
    const data = new Float32Array(TABLE_W * 2 * rows * 4);
    for (const a of list) for (let f = 0; f < a.count; f++) {
      const r = a.source.rects?.[f];
      const x = r ? r.x : (f % a.cols) * a.fw, y = r ? r.y : Math.floor(f / a.cols) * a.fh;
      const w = r ? r.w : a.fw, h = r ? r.h : a.fh;
      const o = (a.base + f) * 8;
      data[o] = (a.px + x) / S; data[o + 1] = (a.py + y) / S; data[o + 2] = (a.px + x + w) / S; data[o + 3] = (a.py + y + h) / S;
      data[o + 4] = w; data[o + 5] = h; data[o + 6] = a.layer; data[o + 7] = a.emis ? 1 : 0;
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
    this.fill(a, f, s, out);
    return true;
  }

  /** Resolve a build-piece frame: variant within idle frames, rotation as direction, damage stage frames if present. */
  resolvePiece(spriteId: number, variant: number, rotation: number, damage: number, out: ResolvedFrame): boolean {
    const s = this.sprites[spriteId]; if (!s) return false;
    const a = this.atlases[s.atlasIdx]!;
    if (s.building) {
      const rows = s.building.frames; const row = rows[rows.length === 1 ? 0 : rotation & 3] ?? rows[0]!;
      const f = row[Math.max(0, Math.min(row.length - 1, damage | 0))]!;
      this.fill(a, f, s, out); out.hasDamageFrames = row.length > 1; return true;
    }
    const an = s.anims[0]; if (!an) return false;
    let f = damage > 0 && s.damage[damage] !== undefined ? s.damage[damage]! : an.frames[variant % an.frames.length]!;
    if (an.directions > 1) f += AssetRegistry.directionIndex((rotation & 3) * (Math.PI / 2), an.directions) * an.dirStride;
    this.fill(a, f, s, out);
    out.hasDamageFrames = damage > 0 && s.damage[damage] !== undefined;
    return true;
  }

  /** Footprint/layer of a building sprite (null for non-building sprites). Rotation 1/3 swaps w/h. */
  pieceInfo(spriteId: number): { fw: number; fh: number; layer: number } | null { const b = this.sprites[spriteId]?.building; return b ? { fw: b.fw, fh: b.fh, layer: b.layer } : null; }

  stateAnim(spriteId: number, state: number): number { const s = this.sprites[spriteId]; return s ? s.stateAnim[Math.min(state, STATE_ANIMS.length - 1)] ?? 0 : 0; }

  private fill(a: AtlasRT, f: number, s: SpriteRT, out: ResolvedFrame): void {
    const fi = Math.min(Math.max(0, f), a.count - 1);
    const r = a.source.rects?.[fi];
    out.entry = a.base + fi;
    if (r) { out.w = r.w; out.h = r.h; out.ax = r.ax; out.ay = r.ay; }
    else { out.w = a.fw; out.h = a.fh; out.ax = s.anchorX * a.fw; out.ay = s.anchorY * a.fh; }
    out.hasDamageFrames = false;
  }

  /** For galleries/tools: every atlas with its frame count and loaded image. */
  listAtlases(): { key: string; id: number; count: number; image: ImageLike | null; emissive: ImageLike | null; rects?: RectTable; fw: number; fh: number; cols: number }[] {
    return this.atlases.map((a) => ({ key: a.key, id: a.id, count: a.count, image: a.img, emissive: a.emis, ...(a.source.rects ? { rects: a.source.rects } : {}), fw: a.fw, fh: a.fh, cols: a.cols }));
  }

  dispose(): void {
    for (const [k, u] of this.held) this.assets.release(k, u);
    this.held = [];
    const gl = this.gl; if (this.tex) gl.deleteTexture(this.tex); if (this.emisTex) gl.deleteTexture(this.emisTex); if (this.frameTex) gl.deleteTexture(this.frameTex);
  }
}

export interface ResolvedFrame { entry: number; w: number; h: number; ax: number; ay: number; hasDamageFrames: boolean }
export const newResolved = (): ResolvedFrame => ({ entry: 0, w: 0, h: 0, ax: 0, ay: 0, hasDamageFrames: false });
