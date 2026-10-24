import { describe, it, expect } from "vitest";
import { defineComponent, schemaHash, Transform, type ComponentDef, type Entity, type Schema, type World } from "@engine/core";
import { Container, CONTAINER_LEGACY_SLOTS, CONTAINER_MAX_SLOTS } from "@engine/gameplay";
import { decodePlayerInto, encodePlayer, MemoryWorldStore } from "../src/index.js";
import { oldSchemaOf } from "../src/migrate.js";
import { makeWorld, step } from "./helpers.js";

/** ADR-098: the pre-change gameplay Container (24-wide arrays), with and without crafterId. */
const L = CONTAINER_LEGACY_SLOTS;
const legacy = (crafter: boolean): Schema => ({
  slotCount: { type: "u8", default: 12 }, maxWeight: "f32", weight: "f32", spoilMul: { type: "f32", default: 1 },
  items: { type: "u16", length: L }, counts: { type: "u16", length: L }, createdTick: { type: "u32", length: L }, durability: { type: "u16", length: L },
  ...(crafter ? { crafterId: { type: "u32", length: L } } : {}),
}) as Schema;
const Old24 = defineComponent("Container", legacy(true), { networked: true, persistent: true }) as ComponentDef;
const Old24NoCrafter = defineComponent("Container", legacy(false), { networked: true, persistent: true }) as ComponentDef;
const arr = (w: World, e: Entity, f: string): number[] => {
  const st = w.store(Container); const n = (st.lengths as Record<string, number>)[f]!; const s = st.slot((e as number) & 0xfffff);
  return Array.from((st.data as unknown as Record<string, ArrayLike<number>>)[f]!).slice(s * n, s * n + n);
};
const seq = (n: number, k: number): number[] => Array.from({ length: n }, (_, i) => k + i);
const pad = (a: number[]): number[] => [...a, ...new Array(CONTAINER_MAX_SLOTS - a.length).fill(0)];

describe("Container 24 -> 96 slot persist migration (ADR-098)", () => {
  it("the legacy layout really is the old Container (hash of current schema with 24-wide arrays)", () => {
    expect(Container.schema.items).toMatchObject({ length: CONTAINER_MAX_SLOTS });
    const g = { items: L, counts: L, createdTick: L, durability: L, crafterId: L };
    expect(schemaHash(oldSchemaOf(Container.schema, [], g))).toBe(schemaHash(Old24.schema));
    expect(schemaHash(oldSchemaOf(Container.schema, ["crafterId"], g))).toBe(schemaHash(Old24NoCrafter.schema));
  });
  for (const [name, OldDef, crafter] of [["24-slot", Old24, true], ["24-slot pre-crafterId", Old24NoCrafter, false]] as const) {
    it(`chunk rows with ${name} containers load: slots, slotCount and weights intact, new tail empty`, async () => {
      const store = new MemoryWorldStore();
      const a = makeWorld(store, { setup: (w) => { w.register(OldDef); } }); a.chunks.setSource({ id: 1, x: 16, y: 16 }); step(a.world);
      const e = a.world.create();
      a.world.add(e, Transform, { x: 3, y: 4 }).add(e, OldDef, { slotCount: 24, maxWeight: 150, weight: 12.5, items: seq(L, 1), counts: seq(L, 100), createdTick: seq(L, 5000), durability: seq(L, 7), ...(crafter ? { crafterId: seq(L, 900) } : {}) } as never);
      step(a.world); await a.persist.saveAll();
      const b = makeWorld(store, { setup: (w) => { w.register(Container); } }); b.chunks.setSource({ id: 1, x: 16, y: 16 }); step(b.world);
      expect(b.persist.stats.decodeErrors).toBe(0); expect(b.persist.stats.migratedChunks).toBeGreaterThan(0);
      const found = [...b.world.query([Container])]; expect(found.length).toBe(1); const x = found[0]!;
      expect(b.world.getField(x, Container, "slotCount")).toBe(24); expect(b.world.getField(x, Container, "maxWeight")).toBeCloseTo(150);
      expect(b.world.getField(x, Container, "weight")).toBeCloseTo(12.5);
      expect(arr(b.world, x, "items")).toEqual(pad(seq(L, 1))); expect(arr(b.world, x, "counts")).toEqual(pad(seq(L, 100)));
      expect(arr(b.world, x, "createdTick")).toEqual(pad(seq(L, 5000))); expect(arr(b.world, x, "durability")).toEqual(pad(seq(L, 7)));
      expect(arr(b.world, x, "crafterId")).toEqual(crafter ? pad(seq(L, 900)) : pad([]));
      expect(b.world.getField(x, Transform, "x")).toBeCloseTo(3);
    });
  }
  it("player records carrying a 24-slot Container restore it widened (was: skipped)", () => {
    const a = makeWorld(new MemoryWorldStore(), { setup: (w) => w.register(Old24) }).world;
    const p = a.create(); a.add(p, Old24, { slotCount: 10, items: [5, 0, 6], counts: [1, 0, 2], crafterId: [0, 0, 77] } as never);
    const bytes = encodePlayer(a, p);
    const b = makeWorld(new MemoryWorldStore(), { setup: (w) => w.register(Container) }).world; const q = b.create();
    const r = decodePlayerInto(b, q, bytes);
    expect(r.migrated).toContain("Container");
    expect(b.getField(q, Container, "slotCount")).toBe(10);
    expect(arr(b, q, "items")).toEqual(pad([5, 0, 6])); expect(arr(b, q, "crafterId")).toEqual(pad([0, 0, 77]));
    expect(decodePlayerInto(b, q, bytes, { migrations: [] }).skipped).toContain("Container");
  });
});
