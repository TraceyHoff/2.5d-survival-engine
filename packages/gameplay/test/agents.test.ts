import { describe, expect, it } from "vitest";
import { Blackboard, Rng, TRAIT_KEYS, type AgentContext } from "@engine/core";
import * as G from "../src/index.js";

const ctx = (archetype: string, over: Partial<AgentContext<G.AgentWorldView>["self"]> = {}, world: Partial<G.AgentWorldView> = {}): AgentContext<G.AgentWorldView> => {
  const id = G.makeAgentIdentity(7, 0, archetype); const agent = G.makeAgent(id, 1);
  return { self: { x: 0, y: 0, facing: 0, hp: 1, hunger: 1, thirst: 1, stamina: 1, tick: 0, dayT: 0.5, phase: "day", ...over }, bb: new Blackboard(), memory: agent.memory, traits: id.traits, rng: new Rng(1), agent, world: { seen: [], home: { x: 0, y: 0 }, playerName: "p", ...world } };
};

describe("survivor agents use bots.json", () => {
  it("identity: deterministic, traits from rollTraits ranges, goals by weight", () => {
    const a = G.makeAgentIdentity(3, 1), b = G.makeAgentIdentity(3, 1);
    expect(a).toEqual(b); expect(Object.keys(G.populationData().bots.archetypes)).toContain(a.archetype);
    const t = G.makeAgentIdentity(3, 1, "bot_trader"); const r = G.populationData().bots.archetypes["bot_trader"]!.traits;
    for (const k of TRAIT_KEYS) { expect(t.traits[k]).toBeGreaterThanOrEqual(r[k][0]); expect(t.traits[k]).toBeLessThanOrEqual(r[k][1]); }
    const gw = G.populationData().bots.archetypes["bot_trader"]!.goals; expect(gw[t.goals[0]!.name as keyof typeof gw]).toBe(Math.max(...Object.values(gw))); expect(() => G.makeAgentIdentity(1, 1, "nope")).toThrow();
  });
  it("makeAgent takes the bots.json routine (sleep / stall_trade names) and imperfections", () => {
    const ag = G.makeAgent(G.makeAgentIdentity(1, 0, "bot_trader"), 1);
    expect(ag.schedule.find((s) => s.from === 0.3)!.prefer).toEqual(["stall_trade"]);
    expect(ag.imperfect.reactionTicks).toEqual(G.populationData().bots.archetypes["bot_trader"]!.imperfections.reactionTicks);
  });
  it("scoreUtilities biases behaviors: hunger raises eat, non-bot archetypes stay neutral", () => {
    expect(G.botUtilityFactor(ctx("bot_gatherer", { hunger: 0 }), "eat")).toBeGreaterThan(G.botUtilityFactor(ctx("bot_gatherer"), "eat"));
    expect(G.botUtilityFactor(ctx("bot_trader"), "stall_trade")).toBeGreaterThan(G.botUtilityFactor(ctx("bot_loner"), "stall_trade"));
    expect(G.botUtilityFactor(ctx("bot_gatherer"), "explore")).toBe(1);
    const c = ctx("bot_gatherer"); c.agent.identity.archetype = "survivor"; expect(G.botUtilityFactor(c, "eat")).toBe(1);
    expect(G.survivorRegistry().get("gather")!.considerations.some((x) => x.name === "botUtility")).toBe(true);
  });
});
