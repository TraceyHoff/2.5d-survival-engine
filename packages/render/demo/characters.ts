/**
 * Demo: layered (paper-doll) characters using core Appearance + setAppearance and the DEBUG layer pack.
 * Modes (?chars=): lineup (varied outfits + status/hit flash + held items), facings (8 facings), crowd (N players).
 */
import { Appearance, SLOT_COUNT, Transform, WEARABLE_SLOTS, setAppearance, slotIndex, type AppearanceValue, type CosmeticCatalogLike, type Entity, type World, type WearableSlot } from "@engine/core";
import type { AssetRegistry } from "@engine/assets";
import type { ChunkedSpatialIndex } from "@engine/world";
import { Shadow, Sprite } from "../src/index.js";
import { AnimState, AnimStateId, BodyTemp, BuildPiece, Equipment, Wetness } from "./mockGameplay.js";
import { DEMO_ITEM } from "./scene.js";

type Cat = CosmeticCatalogLike & { byKey(k: string): { id: number } | undefined; skinTones: unknown[]; hairColors: unknown[]; clothingColors: unknown[] };

export function makeAppearance(cat: Cat, o: { body?: number; skin?: number; parts?: Partial<Record<WearableSlot, [string, number?, number?]>> }): AppearanceValue {
  const a: AppearanceValue = { bodyType: o.body ?? 0, skinTone: o.skin ?? 0, parts: new Array(SLOT_COUNT).fill(0), primary: new Array(SLOT_COUNT).fill(0), secondary: new Array(SLOT_COUNT).fill(0) };
  for (const [s, v] of Object.entries(o.parts ?? {})) { const i = slotIndex(s as WearableSlot); a.parts[i] = cat.byKey(v![0])?.id ?? 0; a.primary[i] = v![1] ?? 0; a.secondary[i] = v![2] ?? 0; }
  return a;
}

/** Deterministic varied outfit #n. */
export function variedAppearance(cat: Cat, n: number): AppearanceValue {
  const r = (k: number): number => { let x = Math.imul(n * 7919 + k * 104729 + 13, 0x9e3779b1); x ^= x >>> 15; return (x >>> 0) % 997; };
  const nc = cat.clothingColors.length, nh = cat.hairColors.length;
  return makeAppearance(cat, { body: n % 2, skin: r(1) % cat.skinTones.length, parts: {
    hair: [r(2) % 2 ? "dbg_hair_short" : "dbg_hair_alt", r(3) % nh],
    ...(r(4) % 3 === 0 ? { hat: ["dbg_hat_cap", r(5) % nc, r(6) % nc] as [string, number, number] } : {}),
    ...(r(7) % 3 === 0 ? { accessory: ["dbg_scarf", r(8) % nc, r(9) % nc] as [string, number, number] } : {}),
    top: [r(10) % 2 ? "dbg_top_a" : "dbg_top_c", r(11) % nc], bottom: ["dbg_bottom", r(12) % nc], shoes: ["dbg_shoes", r(13) % nc],
  } });
}

export interface CharacterDemo { entities: Entity[]; hitFlash: (e: Entity) => number }

export function spawnCharacters(world: World, reg: AssetRegistry, index: ChunkedSpatialIndex, at: { x: number; y: number; z: number }, mode: string, count: number, keep: readonly Entity[] = []): CharacterDemo {
  const cat = reg.cosmetics as unknown as Cat; const out: Entity[] = [];
  if (!cat) return { entities: out, hitFlash: () => 0 };
  // clear props (trees, rocks) from the stage so the lineup reads clearly
  const w = mode === "crowd" ? Math.ceil(Math.sqrt(count)) * 0.9 : mode === "facings" ? 6.5 : count * 1.1;
  const h = mode === "crowd" ? w : 1;
  for (const e of index.queryRect(at.x - 2, at.y - (mode === "facings" ? 8 : 4), at.x + w + 2, at.y + h + 2)) if (!keep.includes(e) && world.has(e, Sprite) && !world.has(e, AnimState) && !world.has(e, BuildPiece)) { index.remove(e); world.destroy(e); }
  if (!world.isRegistered(Appearance)) world.register(Appearance);
  const placeholder = reg.ids.sprites.tryId("dbg_a_body") ?? 0;
  const mk = (x: number, y: number, facing: number, a: AppearanceValue, state: number, k: number): Entity => {
    const e = world.create(); world.add(e, Transform, { x, y, z: at.z, facing });
    world.add(e, Sprite, { spriteId: placeholder, frameId: 0, flags: 0, scale: 1.4, tint: 0 }); world.add(e, Shadow, { alpha: 1, length: 1 });
    world.add(e, AnimState, { state, startTick: k * 5 });
    setAppearance(world, e, a); // sole sanctioned writer (bumps version)
    index.insert(e, x, y); out.push(e); return e;
  };
  if (mode === "facings") {
    const a = makeAppearance(cat, { body: 0, skin: 0, parts: { hair: ["dbg_hair_short", 1], accessory: ["dbg_scarf", 4, 5], top: ["dbg_top_a", 1], bottom: ["dbg_bottom", 3], shoes: ["dbg_shoes", 5] } });
    // one screen-horizontal row (iso screen x ~ x - y), facing k*45deg
    for (let k = 0; k < 8; k++) mk(at.x + k * 0.75, at.y - k * 0.75, k * Math.PI / 4, a, AnimStateId.Idle, 0);
  } else if (mode === "crowd") {
    const side = Math.ceil(Math.sqrt(count));
    for (let k = 0; k < count; k++) mk(at.x + (k % side) * 0.9, at.y + Math.floor(k / side) * 0.9, (k % 8) * Math.PI / 4, variedAppearance(cat, k), k % 3 ? AnimStateId.Walk : AnimStateId.Idle, k);
  } else {
    for (let k = 0; k < count; k++) {
      const e = mk(at.x + k * 1.1, at.y + (k % 2) * 0.5, Math.PI / 2 - (k % 3 - 1) * Math.PI / 4, variedAppearance(cat, k + 3), k % 4 === 1 ? AnimStateId.Walk : AnimStateId.Idle, k);
      if (k === 2) world.add(e, Wetness, { level: 255 });
      if (k === 4) world.add(e, BodyTemp, { cold: 220, heat: 0, shivering: 255 });
      if (k % 3 === 0) world.add(e, Equipment, { mainHandSlot: 0, mainHandItem: [DEMO_ITEM.iron_axe, DEMO_ITEM.torch, DEMO_ITEM.iron_sword][(k / 3) % 3]! });
    }
  }
  const flashE = mode === "lineup" ? out[6] : undefined;
  return { entities: out, hitFlash: (e) => (flashE !== undefined && e === flashE ? 0.45 : 0) };
}
export { WEARABLE_SLOTS };
