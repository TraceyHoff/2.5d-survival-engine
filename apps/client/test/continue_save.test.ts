import { describe, it, expect } from "vitest";
// @ts-expect-error untyped relative path into persist's dev dependency
import { IDBFactory } from "../../../packages/persist/node_modules/fake-indexeddb/build/esm/index.js";
import { IndexedDbWorldStore } from "@engine/persist";
import { createLocalServer } from "../src/local.js";

// Regression: "Continue" on a saved singleplayer world left a blank light-blue screen. With an async (IndexedDB) store
// the spawn-area preload in createGameServer spun forever waiting for in-flight chunk reads that can only settle on a
// later microtask, so the worker never came up and the in-tab fallback locked the page.
describe("continue a saved singleplayer world (IndexedDB)", () => {
  it("reopens without hanging and streams the saved chunks in", async () => {
    const factory = new IDBFactory();
    const a = await createLocalServer({ store: await IndexedDbWorldStore.open("continue-test", { factory }), seed: 7, bots: 2 });
    for (let i = 0; i < 120; i++) a.pump?.(16);
    await a.game.persist?.saveAll(); await a.stop();
    const s2 = await IndexedDbWorldStore.open("continue-test", { factory });
    expect(s2.readMeta()).toBeDefined();
    const b = await createLocalServer({ store: s2, seed: 7, bots: 2 });
    for (let i = 0; i < 30 && b.game.chunks.inflightLoads > 0; i++) { await new Promise((r) => setTimeout(r, 10)); b.pump?.(16); }
    expect(b.game.chunks.inflightLoads).toBe(0);
    expect(b.game.chunks.activeKeys.size).toBeGreaterThan(0);
    await b.stop();
  }, 120000);
});
