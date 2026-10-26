import { describe, expect, it } from "vitest";
import { installPermissions, PlayerId, Transform, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const d = G.defaultDefs(); const WOOD = d.itemId("wood"); const STONE = d.itemId("stone");
const mk = (w: World, id: number, x = 0, y = 0) => { const p = G.spawnPlayer(w, { x, y, clientId: id }); w.add(p, PlayerId, { id }); return p; };
const name = (id: number) => d.items.get(id)?.name;

describe("ADR-161 loot labels", () => {
  it("every bag gets a networked LootSummary (top item, count, stacks, source) that follows its contents", () => {
    const w = makeWorld(); installPermissions(w); const p = mk(w, 7, 5, 5);
    G.addItem(w, p, WOOD, 6); G.addItem(w, p, STONE, 2);
    const bag = G.dropItem(w, p, WOOD, 4)!; expect(bag).toBeDefined();
    const s = w.get(bag, G.LootSummary)!; expect(s).toMatchObject({ item: WOOD, count: 4, stacks: 1, source: G.LootSource.Dropped });
    expect(G.lootLabelText(s, name)).toBe(`${name(WOOD)} ×4`);
    const death = G.dropDeathBag(w, p)!; expect(w.getField(death, G.LootSummary, "source")).toBe(G.LootSource.Death);
    expect(w.getField(death, G.LootSummary, "stacks")).toBe(2);
    expect(G.lootLabelText(w.get(death, G.LootSummary)!, name, true)).toBe("Your bag");
    expect(G.lootLabelText(w.get(death, G.LootSummary)!, name, false)).toBe("Death bag");
    // a crate made without a tag is inferred; contents changes are picked up by the periodic pass
    const crate = w.create(); w.add(crate, Transform, { x: 9, y: 9 }).add(crate, G.Container, { slotCount: 4 }).add(crate, G.ContainerViewers).add(crate, G.LootBag, { owner: 0, despawnAtTick: 0xffffffff });
    G.addItem(w, crate, STONE, 3); steps(w, G.LOOT_SUMMARY_EVERY + 1);
    expect(w.get(crate, G.LootSummary)).toMatchObject({ item: STONE, count: 3, source: G.LootSource.Crate });
    expect(G.addItem(w, crate, STONE, 2)).toBe(2); steps(w, G.LOOT_SUMMARY_EVERY + 1); expect(w.getField(crate, G.LootSummary, "count")).toBe(5);
    expect(G.GAMEPLAY_COMPONENTS[G.GAMEPLAY_COMPONENTS.length - 1]).toBe(G.LootSummary); // append-only
  });
  it("zombie and animal bags are tagged; labels read Zombie loot / item names", () => {
    expect(G.lootLabelText({ item: WOOD, count: 1, stacks: 3, source: G.LootSource.Zombie }, name)).toBe("Zombie loot");
    expect(G.lootLabelText({ item: WOOD, count: 2, stacks: 1, source: G.LootSource.Animal }, name)).toBe(`${name(WOOD)} ×2`);
    expect(G.lootLabelText({ item: 0, count: 0, stacks: 2, source: G.LootSource.Unknown }, name)).toBe("Loot");
    const w = makeWorld(); installPermissions(w); let tagged = 0;
    for (let i = 0; i < 12; i++) { const z = G.spawnZombie(w, "zombie_brute", 40 + i * 6, 40); G.applyDamage(w, z, 1e6, z); }
    steps(w, 2);
    for (const b of w.query([G.LootBag])) { expect(w.getField(b, G.LootSummary, "source")).toBe(G.LootSource.Zombie); tagged++; }
    expect(tagged).toBeGreaterThan(0);
  });
  it("mergeLabels declutters nearest-first and caps the count", () => {
    const pts = [{ key: 1, x: 100, y: 100, dist: 3, text: "A" }, { key: 2, x: 110, y: 104, dist: 1, text: "B" }, { key: 3, x: 400, y: 100, dist: 5, text: "C" }];
    const m = G.mergeLabels(pts); expect(m.map((x) => x.text)).toEqual(["B (+1 bag)", "C"]); expect(m[0]!.keys).toEqual([2, 1]);
    const many = Array.from({ length: 40 }, (_, i) => ({ key: i, x: i * 100, y: 0, dist: i, text: "x" }));
    expect(G.mergeLabels(many).length).toBe(G.LOOT_LABEL.max);
  });
});
