// ADR-115: every peer draws the same time of day, from the authoritative server tick, regardless of join time.
import { describe, expect, it } from "vitest";
import { DayClock, TimeOfDay, dayFractionAt, setDayLength, setTimeOfDay, type World } from "@engine/core";
import { LoopbackNetwork, NetClient, NetServer } from "../src/index.js";
import { DT, applyInput, join, makeWorld } from "./fixture.js";

const mk = (net: LoopbackNetwork) => { const world = makeWorld(); const client = new NetClient({ world, transport: net.createClient({ latencyMs: 40, jitterMs: 10 }), applyInput, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }) }); return { world, client }; };
const frac = (w: World, c: NetClient) => { const td = w.env(TimeOfDay); return dayFractionAt(c.serverTickEstimate, td.epochTick, td.dayLengthTicks); };
const wrapDiff = (a: number, b: number) => { const d = a - b; return Math.abs(d - Math.round(d)); };

describe("ADR-115 synced day clock", () => {
  it("two clients joining at different times compute the same time of day (within epsilon)", async () => {
    const net = new LoopbackNetwork(7); const sworld = makeWorld();
    setDayLength(sworld, 2400); setTimeOfDay(sworld, 17.5);
    new NetServer({ world: sworld, transport: net.createServer(), applyInput });
    const step = (ws: World[], n: number) => { for (let i = 0; i < n; i++) { net.advance(50); sworld.step(DT); for (const w of ws) w.step(DT); } };
    const A = mk(net); await join(net, A.client); step([A.world], 300); // A has been here 15 s
    const B = mk(net); await join(net, B.client); step([A.world, B.world], 40);
    expect(A.world.tick).not.toBe(B.world.tick); // local ticks differ: they must not drive the clock
    const server = dayFractionAt(sworld.tick, sworld.env(TimeOfDay).epochTick, 2400);
    const eps = 6 / 2400; // a few ticks of latency/interp
    expect(wrapDiff(frac(A.world, A.client), frac(B.world, B.client))).toBeLessThan(eps);
    expect(wrapDiff(frac(A.world, A.client), server)).toBeLessThan(eps);
  });
  it("DayClock: takes the first sample, extrapolates, and blends (no snap) on reconnect/epoch jumps across the wrap", () => {
    const c = new DayClock(2);
    expect(c.update(0.99, 0, 120)).toBe(0.99);
    expect(c.update(0.99 + 1 / 120 / 60, 1 / 60, 120)).toBeCloseTo(0.99 + 1 / 7200, 9); // natural rate
    let prev = c.value!, maxStep = 0;
    for (let i = 0; i < 240; i++) { const t = c.update(0.05 + (i / 60) / 120, 1 / 60, 120); let d = t - prev; d -= Math.round(d); maxStep = Math.max(maxStep, Math.abs(d)); prev = t; }
    expect(maxStep).toBeLessThan(0.01); // 6% of a day error folded in smoothly, forward across midnight
    expect(wrapDiff(prev, 0.05 + 4 / 120)).toBeLessThan(1e-3);
  });
});
