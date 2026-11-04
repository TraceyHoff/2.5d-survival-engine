import { describe, expect, it } from "vitest";
import { installPermissions, Membership, PlayerId, type Entity } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, spawnLearned } from "./helpers.js";

const d = G.defaultDefs(); const I = (k: string) => d.itemId(k);
const R = (k: string) => d.recipeId(k);
function setup() {
  const w = makeWorld(); installPermissions(w); G.installEconomy(w);
  const p = spawnLearned(w, { x: 0, y: 0, maxWeight: 0, clientId: 1 }); w.add(p, PlayerId, { id: 1 }).add(p, Membership, { partyId: 0, clanId: 0 });
  const agent = G.makeAgent(G.makeAgentIdentity(5, 0, "bot_gatherer"), 1);
  agent.bb.set("sitePickAt", 0); // ADR-252: no base anchor yet -> the pre-base sensors below
  return { w, p, agent };
}
function craftRecipe(w: ReturnType<typeof setup>["w"], p: Entity, agent: ReturnType<typeof setup>["agent"]): number | undefined {
  return G.buildAgentView(w, p, agent, { x: 0, y: 0 })!.world.craftRecipe;
}
/** Advance past the SENSE_EVERY goal-sensor cache so a fresh plan/legacy pick is computed. */
function retick(w: ReturnType<typeof setup>["w"]): void { for (let i = 0; i < 11; i++) w.step(1 / 20); }

describe("Task 16: purpose-driven bot crafting", () => {
  it("a bot with no crafting need crafts nothing, including Dye", () => {
    const { w, p, agent } = setup();
    // Dye is affordable (berries x3) but purposeless: the bot owns all three goal tools.
    G.addItem(w, p, I("stone_axe"), 1); G.addItem(w, p, I("stone_pickaxe"), 1); G.addItem(w, p, I("stone_spear"), 1);
    G.addItem(w, p, I("berries"), 3);
    expect(craftRecipe(w, p, agent)).toBeUndefined();
  });
  it("a bot with no goal materials and no goal tools also picks nothing (no idle sticks/club/dye)", () => {
    const { w, p, agent } = setup();
    G.addItem(w, p, I("berries"), 3); G.addItem(w, p, I("wood"), 6);
    expect(craftRecipe(w, p, agent)).toBeUndefined();
  });
  it("a bot with a genuine need crafts exactly toward it: sticks, then rope, then the spear", () => {
    const { w, p, agent } = setup();
    G.addItem(w, p, I("stone_axe"), 1); G.addItem(w, p, I("stone_pickaxe"), 1);
    G.addItem(w, p, I("wood"), 6); G.addItem(w, p, I("flint"), 2); G.addItem(w, p, I("fiber"), 8);
    expect(d.recipes.get(craftRecipe(w, p, agent)!)!.key).toBe("sticks");
    G.addItem(w, p, I("sticks"), 3); retick(w); // stock now meets the spear's sticks need
    expect(d.recipes.get(craftRecipe(w, p, agent)!)!.key).toBe("rope");
    G.addItem(w, p, I("rope"), 1); retick(w); // stock now meets the spear's rope need
    expect(d.recipes.get(craftRecipe(w, p, agent)!)!.key).toBe("stone_spear");
  });
  it("the stock cap stops crafting at the outstanding need, even with Dye affordable", () => {
    const { w, p, agent } = setup();
    G.addItem(w, p, I("stone_axe"), 1); G.addItem(w, p, I("stone_pickaxe"), 1);
    G.addItem(w, p, I("wood"), 6); G.addItem(w, p, I("flint"), 2); G.addItem(w, p, I("fiber"), 3); G.addItem(w, p, I("sticks"), 3);
    G.addItem(w, p, I("berries"), 3);
    // sticks capped (3 >= 3), rope unaffordable (fiber 3 < 4), spear missing rope, dye purposeless
    expect(craftRecipe(w, p, agent)).toBeUndefined();
  });
  it("existing stock counts first: a bot holding 2 of the 3 sticks still needs sticks, holding 3 does not", () => {
    const { w, p, agent } = setup();
    G.addItem(w, p, I("stone_axe"), 1); G.addItem(w, p, I("stone_pickaxe"), 1);
    G.addItem(w, p, I("wood"), 6); G.addItem(w, p, I("flint"), 2); G.addItem(w, p, I("fiber"), 8); G.addItem(w, p, I("sticks"), 2);
    expect(d.recipes.get(craftRecipe(w, p, agent)!)!.key).toBe("sticks");
    G.addItem(w, p, I("sticks"), 1); retick(w);
    expect(d.recipes.get(craftRecipe(w, p, agent)!)!.key).toBe("rope");
  });
  it("a bot with no room for the output does not craft (no futile InventoryFull attempts)", () => {
    const { w, p, agent } = setup();
    // All 16 pack slots occupied; axe materials present in excess (so consuming them frees no slot).
    const fill: [string, number][] = [["wood", 6], ["stone", 4], ["fiber", 4], ["flint", 1], ["berries", 3], ["sticks", 1], ["rope", 1], ["raw_meat", 1], ["cooked_meat", 1], ["hide", 1], ["honey", 1], ["salt", 1], ["herbs", 1], ["charcoal", 1], ["leather", 1], ["cloth", 1]];
    for (const [k, n] of fill) G.addItem(w, p, I(k), n);
    expect(G.countItem(w, p, I("wood"))).toBe(6);
    expect(craftRecipe(w, p, agent)).toBeUndefined();
  });
  it("a bot craft lands in the bot's inventory, never as a ground bag", () => {
    const w = makeWorld(); const p = spawnLearned(w, { x: 0, y: 0, maxWeight: 0 });
    G.addItem(w, p, I("wood"), 5); G.addItem(w, p, I("stone"), 2); G.addItem(w, p, I("fiber"), 2);
    G.setIntent(w, p, { action: G.IntentAction.Craft, recipe: R("stone_axe") });
    for (let t = 0; t < 60 && G.countItem(w, p, I("stone_axe")) === 0; t++) w.step(1 / 20);
    expect(G.countItem(w, p, I("stone_axe"))).toBe(1);
    expect([...w.query([G.LootBag])].length).toBe(0);
  });
});
