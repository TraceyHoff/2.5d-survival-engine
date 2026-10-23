/**
 * Character customization (paper-doll) rendering: the render-side contract for core `Appearance` +
 * `resolveLayers(catalog, appearance, facing)` (docs/CHARACTER_CUSTOMIZATION.md, core/src/appearance.ts).
 *
 * Bound like the gameplay bindings (coreAppearanceBinding wires core's Appearance + resolveLayers). Types here are
 * structural mirrors of the core contract (so tests/tools can pass their own resolver):
 *   AppearanceLike  ~ core AppearanceValue      CharacterDrawLayer ~ core DrawLayer (+ optional render tint fields)
 *
 * `LayerCache` keeps each entity's resolved, render-ready layer list and re-resolves only on a key change.
 * Key = (entity, Appearance.version, directionIndex4(facing)). version is bumped by core's setAppearance (the only
 * sanctioned writer) and wraps, so it is compared for equality only.
 */
import { Appearance, directionIndex4, resolveLayers, type AppearanceValue, type ComponentDef, type CosmeticCatalogLike } from "@engine/core";

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
}

export type ResolveLayersFn = (appearance: AppearanceLike, facing: number) => readonly CharacterDrawLayer[];

/** What the renderer needs: the Appearance component def (core schema) and a resolver (wraps core resolveLayers). */
export interface AppearanceBinding {
  def: ComponentDef;
  resolve: ResolveLayersFn;
  /** Per-slot render tint defaults applied when a layer does not carry its own (e.g. { hair: { mode: "lerp" } }). */
  slotTint?: Partial<Record<string, { mode?: TintMode; strength?: number; saturation?: number }>>;
  /** Slots dropped by the crowd LOD (default accessory, shoes, face, eyes). */
  minorSlots?: readonly string[];
}

/** Render-ready layer (sprite + packed tint params). */
export interface CachedLayer {
  slot: string; sprite: number; animName: string;
  /** RGBA8 packed (0 = untinted) */ tint: number; tint2: number;
  /** 0..3 = multiply|add|screen|lerp */ mode: number; strength: number; saturation: number;
  minor: boolean; /** participates in the character outline pass */ outline: boolean;
}

const DEFAULT_MINOR = ["accessory", "shoes", "face", "eyes"];
export const FACING_BUCKETS = 4;
/** resolveLayers only varies by core's 4-way direction (layerByDir), so that is the cache's facing key. */
export function facingBucket(f: number): number { return directionIndex4(f); }

export const rgbToRgba8 = (c: number | undefined): number => (c === undefined ? 0 : (((c & 0xffffff) << 8) | 255) >>> 0);

export function toCachedLayers(list: readonly CharacterDrawLayer[], b: Pick<AppearanceBinding, "slotTint" | "minorSlots">): CachedLayer[] {
  const minor = b.minorSlots ?? DEFAULT_MINOR;
  return list.map((l) => {
    const d = b.slotTint?.[l.slot];
    const mode = TINT_MODES.indexOf(l.tintMode ?? d?.mode ?? "multiply");
    return { slot: l.slot, sprite: l.sprite, animName: l.anim, tint: rgbToRgba8(l.tintR), tint2: rgbToRgba8(l.tintG),
      mode: mode < 0 ? 0 : mode, strength: l.tintStrength ?? d?.strength ?? 1, saturation: l.tintSaturation ?? d?.saturation ?? 1,
      minor: l.minor ?? minor.includes(l.slot), outline: l.outline !== false };
  });
}

/** Read an AppearanceLike from a raw store slot (fresh arrays; only on cache miss). */
export function readAppearanceSlot(data: Record<string, ArrayLike<number>>, lengths: Record<string, number>, slot: number): AppearanceLike {
  const arr = (f: string): number[] => { const n = lengths[f] ?? 0; const a = data[f]; const o: number[] = []; if (a) for (let i = 0; i < n; i++) o.push(a[slot * n + i]!); return o; };
  return { bodyType: data.bodyType?.[slot] ?? 0, skinTone: data.skinTone?.[slot] ?? 0, parts: arr("parts"), primary: arr("primary"), secondary: arr("secondary") };
}

interface Entry { entity: number; version: number; bucket: number; layers: CachedLayer[] }

/** Per-entity resolved layer cache (keyed by entity index, validated by entity handle + Appearance.version + facing4). */
export class LayerCache {
  private m = new Map<number, Entry>();
  /** resolveLayers calls since creation (stat / tests) */ resolves = 0;
  constructor(public binding: AppearanceBinding) {}
  get size(): number { return this.m.size; }
  /** Layers for entity (index i, handle e). `version` = its Appearance.version (u16, wrapping: equality only, never
   *  ordered); `read` builds the value on miss. */
  get(i: number, e: number, version: number, facing: number, read: () => AppearanceLike): CachedLayer[] {
    const bucket = facingBucket(facing); let en = this.m.get(i);
    if (en && en.entity === e && en.version === version && en.bucket === bucket) return en.layers;
    this.resolves++;
    const layers = toCachedLayers(this.binding.resolve(read(), facing), this.binding);
    if (!en) { en = { entity: e, version, bucket, layers }; this.m.set(i, en); } else { en.entity = e; en.version = version; en.bucket = bucket; en.layers = layers; }
    return layers;
  }
  /** Drop entries not seen since `keep` returned false (call occasionally to free despawned entities). */
  prune(alive: (entity: number) => boolean): void { for (const [i, en] of this.m) if (!alive(en.entity)) this.m.delete(i); }
  clear(): void { this.m.clear(); }
}

/**
 * Binding over core's contract (81cdf46): `Appearance` + `resolveLayers(catalog, appearance, facing)` (which already
 * applies hidesSlots, hatHair and layerByDir). `catalog` is the @engine/assets CosmeticCatalog.
 */
export function coreAppearanceBinding(catalog: CosmeticCatalogLike, opts: Omit<AppearanceBinding, "def" | "resolve"> = {}): AppearanceBinding {
  return { def: Appearance as unknown as ComponentDef, resolve: (a, facing) => resolveLayers(catalog, a as AppearanceValue, facing), ...opts };
}
