import { describe, it, expect } from "vitest";
import { CommandRegistry, CommandRejected, installCommandHandlers } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const d = G.defaultDefs(); const id = (k: string) => d.itemId(k); const axe = d.recipeId("stone_axe");
function setup() {
  const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0 });
  G.addItem(w, p, id("wood"), 10); G.addItem(w, p, id("stone"), 4); G.addItem(w, p, id("fiber"), 4);
  return { w, p, q: G.installCraftQueue(w) };
}
describe("craft queue (slice 5, core JobQueues)", () => {
  it("consumes ingredients x count up front, completes each unit on the scheduler", () => {
    const { w, p } = setup();
    expect(G.enqueueCraft(w, p, axe, 2)).toBe(0);
    expect(G.countItem(w, p, id("stone"))).toBe(0);
    steps(w, 41); expect(G.countItem(w, p, id("stone_axe"))).toBe(1);
    steps(w, 40); expect(G.countItem(w, p, id("stone_axe"))).toBe(2);
    expect(w.has(p, G.CraftQueue) && G.installCraftQueue(w).jobs(p)).toEqual([]);
  });
  it("rejects without writes when ingredients are short; cancel refunds the remaining units", () => {
    const { w, p, q } = setup();
    expect(G.enqueueCraft(w, p, axe, 3)).toBe("missing_ingredients"); expect(G.countItem(w, p, id("wood"))).toBe(10);
    expect(G.enqueueCraft(w, p, axe, 0)).toBe("bad_count");
    G.enqueueCraft(w, p, axe, 2); steps(w, 5); expect(q.cancel(p, 0)).toBe(true);
    expect(G.countItem(w, p, id("wood"))).toBe(10); expect(G.countItem(w, p, id("fiber"))).toBe(4);
  });
  it("commands run through core CommandHandlers and reject with reasons", () => {
    const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0 });
    const reg = G.registerGameplayCommands(new CommandRegistry()); const h = installCommandHandlers(w, reg); G.installCraftQueue(w, h);
    const rej: string[] = []; w.events.on(CommandRejected, (e) => rej.push(e.reason));
    h.enqueue(p, 1, 1, reg.make(G.QueueCraftCmd, { recipe: axe, count: 1 })); w.step(1 / 20);
    expect(G.countItem(w, p, id("stone_axe"))).toBe(0);
    expect(rej).toEqual(["missing_ingredients"]);
  });
});
