import { describe, expect, it } from "vitest";
import { installPermissions, PlayerId, Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const d = G.defaultDefs(); const WOOD = d.itemId("wood");
const mk = (w: World, id: number, x = 0, y = 0) => { const p = G.spawnPlayer(w, { x, y, clientId: id }); w.add(p, PlayerId, { id }); return p; };
const bags = (w: World): Entity[] => [...w.query([G.LootBag])];
const items = (w: World, e: Entity): number => G.listSlots(w, e).reduce((s, x) => s + (x.item ? x.count : 0), 0);
/** open + take-all by hand (no tool equipped): the same intents the Interact button / panel send. */
function handLoot(w: World, p: Entity, bag: Entity): number {
  expect(w.getField(p, G.Equipment, "mainHandItem") ?? 0).toBe(0);
  const n = items(w, bag); expect(n).toBeGreaterThan(0);
  G.setIntent(w, p, { action: G.IntentAction.OpenContainer, target: bag }); steps(w, 1);
  expect(w.getField(p, G.Viewing, "container")).toBe(bag);
  G.setIntent(w, p, { action: G.IntentAction.Withdraw, target: bag, item: 0, count: 0 }); steps(w, 1);
  return n;
}

describe("ADR-160 bare-handed loot bags", () => {
  it("dead zombies drop their ai.json loot once, in an ownerless bag", () => {
    const w = makeWorld(); installPermissions(w); let got = 0;
    for (let i = 0; i < 12; i++) { const z = G.spawnZombie(w, i % 2 ? "zombie_brute" : "zombie_walker", 40 + i * 6, 40); G.applyDamage(w, z, 1e6, z); }
    steps(w, 2); got = bags(w).length; expect(got).toBeGreaterThan(0); expect(got).toBeLessThanOrEqual(12);
    for (const b of bags(w)) expect(w.getField(b, G.LootBag, "owner")).toBe(0);
    steps(w, 20); expect(bags(w).length).toBe(got); // never twice per corpse
  });
  it("zombie, animal, death, AI-human, dropped and crate bags all open and empty by hand", () => {
    const w = makeWorld(); installPermissions(w); const me = mk(w, 1, 10, 10);
    const zb = (() => { for (let i = 0; i < 20; i++) { const z = G.spawnZombie(w, "zombie_brute", 10.5, 10); G.applyDamage(w, z, 1e6, z); steps(w, 1); const b = bags(w)[0]; if (b !== undefined) return b; } throw new Error("no zombie loot"); })();
    const got = handLoot(w, me, zb); expect(items(w, me)).toBeGreaterThanOrEqual(got); expect(items(w, zb)).toBe(0); steps(w, 20); expect(w.isAlive(zb)).toBe(false);
    // animal
    const an = (() => { for (let i = 0; i < 20; i++) { const a = G.spawnAnimal(w, G.animalDefs()[0]!.key, 10.5, 10); const b = G.dropAnimalLoot(w, a); w.destroy(a); if (b) return b; } throw new Error("no animal loot"); })();
    handLoot(w, me, an);
    // death bag of a player and of an AI human (bots are Survival players too)
    for (const id of [2, 3]) { const o = mk(w, id, 10.5, 10); G.addItem(w, o, WOOD, 4); G.applyDamage(w, o, 1e6, o); steps(w, 1);
      const b = bags(w).find((x) => w.getField(x, G.LootBag, "owner") === id)!; steps(w, 20 * G.PVP.bagOwnerOnlySeconds); const before = G.countItem(w, me, WOOD);
      handLoot(w, me, b); expect(G.countItem(w, me, WOOD)).toBeGreaterThan(before); } // (pack weight may cap the take)
    // dropped item stack + an ownerless crate
    const other = mk(w, 4, 10.5, 10); G.addItem(w, other, WOOD, 3); const dropped = G.dropItem(w, other, WOOD, 3)!; handLoot(w, other, dropped); expect(G.countItem(w, other, WOOD)).toBe(3);
    const crate = w.create(); w.add(crate, Transform, { x: 10.5, y: 10 }).add(crate, G.Container, { slotCount: 12 }).add(crate, G.ContainerViewers).add(crate, G.LootBag, { owner: 0, despawnAtTick: 0xffffffff });
    G.addItem(w, crate, WOOD, 2); G.indexEntity(w, crate); handLoot(w, me, crate);
  });
  it("handLootTarget / interactPanel pick the nearest bag in reach (primary-button and Interact fallbacks)", () => {
    const w = makeWorld(); installPermissions(w); const me = mk(w, 1, 10, 10);
    const reach = d.building.containerReach;
    const mkBag = (x: number) => { const b = w.create(); w.add(b, Transform, { x, y: 10 }).add(b, G.Container, { slotCount: 4 }).add(b, G.ContainerViewers).add(b, G.LootBag, { owner: 0, despawnAtTick: 0xffffffff }); G.addItem(w, b, WOOD, 1); return b; };
    const far = mkBag(10 + reach + 1); expect(G.handLootTarget(w, me)).toBeUndefined(); expect(G.interactPanel({ world: w, player: me })).toBeUndefined();
    const near = mkBag(10.8); mkBag(11.5);
    expect(G.handLootTarget(w, me)).toBe(near); expect(G.handLootTarget(w, me, 0.5)).toBeUndefined(); // a closer resource node wins
    expect(G.interactPanel({ world: w, player: me })).toEqual({ panel: "loot", bag: near }); expect(far).toBeDefined();
    expect(G.takeAllIntent(near).args).toMatchObject({ item: 0 });
  });
});
