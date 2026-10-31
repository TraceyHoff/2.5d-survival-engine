// ADR-250: a placed Basic Storage Box and its contents survive save -> reload (chunk unload/reload and a fresh host), and
// the reloaded box is still a working 12-slot container that never became a timed loot bag.
import { describe, it, expect } from "vitest";
import { World } from "@engine/core";
import { ProceduralGenerator } from "@engine/world";
import { ChunkManager } from "@engine/world";
import { AttachKind, BuildPiece, Container, LootBag, addItem, countItem, gameplayDefs, installGameplay, listSlots, placePiece, resolveAttachment, snapPlacement } from "@engine/gameplay";
import { MemoryWorldStore, WorldPersistence, type WorldStore } from "../src/index.js";
import { gameplayStructures } from "../src/gameplay.js";

function host(store: WorldStore) {
  const world = new World({ seed: 5, maxEntities: 1 << 16 }); installGameplay(world, { role: "server" });
  const persist = new WorldPersistence({ world, store, generator: new ProceduralGenerator({ seed: 5 }), autosaveSeconds: 0, playerSaveSeconds: 0, sidecars: [gameplayStructures()] });
  const chunks = new ChunkManager({ provider: persist.provider, loadRadius: 0, unloadMargin: 0, cacheSize: 0 });
  persist.attach(chunks); world.addSystem("postSim", "test.chunks", () => chunks.update());
  chunks.setSource({ id: 1, x: 16, y: 16 }); chunks.update();
  return { world, persist, chunks, step: (n = 1) => { for (let i = 0; i < n; i++) world.step(1 / 20); } };
}
const boxes = (w: World) => { const d = gameplayDefs(w); const t = d.pieceId("basic_storage_box"); return [...w.query([BuildPiece])].filter((e) => w.getField(e, BuildPiece, "type") === t); };
// `created` (spoil clock) is re-based on load by the existing persistence path; compare item/count/slot only.
const items = (w: World, e: number) => listSlots(w, e).map(({ slot, item, count }) => ({ slot, item, count }));
const store = (w: World, e: number) => resolveAttachment(w, e, AttachKind.Storage)!;

describe("ADR-250 basic storage box persistence", () => {
  it("round-trips placement + contents across chunk unload/reload and a server restart", async () => {
    const mem = new MemoryWorldStore(); const a = host(mem); a.step();
    const d = gameplayDefs(a.world); const it = (k: string) => d.itemId(k);
    const sn = snapPlacement(a.world, { piece: d.pieceId("basic_storage_box"), x: 10.5, y: 12.5, level: 0, rot: 1, tier: 1, variant: 0 });
    if (typeof sn === "number") throw new Error(`snap ${sn}`);
    const box = placePiece(a.world, 0, sn, { pay: false }); const st = store(a.world, box);
    addItem(a.world, st, it("stone"), 40); addItem(a.world, st, it("fiber"), 12); addItem(a.world, st, it("sticks"), 7);
    const contents = items(a.world, st); a.step(3);
    a.chunks.setSource({ id: 1, x: 500, y: 500 }); a.step(2); expect(boxes(a.world)).toEqual([]);
    a.chunks.setSource({ id: 1, x: 16, y: 16 }); a.step(3);
    const [again] = boxes(a.world); expect(again).toBeDefined(); expect(items(a.world, store(a.world, again!))).toEqual(contents);
    await a.persist.saveAll();

    const b = host(mem); b.step(3);
    const [r] = boxes(b.world); expect(r).toBeDefined();
    const bs = store(b.world, r!); expect(b.world.get(bs, Container)!.slotCount).toBe(12);
    expect(b.world.getField(r!, BuildPiece, "rot")).toBe(1);
    expect(items(b.world, bs)).toEqual(contents); expect(countItem(b.world, bs, it("stone"))).toBe(40);
    expect(b.world.has(r!, LootBag) || b.world.has(bs, LootBag)).toBe(false);
  });
});
