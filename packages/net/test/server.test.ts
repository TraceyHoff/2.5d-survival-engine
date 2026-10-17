import { describe, expect, it } from "vitest";
import { NetId, Owner, Transform } from "@engine/core";
import {
  BitReader, LoopbackNetwork, MsgType, NetClient, NetRejectedError, NetServer, PROTOCOL_VERSION, RejectReason,
  encodeHello, encodeInput, readHeader,
} from "../src/index.js";
import { DT, join, makeWorld } from "./fixture.js";

function setup() {
  const net = new LoopbackNetwork(3); const world = makeWorld();
  const server = new NetServer({ world, transport: net.createServer() });
  return { net, world, server };
}

describe("NetServer", () => {
  it("assigns netIds to networked entities, maps both ways, unmaps on despawn, adopts manual NetIds", () => {
    const { world, server } = setup();
    const a = world.create(); world.add(a, Transform, { x: 1 });
    const local = world.create(); world.add(local, NetId, { id: 1 }); // manual id collides with first assignment
    world.step(DT);
    const ida = server.netIds.netIdOf(a)!;
    expect(world.getField(a, NetId, "id")).toBe(ida);
    expect(server.netIds.entityOf(ida)).toBe(a);
    const idl = server.netIds.netIdOf(local)!;
    expect(idl).not.toBe(ida);
    world.destroy(a); expect(server.netIds.entityOf(ida)).toBeUndefined();
    const b = world.create(); world.add(b, Transform); world.step(DT);
    expect(server.netIds.netIdOf(b)).not.toBe(ida); // never reused
  });
  it("rejects protocol and schema mismatches; resumes sessions by token; rejects unknown tokens", async () => {
    const { net, world, server } = setup();
    const raw = net.createClient(); await raw.connect();
    const replies: number[][] = [];
    raw.onMessage((b) => { const r = new BitReader(b); const h = readHeader(r); replies.push([h.type, r.readBits(8)]); });
    void world;
    const ok = server.requiredHashes;
    raw.send(encodeHello({ hashes: ok, token: new Uint8Array(16) }, PROTOCOL_VERSION + 1), "reliable");
    raw.send(encodeHello({ hashes: { ...ok, schema: 123 }, token: new Uint8Array(16) }), "reliable");
    raw.send(encodeHello({ hashes: ok, token: new Uint8Array(16).fill(1) }), "reliable");
    raw.send(encodeHello({ hashes: { schema: ok.schema! }, token: new Uint8Array(16) }), "reliable");
    net.advance(1);
    expect(replies).toEqual([[MsgType.Reject, RejectReason.ProtocolMismatch], [MsgType.Reject, RejectReason.SchemaMismatch], [MsgType.Reject, RejectReason.BadToken], [MsgType.Reject, RejectReason.HashMismatch]]);
    expect(server.sessions.size).toBe(0);

    const c1 = new NetClient({ world: makeWorld(), transport: net.createClient() });
    const w1 = await join(net, c1);
    expect(w1.clientId).toBe(1);
    c1.close();
    const c2 = new NetClient({ world: makeWorld(), transport: net.createClient() });
    expect((await join(net, c2, w1.token)).clientId).toBe(1);
    expect(server.sessions.size).toBe(1);

    const bad = new NetClient({ world: makeWorld({ extra: true }), transport: net.createClient() });
    await expect(join(net, bad)).rejects.toBeInstanceOf(NetRejectedError);
  });
  it("queues inputs in seq order, ignores redundant copies, bounds the queue, applies one per tick", async () => {
    const applied: (number | null)[] = [];
    const net2 = new LoopbackNetwork(); const w2 = makeWorld();
    const server = new NetServer({ world: w2, transport: net2.createServer(), maxInputQueue: 4, applyInput: (_w, _e, cmd) => applied.push(cmd ? cmd.seq : null),
      onClientJoin: (s, w) => { const e = w.create(); w.add(e, Owner, { clientId: s.clientId }).add(e, Transform); } });
    const c = new NetClient({ world: makeWorld(), transport: net2.createClient() });
    await join(net2, c);
    const s = server.sessions.get(1)!;
    const send = (cmds: number[]) => (c as unknown as { opts: { transport: { send(b: Uint8Array, ch: string): void } } }).opts.transport
      .send(encodeInput({ ackTick: 0xffffffff, cmds: cmds.map((seq) => ({ seq, buttons: 0, aimX: 0, aimY: 0 })) }), "unreliable");
    send([0, 1]); send([0, 1, 2]); net2.advance(1);
    expect(s.inputQueue.map((x) => x.seq)).toEqual([0, 1, 2]);
    w2.step(DT); w2.step(DT);
    expect(applied).toEqual([0, 1]); expect(s.lastProcessedSeq).toBe(1);
    send([3, 4, 5, 6, 7, 8]); net2.advance(1);
    expect(s.inputQueue.map((x) => x.seq)).toEqual([5, 6, 7, 8]);
    w2.step(DT); w2.step(DT); w2.step(DT); w2.step(DT); w2.step(DT);
    expect(applied.slice(2)).toEqual([5, 6, 7, 8, null]);
  });
  it("sends a full snapshot without a valid ack, deltas after ack, and falls back when the ack ages out of history", async () => {
    const net = new LoopbackNetwork(); const world = makeWorld();
    const server = new NetServer({ world, transport: net.createServer(), historySize: 32, interest: false });
    for (let i = 0; i < 20; i++) { const e = world.create(); world.add(e, Transform, { x: i }); }
    const c = new NetClient({ world: makeWorld(), transport: net.createClient() });
    await join(net, c);
    const s = server.sessions.get(1)!;
    world.step(DT); const fullBytes = s.lastSnapshotBytes; expect(s.fullSnapshots).toBe(1);
    s.lastAckTick = world.tick - 1;
    world.step(DT); expect(s.fullSnapshots).toBe(1); expect(s.lastSnapshotBytes).toBeLessThan(fullBytes / 10);
    for (let i = 0; i < 40; i++) world.step(DT);
    const before = s.fullSnapshots; world.step(DT);
    expect(s.fullSnapshots).toBe(before + 1); // ack is 40+ ticks old: no baseline left
  });
});
