/**
 * Character customization (paper-doll) rendering: the render-side contract for core `Appearance` +
 * `resolveLayers(catalog, appearance, facing)` (docs/CHARACTER_CUSTOMIZATION.md, core/src/appearance.ts).
 *
 * Bound like the gameplay bindings (coreAppearanceBinding wires core's Appearance + resolveLayers). Types here are
 * structural mirrors of the core contract (so tests/tools can pass their own resolver):
 *   AppearanceLike  ~ core AppearanceValue      CharacterDrawLayer ~ core DrawLayer (+ optional render tint fields)
 *
 * `LayerCache` keeps each entity's resolved, render-ready layer list and re-resolves only on a key change.
 * Key = (entity, Appearance.version, directionIndex8(facing), anim, expression). version is bumped by core's setAppearance (the only
 * sanctioned writer) and wraps, so it is compared for equality only.
 */
import { Appearance, DEFAULT_TINT_NEUTRAL, directionIndex8, resolveLayers, type ResolveLayersOptions, type AppearanceValue, type ComponentDef, type CosmeticCatalogLike } from "@engine/core";

export type TintMode = "multiply" | "add" | "screen" | "lerp";
export const TINT_MODES: readonly TintMode[] = ["multiply", "add", "screen", "lerp"];

/** Structural mirror of core AppearanceValue. */
export interface AppearanceLike { bodyType: number; skinTone: number; parts: ArrayLike<number>; primary: ArrayLike<number>; secondary: ArrayLike<number> }

/**
 * One back-to-front draw layer (core DrawLayer). `tintR`/`tintG` are 0xRRGGBB for tintmask R / G (body: R = skin).
 * Optional render hints from core DrawLayer (c734b72, passed through resolveLayers): tint mode/strength/saturation,
 * `minor` (dropped by the crowd LOD) and `outline` (false = excluded from the union outline pass).
 */
export interface CharacterDrawLayer {
  slot: string; sprite: number; anim: string; layer?: number; z?: number; wearable?: number;
  tintR?: number; tintG?: number;
  tintMode?: TintMode; tintStrength?: number; tintSaturation?: number;
  minor?: boolean; outline?: boolean;
  /** ADR-082: wearable layer name (multi-layer wearables emit one DrawLayer per layer), neutral grey of the multiply/lerp
   *  contract (default 0.78), outline mode ("none" = excluded from the outline pass; wins over `outline`), face expression. */
  layerName?: string; tintNeutral?: number; outlineMode?: "body" | "none"; expression?: string;
}

export type ResolveLayersFn = (appearance: AppearanceLike, facing: number, opts?: ResolveLayersOptions) => readonly CharacterDrawLayer[];

/** What the renderer needs: the Appearance component def (core schema) and a resolver (wraps core resolveLayers). */
export interface AppearanceBinding {
  def: ComponentDef;
  resolve: ResolveLayersFn;
  /** Per-slot render tint defaults applied when a layer does not carry its own (e.g. { hair: { mode: "lerp" } }). */
  slotTint?: Partial<Record<string, { mode?: TintMode; strength?: number; saturation?: number }>>;
  /** Slots dropped by the crowd LOD (default accessory, shoes; face/eyes are never dropped). */
  minorSlots?: readonly string[];
  /**
   * Broadcast gameplay `Expression {id, untilTick}` (networked; optional). While world.tick < untilTick, name(id) is
   * passed to resolveLayers as `expression`; expired or id 0 = none. name defaults to String(id) until Survival ships
   * the expression name order.
   */
  expression?: { def: ComponentDef; name?: (id: number) => string | undefined };
}

/** Active face expression of `e` from binding.expression (undefined when absent, id 0 or untilTick has passed). */
export function activeExpression(world: { tick: number; has(e: number, d: ComponentDef): boolean; getField(e: number, d: ComponentDef<any>, f: never): number | undefined },
  e: number, b: Pick<AppearanceBinding, "expression">): string | undefined {
  const x = b.expression; if (!x || !world.has(e, x.def)) return undefined;
  const id = world.getField(e, x.def, "id" as never) ?? 0, until = world.getField(e, x.def, "untilTick" as never) ?? 0;
  if (!id || world.tick >= until) return undefined;
  return x.name ? x.name(id) : String(id);
}

/** Render-ready layer (sprite + packed tint params). */
export interface CachedLayer {
  slot: string; sprite: number; animName: string; /** wearable layer name ("" = single-layer) */ layerName: string;
  /** neutral grey of the multiply/lerp tint contract */ neutral: number;
  /** RGBA8 packed (0 = untinted) */ tint: number; tint2: number;
  /** 0..3 = multiply|add|screen|lerp */ mode: number; strength: number; saturation: number;
  minor: boolean; /** participates in the character outline pass */ outline: boolean;
}

// face/eyes are not minor: they are what makes a character read at crowd zoom (cute/cartoony art direction)
const DEFAULT_MINOR = ["accessory", "shoes"];
export const FACING_BUCKETS = 8;
/** resolveLayers varies by core's 8-way direction (8-entry layerByDir, ADR-082), so that is the cache's facing key. */
export function facingBucket(f: number): number { return directionIndex8(f); }

export const rgbToRgba8 = (c: number | undefined): number => (c === undefined ? 0 : (((c & 0xffffff) << 8) | 255) >>> 0);

export function toCachedLayers(list: readonly CharacterDrawLayer[], b: Pick<AppearanceBinding, "slotTint" | "minorSlots">): CachedLayer[] {
  const minor = b.minorSlots ?? DEFAULT_MINOR;
  return list.map((l) => {
    const d = b.slotTint?.[l.slot];
    const mode = TINT_MODES.indexOf(l.tintMode ?? d?.mode ?? "multiply");
    return { slot: l.slot, sprite: l.sprite, animName: l.anim, layerName: l.layerName ?? "", neutral: l.tintNeutral && l.tintNeutral > 0 ? l.tintNeutral : DEFAULT_TINT_NEUTRAL, tint: rgbToRgba8(l.tintR), tint2: rgbToRgba8(l.tintG),
      mode: mode < 0 ? 0 : mode, strength: l.tintStrength ?? d?.strength ?? 1, saturation: l.tintSaturation ?? d?.saturation ?? 1,
      minor: l.minor ?? minor.includes(l.slot), outline: l.outlineMode !== undefined ? l.outlineMode !== "none" : l.outline !== false };
  });
}

/** Read an AppearanceLike from a raw store slot (fresh arrays; only on cache miss). */
export function readAppearanceSlot(data: Record<string, ArrayLike<number>>, lengths: Record<string, number>, slot: number): AppearanceLike {
  const arr = (f: string): number[] => { const n = lengths[f] ?? 0; const a = data[f]; const o: number[] = []; if (a) for (let i = 0; i < n; i++) o.push(a[slot * n + i]!); return o; };
  return { bodyType: data.bodyType?.[slot] ?? 0, skinTone: data.skinTone?.[slot] ?? 0, parts: arr("parts"), primary: arr("primary"), secondary: arr("secondary") };
}

interface Entry { entity: number; version: number; bucket: number; anim: string; expr: string; layers: CachedLayer[] }

/** Per-entity resolved layer cache (keyed by entity index, validated by entity handle + Appearance.version + facing4). */
export class LayerCache {
  private m = new Map<number, Entry>();
  /** resolveLayers calls since creation (stat / tests) */ resolves = 0;
  /** Called when an entry's layer set changes or is dropped (texture page refcounts: AtlasManager.retainSprite/releaseSprite). */
  onLayers: ((prev: readonly CachedLayer[] | null, next: readonly CachedLayer[] | null) => void) | null = null;
  constructor(public binding: AppearanceBinding) {}
  get size(): number { return this.m.size; }
  /** Layers for entity (index i, handle e). `version` = its Appearance.version (u16, wrapping: equality only, never
   *  ordered); `read` builds the value on miss. */
  get(i: number, e: number, version: number, facing: number, read: () => AppearanceLike, opts: ResolveLayersOptions = {}): CachedLayer[] {
    const bucket = facingBucket(facing); const anim = opts.anim ?? "", expr = opts.expression ?? ""; let en = this.m.get(i);
    if (en && en.entity === e && en.version === version && en.bucket === bucket && en.anim === anim && en.expr === expr) return en.layers;
    this.resolves++;
    const layers = toCachedLayers(this.binding.resolve(read(), facing, opts), this.binding);
    this.onLayers?.(en ? en.layers : null, layers);
    if (!en) { en = { entity: e, version, bucket, anim, expr, layers }; this.m.set(i, en); } else { en.entity = e; en.version = version; en.bucket = bucket; en.anim = anim; en.expr = expr; en.layers = layers; }
    return layers;
  }
  /** Drop entries not seen since `keep` returned false (call occasionally to free despawned entities). */
  prune(alive: (entity: number) => boolean): void { for (const [i, en] of this.m) if (!alive(en.entity)) { this.onLayers?.(en.layers, null); this.m.delete(i); } }
  clear(): void { if (this.onLayers) for (const en of this.m.values()) this.onLayers(en.layers, null); this.m.clear(); }
}

/**
 * Binding over core's contract (81cdf46): `Appearance` + `resolveLayers(catalog, appearance, facing)` (which already
 * applies hidesSlots, hatHair and layerByDir). `catalog` is the @engine/assets CosmeticCatalog.
 */
export function coreAppearanceBinding(catalog: CosmeticCatalogLike, opts: Omit<AppearanceBinding, "def" | "resolve"> & { faceOverHair?: boolean } = {}): AppearanceBinding {
  const { faceOverHair = true, ...rest } = opts;
  return { def: Appearance as unknown as ComponentDef, resolve: (a, facing, o) => { const l = resolveLayers(catalog, a as AppearanceValue, facing, o); return faceOverHair ? liftFaceOverHair(l, facing) : l; }, ...rest };
}

/**
 * CPU reference of the sprite shader's layerTint (ADR-082 pinned contract), per channel 0..1. multiply:
 * out = base * mix(1, color / neutral, strength * mask); lerp: mix(base, luma(base) * color / neutral, k); add / screen
 * use the raw colour. tintSaturation is applied to the tinted result (scaled by k), never before the tint.
 */
export function layerTintRef(base: [number, number, number], color: [number, number, number], mode: number, strength: number, mask = 1, saturation = 1, neutral = DEFAULT_TINT_NEUTRAL): [number, number, number] {
  const k = strength * mask; if (k <= 0.003) return [...base] as [number, number, number];
  const d = mode === 0 || mode === 3 ? 1 / neutral : 1; const tc = color.map((c) => c * d);
  const lum = (c: number[]): number => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!; const L = lum(base);
  const cl = (v: number): number => Math.min(1, Math.max(0, v)); const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  let r = base.map((c, i) => cl(mode === 0 ? c * mix(1, tc[i]!, k) : mode === 1 ? mix(c, c + tc[i]!, k) : mode === 2 ? mix(c, 1 - (1 - c) * (1 - tc[i]!), k) : mix(c, tc[i]! * L, k)));
  if (saturation !== 1) { const l2 = lum(r); const s = mix(1, saturation, k); r = r.map((c) => cl(mix(l2, c, s))); }
  return r as [number, number, number];
}

/** Facings (directionIndex8: E, SE, S, SW, W) that show the face; back facings keep the authored order (hair over face). */
const FACE_VISIBLE_DIRS = [true, true, true, true, true, false, false, false];
/**
 * Face/eyes drawn just above hair on facings that show the face. Art authors face 32 / eyes 34 under hair 40, so fringes
 * and bobs covered brows, mouth and eyes (bob: 2/3 of the face pixels hidden); hats/accessories above hair stay in front.
 * Stable: the moved layers keep their relative order and sit right after the last hair layer.
 */
export function liftFaceOverHair<L extends { slot: string }>(list: readonly L[], facing: number): readonly L[] {
  if (!FACE_VISIBLE_DIRS[directionIndex8(facing)]) return list;
  let lastHair = -1, firstFace = -1;
  for (let i = 0; i < list.length; i++) { const s = list[i]!.slot; if (s === "hair") lastHair = i; else if ((s === "face" || s === "eyes") && firstFace < 0) firstFace = i; }
  if (lastHair < 0 || firstFace < 0 || firstFace > lastHair) return list;
  const face = list.filter((l) => l.slot === "face" || l.slot === "eyes"), rest = list.filter((l) => l.slot !== "face" && l.slot !== "eyes");
  const at = rest.lastIndexOf(list[lastHair]!) + 1;
  return [...rest.slice(0, at), ...face, ...rest.slice(at)];
}
