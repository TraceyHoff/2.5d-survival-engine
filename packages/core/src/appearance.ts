import { defineComponent } from "./component.js";
import type { Entity } from "./entity.js";
import type { World } from "./world.js";

/**
 * Character customization (cosmetic paper-doll) contract. Pure data + helpers; no art, UI or rendering.
 * Cosmetics are separate from gameplay equipment: an item def may name an `equipCosmetic` wearable key that
 * overrides a slot visually (documented in docs/CHARACTER_CUSTOMIZATION.md, not wired yet).
 */
export const BODY_TYPES = ["male", "female"] as const;
export type BodyType = (typeof BODY_TYPES)[number];
/** Slot order is part of the wire/save layout (array index); only append. */
export const WEARABLE_SLOTS = ["hair", "hat", "accessory", "top", "bottom", "shoes", "face", "eyes", "hands"] as const;
export type WearableSlot = (typeof WEARABLE_SLOTS)[number];
export const SLOT_COUNT = WEARABLE_SLOTS.length;
export const slotIndex = (s: WearableSlot): number => WEARABLE_SLOTS.indexOf(s);
/** Which palette a slot's primary/secondary indices refer to. */
export const SLOT_PALETTE: Record<WearableSlot, "hairColors" | "clothingColors"> = {
  hair: "hairColors", hat: "clothingColors", accessory: "clothingColors", top: "clothingColors",
  bottom: "clothingColors", shoes: "clothingColors", face: "hairColors", eyes: "clothingColors", hands: "clothingColors",
};

/**
 * Networked + persistent. `version` (u16, wrapping) is bumped on every write so the Renderer can cache resolveLayers
 * output per entity; ALL writers must go through setAppearance (never world.set/setElement on Appearance directly).
 * parts[slot] = wearable id (0 = none); primary/secondary[slot] = palette index (u8). */
export const Appearance = defineComponent("Appearance", {
  bodyType: "u8", skinTone: "u8", version: "u16",
  parts: { type: "u16", length: SLOT_COUNT },
  primary: { type: "u8", length: SLOT_COUNT },
  secondary: { type: "u8", length: SLOT_COUNT },
}, { networked: true, persistent: true });

export interface AppearanceValue { bodyType: number; skinTone: number; parts: number[]; primary: number[]; secondary: number[] }

/** Per body-type art for one wearable (ids resolved by the assets loader). */
export interface WearableBodyArt { sprite: number; anim: string; /** alt art used when a hat sets `hatHair` (hair slot only) */ hatHair?: { sprite: number; anim: string } }
/** Tintmask blend modes understood by the Renderer (render TINT_MODES). */
export type TintMode = "multiply" | "add" | "screen" | "lerp";
export const TINT_MODES: readonly TintMode[] = ["multiply", "add", "screen", "lerp"];
/** Pinned default blend (ADR-082): absent tintMode means multiply. */
export const DEFAULT_TINT_MODE: TintMode = "multiply";
/**
 * Neutral grey of Art's masked regions (0..1). Multiply contract (ADR-082):
 * out = base * mix(1, color / tintNeutral, strength * mask), so a neutral-grey pixel becomes exactly `color` at full strength.
 */
export const DEFAULT_TINT_NEUTRAL = 0.78;
/** Outline participation: "body" = joins the character union outline (default), "none" = excluded. */
export type OutlineMode = "body" | "none";
export const OUTLINE_MODES: readonly OutlineMode[] = ["body", "none"];
/** Legacy boolean (c734b72) or enum -> enum. true -> body, false -> none. */
export function normalizeOutline(v: boolean | OutlineMode | undefined): OutlineMode | undefined {
  return v === undefined ? undefined : v === true ? "body" : v === false ? "none" : v;
}
/** Slots a valid appearance must fill (falls back to the body's cosmeticDefaults when 0). */
export const DEFAULT_REQUIRED_SLOTS: readonly WearableSlot[] = ["face", "eyes"];
/** 8-way compass names in directionIndex8 order (0 = E, clockwise on screen: E, SE, S, SW, W, NW, N, NE). */
export const DIRECTIONS8 = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"] as const;
export type Direction8 = (typeof DIRECTIONS8)[number];
/** 4-way names in directionIndex4 order. */
export const DIRECTIONS4 = ["E", "S", "W", "N"] as const;

/** Shared draw/tint fields of a wearable or one of its layers. */
export interface WearableLayerProps {
  /** Draw order; higher = in front. `layerByDir` overrides per facing: 4 entries (E,S,W,N; directionIndex4) or 8 (DIRECTIONS8; directionIndex8). */
  layer: number; layerByDir?: number[]; z: number;
  /** Tintmask channels used: 0 = untinted, 1 = R<-primary, 2 = R<-primary + G<-secondary. */
  tintChannels: 0 | 1 | 2;
  /** Optional render hints (passed through resolveLayers; renderer defaults apply when absent; mode default = multiply). */
  tintMode?: TintMode; tintStrength?: number; tintSaturation?: number;
  /** Per-wearable/layer neutral grey override (else the catalog's tintNeutral). */
  tintNeutral?: number;
  /** Small detail part the Renderer's crowd LOD may drop. */
  minor?: boolean;
  /** Legacy boolean view of outlineMode: false = excluded from the outline pass. Kept in sync with outlineMode. */
  outline?: boolean;
  outlineMode?: OutlineMode;
}
/** One draw layer of a multi-layer wearable (e.g. sleeve_back + sleeve_front). */
export interface WearableLayerDef extends WearableLayerProps {
  name: string;
  bodies: Partial<Record<BodyType, WearableBodyArt>>;
}
export interface WearableDef extends WearableLayerProps {
  id: number; key: string; slot: WearableSlot;
  /** Keyed by BodyType; a part is compatible only with listed body types. With `layers`, this mirrors layers[0]. */
  bodies: Partial<Record<BodyType, WearableBodyArt>>;
  /** Multi-layer form; when present, resolveLayers emits one DrawLayer per entry (single-layer fields are ignored for drawing). */
  layers?: WearableLayerDef[];
  hidesSlots: WearableSlot[];
  /** Hat only: hair draws its hatHair variant (or is hidden if the hair lacks one). */
  hatHair: boolean;
  unlockTags: string[];
  displayName?: string; locKey?: string;
  /** face/eyes only: body anim name -> expression key (e.g. { idle: "smile", hurt: "ouch" }); overrides catalog faceAnims. */
  faceAnims?: Record<string, string>;
  /** face/eyes only: expression key -> per-body art. The loader fills one entry per anim of the part's sprite (key = anim name). */
  expressions?: Record<string, Partial<Record<BodyType, { sprite: number; anim: string }>>>;
}
export interface PaletteColor { index: number; key: string; color: number }
export interface BodyTypeInfo { sprite: number; anim: string; displayName?: string; locKey?: string;
  /** slot -> wearable id used by defaultAppearance and to fill required slots. */ cosmeticDefaults?: Partial<Record<WearableSlot, number>> }
/** What core needs from the asset side (implemented by @engine/assets CosmeticCatalog). */
export interface CosmeticCatalogLike {
  wearable(id: number): WearableDef | undefined;
  bodySprite(bodyType: BodyType): { sprite: number; anim: string } | undefined;
  skinTones: PaletteColor[]; hairColors: PaletteColor[]; clothingColors: PaletteColor[];
  /** First compatible wearable per slot to use as default (0 = none); optional. */
  defaults?: Partial<Record<WearableSlot, number>>;
  /** Per-body cosmetic defaults (wins over `defaults`). */
  bodyDefaults?(bodyType: BodyType): Partial<Record<WearableSlot, number>> | undefined;
  /** Slots that must be non-zero after validateAppearance (filled from bodyDefaults). Absent = none. */
  requiredSlots?: readonly WearableSlot[];
  /** Catalog-wide neutral grey (default DEFAULT_TINT_NEUTRAL). */
  tintNeutral?: number;
  /** Catalog-wide face/eyes anim -> expression key (per-wearable faceAnims win). */
  faceAnims?: Record<string, string> | undefined;
}

export function defaultAppearance(cat?: CosmeticCatalogLike, bodyType = 0): AppearanceValue {
  const parts = new Array<number>(SLOT_COUNT).fill(0); const body = BODY_TYPES[bodyType] ?? "male";
  for (const src of [cat?.defaults, cat?.bodyDefaults?.(body)]) if (src) for (const [s, id] of Object.entries(src)) {
    const w = cat!.wearable(id ?? 0); if (w && w.slot === s && w.bodies[body]) parts[slotIndex(s as WearableSlot)] = id!;
  }
  return { bodyType: bodyType < BODY_TYPES.length ? bodyType : 0, skinTone: 0, parts, primary: new Array<number>(SLOT_COUNT).fill(0), secondary: new Array<number>(SLOT_COUNT).fill(0) };
}

export interface ValidateAppearanceOptions {
  /** "clamp" (default): fix issues and return the repaired value. "reject": return issues and value = undefined. */
  mode?: "clamp" | "reject";
  /** If given, parts with unlock tags require at least one tag in this set (server passes the player's unlocks). */
  unlocked?: ReadonlySet<string>;
}
export interface ValidateAppearanceResult { value: AppearanceValue | undefined; issues: string[] }

/** Server-side gate for setAppearance and load-time repair. Unknown/incompatible/locked parts -> 0; bad palette indices -> 0. */
export function validateAppearance(cat: CosmeticCatalogLike, a: Partial<AppearanceValue>, opts: ValidateAppearanceOptions = {}): ValidateAppearanceResult {
  const issues: string[] = [];
  const bt = Number.isInteger(a.bodyType) && a.bodyType! >= 0 && a.bodyType! < BODY_TYPES.length ? a.bodyType! : (issues.push(`bad bodyType ${a.bodyType}`), 0);
  const body = BODY_TYPES[bt]!;
  const inPal = (n: number | undefined, len: number) => Number.isInteger(n) && n! >= 0 && n! < len;
  const skin = inPal(a.skinTone, cat.skinTones.length) ? a.skinTone! : (issues.push(`bad skinTone ${a.skinTone}`), 0);
  const out = defaultAppearance(undefined, bt); out.skinTone = skin;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = WEARABLE_SLOTS[i]!; const id = a.parts?.[i] ?? 0;
    if (id !== 0) {
      const w = cat.wearable(id);
      if (!w) issues.push(`${slot}: unknown wearable ${id}`);
      else if (w.slot !== slot) issues.push(`${slot}: wearable ${w.key} belongs to ${w.slot}`);
      else if (!w.bodies[body]) issues.push(`${slot}: wearable ${w.key} has no ${body} art`);
      else if (opts.unlocked && w.unlockTags.length && !w.unlockTags.some((t) => opts.unlocked!.has(t))) issues.push(`${slot}: wearable ${w.key} is locked`);
      else out.parts[i] = id;
    }
    const len = cat[SLOT_PALETTE[slot]].length;
    for (const k of ["primary", "secondary"] as const) {
      const v = a[k]?.[i] ?? 0;
      if (inPal(v, Math.max(len, 1))) out[k][i] = v; else issues.push(`${slot}: bad ${k} color ${v}`);
    }
  }
  for (const slot of cat.requiredSlots ?? []) {
    const i = slotIndex(slot); if (out.parts[i]) continue;
    const id = cat.bodyDefaults?.(body)?.[slot] ?? cat.defaults?.[slot]; const w = id ? cat.wearable(id) : undefined;
    // filled silently from the body's default (not an issue, so reject mode still accepts an empty face/eyes)
    if (w && w.slot === slot && w.bodies[body]) out.parts[i] = id!; else issues.push(`${slot}: required slot is empty and has no default`);
  }
  if (opts.mode === "reject" && issues.length) return { value: undefined, issues };
  return { value: out, issues };
}

export interface DrawLayer {
  /** "body" for the base body, else the slot name. */
  slot: "body" | WearableSlot; wearable: number; sprite: number; anim: string;
  layer: number; z: number;
  /** WearableLayerDef.name for multi-layer wearables (absent for the single-layer form and the body). */
  layerName?: string;
  /** Tintmask R / G target colors (0xRRGGBB); undefined channel = untinted. Body: r = skin tone. */
  tintR?: number; tintG?: number;
  /** Passed through from the WearableDef / layer when set (see WearableLayerProps). */
  tintMode?: TintMode; tintStrength?: number; tintSaturation?: number; minor?: boolean; outline?: boolean;
  /** Neutral grey for the multiply formula; always set on tinted layers (layer > wearable > catalog > 0.78). */
  tintNeutral?: number;
  outlineMode?: OutlineMode;
  /** face/eyes: expression key that selected `anim`/`sprite` (absent = base art). */
  expression?: string;
}
/** 4-way direction index (0 = +x/E, 1 = +y/S, 2 = W, 3 = N), same convention as AssetRegistry.directionIndex. */
export function directionIndex4(facing: number): number {
  const a = ((facing % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return Math.round(a / (Math.PI / 2)) % 4;
}
/** 8-way direction index (DIRECTIONS8: 0 = E, 1 = SE, 2 = S, ... 6 = N, 7 = NE), same as AssetRegistry.directionIndex(f, 8). */
export function directionIndex8(facing: number): number {
  const a = ((facing % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return Math.round(a / (Math.PI / 4)) % 8;
}
/** Layer for a facing: 8-entry layerByDir uses directionIndex8, 4-entry uses directionIndex4, else `layer`. */
export function layerForFacing(p: { layer: number; layerByDir?: readonly number[] }, facing: number): number {
  const d = p.layerByDir; if (!d) return p.layer;
  return (d.length === 8 ? d[directionIndex8(facing)] : d.length === 4 ? d[directionIndex4(facing)] : undefined) ?? p.layer;
}
/** Body draws at this layer; wearables author layers relative to it (e.g. top 20, hair 40, hat 50, back-facing hair 5). */
export const BODY_LAYER = 10;

export interface ResolveLayersOptions {
  /** Current body anim (e.g. "idle", "hurt"): selects face/eyes expressions via faceAnims. */
  anim?: string;
  /** Runtime expression key (emote, dialogue), independent of Appearance; wins over faceAnims. Unknown keys fall back to faceAnims / base art. */
  expression?: string;
}
const FACE_SLOTS: ReadonlySet<WearableSlot> = new Set<WearableSlot>(["face", "eyes"]);

/**
 * Ordered back-to-front draw list for the Renderer. Assumes a validated appearance (call validateAppearance first);
 * silently skips unknown/incompatible parts. Respects hidesSlots and hatHair. One entry per wearable layer.
 * Sort: layer, z, slot index, layer index.
 */
export function resolveLayers(cat: CosmeticCatalogLike, a: AppearanceValue, facing: number, opts: ResolveLayersOptions = {}): DrawLayer[] {
  const body = BODY_TYPES[a.bodyType] ?? "male"; const neutral = cat.tintNeutral ?? DEFAULT_TINT_NEUTRAL;
  const out: (DrawLayer & { order: number })[] = [];
  const b = cat.bodySprite(body);
  if (b) out.push({ slot: "body", wearable: 0, sprite: b.sprite, anim: b.anim, layer: BODY_LAYER, z: 0, order: -1, tintR: cat.skinTones[a.skinTone]?.color ?? cat.skinTones[0]?.color ?? 0xffffff, tintNeutral: neutral });
  const worn: (WearableDef | undefined)[] = WEARABLE_SLOTS.map((s, i) => { const w = a.parts[i] ? cat.wearable(a.parts[i]!) : undefined; return w && w.slot === s && w.bodies[body] ? w : undefined; });
  const hidden = new Set<WearableSlot>(); let hatHair = false;
  for (const w of worn) if (w) { for (const h of w.hidesSlots) hidden.add(h); if (w.hatHair) hatHair = true; }
  worn.forEach((w, i) => {
    if (!w || hidden.has(w.slot)) return;
    const pal = cat[SLOT_PALETTE[w.slot]];
    let expr: string | undefined; let exprArt: { sprite: number; anim: string } | undefined;
    if (FACE_SLOTS.has(w.slot) && w.expressions) {
      for (const k of [opts.expression, opts.anim !== undefined ? (w.faceAnims ?? cat.faceAnims)?.[opts.anim] : undefined]) {
        const e = k !== undefined ? w.expressions[k]?.[body] : undefined; if (e) { expr = k; exprArt = e; break; }
      }
    }
    const layers: (WearableLayerProps & { name?: string; bodies: Partial<Record<BodyType, WearableBodyArt>> })[] = w.layers?.length ? w.layers : [w];
    layers.forEach((L, li) => {
      let art: { sprite: number; anim: string } | undefined = L.bodies[body]; if (!art) return;
      if (w.slot === "hair" && hatHair) { art = L.bodies[body]!.hatHair; if (!art) return; }
      if (exprArt && li === 0) art = exprArt;
      const tc = L.tintChannels; const om = L.outlineMode ?? normalizeOutline(L.outline);
      out.push({ slot: w.slot, wearable: w.id, sprite: art.sprite, anim: art.anim, layer: layerForFacing(L, facing), z: L.z, order: i * 64 + li,
        ...(L.name !== undefined && w.layers?.length ? { layerName: L.name } : {}),
        ...(tc >= 1 ? { tintR: pal[a.primary[i] ?? 0]?.color ?? 0xffffff, tintNeutral: L.tintNeutral ?? w.tintNeutral ?? neutral } : {}),
        ...(tc >= 2 ? { tintG: pal[a.secondary[i] ?? 0]?.color ?? 0xffffff } : {}),
        ...(L.tintMode !== undefined ? { tintMode: L.tintMode } : {}), ...(L.tintStrength !== undefined ? { tintStrength: L.tintStrength } : {}),
        ...(L.tintSaturation !== undefined ? { tintSaturation: L.tintSaturation } : {}), ...(L.minor !== undefined ? { minor: L.minor } : {}),
        ...(om !== undefined ? { outline: om === "body", outlineMode: om } : {}),
        ...(expr !== undefined && li === 0 ? { expression: expr } : {}) });
    });
  });
  out.sort((x, y) => x.layer - y.layer || x.z - y.z || x.order - y.order);
  return out.map(({ order: _o, ...l }) => l);
}

/** Read an entity's Appearance as a plain value (copies arrays); undefined if absent. */
export function getAppearance(world: World, e: Entity): (AppearanceValue & { version: number }) | undefined {
  const v = world.get(e, Appearance); if (!v) return undefined;
  return { bodyType: v.bodyType, skinTone: v.skinTone, version: v.version, parts: [...v.parts], primary: [...v.primary], secondary: [...v.secondary] };
}
/**
 * The only sanctioned Appearance writer: adds or overwrites the component and bumps `version` (wraps at 0xffff -> 0).
 * Validate first (validateAppearance); this does not. Returns the new version.
 */
export function setAppearance(world: World, e: Entity, value: AppearanceValue): number {
  const prev = world.get(e, Appearance);
  const version = prev ? (prev.version + 1) & 0xffff : 0;
  const init = { bodyType: value.bodyType, skinTone: value.skinTone, version, parts: value.parts, primary: value.primary, secondary: value.secondary };
  if (prev) world.set(e, Appearance, init); else world.add(e, Appearance, init);
  return version;
}
