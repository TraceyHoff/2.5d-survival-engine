import { describe, it, expect } from "vitest";
import { World, Weather, decayAt, decayReachesAt, defineModifierStack, addModifier, removeModifiers, evaluate, pruneModifiers, ModOp, stepN, wireValue, entityIndex } from "../src/index.js";

describe("scheduled systems", () => {
  it("every/offset run deterministically with dt * every; replay honors schedule", () => {
    const w = new World(); const ticks: number[] = []; const dts: number[] = [];
    w.addSystem("simulation", "slow", (wd, dt) => { ticks.push(wd.tick); dts.push(dt); }, { every: 4, offset: 1 });
    stepN(w, 10, 0.05); expect(ticks).toEqual([1, 5, 9]); expect(dts[0]).toBeCloseTo(0.2);
    expect(w.systemOrder()).toEqual([{ phase: "simulation", name: "slow", every: 4, offset: 1 }]);
    ticks.length = 0; w.simulate(4, 0.05, { startTick: 3 }); expect(ticks).toEqual([5]);
    const a = new World(); a.addSystem("simulation", "decay", () => {}, { every: 20 });
    const b = new World(); b.addSystem("simulation", "decay", () => {}, { every: 20 });
    expect(a.systemOrder()[0]!.offset).toBe(b.systemOrder()[0]!.offset); // stagger from name hash, stable
    expect(() => a.addSystem("simulation", "x", () => {}, { every: 0 })).toThrow();
  });
});

describe("decayAt", () => {
  it("linear/exp lazy values and spoil tick", () => {
    expect(decayAt(100, 0.01, 150)).toBeCloseTo(0.5); expect(decayAt(100, 0.01, 50)).toBe(1); expect(decayAt(0, 0.01, 1000)).toBe(0);
    expect(decayAt(0, 0.1, 2, { mode: "exp", initial: 10 })).toBeCloseTo(8.1);
    expect(decayReachesAt(100, 0.01)).toBe(200); expect(decayReachesAt(0, 0)).toBe(Infinity);
  });
});

describe("modifier stacks", () => {
  const Mods = defineModifierStack("Mods", 3); const SPEED = 1, WARMTH = 2;
  it("add/refresh/evaluate/expire/prune/remove", () => {
    const w = new World(); w.register(Mods); const e = w.create();
    expect(evaluate(w, e, Mods, SPEED, 1)).toBe(1);
    addModifier(w, e, Mods, { stat: SPEED, op: ModOp.Mul, value: 0.5, expiresAtTick: 10 }); // wet
    addModifier(w, e, Mods, { stat: SPEED, op: ModOp.Add, value: 0.2 });                    // well-fed, permanent
    addModifier(w, e, Mods, { stat: WARMTH, op: ModOp.Add, value: -3, expiresAtTick: 5 });
    expect(evaluate(w, e, Mods, SPEED, 1)).toBeCloseTo(0.6);
    addModifier(w, e, Mods, { stat: SPEED, op: ModOp.Mul, value: 0.8, expiresAtTick: 20 }); // refresh replaces same stat+op
    expect(evaluate(w, e, Mods, SPEED, 1)).toBeCloseTo(0.96);
    expect(addModifier(w, e, Mods, { stat: 9, op: ModOp.Add, value: 1, replace: false })).toBe(-1); // full
    stepN(w, 6); expect(evaluate(w, e, Mods, WARMTH, 0)).toBe(0); // expired
    expect(addModifier(w, e, Mods, { stat: 9, op: ModOp.Add, value: 1 })).toBe(2); // reuses expired slot
    stepN(w, 20); pruneModifiers(w, Mods); expect(w.get(e, Mods)!.stat.filter((s) => s !== 0).sort()).toEqual([1, 9]);
    expect(removeModifiers(w, e, Mods, 9)).toBe(1); expect(() => addModifier(w, e, Mods, { stat: 0, op: ModOp.Add, value: 1 })).toThrow();
    void entityIndex;
  });
});

describe("wind in Weather", () => {
  it("windDir q8 angle and windSpeed q8 are networked fields", () => {
    const w = new World(); w.env(Weather).windDir = 1.0; w.env(Weather).windSpeed = 5;
    expect(Weather.networked).toBe(true);
    const st = w.store(Weather); const s = st.slot(entityIndex(w.environment));
    expect(wireValue(st, "windDir", s).quant!.bits).toBe(8); expect(wireValue(st, "windSpeed", s).quant).toEqual({ bits: 8, min: 0, max: 32 });
  });
});
