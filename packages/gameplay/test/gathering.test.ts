import { describe, it, expect } from "vitest";
import {
  addItem, countItem, defaultDefs, Equipment, GatherFail, GatherFailed, GatherSwing, IntentAction, ItemGathered,
  NodeDepleted, NodeRegrow, NodeRespawned, ResourceNode, depleteNode, findRegrowSpot, PopulationTiles, Road, setIntent, spawnPlayer, spawnResourceNode, Survival,
} from "../src/index.js";
import { Transform } from "@engine/core";
import { collect, makeWorld, steps } from "./helpers.js";

const d = defaultDefs();
const WOOD = d.itemId("wood");

function gather(w: ReturnType<typeof makeWorld>, p: number, node: number, wait = 30): void {
  setIntent(w, p, { action: IntentAction.Gather, target: node }); w.step(1 / 20); steps(w, wait);
}

describe("gathering", () => {
  it("bare hands gather tool-free nodes; yields land in the inventory", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0 });
    const branches = spawnResourceNode(w, "fallen_branches", 1, 0);
    const got = collect(w, ItemGathered);
    gather(w, p, branches);
    const sticks = countItem(w, p, d.itemId("sticks")); // ADR-217: fallen branches are sticks (2..4), an odd log at most
    expect(sticks).toBeGreaterThanOrEqual(2); expect(sticks).toBeLessThanOrEqual(4);
    expect(got[0]).toMatchObject({ entity: p, node: branches, item: d.itemId("sticks"), count: sticks });
    expect(countItem(w, p, WOOD)).toBeLessThanOrEqual(1);
    expect(w.get(branches, ResourceNode)!.amount).toBe(2);
  });

  it("enforces tool kind and tier; higher tiers add bonus yield", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0, maxWeight: 0 });
    const tree = spawnResourceNode(w, "tree", 1, 0); const oak = spawnResourceNode(w, "oak_tree", 1, 0.5); // oak: axe tier 2 (no bare hands, ADR-107)
    const failed = collect(w, GatherFailed);
    gather(w, p, oak);
    expect(failed.at(-1)!.reason).toBe(GatherFail.WrongTool);
    addItem(w, p, d.itemId("stone_pickaxe"), 1); w.set(p, Equipment, { mainHandSlot: 0 });
    gather(w, p, oak);
    expect(failed.at(-1)!.reason).toBe(GatherFail.WrongTool);
    addItem(w, p, d.itemId("iron_axe"), 1); w.set(p, Equipment, { mainHandSlot: 1 });
    w.step(1 / 20);
    expect(w.get(p, Equipment)!.mainHandItem).toBe(d.itemId("iron_axe"));
    const got = collect(w, ItemGathered);
    for (let i = 0; i < 4; i++) gather(w, p, tree);
    const woodHits = got.filter((g) => g.item === WOOD).map((g) => g.count);
    expect(woodHits).toHaveLength(4);
    for (const n of woodHits) { expect(n).toBeGreaterThanOrEqual(4); expect(n).toBeLessThanOrEqual(6); } // 3..5 (ADR-217) + 1 tier bonus
  });

  it("depletes: node leaves the world, regrows elsewhere after respawnSeconds (ADR-134)", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0 });
    const grass = spawnResourceNode(w, "fiber_grass", 0, 1);
    const depleted = collect(w, NodeDepleted); const respawned = collect(w, NodeRespawned);
    gather(w, p, grass); gather(w, p, grass, 0);
    expect(depleted).toHaveLength(1);
    expect(w.isAlive(grass)).toBe(false);
    const regrow = [...w.query([NodeRegrow])]; expect(regrow).toHaveLength(1);
    const r = w.get(regrow[0]!, NodeRegrow)!;
    expect(r.respawnAtTick).toBe(w.tick - 1 + 90 * 20);
    expect(r.stumpUntilTick).toBe(0); // grass: no stump
    while (w.tick <= r.respawnAtTick) w.step(1 / 20);
    expect(respawned).toHaveLength(1);
    const n = respawned[0]!.node; expect(w.get(n, ResourceNode)!.amount).toBe(2);
    const t = w.get(n, Transform)!; const d = Math.hypot(t.x, t.y - 1);
    expect(d).toBeGreaterThanOrEqual(2); expect(d).toBeLessThanOrEqual(13.5);
    expect(Math.hypot(t.x, t.y)).toBeGreaterThanOrEqual(10); // clear of the player
    expect([...w.query([NodeRegrow])]).toHaveLength(0);
  });

  it("trees leave a stump; regrow spot avoids structures and roads and keeps the biome", () => {
    const w = makeWorld(); const d0 = defaultDefs();
    w.setResource(PopulationTiles, (tx: number) => (tx < 0 ? 1 : 4)); // west = water, east = forest
    const tree = spawnResourceNode(w, "tree", 0.5, 0.5);
    const g = depleteNode(w, tree, d0.resourceId("tree"), w.tick, 900);
    expect(w.get(g, NodeRegrow)!.stumpUntilTick).toBe(w.tick + 900);
    const road = w.create(); w.add(road, Transform, { x: 6, y: 0 }).add(road, Road, { surface: 1, mask: 0, owner: 0 });
    for (let i = 0; i < 40; i++) {
      const s = findRegrowSpot(w, 0.5, 0.5, w.rngFor("t", i))!;
      expect(s.x).toBeGreaterThan(0); // never in the water half
      expect(Math.hypot(s.x - 6, s.y)).toBeGreaterThanOrEqual(2);
    }
    w.setResource(PopulationTiles, () => 1); // all water: nowhere valid
    expect(findRegrowSpot(w, 0.5, 0.5, w.rngFor("t", 1))).toBeUndefined();
  });

  it("applies cooldown, reach and stamina cost", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0 });
    const rocks = spawnResourceNode(w, "loose_rocks", 1, 0);
    const far = spawnResourceNode(w, "loose_rocks", 10, 0);
    const failed = collect(w, GatherFailed);
    gather(w, p, rocks, 0);
    expect(w.get(p, Survival)!.stamina).toBeCloseTo(100 - 3, 3);
    gather(w, p, rocks, 0);
    expect(failed.at(-1)!.reason).toBe(GatherFail.Cooldown);
    steps(w, 30);
    gather(w, p, far);
    expect(failed.at(-1)!.reason).toBe(GatherFail.OutOfRange);
    w.set(p, Survival, { stamina: 1 });
    gather(w, p, rocks, 0);
    expect(failed.at(-1)!.reason).toBe(GatherFail.Exhausted);
    gather(w, p, 123456, 0);
    expect(failed.at(-1)!.reason).toBe(GatherFail.InvalidTarget);
  });

  it("client role predicts cooldown + stamina but not yields or node state", () => {
    const w = makeWorld({ role: "client" }); const p = spawnPlayer(w, { x: 0, y: 0 });
    const bush = spawnResourceNode(w, "berry_bush", 1, 0);
    const swings = collect(w, GatherSwing);
    const rngBefore = w.rng.state;
    gather(w, p, bush, 0);
    expect(swings).toHaveLength(1);
    expect(countItem(w, p, d.itemId("berries"))).toBe(0);
    expect(w.get(bush, ResourceNode)!.amount).toBe(3);
    expect(w.get(p, Survival)!.stamina).toBeLessThan(100);
    expect(w.rng.state).toBe(rngBefore);
  });
});
