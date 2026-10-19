import { describe, expect, it } from "vitest";
import { Owner, Transform, type Entity, type World } from "@engine/core";
import { LoopbackNetwork, NetClient, NetRejectedError, NetServer, RejectReason } from "../src/index.js";
import { BTN_DOWN, BTN_RIGHT, Buff, DT, SPEED, applyInput, join, makeWorld } from "./fixture.js";

const WALL = 5;

function makeClient(net: LoopbackNetwork) {
  const input = { buttons: 0 };
  const world = makeWorld();
  const client = new NetClient({
    world, transport: net.createClient({ latencyMs: 60, jitterMs: 20, loss: 0.1 }), applyInput,
    sampleInput: () => ({ buttons: input.buttons, aimX: 0, aimY: 0 }),
  });
  return { world, client, input };
}
const pos = (w: World, e: Entity) => w.get(e, Transform)!;
function ownedEntity(c: NetClient): Entity { return c.entities.get([...c.owned][0]!)!; }

describe("integration: server + 2 clients over a lossy, jittery loopback", () => {
  it("replicates movement, reconciles mispredictions, propagates component removal and despawn, rejects schema mismatch", async () => {
    const net = new LoopbackNetwork(1234);
    const sworld = makeWorld({ wallX: WALL });
    const players = new Map<number, Entity>();
    const server = new NetServer({
      world: sworld, transport: net.createServer(), applyInput: (w, e, cmd) => applyInput(w, e, cmd),
      onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: 0, y: s.clientId * 2 }).add(e, Owner, { clientId: s.clientId }); players.set(s.clientId, e); },
    });
    const A = makeClient(net), B = makeClient(net);
    const wa = await join(net, A.client); const wb = await join(net, B.client);
    expect([wa.clientId, wb.clientId]).toEqual([1, 2]);

    const frame = (n = 1) => { for (let i = 0; i < n; i++) { net.advance(50); sworld.step(DT); A.world.step(DT); B.world.step(DT); } };
    frame(10);
    for (const c of [A.client, B.client]) { expect(c.entities.size).toBe(3); expect(c.owned.size).toBe(1); } // 2 players + environment
    const aSelf = ownedEntity(A.client), bSelf = ownedEntity(B.client);
    const bNetId = [...B.client.owned][0]!;
    const bOnA = A.client.entities.get(bNetId)!;
    expect(pos(A.world, bOnA).y).toBeCloseTo(4);

    // --- movement: A runs right into a server-only wall, B runs down ---
    A.input.buttons = BTN_RIGHT; B.input.buttons = BTN_DOWN;
    frame(20);
    expect(pos(B.world, bSelf).y).toBeGreaterThan(4 + 15 * SPEED * DT); // B predicts immediately
    const midOnA = pos(A.world, bOnA).y;
    expect(midOnA).toBeGreaterThan(5); // A sees B moving (interpolated, in the past)
    expect(midOnA).toBeLessThan(pos(B.world, bSelf).y);
    // correction smoothing: reconciliation snaps sim state, the visual offset absorbs it and decays (~100 ms)
    let maxOff = 0; let visualJump = 0; let lastVisual = pos(A.world, aSelf).x + (A.client.correctionOffset(aSelf)?.x ?? 0); // rendered position = sim + offset
    for (let i = 0; i < 20; i++) {
      frame(1);
      const o = A.client.correctionOffset(aSelf)?.x ?? 0; maxOff = Math.max(maxOff, Math.abs(o));
      const visual = pos(A.world, aSelf).x + o; visualJump = Math.max(visualJump, Math.abs(visual - lastVisual)); lastVisual = visual;
    }
    A.input.buttons = 0; B.input.buttons = 0;
    frame(20);
    expect(maxOff).toBeGreaterThan(0.1);
    expect(visualJump).toBeLessThan(A.client.stats.maxCorrection); // rendered position never snaps by the full correction
    expect(A.client.correctionOffset(aSelf)).toBeUndefined(); // fully decayed; sim untouched (asserted below)

    // prediction overshot the wall, reconciliation pulled it back to the authoritative position
    expect(A.client.stats.maxCorrection).toBeGreaterThan(0.3); // >= 2 ticks of overshoot (0.2/tick); was >0.5 against the pre-m6 inflated stat
    expect(pos(A.world, aSelf).x).toBe(WALL);
    expect(pos(sworld, players.get(1)!).x).toBe(WALL);
    // B converged to the server and A sees the same position
    const bServer = pos(sworld, players.get(2)!);
    expect(bServer.y).toBeGreaterThan(4 + 30 * SPEED * DT);
    expect(pos(B.world, bSelf).y).toBeCloseTo(bServer.y, 5);
    expect(pos(A.world, bOnA).y).toBeCloseTo(bServer.y, 5);
    expect(B.client.pending.length).toBeLessThanOrEqual(8); // ~RTT + server input buffer
    // steady state is deltas, not full snapshots
    for (const s of server.sessions.values()) expect(s.fullSnapshots).toBeLessThan(10);

    // --- component add + removal replicate ---
    sworld.add(players.get(1)!, Buff, { power: 2.5, kind: 3 });
    frame(10);
    const aOnB = B.client.entities.get([...A.client.owned][0]!)!;
    expect(B.world.getField(aOnB, Buff, "power")).toBeCloseTo(2.5, 1);
    expect(A.world.get(aSelf, Buff)?.kind).toBe(3);
    sworld.remove(players.get(1)!, Buff);
    frame(10);
    expect(A.world.has(aSelf, Buff)).toBe(false);
    expect(B.world.has(aOnB, Buff)).toBe(false);
    expect(B.world.isAlive(aOnB)).toBe(true);

    // --- despawn propagates ---
    sworld.destroy(players.get(2)!);
    frame(10);
    expect(A.world.isAlive(bOnA)).toBe(false);
    expect(A.client.entities.has(bNetId)).toBe(false);
    expect(B.world.isAlive(bSelf)).toBe(false);
    expect(B.client.owned.size).toBe(0);
    expect(A.client.entities.size).toBe(2);

    // --- schema mismatch rejected ---
    const bad = new NetClient({ world: makeWorld({ extra: true }), transport: net.createClient({ latencyMs: 60 }) });
    const p = bad.connect(); p.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 0)); frame(4);
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetRejectedError);
    expect((err as NetRejectedError).reason).toBe(RejectReason.SchemaMismatch);
    expect(server.sessions.size).toBe(2);
  });
});
