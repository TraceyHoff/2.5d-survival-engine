import { describe, expect, it } from "vitest";
import { Health, Survival } from "../src/components.js";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

describe("Expression", () => {
  it("data validates; component is networked, not persisted, appended after CraftOwed", () => {
    expect(G.validateExpressionData(G.EXPRESSION_DATA)).toEqual([]);
    expect(G.Expression.networked).toBe(true); expect(G.Expression.persistent).toBeFalsy();
    const L = G.GAMEPLAY_COMPONENTS; expect(L[L.length - 1]).toBe(G.Expression); expect(L[L.length - 2]).toBe(G.CraftOwed);
  });
  it("moods set an expression that expires; emotes win until untilTick", () => {
    const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 1 });
    steps(w, 6); expect(w.has(p, G.Expression)).toBe(false);
    w.set(p, Health, { hp: 10 }); steps(w, 6);
    expect(G.expressionKey(w.get(p, G.Expression)!.id)).toBe("hurt");
    expect(w.get(p, G.Expression)!.untilTick).toBeGreaterThan(w.tick);
    G.requestEmote(w, p, "wave"); steps(w, 6);
    expect(G.expressionKey(w.get(p, G.Expression)!.id)).toBe("happy");
    w.set(p, Health, { hp: w.get(p, Health)!.max }); w.set(p, Survival, { hunger: 100, thirst: 100 });
    steps(w, 80); expect(w.get(p, G.Expression)!.id).toBe(0);
  });
  it("animals look scared while fleeing", () => {
    const w = makeWorld(); const a = G.spawnAnimal(w, 0, 3, 3); w.setField(a, G.Animal, "state", 2);
    G.expressionSystem(w); expect(G.expressionKey(w.get(a, G.Expression)!.id)).toBe("scared");
  });
});
