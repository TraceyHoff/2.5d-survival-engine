import { describe, it, expect } from "vitest";
import {
  addItem, countItem, defaultDefs, Equipment, GatherFail, GatherFailed, GatherSwing, IntentAction, ItemGathered,
  NodeDepleted, NodeRespawned, ResourceNode, setIntent, spawnPlayer, spawnResourceNode, Survival,
} from "../src/index.js";
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
    const wood = countItem(w, p, WOOD);
    expect(wood).toBeGreaterThanOrEqual(1); expect(wood).toBeLessThanOrEqual(2);
    expect(got).toMatchObject([{ entity: p, node: branches, item: WOOD, count: wood }]);
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
    for (const n of woodHits) { expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(5); } // 2..4 + 1 tier bonus
  });

  it("depletes and respawns on tick count", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0 });
    const grass = spawnResourceNode(w, "fiber_grass", 0, 1);
    const depleted = collect(w, NodeDepleted); const respawned = collect(w, NodeRespawned); const failed = collect(w, GatherFailed);
    gather(w, p, grass); gather(w, p, grass, 0);
    expect(depleted).toHaveLength(1);
    const respawnAt = w.get(grass, ResourceNode)!.respawnAtTick;
    expect(respawnAt).toBe(w.tick - 1 + 90 * 20);
    steps(w, 20);
    gather(w, p, grass);
    expect(failed.at(-1)!.reason).toBe(GatherFail.Depleted);
    while (w.tick <= respawnAt) w.step(1 / 20);
    expect(respawned).toHaveLength(1);
    expect(w.get(grass, ResourceNode)!.amount).toBe(2);
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
