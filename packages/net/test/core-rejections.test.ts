import { describe, expect, it } from "vitest";
import { CommandRejected } from "@engine/core";
import { LoopbackNetwork, NetClient, NetServer } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

describe("core command rejections", () => {
  it("forwards core CommandRejected events to the issuing client only, with seq and reason", async () => {
    const net = new LoopbackNetwork(3); const sw = makeWorld();
    const server = new NetServer({ world: sw, transport: net.createServer(), interest: false });
    const A = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 10 }) });
    const B = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 10 }) });
    await join(net, A); await join(net, B);
    const step = (k: number) => frames(net, [sw, A.world, B.world], k);
    step(2);
    const got: unknown[] = []; A.onCommandRejected((r) => got.push(r));
    sw.events.emit(CommandRejected, { actor: 0 as never, clientId: A.clientId!, seq: 41, type: 3, command: "Build", reason: "no_permission" });
    step(3);
    expect(got).toEqual([expect.objectContaining({ source: "core", seq: 41, detail: "no_permission" })]);
    expect(B.rejections.length).toBe(0);
    void server;
  });
});
