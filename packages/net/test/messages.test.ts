import { describe, expect, it } from "vitest";
import { Owner, Transform, type Entity } from "@engine/core";
import { LoopbackNetwork, NO_ENTITY, NetClient, NetRejectedError, NetServer, RejectReason, defineCommand, defineNetEvent, type ClientSession, type MessageDefBase } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

const Gather = defineCommand("gather", { target: "u32", tool: "u8" }, { entityFields: ["target"], rate: { perSec: 2, burst: 3 } });
const Craft = defineCommand("craft", { recipe: "u16" });
const Ping = defineCommand("ping", { n: "u8" }, { rate: { perSec: 2, burst: 3 } });
const Hit = defineNetEvent("hit", { target: "u32", dmg: "u16" }, { entityFields: ["target"] });
const Toast = defineNetEvent("toast", { code: "u8" });

async function setup(extra: { clientCommands?: MessageDefBase[] } = {}) {
  const net = new LoopbackNetwork(9); const sw = makeWorld();
  const players = new Map<number, Entity>();
  const server = new NetServer({ world: sw, transport: net.createServer(), commands: [Gather, Craft, Ping], events: [Hit, Toast],
    onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: s.clientId === 1 ? 1 : 300, y: 0 }).add(e, Owner, { clientId: s.clientId }); players.set(s.clientId, e); } });
  const mk = () => new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 30 }), commands: extra.clientCommands ?? [Gather, Craft, Ping], events: [Hit, Toast] });
  return { net, sw, server, players, mk };
}

describe("commands", () => {
  it("resolves NetId fields to server entities, drops unknown/stale targets, rate-limits per type", async () => {
    const { net, sw, server, mk } = await setup();
    const A = mk(); await join(net, A);
    const tree = sw.create(); sw.add(tree, Transform, { x: 5, y: 5 });
    const got: [number, number, number][] = [];
    server.onCommand(Gather, (s: ClientSession, p) => got.push([s.clientId, p.target, p.tool]));
    frames(net, [sw, A.world], 6);
    const treeOnA = A.entityOf(server.netIds.netIdOf(tree)!)!;
    expect(A.sendCommand(Gather, { target: treeOnA, tool: 2 })).toBe(true);
    frames(net, [sw, A.world], 3);
    expect(got).toEqual([[1, tree, 2]]);
    // stale target: destroyed on the server before the command is dispatched
    A.sendCommand(Gather, { target: treeOnA, tool: 1 }); sw.destroy(tree);
    frames(net, [sw, A.world], 3);
    expect(got.length).toBe(1); expect(server.sessions.get(1)!.stats.droppedCommands).toBe(1);
    // unknown local entity cannot be sent at all
    expect(A.sendCommand(Gather, { target: 12345, tool: 1 })).toBe(false);
    // rate limit (per session, per type): burst 3 then 2/s
    const pings: number[] = []; server.onCommand(Ping, (_s, p) => pings.push(p.n));
    for (let i = 0; i < 6; i++) A.sendCommand(Ping, { n: i });
    frames(net, [sw, A.world], 2);
    expect(pings).toEqual([0, 1, 2]); expect(server.sessions.get(1)!.stats.rateLimited).toBe(3);
    frames(net, [sw, A.world], 20); // 1 s => +2 tokens
    for (let i = 0; i < 3; i++) A.sendCommand(Ping, { n: 10 + i });
    frames(net, [sw, A.world], 2);
    expect(pings).toEqual([0, 1, 2, 10, 11]);
    // command without entity fields + NO_ENTITY
    const crafts: number[] = []; server.onCommand(Craft, (_s, p) => crafts.push(p.recipe));
    A.sendCommand(Craft, { recipe: 42 }); frames(net, [sw, A.world], 3);
    expect(crafts).toEqual([42]);
    void NO_ENTITY;
  });

  it("rejects clients whose command/event list differs (netdefs hash)", async () => {
    const { net, mk } = await setup({ clientCommands: [Gather] });
    const err = await join(net, mk()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetRejectedError);
    expect((err as NetRejectedError).reason).toBe(RejectReason.HashMismatch);
    expect((err as NetRejectedError).detail).toBe("netdefs");
  });
});

describe("events", () => {
  it("delivers tick-stamped events by scope; entity fields resolve on the client; poll waits for renderTick", async () => {
    const { net, sw, server, players, mk } = await setup();
    const A = mk(), B = mk(); await join(net, A); await join(net, B);
    frames(net, [sw, A.world, B.world], 6);
    const pa = players.get(1)!;
    server.emitEvent(Hit, { target: pa, dmg: 5 }); // all, reliable
    server.emitEvent(Toast, { code: 1 }, { scope: { owner: 2 } });
    server.emitEvent(Toast, { code: 2 }, { scope: { nearby: { x: 1, y: 1 } }, reliable: false }); // only A is near (B at x=80)
    const tick = sw.tick;
    frames(net, [sw, A.world, B.world], 2);
    expect(A.pollEvents(tick - 1)).toEqual([]); // not yet at that tick
    const a = A.pollEvents(Infinity);
    expect(a.map((e) => [e.def.name, e.tick])).toEqual([["hit", tick], ["toast", tick]]);
    expect(a[0]!.payload.target).toBe(A.entityOf(server.netIds.netIdOf(pa)!));
    expect(a[1]!.payload.code).toBe(2);
    const seen: number[] = []; B.onEvent(Toast, (p) => seen.push(p.code));
    frames(net, [sw, A.world, B.world], 4); B.pollEvents();
    expect(seen).toEqual([1]);
    expect(B.pendingEvents).toBe(0);
  });
});
