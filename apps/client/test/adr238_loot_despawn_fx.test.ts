import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Transform, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { LootPuffTracker } from "../src/fx/loot-puff.js";

/** ADR-238 client side: puff only where a bag despawned (timer/emptied), not where it left interest range; gentle sprite fade wiring. */
const mkWorld = () => { const w = new World({ seed: 1 }); w.register(Transform); w.register(G.LootBag); return w; };
const bag = (w: World, x: number, lb: Partial<{ despawnAtTick: number; emptiedTick: number }>) => { const e = w.create(); w.add(e, Transform, { x, y: 2, z: 0 }).add(e, G.LootBag, { owner: 0, despawnAtTick: 1e6, spawnTick: 0, kind: G.LootSource.Dropped, emptiedTick: 0, ...lb }); return e; };

describe("ADR-238 loot despawn FX", () => {
  it("puffs for a bag removed at its expiry (timer or emptied grace), not for one removed early (AOI exit) or a permanent crate", () => {
    const w = mkWorld(); w.tick = 1000; const tr = new LootPuffTracker(); const puffs: number[] = []; const on = (x: number) => puffs.push(x);
    const timed = bag(w, 1, { despawnAtTick: 1010 }); const early = bag(w, 2, { despawnAtTick: 50_000 });
    const emptied = bag(w, 3, { emptiedTick: 1000 - G.DESPAWN.emptiedSeconds * 20 + 5 }); const crate = bag(w, 4, { despawnAtTick: G.PERMANENT_DESPAWN });
    tr.step(w, true, on); expect(tr.tracked).toBe(4); expect(puffs).toEqual([]);
    w.tick = 1012; w.destroy(timed); w.destroy(early); w.destroy(emptied); w.destroy(crate); tr.step(w, true, on);
    expect(puffs.sort()).toEqual([1, 3]); expect(tr.tracked).toBe(0);
  });
  it("no puff while not live (loading / replay), and the tracker forgets on reset", () => {
    const w = mkWorld(); w.tick = 10; const tr = new LootPuffTracker(); const puffs: number[] = [];
    const e = bag(w, 1, { despawnAtTick: 12 }); tr.step(w, true, (x) => puffs.push(x)); w.tick = 13; w.destroy(e); tr.step(w, false, (x) => puffs.push(x));
    expect(puffs).toEqual([]); bag(w, 2, {}); tr.step(w, true, () => {}); tr.reset(); expect(tr.tracked).toBe(0);
  });
  it("the view fades LootBag sprites via SpriteAlpha from despawnFadeAlpha; the director drives the puff; renderers honour SpriteAlpha", () => {
    const v = readFileSync("apps/client/src/view.ts", "utf8");
    expect(v).toMatch(/net\.has\(e, LootBag\)\) this\.syncLootFade/); expect(v).toMatch(/despawnFadeAlpha\(lb, net\.tick/);
    expect(readFileSync("apps/client/src/fx/director.ts", "utf8")).toMatch(/this\.loot\.step\(w, live, this\.puff\)/);
    expect(readFileSync("packages/render/src/sprites.ts", "utf8")).toMatch(/SpriteAlpha/); expect(readFileSync("packages/render/src/canvas2d.ts", "utf8")).toMatch(/SpriteAlpha/);
  });
});
