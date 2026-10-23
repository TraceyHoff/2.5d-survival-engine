import { describe, it, expect } from "vitest";
import { Agent, AgentController, BehaviorRegistry, randomTraits, Rng, type AgentOutput, type AgentSelf } from "../src/index.js";

type W = { threat: number };
function make(n: number, budget = 2) {
  const reg = new BehaviorRegistry<W>();
  reg.register({ name: "wander", considerations: [{ name: "base", input: () => 0, curve: { type: "linear", m: 0, b: 0.3 } }], run: (c, o) => { o.moveX = Math.cos(c.rng.range(0, 6)); o.moveY = 0.5; } });
  reg.register({ name: "flee", considerations: [{ name: "threat", input: (c) => c.world.threat, curve: { type: "linear", m: 1, b: 0 } }], run: (_c, o) => { o.moveX = -1; o.sprint = true; } });
  const ctl = new AgentController<W>({ behaviors: reg, thinkBudget: budget, thinkEvery: 2 });
  for (let i = 0; i < n; i++) ctl.add(new Agent({ id: `a${i}`, name: `A${i}`, relationship: 0, traits: randomTraits(new Rng(i)), archetype: "t", goals: [] }, 100 + i));
  return ctl;
}
const self = (tick: number): AgentSelf => ({ x: 0, y: 0, facing: 0, hp: 100, hunger: 100, thirst: 100, stamina: 100, tick, dayT: 0.5, phase: "day" });
const runCtl = (c: AgentController<W>, ticks: number) => { const log: AgentOutput[][] = []; for (let t = 0; t < ticks; t++) log.push([...c.tick(t, () => ({ self: self(t), world: { threat: t > 20 ? 1 : 0 } })).values()]); return log; };

describe("agent framework", () => {
  it("is deterministic", () => { expect(runCtl(make(5), 60)).toEqual(runCtl(make(5), 60)); });
  it("caps thinks per tick at the budget", () => {
    const c = make(30, 3); for (let t = 0; t < 20; t++) { c.tick(t, () => ({ self: self(t), world: { threat: 0 } })); if (t > 0) expect(c.thinksLastTick).toBeLessThanOrEqual(3); }
  });
  it("only produces input-shaped output (no world access) and reacts with delay", () => {
    const c = make(1, 1); const log = runCtl(c, 60);
    for (const [o] of log) expect(Object.keys(o!).every((k) => ["moveX", "moveY", "aimX", "aimY", "sprint", "actions", "chat", "emote"].includes(k))).toBe(true);
    expect(log[21]![0]!.sprint).toBe(false); expect(log.slice(30).some(([o]) => o!.sprint)).toBe(true);
  });
});
