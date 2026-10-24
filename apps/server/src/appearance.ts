/** Random server-side character looks (replicated via Appearance). The old starter camp seeding was removed (ADR-106). */
import { BODY_TYPES, SLOT_COUNT, WEARABLE_SLOTS, SLOT_PALETTE, defaultAppearance, setAppearance, validateAppearance, type CosmeticCatalogLike, type Entity, type World } from "@engine/core";

/** Random valid look from the catalog (server-side; replicated via Appearance). */
export function randomAppearance(cat: CosmeticCatalogLike, rnd: () => number): ReturnType<typeof defaultAppearance> {
  const bt = Math.floor(rnd() * BODY_TYPES.length); const body = BODY_TYPES[bt]!;
  const a = defaultAppearance(cat, bt); a.skinTone = Math.floor(rnd() * Math.max(1, cat.skinTones.length));
  const bySlot = new Map<string, number[]>();
  for (let id = 1, miss = 0; miss < 256; id++) { const w = cat.wearable(id); if (!w) { miss++; continue; } miss = 0; if (w.bodies[body] && !w.unlockTags.length) { const l = bySlot.get(w.slot) ?? []; l.push(id); bySlot.set(w.slot, l); } }
  const optional = new Set(["hat", "accessory", "face"]);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = WEARABLE_SLOTS[i]!; const l = bySlot.get(slot) ?? [];
    if (l.length && !(optional.has(slot) && rnd() < 0.5)) a.parts[i] = l[Math.floor(rnd() * l.length)]!;
    const n = Math.max(1, cat[SLOT_PALETTE[slot]].length); a.primary[i] = Math.floor(rnd() * n); a.secondary[i] = Math.floor(rnd() * n);
  }
  return validateAppearance(cat, a).value ?? defaultAppearance(cat, bt);
}
export function giveRandomAppearance(world: World, e: Entity, cat: CosmeticCatalogLike, rnd: () => number): void { setAppearance(world, e, randomAppearance(cat, rnd)); }
