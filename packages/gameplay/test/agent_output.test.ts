import { describe, expect, it } from "vitest";
import { idleOutput } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const reg = G.registerGameplayCommands();
describe("AgentOutput -> inputs", () => {
  it("frame: move/sprint/aim via intentToFrame, actions merged, plain gather = Primary bit only", () => {
    const f = G.agentOutputFrame({ ...idleOutput(), moveX: 1, moveY: 0, aimX: 0, aimY: 1, sprint: true, actions: ["gather", "eat:2", "bogus", "craft:x"] }, 9, reg);
    expect(f.tick).toBe(9); expect(f.actions & G.GameplayActions.MoveRight).toBeTruthy(); expect(f.actions & G.GameplayActions.Sprint).toBeTruthy();
    expect(f.actions & G.GameplayActions.Primary).toBeTruthy(); expect([f.aimX, f.aimY]).toEqual([0, 1]);
    expect(f.commands).toEqual([reg.make(G.UseCmd, { slot: 2 })]);
    expect(G.agentOutputIntents({ ...idleOutput(), actions: ["buy:5:1:2:7:3:4", "build:1:2:3", "drink:4"] })).toEqual([
      { kind: "buy", stall: 5, listingSlot: 1, qty: 2, expectedRevision: 7, expectedPriceItem: 3, expectedPriceCount: 4 }, { kind: "build", piece: 1, x: 2, y: 3 }, { kind: "eat", slot: 4 }]);
  });
  it("applyAgentEmote queues requestEmote; skipped while replaying or unknown", () => {
    const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 1 });
    expect(G.applyAgentEmote(w, p, idleOutput())).toBe(false); expect(G.applyAgentEmote(w, p, { ...idleOutput(), emote: "nope" })).toBe(false);
    w.isReplaying = true; expect(G.applyAgentEmote(w, p, { ...idleOutput(), emote: "wave" })).toBe(false); w.isReplaying = false;
    expect(G.applyAgentEmote(w, p, { ...idleOutput(), emote: "wave" })).toBe(true); steps(w, 6);
    expect(G.expressionKey(w.get(p, G.Expression)!.id)).toBe("happy");
  });
  it("emitAgentCommands: buy/use/craft/place/open become net commands by registered name, in order", () => {
    const out = { ...idleOutput(), actions: ["gather", "eat:3", "craft:5:2", "build:7:1.5:2", "open:40", "buy:40:2:1:9:11:3", "sleep"] };
    G.emitAgentCommands(out);
    expect(out.actions).toEqual(["gather", "sleep"]);
    expect(out.commands).toEqual([
      { type: "gameplay.use", payload: { slot: 3 } },
      { type: "gameplay.queueCraft", payload: { recipe: 5, count: 2 } },
      { type: "gameplay.place", payload: { piece: 7, x: 1.5, y: 2, level: 0, rot: 0, tier: 0, variant: 0 } },
      { type: "gameplay.openStall", payload: { stall: 40 } }, // replica entity; NetClient.sendCommand maps it to a NetId
      { type: "gameplay.buyFromStall", payload: { stall: 40, listingSlot: 2, qty: 1, expectedRevision: 9, expectedPriceItem: 11, expectedPriceCount: 3 } },
    ]);
  });
});
