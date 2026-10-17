import { describe, it, expect } from "vitest";
import { World, Transform, TimeOfDay, Weather, timeOfDay, setTimeOfDay, setDayLength, wireValue, dequantize, normalizeAngle, TRANSFORM_Z_MAX, stepN, entityIndex } from "../src/index.js";

describe("Transform quantization hints", () => {
  it("facing q8 over [-π,π], z q10 over [0,64]; sim keeps f32", () => {
    const w = new World(); const e = w.create(); w.add(e, Transform, { z: 3.3, facing: 2.0 });
    const st = w.store(Transform); const s = st.slot(entityIndex(e));
    const f = wireValue(st, "facing", s); expect(f.quant).toEqual({ bits: 8, min: -Math.PI, max: Math.PI });
    expect(Math.abs(dequantize(f.value, f.quant!) - 2.0)).toBeLessThan((2 * Math.PI) / 255);
    const z = wireValue(st, "z", s); expect(z.quant!.bits).toBe(10); expect(z.quant!.max).toBe(TRANSFORM_Z_MAX);
    expect(Math.abs(dequantize(z.value, z.quant!) - 3.3)).toBeLessThan(64 / 1023);
    expect(w.getField(e, Transform, "facing")).toBeCloseTo(2.0, 6);
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI); expect(normalizeAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2);
  });
});

describe("derived TimeOfDay", () => {
  it("derives hours/day from world.tick without per-tick writes", () => {
    const w = new World(); expect(timeOfDay(w)).toMatchObject({ t: 0, day: 0, dayLengthTicks: 0 });
    w.env(TimeOfDay).dayLengthTicks = 240; setTimeOfDay(w, 6); w.step(0.05);
    expect(timeOfDay(w).hours).toBeCloseTo(6.1); // 1 tick = 0.1 h
    stepN(w, 10); expect([...w.changed(TimeOfDay)]).toEqual([]); // no per-tick replication
    stepN(w, 289); expect(timeOfDay(w)).toMatchObject({ day: 1, hours: 12 }); // tick 300, 360 ticks since 00:00 day 0
    expect(timeOfDay(w, w.tick - 240).day).toBe(0);
  });
  it("setTimeOfDay / setDayLength jump without changing day unless asked", () => {
    const w = new World(); stepN(w, 1000); w.env(TimeOfDay).dayLengthTicks = 100;
    setTimeOfDay(w, 12, 5); expect(timeOfDay(w)).toMatchObject({ day: 5, hours: 12 });
    setDayLength(w, 400); expect(timeOfDay(w)).toMatchObject({ day: 5, hours: 12, dayLengthTicks: 400 });
    setTimeOfDay(w, 18); expect(timeOfDay(w)).toMatchObject({ day: 5, hours: 18 });
    expect(() => setDayLength(w, 0)).toThrow();
  });
});

describe("Weather endsAtTick", () => {
  it("is a u32 absolute tick that stays constant", () => {
    const w = new World(); w.env(Weather).endsAtTick = 100; stepN(w, 5);
    expect(w.env(Weather).endsAtTick).toBe(100); expect(Weather.schema).toEqual({ kind: "u8", intensity: "f32", endsAtTick: "u32" });
  });
});
