import { fnv1a, StableIdRegistry, type World } from "@engine/core";

export const MANIFEST_VERSION = 1;
export const CATEGORIES = ["character", "zombie", "item", "equipment", "resource", "building", "tile", "ui", "vfx"] as const;
export type Category = (typeof CATEGORIES)[number];
export const SOUND_CATEGORIES = ["sfx", "ambience", "ui"] as const;
export type SoundCategory = (typeof SOUND_CATEGORIES)[number];
export const BLEND_MODES = ["normal", "additive", "multiply"] as const;
export type BlendMode = (typeof BLEND_MODES)[number];
/** Iso facings: 1 (none), 4 (NE,SE,SW,NW) or 8 (E,SE,S,SW,W,NW,N,NE). */
export type Directions = 1 | 4 | 8;
/** Id namespaces, each with its own StableIdRegistry and lock section. */
export const ID_KINDS = ["sprites", "sounds", "vfx", "variants", "tints", "palettes"] as const;
export type IdKind = (typeof ID_KINDS)[number];
export type IdLock = Partial<Record<IdKind, Record<string, number>>>;

// ---------- JSON shapes ----------
export interface NineSlice { l: number; t: number; r: number; b: number }
export interface AtlasJson {
  key: string; image: string; frameW: number; frameH: number; columns: number; rows: number;
  /** An emissive page `<image base>_emissive.<ext>` with the same layout exists. */
  emissive?: boolean;
  /** UI atlases: nine-slice insets (pixels) per frame index. */
  nineSlice?: Record<string, NineSlice>;
}
export interface AnimationJson { frames: number[]; fps: number; directions?: Directions; /** frame offset per direction row (default: atlas columns) */ dirStride?: number; loop?: boolean }
export interface BuildingSpriteJson {
  /** BuildPieceDef key (cross-checked with validateBuildingSprites). */
  piece: string; footprint: { w: number; h: number }; layer: number;
  /** frames[rotation][damageStage]: 1 or 4 rotations (0-3), exactly 4 damage stages (0 = intact .. 3 = wrecked). */
  frames: number[][];
}
export interface SpriteJson {
  key: string; category: Category; atlas: string;
  /** Pivot in [0,1] of the frame; feet for characters (default 0.5, 0.9). */
  anchor?: { x: number; y: number };
  animations: Record<string, AnimationJson>;
  building?: BuildingSpriteJson;
}
export interface SoundJson { key: string; files: string[]; volume?: number; pitchJitter?: number; loop?: boolean; category: SoundCategory }
export interface ParticleJson { rate: number; count: number; speed: [number, number]; spread: number; gravity: number; fade: boolean; scaleCurve: number[] }
export interface VfxJson { key: string; sprite: string; anim?: string; lifetime: number; blend?: BlendMode; particles?: ParticleJson }
export interface TintSetJson { key: string; tints: string[] }
export interface PaletteJson { key: string; source: string[]; target: string[] }
export interface VariantJson { key: string; sprite?: string; tint?: string; tintIndex?: number; palette?: string }
export interface VariantSetJson { key: string; base: string; variants: VariantJson[] }
export interface ManifestJson {
  version: number; name?: string; atlases: AtlasJson[]; sprites: SpriteJson[];
  sounds?: SoundJson[]; vfx?: VfxJson[]; tintSets?: TintSetJson[]; palettes?: PaletteJson[]; variantSets?: VariantSetJson[];
}

// ---------- resolved ----------
export interface Atlas extends Omit<AtlasJson, "emissive" | "nineSlice"> { id: number; emissiveImage?: string; nineSlice: Map<number, NineSlice> }
export interface Animation { id: number; name: string; frames: number[]; fps: number; directions: Directions; dirStride: number; loop: boolean }
export interface BuildingSprite { piece: string; footprint: { w: number; h: number }; layer: number; frames: number[][] }
export interface SpriteDef { id: number; key: string; category: Category; atlas: Atlas; anchor: { x: number; y: number }; animations: Map<string, Animation>; animList: Animation[]; building?: BuildingSprite }
export interface FrameRef { atlas: Atlas; frame: number; x: number; y: number; w: number; h: number; anchorX: number; anchorY: number; emissiveImage?: string; nineSlice?: NineSlice }
export interface SoundDef { id: number; key: string; files: string[]; volume: number; pitchJitter: number; loop: boolean; category: SoundCategory }
export interface VfxDef { id: number; key: string; sprite: number; anim: string; lifetime: number; blend: BlendMode; particles?: ParticleJson }
/** Colors are packed 0xRRGGBB. */
export interface TintSet { id: number; key: string; tints: number[] }
export interface Palette { id: number; key: string; map: Map<number, number>; source: number[]; target: number[] }
export interface Variant { id: number; key: string; set: string; sprite: number; tint?: number; palette?: number }

export class ManifestError extends Error { constructor(readonly issues: string[]) { super(`Asset manifest invalid:\n${issues.join("\n")}`); } }

const HEX = /^#[0-9a-fA-F]{6}$/;
export const parseColor = (s: string): number => parseInt(s.slice(1), 16);
export const emissivePath = (image: string): string => image.replace(/(\.[a-z]+)$/, "_emissive$1");

/** Registry of all asset kinds with stable numeric ids (u16) per kind. */
export class AssetRegistry {
  constructor(
    readonly atlases: Map<string, Atlas>, private sprites: Map<number, SpriteDef>, readonly ids: Record<IdKind, StableIdRegistry>,
    readonly sounds = new Map<number, SoundDef>(), readonly vfx = new Map<number, VfxDef>(), readonly tintSets = new Map<number, TintSet>(),
    readonly palettes = new Map<number, Palette>(), readonly variants = new Map<number, Variant>(),
  ) {}
  /** Combined hash over every id namespace (for the handshake). */
  get hash(): number { let h = 0x811c9dc5; for (const k of ID_KINDS) h = fnv1a(`${k}:${this.ids[k].hash};`, h); return h; }
  get size(): number { return this.sprites.size; }
  id(key: string): number { return this.ids.sprites.id(key); }
  sprite(id: number): SpriteDef { const s = this.sprites.get(id); if (!s) throw new Error(`unknown sprite ${id}`); return s; }
  byKey(key: string): SpriteDef { return this.sprite(this.ids.sprites.id(key)); }
  byCategory(c: Category): SpriteDef[] { return [...this.sprites.values()].filter((s) => s.category === c); }
  allSprites(): IterableIterator<SpriteDef> { return this.sprites.values(); }
  sound(key: string): SoundDef { return this.sounds.get(this.ids.sounds.id(key))!; }
  effect(key: string): VfxDef { return this.vfx.get(this.ids.vfx.id(key))!; }
  tintSet(key: string): TintSet { return this.tintSets.get(this.ids.tints.id(key))!; }
  palette(key: string): Palette { return this.palettes.get(this.ids.palettes.id(key))!; }
  variant(key: string): Variant { return this.variants.get(this.ids.variants.id(key))!; }
  variantsOf(set: string): Variant[] { return [...this.variants.values()].filter((v) => v.set === set); }
  /** Direction index for a facing angle (radians, 0 = +x tile axis) quantized to the animation's directions. */
  static directionIndex(facing: number, directions: Directions): number {
    if (directions === 1) return 0; const a = ((facing % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return Math.round(a / ((2 * Math.PI) / directions)) % directions;
  }
  private ref(s: SpriteDef, f: number): FrameRef {
    const at = s.atlas; const ns = at.nineSlice.get(f);
    return { atlas: at, frame: f, x: (f % at.columns) * at.frameW, y: Math.floor(f / at.columns) * at.frameH, w: at.frameW, h: at.frameH,
      anchorX: s.anchor.x * at.frameW, anchorY: s.anchor.y * at.frameH, ...(at.emissiveImage ? { emissiveImage: at.emissiveImage } : {}), ...(ns ? { nineSlice: ns } : {}) };
  }
  /** Resolve the atlas rect for sprite/animation/facing at time t (seconds). */
  frame(spriteId: number, anim: string, facing: number, timeSec: number): FrameRef {
    const s = this.sprite(spriteId); const a = s.animations.get(anim) ?? s.animList[0]!;
    const n = a.frames.length; let i = Math.floor(timeSec * a.fps); i = a.loop ? i % n : Math.min(i, n - 1);
    return this.ref(s, a.frames[i]! + AssetRegistry.directionIndex(facing, a.directions) * a.dirStride);
  }
  /** Building piece frame by rotation (0-3) and damage stage (0-3). Single-rotation sprites reuse rotation 0. */
  buildingFrame(spriteId: number, rotation: number, damageStage: number): FrameRef {
    const s = this.sprite(spriteId); if (!s.building) throw new Error(`${s.key} is not a building sprite`);
    const rows = s.building.frames; const row = rows[rows.length === 1 ? 0 : rotation & 3]!;
    return this.ref(s, row[Math.max(0, Math.min(3, damageStage | 0))]!);
  }
}

/** Minimal BuildPieceDef view (from @engine/world BuildPieceRegistry) for cross-checking. */
export interface PieceLookup { byKey(key: string): { footprint: { w: number; h: number }; layer: number } }
/** Cross-checks building sprites against BuildPieceDefs: piece exists, footprint and layer match. Returns issues. */
export function validateBuildingSprites(reg: AssetRegistry, pieces: PieceLookup): string[] {
  const issues: string[] = [];
  for (const s of reg.allSprites()) {
    if (!s.building) continue; let d;
    try { d = pieces.byKey(s.building.piece); } catch { issues.push(`${s.key}: unknown build piece "${s.building.piece}"`); continue; }
    if (d.footprint.w !== s.building.footprint.w || d.footprint.h !== s.building.footprint.h) issues.push(`${s.key}: footprint ${s.building.footprint.w}x${s.building.footprint.h} != piece ${d.footprint.w}x${d.footprint.h}`);
    if (d.layer !== s.building.layer) issues.push(`${s.key}: layer ${s.building.layer} != piece layer ${d.layer}`);
  }
  return issues;
}

/** Validate + build a registry. Throws ManifestError listing every issue. Returns the updated (namespaced) id lock. */
export function loadManifest(json: unknown, opts: { lock?: IdLock | Record<string, number> } = {}): { registry: AssetRegistry; lock: Required<IdLock> } {
  const issues: string[] = []; const m = json as ManifestJson;
  if (!m || typeof m !== "object") throw new ManifestError(["manifest is not an object"]);
  if (m.version !== MANIFEST_VERSION) issues.push(`version must be ${MANIFEST_VERSION}`);
  if (!Array.isArray(m.atlases)) issues.push("atlases must be an array");
  if (!Array.isArray(m.sprites)) issues.push("sprites must be an array");
  for (const k of ["sounds", "vfx", "tintSets", "palettes", "variantSets"] as const) if (m[k] !== undefined && !Array.isArray(m[k])) issues.push(`${k} must be an array`);
  if (issues.length) throw new ManifestError(issues);
  const KEY = /^[a-z0-9_]+$/;
  const uniq = (list: { key: string }[], what: string) => { const seen = new Set<string>(); list.forEach((x, i) => {
    if (!KEY.test(x.key ?? "")) issues.push(`${what}[${i}](${x.key}): bad key`);
    if (seen.has(x.key)) issues.push(`${what}[${i}](${x.key}): duplicate key`); seen.add(x.key); }); return seen; };

  // atlases
  const atlases = new Map<string, Atlas>(); uniq(m.atlases, "atlases");
  m.atlases.forEach((a, i) => {
    const p = `atlases[${i}](${a.key})`;
    if (!a.image || !/\.(png|webp)$/.test(a.image)) issues.push(`${p}: image must be .png/.webp`);
    for (const f of ["frameW", "frameH", "columns", "rows"] as const) if (!(Number.isInteger(a[f]) && a[f] > 0)) issues.push(`${p}: ${f} must be a positive integer`);
    const nine = new Map<number, NineSlice>();
    for (const [fs, n] of Object.entries(a.nineSlice ?? {})) {
      const f = Number(fs);
      if (!(Number.isInteger(f) && f >= 0 && f < a.columns * a.rows)) issues.push(`${p}: nineSlice frame ${fs} out of range`);
      if (![n.l, n.t, n.r, n.b].every((v) => Number.isInteger(v) && v >= 0) || n.l + n.r >= a.frameW || n.t + n.b >= a.frameH) issues.push(`${p}: nineSlice ${fs} insets invalid`);
      nine.set(f, n);
    }
    const { emissive, nineSlice: _n, ...rest } = a;
    atlases.set(a.key, { ...rest, id: atlases.size + 1, nineSlice: nine, ...(emissive ? { emissiveImage: emissivePath(a.image) } : {}) });
  });

  // sprites
  const spriteKeys = uniq(m.sprites, "sprites");
  m.sprites.forEach((s, i) => {
    const p = `sprites[${i}](${s.key})`;
    if (!CATEGORIES.includes(s.category)) issues.push(`${p}: unknown category "${s.category}"`);
    const at = atlases.get(s.atlas); if (!at) issues.push(`${p}: unknown atlas "${s.atlas}"`);
    const total = at ? at.columns * at.rows : 0;
    if (s.anchor && !(s.anchor.x >= 0 && s.anchor.x <= 1 && s.anchor.y >= 0 && s.anchor.y <= 1)) issues.push(`${p}: anchor must be within [0,1]`);
    const anims = Object.entries(s.animations ?? {}); if (!anims.length) issues.push(`${p}: needs at least one animation`);
    for (const [name, a] of anims) {
      const q = `${p}.${name}`; const dirs = a.directions ?? 1;
      if (![1, 4, 8].includes(dirs)) issues.push(`${q}: directions must be 1, 4 or 8`);
      if (!(a.fps > 0)) issues.push(`${q}: fps must be > 0`);
      if (!Array.isArray(a.frames) || !a.frames.length) issues.push(`${q}: frames required`);
      else if (at) {
        const stride = a.dirStride ?? at.columns;
        for (const f of a.frames) if (!(Number.isInteger(f) && f >= 0 && f + (dirs - 1) * stride < total)) issues.push(`${q}: frame ${f} out of atlas range`);
      }
    }
    if (s.building) {
      const b = s.building; const q = `${p}.building`;
      if (s.category !== "building") issues.push(`${q}: only building sprites may have building data`);
      if (!b.piece) issues.push(`${q}: piece required`);
      if (!(Number.isInteger(b.footprint?.w) && b.footprint.w >= 1 && Number.isInteger(b.footprint?.h) && b.footprint.h >= 1)) issues.push(`${q}: bad footprint`);
      if (!(Number.isInteger(b.layer) && b.layer >= 0 && b.layer <= 3)) issues.push(`${q}: layer must be 0-3`);
      if (!Array.isArray(b.frames) || ![1, 4].includes(b.frames.length)) issues.push(`${q}: frames must have 1 or 4 rotations`);
      else b.frames.forEach((row, r) => {
        if (!Array.isArray(row) || row.length !== 4) issues.push(`${q}: rotation ${r} needs 4 damage stages`);
        else if (at) for (const f of row) if (!(Number.isInteger(f) && f >= 0 && f < total)) issues.push(`${q}: frame ${f} out of atlas range`);
      });
    }
  });

  // sounds
  const sounds = m.sounds ?? []; uniq(sounds, "sounds");
  sounds.forEach((s, i) => {
    const p = `sounds[${i}](${s.key})`;
    if (!Array.isArray(s.files) || !s.files.length) issues.push(`${p}: files must list at least one variant`);
    else for (const f of s.files) if (!/\.(ogg|mp3|wav|webm)$/.test(f)) issues.push(`${p}: unsupported audio file ${f}`);
    if (s.volume !== undefined && !(s.volume >= 0 && s.volume <= 1)) issues.push(`${p}: volume must be within [0,1]`);
    if (s.pitchJitter !== undefined && !(s.pitchJitter >= 0 && s.pitchJitter <= 1)) issues.push(`${p}: pitchJitter must be within [0,1]`);
    if (!SOUND_CATEGORIES.includes(s.category)) issues.push(`${p}: category must be sfx|ambience|ui`);
  });

  // vfx
  const vfx = m.vfx ?? []; uniq(vfx, "vfx");
  vfx.forEach((v, i) => {
    const p = `vfx[${i}](${v.key})`;
    const sp = m.sprites.find((s) => s.key === v.sprite);
    if (!sp) issues.push(`${p}: unknown sprite "${v.sprite}"`);
    else if (v.anim !== undefined && !(v.anim in (sp.animations ?? {}))) issues.push(`${p}: sprite ${v.sprite} has no animation "${v.anim}"`);
    if (!(v.lifetime > 0)) issues.push(`${p}: lifetime must be > 0`);
    if (v.blend !== undefined && !BLEND_MODES.includes(v.blend)) issues.push(`${p}: blend must be normal|additive|multiply`);
    const pt = v.particles;
    if (pt) {
      if (!(pt.rate >= 0) || !(Number.isInteger(pt.count) && pt.count >= 0) || pt.rate + pt.count <= 0) issues.push(`${p}: particles need rate >= 0, integer count >= 0, and one of them > 0`);
      if (!Array.isArray(pt.speed) || pt.speed.length !== 2 || !(pt.speed[0] >= 0 && pt.speed[1] >= pt.speed[0])) issues.push(`${p}: speed must be [min,max] with 0 <= min <= max`);
      if (!(pt.spread >= 0 && pt.spread <= 2 * Math.PI)) issues.push(`${p}: spread must be within [0, 2π]`);
      if (typeof pt.gravity !== "number" || !Number.isFinite(pt.gravity)) issues.push(`${p}: gravity must be a number`);
      if (typeof pt.fade !== "boolean") issues.push(`${p}: fade must be boolean`);
      if (!Array.isArray(pt.scaleCurve) || !pt.scaleCurve.length || !pt.scaleCurve.every((x) => x >= 0)) issues.push(`${p}: scaleCurve must be non-empty, values >= 0`);
    }
  });

  // tints / palettes / variants
  const tints = m.tintSets ?? []; const tintKeys = uniq(tints, "tintSets");
  tints.forEach((t, i) => { if (!Array.isArray(t.tints) || !t.tints.length || !t.tints.every((c) => HEX.test(c))) issues.push(`tintSets[${i}](${t.key}): tints must be non-empty #rrggbb list`); });
  const pals = m.palettes ?? []; const palKeys = uniq(pals, "palettes");
  pals.forEach((pl, i) => {
    const p = `palettes[${i}](${pl.key})`;
    if (!Array.isArray(pl.source) || !Array.isArray(pl.target) || pl.source.length !== pl.target.length || !pl.source.length) issues.push(`${p}: source and target must be equal-length, non-empty`);
    else { if (![...pl.source, ...pl.target].every((c) => HEX.test(c))) issues.push(`${p}: colors must be #rrggbb`); if (new Set(pl.source.map((c) => c.toLowerCase())).size !== pl.source.length) issues.push(`${p}: duplicate source color`); }
  });
  const sets = m.variantSets ?? []; uniq(sets, "variantSets");
  const variantKeys: string[] = [];
  sets.forEach((vs, i) => {
    const p = `variantSets[${i}](${vs.key})`; const base = m.sprites.find((s) => s.key === vs.base);
    if (!base) issues.push(`${p}: unknown base sprite "${vs.base}"`);
    else if (base.category !== "character" && base.category !== "zombie") issues.push(`${p}: base must be a character or zombie sprite`);
    if (!Array.isArray(vs.variants) || !vs.variants.length) issues.push(`${p}: needs variants`);
    for (const v of vs.variants ?? []) {
      const q = `${p}.${v.key}`;
      if (!KEY.test(v.key ?? "")) issues.push(`${q}: bad key`);
      if (variantKeys.includes(v.key)) issues.push(`${q}: duplicate variant key`); variantKeys.push(v.key);
      if (v.sprite !== undefined && !spriteKeys.has(v.sprite)) issues.push(`${q}: unknown sprite "${v.sprite}"`);
      if (v.tint !== undefined) {
        if (!tintKeys.has(v.tint)) issues.push(`${q}: unknown tint set "${v.tint}"`);
        else { const n = tints.find((t) => t.key === v.tint)!.tints.length; if (!(Number.isInteger(v.tintIndex ?? 0) && (v.tintIndex ?? 0) >= 0 && (v.tintIndex ?? 0) < n)) issues.push(`${q}: tintIndex out of range`); }
      }
      if (v.palette !== undefined && !palKeys.has(v.palette)) issues.push(`${q}: unknown palette "${v.palette}"`);
    }
  });
  if (issues.length) throw new ManifestError(issues);

  // ids
  const rawLock = (opts.lock ?? {}) as Record<string, unknown>;
  const nsLock: IdLock = ID_KINDS.some((k) => typeof rawLock[k] === "object") ? (rawLock as IdLock) : { sprites: rawLock as Record<string, number> };
  const ids = Object.fromEntries(ID_KINDS.map((k) => [k, new StableIdRegistry(k)])) as Record<IdKind, StableIdRegistry>;
  const lock = {} as Required<IdLock>;
  const keysOf: Record<IdKind, string[]> = { sprites: m.sprites.map((s) => s.key), sounds: sounds.map((s) => s.key), vfx: vfx.map((v) => v.key), variants: variantKeys, tints: tints.map((t) => t.key), palettes: pals.map((p) => p.key) };
  for (const k of ID_KINDS) lock[k] = ids[k].assign(keysOf[k], nsLock[k] ?? {});

  const sprites = new Map<number, SpriteDef>();
  for (const s of m.sprites) {
    const at = atlases.get(s.atlas)!; const animList: Animation[] = [];
    Object.entries(s.animations).forEach(([name, a], i) => animList.push({ id: i, name, frames: a.frames, fps: a.fps, directions: a.directions ?? 1, dirStride: a.dirStride ?? at.columns, loop: a.loop ?? true }));
    const id = ids.sprites.id(s.key);
    sprites.set(id, { id, key: s.key, category: s.category, atlas: at, anchor: s.anchor ?? { x: 0.5, y: 0.9 }, animations: new Map(animList.map((a) => [a.name, a])), animList,
      ...(s.building ? { building: { piece: s.building.piece, footprint: { ...s.building.footprint }, layer: s.building.layer, frames: s.building.frames.map((r) => [...r]) } } : {}) });
  }
  const soundMap = new Map<number, SoundDef>(sounds.map((s) => { const id = ids.sounds.id(s.key); return [id, { id, key: s.key, files: [...s.files], volume: s.volume ?? 1, pitchJitter: s.pitchJitter ?? 0, loop: s.loop ?? false, category: s.category }]; }));
  const vfxMap = new Map<number, VfxDef>(vfx.map((v) => { const id = ids.vfx.id(v.key); const sp = m.sprites.find((s) => s.key === v.sprite)!;
    return [id, { id, key: v.key, sprite: ids.sprites.id(v.sprite), anim: v.anim ?? Object.keys(sp.animations)[0]!, lifetime: v.lifetime, blend: v.blend ?? "normal", ...(v.particles ? { particles: v.particles } : {}) }]; }));
  const tintMap = new Map<number, TintSet>(tints.map((t) => { const id = ids.tints.id(t.key); return [id, { id, key: t.key, tints: t.tints.map(parseColor) }]; }));
  const palMap = new Map<number, Palette>(pals.map((p) => { const id = ids.palettes.id(p.key); const source = p.source.map(parseColor), target = p.target.map(parseColor);
    return [id, { id, key: p.key, source, target, map: new Map(source.map((c, i) => [c, target[i]!])) }]; }));
  const varMap = new Map<number, Variant>();
  for (const vs of sets) for (const v of vs.variants) {
    const id = ids.variants.id(v.key);
    varMap.set(id, { id, key: v.key, set: vs.key, sprite: ids.sprites.id(v.sprite ?? vs.base),
      ...(v.tint !== undefined ? { tint: tintMap.get(ids.tints.id(v.tint))!.tints[v.tintIndex ?? 0]! } : {}),
      ...(v.palette !== undefined ? { palette: ids.palettes.id(v.palette) } : {}) });
  }
  return { registry: new AssetRegistry(atlases, sprites, ids, soundMap, vfxMap, tintMap, palMap, varMap), lock };
}

/** Mix the asset id hash into the world schema hash so client/server handshakes reject mismatched content. */
export function installAssetHash(world: World, reg: AssetRegistry): void { world.addSchemaSalt("assets", reg.hash); }

/** Browser/Node fetch-based loader: manifest + optional lock (ids.lock.json next to it). */
export async function fetchManifest(url: string, fetcher: (u: string) => Promise<{ ok: boolean; json(): Promise<unknown> }> = fetch): Promise<ReturnType<typeof loadManifest>> {
  const res = await fetcher(url); if (!res.ok) throw new Error(`manifest fetch failed: ${url}`);
  const lockUrl = url.replace(/[^/]+$/, "ids.lock.json"); let lock: IdLock | undefined;
  try { const l = await fetcher(lockUrl); if (l.ok) lock = (await l.json()) as IdLock; } catch { /* optional */ }
  return loadManifest(await res.json(), lock ? { lock } : {});
}
