import { loadCosmetics, type CosmeticCatalog, type CosmeticsJson } from "./cosmetics.js";
import { fnv1a, StableIdRegistry, type World } from "@engine/core";

export const MANIFEST_VERSION = 1;
export const CATEGORIES = ["character", "zombie", "item", "equipment", "resource", "building", "tile", "ui", "vfx"] as const;
/** Optional categories: accepted by validation but not required to be present (e.g. by "covers every category" checks). */
/** decal: ground overlays (territory edges, puddles) with optional autotile neighbor rules (ADR-078). */
export const OPTIONAL_CATEGORIES = ["critter", "glyph", "decal"] as const;
export const ALL_CATEGORIES = [...CATEGORIES, ...OPTIONAL_CATEGORIES] as const;
export type Category = (typeof ALL_CATEGORIES)[number];
export const ROTATION_ART = ["mirror", "unique4"] as const;
/** mirror: 1 row (symmetric), 2 rows (rotations 2/3 = rows 0/1 flipped on X) or 4 drawn rows; unique4: 4 rows required. */
export type RotationArt = (typeof ROTATION_ART)[number];
export interface SwayJson { /** px at frame top */ amp: number; /** Hz */ freq: number; /** 0..1, higher = stiffer */ stiffness: number; /** optional sway weight mask page (overrides the atlas sway mask) */ mask?: string }
export interface LoopPoints { /** seconds */ start: number; /** seconds (> start) */ end: number }
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
  /** Extra resolution variants of `image` (same grid, pixel sizes × scale). `image` is the scale-1 page. */
  pages?: AtlasPageJson[];
  /** Same-layout mask pages (sampled by UV, so they work with every scale page). `emissive: true` = derived `<image>_emissive.<ext>`. */
  masks?: AtlasMasksJson;
}
export interface AtlasPageJson { scale: number; image: string }
export const MASK_KINDS = ["emissive", "sheen", "sway", "tintmask"] as const;
export type MaskKind = (typeof MASK_KINDS)[number];
export type AtlasMasksJson = { emissive?: string | true; sheen?: string; sway?: string; tintmask?: string };
export const TINT_MODES = ["multiply", "add", "screen", "lerp"] as const;
export type TintMode = (typeof TINT_MODES)[number];
/** Per-sprite status tint (wet, frost, exhausted, flush...): gameplay/render pick by name and scale strength at runtime. */
/** saturation (default 1) is applied before the color mode (0 = grayscale, >1 = boost). */
export interface SpriteTintJson { color: string; strength: number; mode?: TintMode; saturation?: number }
/** Input prompt glyph: id like "gamepad.xbox.a", "kbm.key.e", "touch.tap" -> sprite (+ optional frame index within its idle animation). */
export interface GlyphJson { sprite: string; frame?: number }
export const GLYPH_ID = /^(kbm|gamepad|touch)(\.[a-z0-9_]+)+$/;
export interface AnimationJson { frames: number[]; fps: number; directions?: Directions; /** frame offset per direction row (default: atlas columns) */ dirStride?: number; loop?: boolean;
  /** Optional per-rotation frame rows for building anims: 1, 2 (rotations 2/3 = rows 0/1 mirrored) or 4 rows, each the same length as frames. Replaces the `<anim>_r1` naming hack (still honored as fallback). */
  rotations?: number[][] }
/** Building state -> vfx spawned at a named attach point (e.g. burning: fire/ember/smoke). */
export interface StateVfxJson { vfx: string; attach: string }
export const STRETCH_MODES = ["none", "velocity"] as const;
export type StretchMode = (typeof STRETCH_MODES)[number];
/** Decal autotile: first rule whose (neighbors & care) === (mask & care) wins; a rule with care 0 is the required fallback. Bits: N=1,E=2,S=4,W=8 (+ NE=16,SE=32,SW=64,NW=128 when neighbors = 8). Neighbors count when they share `group` (default: same sprite). */
export interface AutotileJson { neighbors: 4 | 8; group?: string; rules: { mask: number; care?: number; frame: number }[] }
/** Clan palette pair: tintmask R channel <- primary, G <- secondary. BuildPiece.tint (u8): 0 = none, 1..N = clanPalettes[tint-1] (clanPaletteForTint). */
export interface ClanPaletteJson { key: string; primary: string; secondary: string }
export interface BuildingSpriteJson {
  /** BuildPieceDef key (cross-checked with validateBuildingSprites). */
  piece: string; footprint: { w: number; h: number }; layer: number;
  /** frames[rotation][damageStage]: 1 or 4 rotations (0-3), exactly 4 damage stages (0 = intact .. 3 = wrecked). */
  frames: number[][];
  /** Optional piece states (e.g. closed/open), each with its own frames[rotation][damageStage]. State index = declaration order (BuildingGrid state u8). */
  states?: Record<string, number[][]>;
  /** Fallback crack overlay sprite (anims stage1..stage3, drawn over damage stages 1-3) for pieces without bespoke damage frames. */
  crackOverlay?: string;
  /** State name (a building state or a gameplay status like "burning") -> vfx at attach points of this sprite. */
  stateVfx?: Record<string, StateVfxJson[]>;
}
/** Named attach point (stall display slots, price tags, name labels, vfx sockets): px offsets from the pivot at 1x scale; x is mirrored when flipX. Optional w/h = slot box. */
export interface AttachPoint { x: number; y: number; z?: number; w?: number; h?: number }
export type AttachMap = Record<string, AttachPoint>;
export interface SpriteJson {
  /** Sprite-level attach points (see AttachPoint). */
  attach?: AttachMap;
  /** Per-frame attach overrides keyed by atlas frame index; frame keys override sprite keys. */
  frameAttach?: Record<string, AttachMap>;
  key: string; category: Category; atlas: string;
  /** Pivot in [0,1] of the frame; feet for characters (default 0.5, 0.9). */
  anchor?: { x: number; y: number };
  animations: Record<string, AnimationJson>;
  building?: BuildingSpriteJson;
  rotationArt?: RotationArt;
  sway?: SwayJson;
  tints?: Record<string, SpriteTintJson>;
  /** decal sprites only. */
  autotile?: AutotileJson;
}
export interface SoundJson { key: string; files: string[]; volume?: number; pitchJitter?: number; /** true, or loop points in seconds */ loop?: boolean | LoopPoints; category: SoundCategory }
export interface ParticleJson { rate: number; count: number; speed: [number, number]; spread: number; gravity: number; fade: boolean; scaleCurve: number[] }
export interface VfxJson { key: string; sprite: string; anim?: string; lifetime: number; blend?: BlendMode; particles?: ParticleJson;
  /** velocity: stretch the sprite along its velocity (trails, projectiles); stretchMax caps the length factor (default 4). */ stretch?: StretchMode; stretchMax?: number }
export interface TintSetJson { key: string; tints: string[] }
export interface PaletteJson { key: string; source: string[]; target: string[] }
export interface VariantJson { key: string; sprite?: string; tint?: string; tintIndex?: number; palette?: string }
export interface VariantSetJson { key: string; base: string; variants: VariantJson[] }
export interface ManifestJson extends CosmeticsJson {
  version: number; name?: string; atlases: AtlasJson[]; sprites: SpriteJson[];
  sounds?: SoundJson[]; vfx?: VfxJson[]; tintSets?: TintSetJson[]; palettes?: PaletteJson[]; variantSets?: VariantSetJson[];
  /** Input prompt glyphs keyed by glyph id (see GLYPH_ID). */
  glyphs?: Record<string, GlyphJson>;
  /** Clan two-tone palettes, index = array order (u8). */
  clanPalettes?: ClanPaletteJson[];
  /** @deprecated legacy survival_fx extension; mapped onto pages/masks/sway with a warning. */
  x_survival?: { hiDpiAtlases?: Record<string, string>; emissivePages?: string[]; sheenMasks?: string[]; swayMasks?: string[]; sway?: Record<string, SwayJson>; [k: string]: unknown };
}

// ---------- resolved ----------
export interface AtlasPage { scale: number; image: string }
export type AtlasMasks = Partial<Record<MaskKind, string>>;
export interface Atlas extends Omit<AtlasJson, "emissive" | "nineSlice" | "pages" | "masks"> {
  id: number; /** = masks.emissive (kept for compatibility) */ emissiveImage?: string; nineSlice: Map<number, NineSlice>;
  /** All pages ascending by scale; pages[0] is scale 1 (= image). */ pages: AtlasPage[]; masks: AtlasMasks;
}
export interface SpriteTint { color: number; strength: number; mode: TintMode; saturation: number }
export interface GlyphDef { id: string; sprite: number; frame: number }
export interface Animation { id: number; name: string; frames: number[]; fps: number; directions: Directions; dirStride: number; loop: boolean; rotations?: number[][] }
export interface BuildingSprite { piece: string; footprint: { w: number; h: number }; layer: number; frames: number[][]; rotationArt: RotationArt; stateNames: string[]; states: number[][][];
  /** crack overlay sprite id */ crackOverlay?: number; stateVfx: Record<string, { vfx: number; attach: string }[]> }
export interface SpriteDef { id: number; key: string; category: Category; atlas: Atlas; anchor: { x: number; y: number }; animations: Map<string, Animation>; animList: Animation[]; building?: BuildingSprite; sway?: SwayJson; tints: Record<string, SpriteTint>;
  autotile?: AutotileJson;
  /** Sprite-level attach points. */ attach?: AttachMap; /** Per-frame overrides by atlas frame index. */ frameAttach?: Map<number, AttachMap> }
export interface FrameRef { atlas: Atlas; frame: number; x: number; y: number; w: number; h: number; anchorX: number; anchorY: number; emissiveImage?: string; nineSlice?: NineSlice; /** draw mirrored on X (mirror rotationArt) */ flipX?: boolean;
  /** Effective attach points: sprite attach merged with this frame's override (frame wins). Unmirrored: negate x when flipX (see attachPoint). */ attach?: AttachMap;
  /** Scale pages of the atlas (x/y/w/h above are scale-1 pixels; multiply by page.scale). */ pages: AtlasPage[]; masks: AtlasMasks }
/** A frame resolved on a concrete page. */
export interface ScaledFrame { image: string; scale: number; x: number; y: number; w: number; h: number }
export interface SoundDef { id: number; key: string; files: string[]; volume: number; pitchJitter: number; loop: boolean; loopPoints?: LoopPoints; category: SoundCategory }
export interface VfxDef { id: number; key: string; sprite: number; anim: string; lifetime: number; blend: BlendMode; particles?: ParticleJson; stretch: StretchMode; stretchMax: number }
export interface ClanPalette { index: number; key: string; primary: number; secondary: number }
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
  get hash(): number { let h = 0x811c9dc5; for (const k of ID_KINDS) h = fnv1a(`${k}:${this.ids[k].hash};`, h); if (this.cosmetics?.size) h = fnv1a(`cosmetics:${this.cosmetics.hash};`, h); return h; }
  /** Character customization catalog (manifest wearables/bodyTypes/skinTones/hairColors/clothingColors); undefined if none. */
  cosmetics: CosmeticCatalog | undefined;
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
    const at = s.atlas; const ns = at.nineSlice.get(f); const fa = s.frameAttach?.get(f);
    const attach = fa ? { ...(s.attach ?? {}), ...fa } : s.attach;
    return { atlas: at, frame: f, x: (f % at.columns) * at.frameW, y: Math.floor(f / at.columns) * at.frameH, w: at.frameW, h: at.frameH,
      anchorX: s.anchor.x * at.frameW, anchorY: s.anchor.y * at.frameH, ...(at.emissiveImage ? { emissiveImage: at.emissiveImage } : {}), ...(ns ? { nineSlice: ns } : {}), ...(attach ? { attach } : {}), pages: at.pages, masks: at.masks };
  }
  /** Resolve the atlas rect for sprite/animation/facing at time t (seconds). */
  frame(spriteId: number, anim: string, facing: number, timeSec: number): FrameRef {
    const s = this.sprite(spriteId); const a = s.animations.get(anim) ?? s.animList[0]!;
    const n = a.frames.length; let i = Math.floor(timeSec * a.fps); i = a.loop ? i % n : Math.min(i, n - 1);
    return this.ref(s, a.frames[i]! + AssetRegistry.directionIndex(facing, a.directions) * a.dirStride);
  }
  /** Building piece frame by rotation (0-3) and damage stage (0-3). Single-rotation sprites reuse rotation 0. */
  /** Frame for rotation (0-3), damage stage (0-3) and optional piece state index (out of range = default frames). */
  buildingFrame(spriteId: number, rotation: number, damageStage: number, state = -1): FrameRef {
    const s = this.sprite(spriteId); const b = s.building; if (!b) throw new Error(`${s.key} is not a building sprite`);
    const rows = (state >= 0 && b.states[state]) || b.frames; const r = rotation & 3;
    const ri = rows.length === 1 ? 0 : rows.length === 2 ? r & 1 : r;
    const ref = this.ref(s, rows[ri]![Math.max(0, Math.min(3, damageStage | 0))]!);
    return rows.length === 2 && r >= 2 ? { ...ref, flipX: true } : ref;
  }
  /** Attach point `name` of a resolved frame in pivot-relative 1x px, x mirrored when ref.flipX. */
  static attachPoint(ref: FrameRef, name: string): AttachPoint | undefined {
    const a = ref.attach?.[name]; if (!a) return undefined; return ref.flipX ? { ...a, x: -a.x } : a;
  }
  /**
   * Animation frame for a building rotation (0-3): uses anim.rotations rows when present (2 rows: rotations 2/3 mirror
   * rows 0/1 with flipX), else the legacy `<anim>_r1` anim for odd rotations, else the plain anim.
   */
  animFrame(spriteId: number, anim: string, rotation: number, timeSec: number): FrameRef {
    const s = this.sprite(spriteId); const r = rotation & 3; let a = s.animations.get(anim) ?? s.animList[0]!;
    const pick = (n: number, loop: boolean) => { let i = Math.floor(timeSec * a.fps); return loop ? i % n : Math.min(i, n - 1); };
    if (a.rotations) {
      const rows = a.rotations; const ri = rows.length === 1 ? 0 : rows.length === 2 ? r & 1 : r; const row = rows[ri]!;
      const ref = this.ref(s, row[pick(row.length, a.loop)]!); return rows.length === 2 && r >= 2 ? { ...ref, flipX: true } : ref;
    }
    let flip = false;
    if (r & 1) { const alt = s.animations.get(`${a.name}_r1`); if (alt) a = alt; }
    if (r >= 2 && s.building?.rotationArt === "mirror") flip = true;
    const ref = this.ref(s, a.frames[pick(a.frames.length, a.loop)]!); return flip ? { ...ref, flipX: true } : ref;
  }
  /** Decal frame for a neighbor bitmask (see AutotileJson); undefined if the sprite has no autotile rules. */
  decalFrame(spriteId: number, neighbors: number): FrameRef | undefined {
    const s = this.sprite(spriteId); const at = s.autotile; if (!at) return undefined;
    for (const rule of at.rules) { const care = rule.care ?? (at.neighbors === 8 ? 0xff : 0xf); if ((neighbors & care) === (rule.mask & care)) return this.ref(s, rule.frame); }
    return undefined;
  }
  /** Clan palettes by array index. BuildPiece.tint is 1-based: use clanPaletteForTint. */
  clanPalettes: ClanPalette[] = [];
  clanPalette(index: number): ClanPalette | undefined { return this.clanPalettes[index]; }
  /**
   * Clan palette for a BuildPiece.tint value (ADR-081): 0 = no clan tint, 1..N = clanPalettes[tint - 1]. Out-of-range or
   * non-integer values give undefined (no tint; never wrapped with modulo).
   */
  clanPaletteForTint(tint: number): ClanPalette | undefined {
    return Number.isInteger(tint) && tint >= 1 && tint <= this.clanPalettes.length ? this.clanPalettes[tint - 1] : undefined;
  }
  private pieceSprites?: Map<string, number>;
  /** Building sprite id for a BuildPieceDef key (sprite.building.piece; first declared wins), undefined if none. */
  spriteForPiece(pieceKey: string): number | undefined {
    if (!this.pieceSprites) { this.pieceSprites = new Map(); for (const s of this.sprites.values()) if (s.building && !this.pieceSprites.has(s.building.piece)) this.pieceSprites.set(s.building.piece, s.id); }
    return this.pieceSprites.get(pieceKey);
  }
  /** Input prompt glyphs by id (manifest `glyphs`). */
  glyphs = new Map<string, GlyphDef>();
  glyph(id: string): GlyphDef | undefined { return this.glyphs.get(id); }
  /** Frame for a glyph id (undefined if Art hasn't supplied it). */
  glyphFrame(id: string): FrameRef | undefined { const g = this.glyphs.get(id); return g ? this.ref(this.sprite(g.sprite), g.frame) : undefined; }
  /** Page for a device pixel ratio: smallest scale >= dpr, else the largest available. */
  static pickPage(atlas: Atlas, dpr = 1): AtlasPage {
    for (const p of atlas.pages) if (p.scale >= dpr - 1e-6) return p; return atlas.pages[atlas.pages.length - 1]!;
  }
  pickPage(atlas: Atlas, dpr = 1): AtlasPage { return AssetRegistry.pickPage(atlas, dpr); }
  /** Frame coordinates on the page chosen for `dpr`. */
  static scaled(ref: FrameRef, dpr = 1): ScaledFrame {
    const p = AssetRegistry.pickPage(ref.atlas, dpr); const k = p.scale;
    return { image: p.image, scale: k, x: ref.x * k, y: ref.y * k, w: ref.w * k, h: ref.h * k };
  }
  /** State index by name for a building sprite (-1 if none). */
  stateIndex(spriteId: number, name: string): number { return this.sprite(spriteId).building?.stateNames.indexOf(name) ?? -1; }
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
/** Maps the deprecated `x_survival` block onto typed fields (on a copy). Typed fields already present win. */
export function applyLegacySurvival(src: ManifestJson, warnings: string[]): ManifestJson {
  const m = structuredClone(src); const x = m.x_survival!; delete m.x_survival;
  warnings.push("x_survival is deprecated: use atlas pages/masks and sprite sway/tints (mapped automatically)");
  const stem = (path: string) => path.replace(/^.*\//, "").replace(/\.[a-z]+$/, "");
  const byKey = new Map(m.atlases.map((a) => [a.key, a]));
  for (const [k, img] of Object.entries(x.hiDpiAtlases ?? {})) {
    const a = byKey.get(k); if (!a) { warnings.push(`x_survival.hiDpiAtlases: unknown atlas "${k}"`); continue; }
    if (!(a.pages ?? []).some((pg) => pg.scale === 2)) a.pages = [...(a.pages ?? []), { scale: 2, image: img }];
  }
  const mapMasks = (list: string[] | undefined, kind: MaskKind, suffix: string) => {
    for (const path of list ?? []) {
      const base = stem(path).replace(new RegExp(`_${suffix}$`), "");
      const a = m.atlases.find((at) => (kind === "emissive" ? emissivePath(at.image) === path : stem(at.image) === base));
      if (!a) { warnings.push(`x_survival: no atlas for ${kind} mask ${path}`); continue; }
      a.masks = { ...(a.masks ?? {}) }; if (a.masks[kind] === undefined) a.masks[kind] = path;
    }
  };
  mapMasks(x.emissivePages, "emissive", "emissive"); mapMasks(x.sheenMasks, "sheen", "sheen"); mapMasks(x.swayMasks, "sway", "sway");
  for (const [k, sw] of Object.entries(x.sway ?? {})) {
    const s = m.sprites.find((sp) => sp.key === k); if (!s) { warnings.push(`x_survival.sway: unknown sprite "${k}"`); continue; }
    if (!s.sway) s.sway = { ...sw };
  }
  const known = new Set(["doc", "hiDpiAtlases", "emissivePages", "sheenMasks", "swayMasks", "sway"]);
  const rest = Object.keys(x).filter((k) => !known.has(k)); if (rest.length) warnings.push(`x_survival: not mapped (renderer-owned): ${rest.join(", ")}`);
  return m;
}

const cloneAttach = (m: AttachMap): AttachMap => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v }]));
/** Validates an attach map: names match [a-z0-9_.]+, x/y finite, z finite, w/h > 0. */
export function checkAttach(m: unknown, where: string, issues: string[]): void {
  if (m === undefined) return;
  if (!m || typeof m !== "object" || Array.isArray(m)) { issues.push(`${where} must be an object`); return; }
  const fin = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  for (const [n, a] of Object.entries(m as Record<string, AttachPoint>)) {
    if (!/^[a-z0-9_.]+$/.test(n)) issues.push(`${where}: bad attach name "${n}"`);
    if (!a || !fin(a.x) || !fin(a.y)) { issues.push(`${where}.${n}: x and y must be finite numbers`); continue; }
    if (a.z !== undefined && !fin(a.z)) issues.push(`${where}.${n}: z must be a finite number`);
    for (const k of ["w", "h"] as const) if (a[k] !== undefined && !(fin(a[k]) && a[k]! > 0)) issues.push(`${where}.${n}: ${k} must be > 0`);
  }
}

export function loadManifest(json: unknown, opts: { lock?: IdLock | Record<string, number> } = {}): { registry: AssetRegistry; lock: Required<IdLock> & { wearables?: Record<string, number> }; warnings: string[] } {
  const issues: string[] = []; let m = json as ManifestJson;
  if (!m || typeof m !== "object") throw new ManifestError(["manifest is not an object"]);
  if (m.version !== MANIFEST_VERSION) issues.push(`version must be ${MANIFEST_VERSION}`);
  if (!Array.isArray(m.atlases)) issues.push("atlases must be an array");
  if (!Array.isArray(m.sprites)) issues.push("sprites must be an array");
  for (const k of ["sounds", "vfx", "tintSets", "palettes", "variantSets"] as const) if (m[k] !== undefined && !Array.isArray(m[k])) issues.push(`${k} must be an array`);
  if (issues.length) throw new ManifestError(issues);
  const warnings: string[] = [];
  if (m.x_survival !== undefined) m = applyLegacySurvival(m, warnings);
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
    const IMG = /\.(png|webp)$/;
    const pages: AtlasPage[] = [{ scale: 1, image: a.image }];
    if (a.pages !== undefined) {
      if (!Array.isArray(a.pages)) issues.push(`${p}: pages must be an array`);
      else for (const pg of a.pages) {
        if (!(typeof pg?.scale === "number" && pg.scale > 0 && pg.scale <= 8)) { issues.push(`${p}: page scale must be in (0, 8]`); continue; }
        if (!pg.image || !IMG.test(pg.image)) issues.push(`${p}: page image must be .png/.webp`);
        if (pages.some((x) => x.scale === pg.scale)) issues.push(`${p}: duplicate page scale ${pg.scale}`); else pages.push({ scale: pg.scale, image: pg.image });
      }
      pages.sort((x, y) => x.scale - y.scale);
    }
    const masks: AtlasMasks = {};
    if (a.emissive) masks.emissive = emissivePath(a.image);
    if (a.masks !== undefined) {
      if (!a.masks || typeof a.masks !== "object") issues.push(`${p}: masks must be an object`);
      else for (const [k, v] of Object.entries(a.masks)) {
        if (!(MASK_KINDS as readonly string[]).includes(k)) { issues.push(`${p}: unknown mask "${k}" (emissive|sheen|sway|tintmask)`); continue; }
        if (k === "emissive" && v === true) { masks.emissive = emissivePath(a.image); continue; }
        if (typeof v !== "string" || !IMG.test(v)) { issues.push(`${p}: mask ${k} must be a .png/.webp path`); continue; }
        masks[k as MaskKind] = v;
      }
    }
    const { emissive: _e, nineSlice: _n, pages: _p, masks: _m, ...rest } = a;
    atlases.set(a.key, { ...rest, id: atlases.size + 1, nineSlice: nine, pages, masks, ...(masks.emissive ? { emissiveImage: masks.emissive } : {}) });
  });

  // sprites
  const spriteKeys = uniq(m.sprites, "sprites");
  m.sprites.forEach((s, i) => {
    const p = `sprites[${i}](${s.key})`;
    if (!(ALL_CATEGORIES as readonly string[]).includes(s.category)) issues.push(`${p}: unknown category "${s.category}"`);
    if (s.rotationArt !== undefined && !ROTATION_ART.includes(s.rotationArt)) issues.push(`${p}: rotationArt must be mirror|unique4`);
    if (s.rotationArt !== undefined && !s.building) issues.push(`${p}: rotationArt only applies to building sprites`);
    if (s.sway?.mask !== undefined && !(typeof s.sway.mask === "string" && /\.(png|webp)$/.test(s.sway.mask))) issues.push(`${p}: sway.mask must be a .png/.webp path`);
    if (s.tints !== undefined) {
      if (!s.tints || typeof s.tints !== "object") issues.push(`${p}: tints must be an object`);
      else for (const [n, t] of Object.entries(s.tints)) {
        if (!KEY.test(n)) issues.push(`${p}: bad tint name "${n}"`);
        if (!/^#[0-9a-fA-F]{6}$/.test(t?.color ?? "")) issues.push(`${p}: tint ${n} color must be #rrggbb`);
        if (!(typeof t?.strength === "number" && t.strength >= 0 && t.strength <= 1)) issues.push(`${p}: tint ${n} strength must be within [0,1]`);
        if (t?.mode !== undefined && !TINT_MODES.includes(t.mode)) issues.push(`${p}: tint ${n} mode must be multiply|add|screen|lerp`);
        if (t?.saturation !== undefined && !(typeof t.saturation === "number" && t.saturation >= 0 && t.saturation <= 4)) issues.push(`${p}: tint ${n} saturation must be within [0,4]`);
      }
    }
    if (s.sway !== undefined && !(s.sway && s.sway.amp >= 0 && s.sway.freq >= 0 && s.sway.stiffness >= 0 && s.sway.stiffness <= 1)) issues.push(`${p}: sway needs amp >= 0, freq >= 0, stiffness in [0,1]`);
    const at = atlases.get(s.atlas); if (!at) issues.push(`${p}: unknown atlas "${s.atlas}"`);
    checkAttach(s.attach, `${p}.attach`, issues);
    if (s.frameAttach !== undefined) {
      if (!s.frameAttach || typeof s.frameAttach !== "object") issues.push(`${p}: frameAttach must be an object`);
      else for (const [fs, am] of Object.entries(s.frameAttach)) {
        const f = Number(fs); if (!(Number.isInteger(f) && f >= 0 && (!at || f < at.columns * at.rows))) issues.push(`${p}: frameAttach frame ${fs} out of atlas range`);
        checkAttach(am, `${p}.frameAttach.${fs}`, issues);
      }
    }
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
      if (a.rotations !== undefined) {
        if (!s.building) issues.push(`${q}: rotations only apply to building sprites`);
        if (!Array.isArray(a.rotations) || ![1, 2, 4].includes(a.rotations.length)) issues.push(`${q}: rotations must have 1, 2 or 4 rows`);
        else { if (s.rotationArt === "unique4" && a.rotations.length !== 4) issues.push(`${q}: rotations needs 4 rows for rotationArt unique4`);
          a.rotations.forEach((row, r) => {
            if (!Array.isArray(row) || row.length !== (a.frames?.length ?? 0)) issues.push(`${q}: rotation row ${r} must have ${a.frames?.length ?? 0} frames`);
            else if (at) for (const f of row) if (!(Number.isInteger(f) && f >= 0 && f < total)) issues.push(`${q}: rotation ${r} frame ${f} out of atlas range`);
          }); }
      }
    }
    if (s.building) {
      const b = s.building; const q = `${p}.building`;
      if (s.category !== "building") issues.push(`${q}: only building sprites may have building data`);
      if (!b.piece) issues.push(`${q}: piece required`);
      if (!(Number.isInteger(b.footprint?.w) && b.footprint.w >= 1 && Number.isInteger(b.footprint?.h) && b.footprint.h >= 1)) issues.push(`${q}: bad footprint`);
      if (!(Number.isInteger(b.layer) && b.layer >= 0 && b.layer <= 3)) issues.push(`${q}: layer must be 0-3`);
      const art = s.rotationArt ?? "mirror";
      const checkRows = (rows: unknown, label: string) => {
        if (!Array.isArray(rows)) { issues.push(`${q}: ${label} must be an array of rotations`); return; }
        const okN = art === "unique4" ? [4] : [1, 2, 4];
        if (!okN.includes(rows.length)) { issues.push(art === "unique4" ? `${q}: ${label} needs 4 rotations for rotationArt unique4` : `${q}: ${label} must have 1, 2 or 4 rotations`); return; }
        (rows as number[][]).forEach((row, r) => {
          if (!Array.isArray(row) || row.length !== 4) issues.push(`${q}: rotation ${r} needs 4 damage stages`);
          else if (at) for (const f of row) if (!(Number.isInteger(f) && f >= 0 && f < total)) issues.push(`${q}: frame ${f} out of atlas range`);
        });
      };
      checkRows(b.frames, "frames");
      if (b.states !== undefined) {
        const names = b.states && typeof b.states === "object" ? Object.keys(b.states) : [];
        if (!names.length) issues.push(`${q}: states must be a non-empty object`); if (names.length > 255) issues.push(`${q}: at most 255 states`);
        for (const n of names) { if (!/^[a-z0-9_]+$/.test(n)) issues.push(`${q}: bad state name "${n}"`); checkRows(b.states[n], `states.${n}`); }
      }
      if (b.crackOverlay !== undefined) {
        const cs = m.sprites.find((x) => x.key === b.crackOverlay);
        if (!cs) issues.push(`${q}: unknown crackOverlay sprite "${b.crackOverlay}"`);
        else for (const st of ["stage1", "stage2", "stage3"]) if (!(st in (cs.animations ?? {}))) issues.push(`${q}: crackOverlay ${b.crackOverlay} lacks animation "${st}"`);
      }
      if (b.stateVfx !== undefined) {
        if (!b.stateVfx || typeof b.stateVfx !== "object") issues.push(`${q}: stateVfx must be an object`);
        else for (const [st, list] of Object.entries(b.stateVfx)) {
          if (!/^[a-z0-9_]+$/.test(st)) issues.push(`${q}: bad stateVfx state "${st}"`);
          if (!Array.isArray(list) || !list.length) { issues.push(`${q}: stateVfx.${st} must be a non-empty array`); continue; }
          const names = new Set([...Object.keys(s.attach ?? {}), ...Object.values(s.frameAttach ?? {}).flatMap((am) => Object.keys(am ?? {}))]);
          for (const e of list) {
            if (!(m.vfx ?? []).some((v) => v.key === e?.vfx)) issues.push(`${q}: stateVfx.${st}: unknown vfx "${e?.vfx}"`);
            if (!names.has(e?.attach)) issues.push(`${q}: stateVfx.${st}: unknown attach point "${e?.attach}"`);
          }
        }
      }
    }
    if (s.autotile !== undefined) {
      const t = s.autotile; const q = `${p}.autotile`;
      if (s.category !== "decal") issues.push(`${q}: only decal sprites may autotile`);
      if (!t || (t.neighbors !== 4 && t.neighbors !== 8)) issues.push(`${q}: neighbors must be 4 or 8`);
      else if (t.group !== undefined && !/^[a-z0-9_]+$/.test(t.group)) issues.push(`${q}: bad group`);
      else if (!Array.isArray(t.rules) || !t.rules.length) issues.push(`${q}: rules required`);
      else {
        const lim = t.neighbors === 8 ? 0xff : 0xf;
        t.rules.forEach((r, k) => {
          if (!(Number.isInteger(r?.mask) && r.mask >= 0 && r.mask <= lim) || (r.care !== undefined && !(Number.isInteger(r.care) && r.care >= 0 && r.care <= lim))) issues.push(`${q}: rule ${k} mask/care must be integers within 0..${lim}`);
          if (!(Number.isInteger(r?.frame) && r.frame >= 0 && r.frame < total)) issues.push(`${q}: rule ${k} frame out of atlas range`);
        });
        if (!t.rules.some((r) => r.care === 0)) issues.push(`${q}: needs a fallback rule with care 0`);
      }
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
    if (s.loop !== undefined && typeof s.loop !== "boolean" && !(s.loop && s.loop.start >= 0 && s.loop.end > s.loop.start)) issues.push(`${p}: loop points need 0 <= start < end (seconds)`);
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
    if (v.stretch !== undefined && !STRETCH_MODES.includes(v.stretch)) issues.push(`${p}: stretch must be none|velocity`);
    if (v.stretchMax !== undefined && !(typeof v.stretchMax === "number" && v.stretchMax >= 1 && v.stretchMax <= 64)) issues.push(`${p}: stretchMax must be within [1,64]`);
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
  const clanPals = m.clanPalettes ?? [];
  if (!Array.isArray(clanPals)) issues.push("clanPalettes must be an array");
  else { uniq(clanPals, "clanPalettes"); if (clanPals.length > 256) issues.push("clanPalettes: at most 256 (u8 index)");
    clanPals.forEach((c, i) => { if (!HEX.test(c?.primary ?? "") || !HEX.test(c?.secondary ?? "")) issues.push(`clanPalettes[${i}](${c?.key}): primary and secondary must be #rrggbb`); }); }
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
    Object.entries(s.animations).forEach(([name, a], i) => animList.push({ id: i, name, frames: a.frames, fps: a.fps, directions: a.directions ?? 1, dirStride: a.dirStride ?? at.columns, loop: a.loop ?? true, ...(a.rotations ? { rotations: a.rotations.map((r) => [...r]) } : {}) }));
    const id = ids.sprites.id(s.key);
    sprites.set(id, { id, key: s.key, category: s.category, atlas: at, anchor: s.anchor ?? { x: 0.5, y: 0.9 }, animations: new Map(animList.map((a) => [a.name, a])), animList,
      ...(s.building ? { building: { piece: s.building.piece, footprint: { ...s.building.footprint }, layer: s.building.layer, frames: s.building.frames.map((r) => [...r]),
        rotationArt: s.rotationArt ?? "mirror", stateNames: Object.keys(s.building.states ?? {}), states: Object.values(s.building.states ?? {}).map((rows) => rows.map((r) => [...r])),
        ...(s.building.crackOverlay ? { crackOverlay: ids.sprites.id(s.building.crackOverlay) } : {}),
        stateVfx: Object.fromEntries(Object.entries(s.building.stateVfx ?? {}).map(([st, l]) => [st, l.map((e) => ({ vfx: ids.vfx.id(e.vfx), attach: e.attach }))])) } } : {}),
      ...(s.autotile ? { autotile: { neighbors: s.autotile.neighbors, ...(s.autotile.group ? { group: s.autotile.group } : {}), rules: s.autotile.rules.map((r) => ({ ...r })) } } : {}),
      ...(s.sway ? { sway: { ...s.sway } } : {}),
      ...(s.attach ? { attach: cloneAttach(s.attach) } : {}),
      ...(s.frameAttach ? { frameAttach: new Map(Object.entries(s.frameAttach).map(([f, am]) => [Number(f), cloneAttach(am)])) } : {}),
      tints: Object.fromEntries(Object.entries(s.tints ?? {}).map(([n, t]) => [n, { color: parseColor(t.color), strength: t.strength, mode: t.mode ?? "multiply", saturation: t.saturation ?? 1 }])) });
  }
  const soundMap = new Map<number, SoundDef>(sounds.map((s) => { const id = ids.sounds.id(s.key); return [id, { id, key: s.key, files: [...s.files], volume: s.volume ?? 1, pitchJitter: s.pitchJitter ?? 0, loop: !!s.loop, ...(typeof s.loop === "object" ? { loopPoints: { ...s.loop } } : {}), category: s.category }]; }));
  const vfxMap = new Map<number, VfxDef>(vfx.map((v) => { const id = ids.vfx.id(v.key); const sp = m.sprites.find((s) => s.key === v.sprite)!;
    return [id, { id, key: v.key, sprite: ids.sprites.id(v.sprite), anim: v.anim ?? Object.keys(sp.animations)[0]!, lifetime: v.lifetime, blend: v.blend ?? "normal", stretch: v.stretch ?? "none", stretchMax: v.stretchMax ?? 4, ...(v.particles ? { particles: v.particles } : {}) }]; }));
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
  const glyphs = new Map<string, GlyphDef>();
  if (m.glyphs !== undefined) {
    if (!m.glyphs || typeof m.glyphs !== "object") issues.push("glyphs must be an object");
    else for (const [gid, g] of Object.entries(m.glyphs)) {
      if (!GLYPH_ID.test(gid)) { issues.push(`glyphs.${gid}: id must look like kbm.key.e / gamepad.xbox.a / touch.tap`); continue; }
      const sp = [...sprites.values()].find((x) => x.key === g?.sprite);
      if (!sp) { issues.push(`glyphs.${gid}: unknown sprite "${g?.sprite}"`); continue; }
      const total = sp.atlas.columns * sp.atlas.rows; const frame = g.frame ?? sp.animList[0]?.frames[0] ?? 0;
      if (!(Number.isInteger(frame) && frame >= 0 && frame < total)) { issues.push(`glyphs.${gid}: frame out of atlas range`); continue; }
      glyphs.set(gid, { id: gid, sprite: sp.id, frame });
    }
    if (issues.length) throw new ManifestError(issues);
  }
  if (warnings.length && typeof console !== "undefined") for (const w of warnings) console.warn(`[assets] ${w}`);
  const registry = new AssetRegistry(atlases, sprites, ids, soundMap, vfxMap, tintMap, palMap, varMap); registry.glyphs = glyphs;
  registry.clanPalettes = clanPals.map((c, index) => ({ index, key: c.key, primary: parseColor(c.primary), secondary: parseColor(c.secondary) }));
  if (m.wearables !== undefined || m.bodyTypes !== undefined || m.skinTones !== undefined || m.hairColors !== undefined || m.clothingColors !== undefined) {
    const ci: string[] = []; const wl = rawLock.wearables;
    const c = loadCosmetics(m, registry, wl && typeof wl === "object" ? (wl as Record<string, number>) : undefined, ci);
    if (ci.length) throw new ManifestError(ci);
    registry.cosmetics = c.catalog; if (c.catalog.size) return { registry, lock: { ...lock, wearables: c.lock }, warnings };
  }
  return { registry, lock, warnings };
}

/** File IO for validateAssetFiles: exists + image pixel size (undefined if unreadable). Paths are manifest paths. */
export interface AssetFileIO { exists(path: string): boolean; imageSize(path: string): { w: number; h: number } | undefined }
/**
 * Checks atlas images, scale pages and mask pages (emissive, sheen, sway, tintmask) exist and that every mask matches its
 * atlas page size (scale-1 mask = atlas image size; `<mask>@Nx` variants, when present, = page N size). Sprite
 * `sway.mask` must match the atlas image or one frame. Returns issues (empty = ok).
 */
export function validateAssetFiles(reg: AssetRegistry, io: AssetFileIO): string[] {
  const issues: string[] = []; const atSize = new Map<string, { w: number; h: number } | undefined>();
  const size = (p: string) => { if (!atSize.has(p)) atSize.set(p, io.imageSize(p)); return atSize.get(p); };
  const at2x = (p: string, k: number) => p.replace(/(\.[a-z]+)$/, `@${k}x$1`);
  for (const a of reg.atlases.values()) {
    for (const pg of a.pages) if (!io.exists(pg.image)) issues.push(`atlas ${a.key}: missing page ${pg.image}`);
    const base = io.exists(a.image) ? size(a.image) : undefined;
    for (const [kind, path] of Object.entries(a.masks) as [MaskKind, string][]) {
      if (!io.exists(path)) { issues.push(`atlas ${a.key}: missing ${kind} mask ${path}`); continue; }
      const ms = size(path); if (!ms || !base) continue;
      if (ms.w !== base.w || ms.h !== base.h) issues.push(`atlas ${a.key}: ${kind} mask ${path} is ${ms.w}x${ms.h}, atlas image is ${base.w}x${base.h}`);
      for (const pg of a.pages) { if (pg.scale === 1) continue; const mp = at2x(path, pg.scale); if (!io.exists(mp) || !io.exists(pg.image)) continue;
        const a2 = size(pg.image), m2 = size(mp); if (a2 && m2 && (a2.w !== m2.w || a2.h !== m2.h)) issues.push(`atlas ${a.key}: ${kind} mask ${mp} is ${m2.w}x${m2.h}, page is ${a2.w}x${a2.h}`); }
    }
  }
  for (const s of reg.allSprites()) {
    const mp = s.sway?.mask; if (!mp) continue;
    if (!io.exists(mp)) { issues.push(`sprite ${s.key}: missing sway mask ${mp}`); continue; }
    const ms = size(mp), base = size(s.atlas.image); if (!ms) continue;
    const okAtlas = base && ms.w === base.w && ms.h === base.h, okFrame = ms.w === s.atlas.frameW && ms.h === s.atlas.frameH;
    if (!okAtlas && !okFrame) issues.push(`sprite ${s.key}: sway mask ${mp} is ${ms.w}x${ms.h}, expected atlas ${base ? `${base.w}x${base.h}` : "?"} or frame ${s.atlas.frameW}x${s.atlas.frameH}`);
  }
  return issues;
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
