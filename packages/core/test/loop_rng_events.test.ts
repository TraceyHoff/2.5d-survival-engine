import { describe, it, expect } from "vitest";
import { FixedLoop, DEFAULT_TICK_HZ, Rng, EventBus, defineEvent, lerpAngle } from "../src/index.js";

describe("FixedLoop", () => {
  it("defaults to 20Hz, steps fixed dt, reports alpha", () => {
    const dts: number[] = []; let alpha = -1;
    const l = new FixedLoop({ step: (dt) => dts.push(dt), render: (a) => (alpha = a) });
    expect(DEFAULT_TICK_HZ).toBe(20);
    expect(l.advance(120)).toBe(2); expect(dts).toEqual([0.05, 0.05]); expect(alpha).toBeCloseTo(0.4);
    expect(l.advance(30)).toBe(1); expect(alpha).toBeCloseTo(0);
  });
  it("clamps spiral of death", () => {
    let n = 0; const l = new FixedLoop({ tickHz: 30, maxStepsPerFrame: 4, step: () => n++ });
    l.advance(10000); expect(n).toBe(4); expect(l.alpha).toBe(0);
  });
});
describe("Rng", () => {
  it("is deterministic per seed and in range", () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const sa = Array.from({ length: 100 }, () => a.next());
    expect(sa).toEqual(Array.from({ length: 100 }, () => b.next()));
    expect(sa[0]).not.toBe(c.next());
    for (const v of sa) expect(v >= 0 && v < 1).toBe(true);
    for (let i = 0; i < 1000; i++) { const v = a.int(3, 7); expect(v >= 3 && v < 7).toBe(true); }
  });
  it("state can be snapshotted/restored", () => {
    const a = new Rng(5); a.next(); const s = a.state; const x = a.next();
    const b = new Rng(0); b.state = s; expect(b.next()).toBe(x);
  });
});
describe("EventBus", () => {
  it("queues until flush, preserves order, unsubscribes", () => {
    const E = defineEvent<number>("E"); const bus = new EventBus(); const got: number[] = [];
    const off = bus.on(E, (n) => got.push(n));
    bus.emit(E, 1); bus.emit(E, 2); expect(got).toEqual([]); bus.flush(); expect(got).toEqual([1, 2]);
    off(); bus.emitNow(E, 3); expect(got).toEqual([1, 2]);
  });
});
describe("math", () => { it("lerpAngle takes short path", () => { expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1); }); });
import { createGameLoop, World, Transform, PrevTransform, lerp } from "../src/index.js";
describe("createGameLoop", () => {
  it("steps world and calls render(world, alpha) with interpolatable transforms", () => {
    const w = new World(); const e = w.create(); w.add(e, Transform);
    w.addSystem("simulation", "m", (wd) => wd.setField(e, Transform, "x", wd.getField(e, Transform, "x")! + 1));
    let seen = NaN;
    const loop = createGameLoop(w, { render: (wd, a) => { seen = lerp(wd.get(e, PrevTransform)!.x, wd.get(e, Transform)!.x, a); } });
    loop.advance(75); expect(w.tick).toBe(1); expect(seen).toBeCloseTo(0.5);
  });
});
