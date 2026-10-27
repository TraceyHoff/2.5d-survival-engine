import { describe, expect, it } from "vitest";
import { Owner, Transform, type Entity } from "@engine/core";
import { InterpolationBuffer, LoopbackNetwork, NetClient, NetServer } from "../src/index.js";
import { BTN_RIGHT, DT, SPEED, applyInput, join, makeWorld } from "./fixture.js";

function client(net: LoopbackNetwork, link: { latencyMs: number; jitterMs?: number }) {
  const input = { buttons: 0 }; const world = makeWorld();
  const c = new NetClient({ world, transport: net.createClient(link), applyInput, sampleInput: () => ({ buttons: input.buttons, aimX: 0, aimY: 0 }), interpDelayTicks: 4 });
  return { world, client: c, input };
}

async function remoteSteps(throttle: { nearTiles: number; interval: number } | undefined, link: { latencyMs: number; jitterMs?: number }) {
  const net = new LoopbackNetwork(99); const sworld = makeWorld();
  new NetServer({ world: sworld, transport: net.createServer(), applyInput, ...(throttle ? { distantThrottle: throttle } : {}),
    onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: 0, y: s.clientId === 1 ? 0 : 60 }).add(e, Owner, { clientId: s.clientId }); } });
  const A = client(net, link), B = client(net, link);
  await join(net, A.client); await join(net, B.client);
  const frame = () => { net.advance(50); sworld.step(DT); A.world.step(DT); B.world.step(DT); };
  for (let i = 0; i < 10; i++) frame();
  const bOnA = A.client.entities.get([...B.client.owned][0]!)! as Entity;
  B.input.buttons = BTN_RIGHT; for (let i = 0; i < 20; i++) frame();
  const steps: number[] = []; let px = A.world.getField(bOnA, Transform, "x")!;
  for (let i = 0; i < 120; i++) {
    B.input.buttons = Math.floor(i / 40) % 2 === 0 ? BTN_RIGHT : 0; // run, stop, run
    frame(); const x = A.world.getField(bOnA, Transform, "x")!; steps.push(x - px); px = x;
  }
  return steps;
}

describe("ADR-192 remote players under distance throttle / budget deferral", () => {
  it("a throttled far remote moves at a steady pace (no hold-then-jump teleports)", async () => {
    for (const link of [{ latencyMs: 30 }, { latencyMs: 75, jitterMs: 10 }]) {
      const s = await remoteSteps({ nearTiles: 10, interval: 3 }, link);
      const run = s.slice(10, 36).concat(s.slice(90, 116)); // well inside the running segments
      for (const d of run) { expect(d).toBeGreaterThan(SPEED * DT * 0.5); expect(d).toBeLessThan(SPEED * DT * 1.5); }
      expect(Math.max(...s)).toBeLessThan(SPEED * DT * 1.5);
      for (const d of s.slice(52, 78)) expect(Math.abs(d)).toBeLessThan(1e-6); // stopped: holds still, no creep or overshoot
    }
  });
  it("buffer: carried (unchanged) snapshots bridge short gaps and pin long rests", () => {
    const b = new InterpolationBuffer(32, 1, [false], 8);
    b.push(1, 0, [0]); b.hold(1, 1); b.hold(1, 2); b.push(1, 3, [3]); // throttled mover: lerp across
    const s1 = b.sample(1, 1)![0]!, s2 = b.sample(1, 2)![0]!; // adaptive lag (≤0.1 tick/call) slews in
    expect(Math.abs(s1 - 1)).toBeLessThan(0.35); expect(Math.abs(s2 - 2)).toBeLessThan(0.35); expect(s2).toBeGreaterThan(s1);
    for (let t = 4; t <= 20; t++) b.hold(1, t); // resting
    expect(b.sample(1, 10)![0]).toBe(3); expect(b.sample(1, 25)![0]).toBe(3); // no extrapolation drift while at rest
    b.push(1, 21, [4]); expect(b.sample(1, 20)![0]).toBe(3); const r = b.sample(1, 21)![0]!; expect(r).toBeGreaterThan(3); expect(r).toBeLessThanOrEqual(4); // no slow creep before resuming
  });
});
