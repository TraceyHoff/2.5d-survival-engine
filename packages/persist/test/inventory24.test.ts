import { describe, it, expect } from "vitest";
import { defineComponent, schemaHash, Transform, type ComponentDef, type Entity, type Schema, type World } from "@engine/core";
import { Inventory, PACK_SLOTS } from "@engine/gameplay";
import { decodePlayerInto, encodePlayer, MemoryWorldStore } from "../src/index.js";
import { oldSchemaOf } from "../src/migrate.js";
import { makeWorld, step } from "./helpers.js";

/** Task 9: the pre-change gameplay Inventory (16-wide arrays), with and without crafterId. */
const L = 16;
const legacy = (crafter: boolean): Schema => ({
  slotCount: { type: "u8", default: 16 }, maxWeight: { type: "f32", default: 60 }, weight: "f32", spoilMul: { type: "f32", default: 1 },
  items: { type: "u16", length: L }, counts: { type: "u16", length: L }, createdTick: { type: "u32", length: L }, durability: { type: "u16", length: L },
  ...(crafter ? { crafterId: { type: "u32", length: L } } : {}),
}) as Schema;
const Old16 = defineComponent("Inventory", legacy(true), { networked: true, persistent: true }) as ComponentDef;
const Old16NoCrafter = defineComponent("Inventory", legacy(false), { networked: true, persistent: true }) as ComponentDef;
const arr = (w: World, e: Entity, f: string): number[] => {
  const st = w.store(Inventory); const n = (st.lengths as Record<string, number>)[f]!; const s = st.slot((e as number) & 0xfffff);
  return Array.from((st.data as unknown as Record<string, ArrayLike<number>>)[f]!).slice(s * n, s * n + n);
};
const seq = (n: number, k: number): number[] => Array.from({ length: n }, (_, i) => k + i);
const pad = (a: number[]): number[] => [...a, ...new Array(PACK_SLOTS + 8 - a.length).fill(0)];

describe("Inventory 16 -> 24 slot persist migration (Task 9: separate hotbar)", () => {
  it("the legacy layout really is the old Inventory (hash of current schema with 16-wide arrays)", () => {
    expect(Inventory.schema.items).toMatchObject({ length: PACK_SLOTS + 8 });
    const g = { items: L, counts: L, createdTick: L, durability: L, crafterId: L };
    expect(schemaHash(oldSchemaOf(Inventory.schema, [], g, { slotCount: 16 }))).toBe(schemaHash(Old16.schema));
    expect(schemaHash(oldSchemaOf(Inventory.schema, ["crafterId"], g, { slotCount: 16 }))).toBe(schemaHash(Old16NoCrafter.schema));
  });
  for (const [name, OldDef, crafter] of [["16-slot", Old16, true], ["16-slot pre-crafterId", Old16NoCrafter, false]] as const) {
    it(`chunk rows with ${name} inventories load: slots intact, new hotbar tail empty`, async () => {
      const store = new MemoryWorldStore();
      const a = makeWorld(store, { setup: (w) => { w.register(OldDef); } }); a.chunks.setSource({ id: 1, x: 16, y: 16 }); step(a.world);
      const e = a.world.create();
      a.world.add(e, Transform, { x: 3, y: 4 }).add(e, OldDef, { slotCount: 16, maxWeight: 60, weight: 12.5, items: seq(L, 1), counts: seq(L, 100), createdTick: seq(L, 5000), durability: seq(L, 7), ...(crafter ? { crafterId: seq(L, 900) } : {}) } as never);
      step(a.world); await a.persist.saveAll();
      const b = makeWorld(store, { setup: (w) => { w.register(Inventory); } }); b.chunks.setSource({ id: 1, x: 16, y: 16 }); step(b.world);
      expect(b.persist.stats.decodeErrors).toBe(0); expect(b.persist.stats.migratedChunks).toBeGreaterThan(0);
      const found = [...b.world.query([Inventory])]; expect(found.length).toBe(1); const x = found[0]!;
      expect(b.world.getField(x, Inventory, "slotCount")).toBe(16); expect(b.world.getField(x, Inventory, "maxWeight")).toBeCloseTo(60);
      // Old items land in the pack (slots 0..15); the new hotbar tail (16..23) starts empty.
      expect(arr(b.world, x, "items")).toEqual(pad(seq(L, 1))); expect(arr(b.world, x, "counts")).toEqual(pad(seq(L, 100)));
      expect(arr(b.world, x, "crafterId")).toEqual(crafter ? pad(seq(L, 900)) : pad([]));
    });
  }
  it("player records carrying a 16-slot Inventory restore it widened", () => {
    const a = makeWorld(new MemoryWorldStore(), { setup: (w) => w.register(Old16) }).world;
    const p = a.create(); a.add(p, Old16, { slotCount: 10, items: [5, 0, 6], counts: [1, 0, 2], crafterId: [0, 0, 77] } as never);
    const bytes = encodePlayer(a, p);
    const b = makeWorld(new MemoryWorldStore(), { setup: (w) => w.register(Inventory) }).world; const q = b.create();
    const r = decodePlayerInto(b, q, bytes);
    expect(r.migrated).toContain("Inventory");
    expect(b.getField(q, Inventory, "slotCount")).toBe(10);
    expect(arr(b, q, "items")).toEqual(pad([5, 0, 6])); expect(arr(b, q, "crafterId")).toEqual(pad([0, 0, 77]));
    expect(decodePlayerInto(b, q, bytes, { migrations: [] }).skipped).toContain("Inventory");
  });
});
