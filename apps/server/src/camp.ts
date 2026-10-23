/**
 * Starter camp for the demo/offline world, seeded authoritatively on the server through gameplay's building API
 * (snapPlacement + placePiece, no cost) so pieces replicate like player-built ones: foundations, walls, a doorway +
 * wooden door, a flat roof, a campfire, workbench, chests, furnace, torch stands and lanterns. Fired pieces are lit
 * with a long burn so the camp glows at night. Idempotent: skipped when any BuildPiece already stands in the area.
 */
import { BODY_TYPES, SLOT_COUNT, WEARABLE_SLOTS, SLOT_PALETTE, Transform, defaultAppearance, setAppearance, validateAppearance, type CosmeticCatalogLike, type Entity, type World } from "@engine/core";
import { BuildPiece, Fuel, PieceLink, ResourceNode, gameplayDefs, placePiece, setEmittersLit, snapPlacement } from "@engine/gameplay";

export interface CampLayout { x: number; y: number }
/** Hut 3x3 at (x..x+2, y..y+2), door on the south (+y) wall, yard to the south/east. */
export function seedStarterCamp(world: World, at: CampLayout): Entity[] {
  const { x, y } = at; const defs = gameplayDefs(world);
  for (const e of world.query([BuildPiece, Transform])) { const t = world.get(e, Transform)!; if (Math.abs(t.x - x - 2) < 8 && Math.abs(t.y - y - 2) < 8) return []; }
  // clear generated resource nodes from the footprint + yard
  for (const e of [...world.query([ResourceNode, Transform])]) { const t = world.get(e, Transform)!; if (t.x > x - 3 && t.x < x + 7 && t.y > y - 3 && t.y < y + 8) world.destroy(e); }
  const out: Entity[] = [];
  const place = (key: string, px: number, py: number, o: { level?: number; rot?: number; tier?: number; variant?: number } = {}): Entity | undefined => {
    let id: number; try { id = defs.pieceId(key); } catch { return undefined; }
    const sn = snapPlacement(world, { piece: id, x: px, y: py, level: o.level ?? 0, rot: o.rot ?? 0, tier: o.tier ?? 1, variant: o.variant ?? 0 });
    if (typeof sn === "number") return undefined;
    const e = placePiece(world, 0, sn, { pay: false }); out.push(e); return e;
  };
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) place("foundation", x + i + 0.5, y + j + 0.5);
  for (let i = 0; i < 3; i++) {
    place("wall", x + i + 0.5, y + 0.02);                    // north
    if (i === 1) place("wall_doorway", x + i + 0.5, y + 3 - 0.02); else place("wall_window", x + i + 0.5, y + 3 - 0.02); // south
    place("wall", x + 0.02, y + i + 0.5);                    // west
    place(i === 1 ? "wall_window" : "wall", x + 3 - 0.02, y + i + 0.5); // east
  }
  place("door_wood", x + 1.5, y + 3 - 0.02);
  place("window_glass", x + 0.5, y + 3 - 0.02); place("window_glass", x + 2.5, y + 3 - 0.02); place("window_glass", x + 3 - 0.02, y + 1.5);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) place("roof_flat", x + i + 0.5, y + j + 0.5, { level: 1 });
  // interior
  place("storage_box", x + 0.5, y + 0.5); place("large_chest", x + 2, y + 0.5); place("lantern", x + 1.5, y + 1.5);
  // yard
  place("campfire", x + 1.5, y + 5.5);
  place("workbench", x + 4.5, y + 3.5); place("storage_box", x + 4, y + 1); place("furnace", x + 5, y + 5.5);
  place("torch_stand", x - 0.5, y + 3.5); place("torch_stand", x + 3.5, y + 3.5); place("torch_stand", x - 1, y + 6.5); place("torch_stand", x + 4, y + 7);
  place("lantern", x + 5.5, y + 2);
  // light every fire for the demo (long burn; fuel system keeps it lit until burnUntilTick)
  for (const e of world.query([Fuel])) if (world.has(e, PieceLink)) { world.set(e, Fuel, { lit: 1, burnUntilTick: 0x7fffffff }); setEmittersLit(world, e, 1); }
  return out;
}

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
