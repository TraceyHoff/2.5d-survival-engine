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

/**
 * ADR-252 / ADR-245: an AI human's look, derived from its persistent agent id (the same survivor looks the same after a
 * reload or reconnect). Skin tone is drawn uniformly over the whole current skin_tones.json palette (v2: 18 tones), so a
 * world's AI humans span light to deep; the rest (body, parts, colours) uses the random-look rules above.
 */
export function botAppearance(cat: CosmeticCatalogLike, agentId: string): ReturnType<typeof defaultAppearance> {
  let h = 0x811c9dc5; for (let i = 0; i < agentId.length; i++) h = Math.imul(h ^ agentId.charCodeAt(i), 0x01000193) >>> 0;
  let s = h || 1; const rnd = (): number => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const a = randomAppearance(cat, rnd); const n = cat.skinTones.length;
  if (n > 0) { const v = validateAppearance(cat, { ...a, skinTone: (Math.imul(h, 0x9e3779b1) >>> 0) % n }).value; if (v) return v; }
  return a;
}
export function giveBotAppearance(world: World, e: Entity, cat: CosmeticCatalogLike, agentId: string): void { setAppearance(world, e, botAppearance(cat, agentId)); }
