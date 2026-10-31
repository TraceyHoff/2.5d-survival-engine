import { describe, it, expect } from "vitest";
import { defineComponent, Transform, type ComponentDef, type World } from "@engine/core";
import { bagExpiryTick, bagSpawnTick, Container, DESPAWN, LootBag, LootSource } from "@engine/gameplay";
import { MemoryWorldStore } from "../src/index.js";
import { makeWorld, step } from "./helpers.js";

/** ADR-238: the despawn timer is data (absolute ticks) in the persisted LootBag, so it survives save/load + restarts. */
const OldLootBag = defineComponent("LootBag", { owner: "u32", despawnAtTick: "u32" }, { networked: true, persistent: true }) as ComponentDef;
const reg = (bag: ComponentDef) => (w: World) => { w.register(Container); w.register(bag); };

describe("ADR-238 LootBag despawn persistence", () => {
  it("spawnTick / kind / emptiedTick round-trip through a chunk save + reload", async () => {
    const store = new MemoryWorldStore();
    const a = makeWorld(store, { setup: reg(LootBag) }); a.chunks.setSource({ id: 1, x: 16, y: 16 }); step(a.world);
    const e = a.world.create(); a.world.add(e, Transform, { x: 5, y: 5 }).add(e, Container, { slotCount: 4 })
      .add(e, LootBag, { owner: 9, despawnAtTick: 3_000_000 + 36_000, spawnTick: 3_000_000, kind: LootSource.Death, emptiedTick: 3_000_500 });
    step(a.world); await a.persist.saveAll();
    const b = makeWorld(store, { setup: reg(LootBag) }); b.chunks.setSource({ id: 1, x: 16, y: 16 }); step(b.world);
    const [x] = [...b.world.query([LootBag])]; const lb = b.world.get(x!, LootBag)!;
    expect(lb).toEqual({ owner: 9, despawnAtTick: 3_036_000, spawnTick: 3_000_000, kind: LootSource.Death, emptiedTick: 3_000_500 });
    expect(bagExpiryTick(lb)).toBe(3_000_500 + Math.ceil(DESPAWN.emptiedSeconds * 20)); // emptied grace survives too
  });
  it("pre-ADR-238 bags (owner + despawnAtTick only) load migrated: new fields zero = legacy, spawn derived, timer kept", async () => {
    const store = new MemoryWorldStore();
    const a = makeWorld(store, { setup: reg(OldLootBag) }); a.chunks.setSource({ id: 1, x: 16, y: 16 }); step(a.world);
    const e = a.world.create(); a.world.add(e, Transform, { x: 5, y: 5 }).add(e, Container, { slotCount: 4 }).add(e, OldLootBag, { owner: 4, despawnAtTick: 50_000 } as never);
    step(a.world); await a.persist.saveAll();
    const b = makeWorld(store, { setup: reg(LootBag) }); b.chunks.setSource({ id: 1, x: 16, y: 16 }); step(b.world);
    expect(b.persist.stats.decodeErrors).toBe(0); expect(b.persist.stats.migratedChunks).toBeGreaterThan(0);
    const [x] = [...b.world.query([LootBag])]; const lb = b.world.get(x!, LootBag)!;
    expect(lb).toMatchObject({ owner: 4, despawnAtTick: 50_000, spawnTick: 0, kind: 0, emptiedTick: 0 });
    expect(bagSpawnTick(lb)).toBe(50_000 - Math.ceil(DESPAWN.legacyBagSeconds * 20)); expect(bagExpiryTick(lb)).toBe(50_000);
  });
});
