import { defineComponent } from "./component.js";

/**
 * Character customization (cosmetic paper-doll) contract. Pure data + helpers; no art, UI or rendering.
 * Cosmetics are separate from gameplay equipment: an item def may name an `equipCosmetic` wearable key that
 * overrides a slot visually (documented in docs/CHARACTER_CUSTOMIZATION.md, not wired yet).
 */
export const BODY_TYPES = ["male", "female"] as const;
export type BodyType = (typeof BODY_TYPES)[number];
/** Slot order is part of the wire/save layout (array index); only append. */
export const WEARABLE_SLOTS = ["hair", "hat", "accessory", "top", "bottom", "shoes", "face", "eyes"] as const;
export type WearableSlot = (typeof WEARABLE_SLOTS)[number];
export const SLOT_COUNT = WEARABLE_SLOTS.length;
export const slotIndex = (s: WearableSlot): number => WEARABLE_SLOTS.indexOf(s);
/** Which palette a slot's primary/secondary indices refer to. */
export const SLOT_PALETTE: Record<WearableSlot, "hairColors" | "clothingColors"> = {
  hair: "hairColors", hat: "clothingColors", accessory: "clothingColors", top: "clothingColors",
  bottom: "clothingColors", shoes: "clothingColors", face: "hairColors", eyes: "clothingColors",
};

/** Networked + persistent. parts[slot] = wearable id (0 = none); primary/secondary[slot] = palette index (u8). */
export const Appearance = defineComponent("Appearance", {
  bodyType: "u8", skinTone: "u8",
  parts: { type: "u16", length: SLOT_COUNT },
  primary: { type: "u8", length: SLOT_COUNT },
  secondary: { type: "u8", length: SLOT_COUNT },
}, { networked: true, persistent: true });

export interface AppearanceValue { bodyType: number; skinTone: number; parts: number[]; primary: number[]; secondary: number[] }

/** Per body-type art for one wearable (ids resolved by the assets loader). */
export interface WearableBodyArt { sprite: number; anim: string; /** alt art used when a hat sets `hatHair` (hair slot only) */ hatHair?: { sprite: number; anim: string } }
export interface WearableDef {
  id: number; key: string; slot: WearableSlot;
  /** Keyed by BodyType; a part is compatible only with listed body types. */
  bodies: Partial<Record<BodyType, WearableBodyArt>>;
  /** Draw order; higher = in front. `layerByDir` (4 entries: E,S,W,N by directionIndex4) overrides per facing. */
  layer: number; layerByDir?: number[]; z: number;
  /** Tintmask channels used: 0 = untinted, 1 = R<-primary, 2 = R<-primary + G<-secondary. */
  tintChannels: 0 | 1 | 2;
  hidesSlots: WearableSlot[];
  /** Hat only: hair draws its hatHair variant (or is hidden if the hair lacks one). */
  hatHair: boolean;
  unlockTags: string[];
}
export interface PaletteColor { index: number; key: string; color: number }
/** What core needs from the asset side (implemented by @engine/assets CosmeticCatalog). */
export interface CosmeticCatalogLike {
  wearable(id: number): WearableDef | undefined;
  bodySprite(bodyType: BodyType): { sprite: number; anim: string } | undefined;
  skinTones: PaletteColor[]; hairColors: PaletteColor[]; clothingColors: PaletteColor[];
  /** First compatible wearable per slot to use as default (0 = none); optional. */
  defaults?: Partial<Record<WearableSlot, number>>;
}

export function defaultAppearance(cat?: CosmeticCatalogLike, bodyType = 0): AppearanceValue {
  const parts = new Array<number>(SLOT_COUNT).fill(0);
  if (cat?.defaults) for (const [s, id] of Object.entries(cat.defaults)) {
    const w = cat.wearable(id ?? 0); if (w && w.bodies[BODY_TYPES[bodyType] ?? "male"]) parts[slotIndex(s as WearableSlot)] = id!;
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
  if (opts.mode === "reject" && issues.length) return { value: undefined, issues };
  return { value: out, issues };
}

export interface DrawLayer {
  /** "body" for the base body, else the slot name. */
  slot: "body" | WearableSlot; wearable: number; sprite: number; anim: string;
  layer: number; z: number;
  /** Tintmask R / G target colors (0xRRGGBB); undefined channel = untinted. Body: r = skin tone. */
  tintR?: number; tintG?: number;
}
/** 4-way direction index (0 = +x/E, 1 = +y/S, 2 = W, 3 = N), same convention as AssetRegistry.directionIndex. */
export function directionIndex4(facing: number): number {
  const a = ((facing % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return Math.round(a / (Math.PI / 2)) % 4;
}
/** Body draws at this layer; wearables author layers relative to it (e.g. top 20, hair 40, hat 50, back-facing hair 5). */
export const BODY_LAYER = 10;

/**
 * Ordered back-to-front draw list for the Renderer. Assumes a validated appearance (call validateAppearance first);
 * silently skips unknown/incompatible parts. Respects hidesSlots and hatHair. Sort: layer, z, slot index.
 */
export function resolveLayers(cat: CosmeticCatalogLike, a: AppearanceValue, facing: number): DrawLayer[] {
  const body = BODY_TYPES[a.bodyType] ?? "male"; const dir = directionIndex4(facing);
  const out: (DrawLayer & { order: number })[] = [];
  const b = cat.bodySprite(body);
  if (b) out.push({ slot: "body", wearable: 0, sprite: b.sprite, anim: b.anim, layer: BODY_LAYER, z: 0, order: -1, tintR: cat.skinTones[a.skinTone]?.color ?? cat.skinTones[0]?.color ?? 0xffffff });
  const worn: (WearableDef | undefined)[] = WEARABLE_SLOTS.map((s, i) => { const w = a.parts[i] ? cat.wearable(a.parts[i]!) : undefined; return w && w.slot === s && w.bodies[body] ? w : undefined; });
  const hidden = new Set<WearableSlot>(); let hatHair = false;
  for (const w of worn) if (w) { for (const h of w.hidesSlots) hidden.add(h); if (w.hatHair) hatHair = true; }
  worn.forEach((w, i) => {
    if (!w || hidden.has(w.slot)) return;
    let art: { sprite: number; anim: string } = w.bodies[body]!;
    if (w.slot === "hair" && hatHair) { const alt = w.bodies[body]!.hatHair; if (!alt) return; art = alt; }
    const pal = cat[SLOT_PALETTE[w.slot]];
    out.push({ slot: w.slot, wearable: w.id, sprite: art.sprite, anim: art.anim, layer: w.layerByDir?.[dir] ?? w.layer, z: w.z, order: i,
      ...(w.tintChannels >= 1 ? { tintR: pal[a.primary[i] ?? 0]?.color ?? 0xffffff } : {}),
      ...(w.tintChannels >= 2 ? { tintG: pal[a.secondary[i] ?? 0]?.color ?? 0xffffff } : {}) });
  });
  out.sort((x, y) => x.layer - y.layer || x.z - y.z || x.order - y.order);
  return out.map(({ order: _o, ...l }) => l);
}
