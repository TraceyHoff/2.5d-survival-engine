import { describe, expect, it } from "vitest";
import { Owner, Transform } from "@engine/core";
import { LoopbackNetwork, NetClient, NetServer } from "../src/index.js";
import { BTN_RIGHT, applyInput, frames, join, makeWorld } from "./fixture.js";

describe("prediction wiring to core replay", () => {
  it("populates world.predicted, replays only predictedSystems with isReplaying set", async () => {
    const net = new LoopbackNetwork(1); const sw = makeWorld();
    new NetServer({ world: sw, transport: net.createServer(), applyInput,
      onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform).add(e, Owner, { clientId: s.clientId }); } });
    const cw = makeWorld();
    const calls = { fx: 0, fxReplay: 0, moveReplay: 0 };
    cw.addSystem("simulation", "fx", (w) => { if (w.isReplaying) calls.fxReplay++; else calls.fx++; });
    cw.addSystem("simulation", "probe", (w) => { if (w.isReplaying) calls.moveReplay++; });
    const input = { buttons: BTN_RIGHT };
    const A = new NetClient({ world: cw, transport: net.createClient({ latencyMs: 40 }), applyInput, predictedSystems: ["move", "probe"],
      sampleInput: () => ({ buttons: input.buttons, aimX: 0, aimY: 0 }) });
    await join(net, A);
    frames(net, [sw, cw], 15);
    const self = A.entityOf([...A.owned][0]!)!;
    expect(cw.predicted.has(self)).toBe(true);
    expect(calls.moveReplay).toBeGreaterThan(0);
    expect(calls.fxReplay).toBe(0);
    expect(calls.fx).toBe(15);
    expect(cw.isReplaying).toBe(false);
  });
});
