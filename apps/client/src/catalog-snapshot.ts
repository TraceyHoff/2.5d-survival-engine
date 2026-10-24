/**
 * Structured-clone snapshot of a CosmeticCatalogLike (ADR-105): the singleplayer server in a Web Worker needs the
 * catalog the main thread loaded with the asset manifest, but CosmeticCatalog is a class (methods do not survive
 * postMessage). Only what the server path uses is kept: wearables by id, body sprites/defaults, palettes and options.
 */
import { BODY_TYPES, type BodyType, type CosmeticCatalogLike, type PaletteColor, type WearableDef, type WearableSlot } from "@engine/core";

export interface CatalogSnapshot {
  parts: WearableDef[];
  bodies: Partial<Record<BodyType, { sprite: { sprite: number; anim: string } | undefined; defaults: Partial<Record<WearableSlot, number>> | undefined }>>;
  skinTones: PaletteColor[]; hairColors: PaletteColor[]; clothingColors: PaletteColor[];
  defaults?: Partial<Record<WearableSlot, number>>; requiredSlots?: readonly WearableSlot[]; tintNeutral?: number; faceAnims?: Record<string, string>;
  size: number;
}

/** Same enumeration the server's randomAppearance uses (ids 1.. until 256 consecutive misses). */
export function snapshotCatalog(cat: CosmeticCatalogLike): CatalogSnapshot {
  const parts: WearableDef[] = [];
  for (let id = 1, miss = 0; miss < 256; id++) { const w = cat.wearable(id); if (!w) { miss++; continue; } miss = 0; parts.push(w); }
  const bodies: CatalogSnapshot["bodies"] = {};
  for (const b of BODY_TYPES) bodies[b] = { sprite: cat.bodySprite(b), defaults: cat.bodyDefaults?.(b) };
  const s: CatalogSnapshot = { parts, bodies, skinTones: cat.skinTones, hairColors: cat.hairColors, clothingColors: cat.clothingColors, size: parts.length };
  if (cat.defaults) s.defaults = cat.defaults;
  if (cat.requiredSlots) s.requiredSlots = cat.requiredSlots;
  if (cat.tintNeutral !== undefined) s.tintNeutral = cat.tintNeutral;
  if (cat.faceAnims) s.faceAnims = cat.faceAnims;
  return JSON.parse(JSON.stringify(s)) as CatalogSnapshot; // plain data only (drops anything non-cloneable)
}

export function catalogFromSnapshot(s: CatalogSnapshot): CosmeticCatalogLike & { size: number } {
  const byId = new Map(s.parts.map((w) => [w.id, w]));
  const c: CosmeticCatalogLike & { size: number } = {
    size: s.size,
    wearable: (id) => byId.get(id),
    bodySprite: (b) => s.bodies[b]?.sprite,
    bodyDefaults: (b) => s.bodies[b]?.defaults,
    skinTones: s.skinTones, hairColors: s.hairColors, clothingColors: s.clothingColors,
  };
  if (s.defaults) c.defaults = s.defaults;
  if (s.requiredSlots) c.requiredSlots = s.requiredSlots;
  if (s.tintNeutral !== undefined) c.tintNeutral = s.tintNeutral;
  if (s.faceAnims) c.faceAnims = s.faceAnims;
  return c;
}
