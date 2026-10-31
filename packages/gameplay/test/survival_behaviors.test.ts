import { describe, expect, it } from "vitest";
import { idleOutput, installPermissions, Membership, PlayerId, Transform, type AgentContext, type Entity } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, spawnLearned } from "./helpers.js";

const d = G.defaultDefs(); const I = (k: string) => d.itemId(k);
function setup() {
  const w = makeWorld(); installPermissions(w); G.installEconomy(w);
  const p = spawnLearned(w, { x: 0, y: 0, maxWeight: 0, clientId: 1 }); w.add(p, PlayerId, { id: 1 }).add(p, Membership, { partyId: 0, clanId: 0 });
  const agent = G.makeAgent(G.makeAgentIdentity(5, 0, "bot_gatherer"), 1);
  agent.bb.set("sitePickAt", 0); // ADR-216: no base anchor yet (site pick waits 200 ticks) -> the pre-base sensors below
  return { w, p, agent };
}
const run = (name: string, c: AgentContext<G.AgentWorldView>) => { const o = idleOutput(); const r = G.survivalBehaviors().find((b) => b.name === name)!.run(c, o); return { o, r }; };
function ctx(w: ReturnType<typeof setup>["w"], p: Entity, agent: ReturnType<typeof setup>["agent"]): AgentContext<G.AgentWorldView> {
  const v = G.buildAgentView(w, p, agent, { x: 0, y: 0 })!; return { ...v, bb: agent.bb, memory: agent.memory, traits: agent.identity.traits, rng: agent.rng, agent };
}

describe("survival behaviors", () => {
  it("sensors: food/water slots, craftable recipe, build plan, inventory space", () => {
    const { w, p, agent } = setup();
    G.addItem(w, p, I("berries"), 3); G.addItem(w, p, I("water_flask"), 1); G.addItem(w, p, I("wood"), 6); G.addItem(w, p, I("stone"), 4);
    const v = ctx(w, p, agent).world;
    expect(v.food).toBeDefined(); expect(v.water).toBeDefined(); expect(v.food).not.toBe(v.water);
    expect(d.recipes.get(v.craftRecipe!)!.station).toBe(0); expect(d.pieces.get(v.buildPlan!.piece)!.key).toBe("campfire");
    expect(v.invSpaceFree).toBeGreaterThan(0); expect(v.invSpaceFree).toBeLessThan(1);
  });
  it("eat / drink / craft / build / sleep emit the matching actions", () => {
    const { w, p, agent } = setup(); G.addItem(w, p, I("berries"), 3); G.addItem(w, p, I("water_flask"), 1); G.addItem(w, p, I("wood"), 6); G.addItem(w, p, I("stone"), 4);
    const c = ctx(w, p, agent);
    expect(run("eat", c).o.actions).toEqual([`eat:${c.world.food}`]); expect(run("drink", c).o.actions).toEqual([`drink:${c.world.water}`]);
    expect(run("craft", c).o.actions).toEqual([`craft:${c.world.craftRecipe}`]);
    const b = run("build", c); expect(b.o.actions).toEqual([`build:${c.world.buildPlan!.piece}:1:0`]);
    expect(G.agentOutputIntents(b.o)[0]).toMatchObject({ kind: "build", piece: c.world.buildPlan!.piece });
    const n = { ...c, self: { ...c.self, phase: "night" } }; expect(run("sleep", n).o.actions).toEqual(["sleep"]);
  });
  it("controller: a starving bot with food picks eat", () => {
    const { w, p, agent } = setup(); G.addItem(w, p, I("berries"), 3); w.set(p, G.Survival, { hunger: 5 });
    const ctl = G.survivorController({ seed: 1 }); ctl.add(agent);
    let ate = false; for (let t = 0; t < 30 && !ate; t++) { const out = ctl.tick(t, () => G.buildAgentView(w, p, agent, { x: 0, y: 0 })).get(agent)!; ate = (out.commands ?? []).some((c) => c.type === G.UseCmd.name); expect(out.actions.some((a) => a.startsWith("eat:"))).toBe(false); }
    expect(ate).toBe(true); // eat leaves as a gameplay.use command (AgentOutput.commands), not an action string
  });
  it("party follows a mate (with a wave); stall_trade opens then buys a visible listing", () => {
    const { w, p, agent } = setup(); w.set(p, Membership, { partyId: 9 });
    const m = G.spawnPlayer(w, { x: 8, y: 0, maxWeight: 0, clientId: 2 }); w.add(m, Membership, { partyId: 9, clanId: 0 });
    const c = ctx(w, p, agent); expect(c.world.partyMates).toEqual([{ id: m, x: 8, y: 0 }]);
    const r = run("party", c); expect(r.o.moveX).toBeGreaterThan(0); expect(r.o.emote).toBe("wave");
    const s = { id: 77, x: 1, y: 0, slot: 2, item: I("berries"), qty: 1, priceItem: I("coin"), priceCount: 3 };
    const open = run("stall_trade", { ...c, world: { ...c.world, stall: s } }); expect(open.o.actions).toEqual(["open:77"]);
    const buy = run("stall_trade", { ...c, world: { ...c.world, stall: { ...s, revision: 4 } } });
    expect(G.agentOutputIntents(buy.o)).toEqual([{ kind: "buy", stall: 77, listingSlot: 2, qty: 1, expectedRevision: 4, expectedPriceItem: I("coin"), expectedPriceCount: 3 }]);
    expect(w.get(p, Transform)).toBeDefined();
  });
  it("registry has all survival behaviors with the bots.json bias where mapped", () => {
    const r = G.survivorRegistry();
    for (const n of ["party", "stall_trade", "eat", "drink", "sleep", "craft", "build"]) expect(r.get(n)).toBeDefined();
    expect(r.get("stall_trade")!.considerations.some((x) => x.name === "botUtility")).toBe(true);
  });
});
