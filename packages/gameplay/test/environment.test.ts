import { describe, it, expect } from "vitest";
import { TimeOfDay, Weather, World, setTimeOfDay, timeOfDay } from "@engine/core";
import { WeatherKind } from "../src/defs.js";
import {
  ambientTemperature, DayPhase, DayPhaseChanged, dayPhase, defaultDefs, Exposure, installGameplay, spawnPlayer,
  spawnStation, StationKind, threatLevel, VitalsModifiers, WeatherChanged,
} from "../src/index.js";
import { collect, makeWorld, steps } from "./helpers.js";

const env = defaultDefs().environment;
const vt = defaultDefs().vitals;

describe("day/night", () => {
  it("advances TimeOfDay by exact ticks and emits phase changes", () => {
    const w = makeWorld({ dayLengthTicks: 100 });
    setTimeOfDay(w, 0 * 24);
    const phases = collect(w, DayPhaseChanged);
    steps(w, 100);
    expect(timeOfDay(w).t).toBe(0);
    expect(timeOfDay(w).day).toBe(1);
    expect(phases.map((p) => p.phase)).toEqual([DayPhase.Dawn, DayPhase.Day, DayPhase.Dusk, DayPhase.Night]);
  });

  it("nights are colder than days and raise threat", () => {
    const w = makeWorld();
    setTimeOfDay(w, 0.5 * 24); const noon = ambientTemperature(w);
    expect(threatLevel(w)).toBe(1);
    setTimeOfDay(w, 0 * 24); const midnight = ambientTemperature(w);
    expect(noon - midnight).toBeCloseTo(2 * env.dayNightAmplitude, 4);
    expect(threatLevel(w)).toBe(env.nightThreatMul);
    expect(dayPhase(0.9)).toBe(DayPhase.Night);
  });
});

describe("weather", () => {
  it("is driven by the seeded RNG: same seed => same weather sequence", () => {
    const seq = (seed: number) => {
      const w = new World({ seed }); installGameplay(w, { role: "server" });
      const ev = collect(w, WeatherChanged);
      for (let i = 0; i < 20 * 60 * 60; i++) w.step(1 / 20);
      return ev.map((e) => [e.to, e.ticks]);
    };
    const a = seq(5);
    expect(a.length).toBeGreaterThan(3);
    expect(seq(5)).toEqual(a);
    expect(seq(6)).not.toEqual(a);
  });

  it("does not run on the client (replicated instead)", () => {
    const w = new World(); installGameplay(w, { role: "client" });
    steps(w, 10);
    expect(w.env(Weather).endsAtTick).toBe(0);
    expect(w.env(Weather).kind).toBe(WeatherKind.Clear);
  });
});

describe("exposure", () => {
  function rainy() {
    const w = makeWorld();
    Object.assign(w.env(Weather), { kind: WeatherKind.Rain, intensity: 1, endsAtTick: 0xffffffff });
    setTimeOfDay(w, 0.5 * 24);
    return w;
  }

  it("rain wets unsheltered players, which chills felt temperature; shelter keeps them dry", () => {
    const w = rainy();
    const out = spawnPlayer(w, { x: 0, y: 0 }); const inside = spawnPlayer(w, { x: 20, y: 0 });
    w.setField(inside, Exposure, "sheltered", 1);
    steps(w, 20 * 20);
    const o = w.get(out, Exposure)!, i = w.get(inside, Exposure)!;
    expect(o.wetness).toBeCloseTo(0.02 * 20, 2);
    expect(i.wetness).toBe(0);
    expect(i.feltTemp - o.feltTemp).toBeCloseTo(env.shelterTempBonus + env.wetChill * o.wetness, 2);
  });

  it("campfires warm nearby players and speed drying", () => {
    const w = rainy(); setTimeOfDay(w, 0 * 24);
    const p = spawnPlayer(w, { x: 0, y: 0 }); const far = spawnPlayer(w, { x: 30, y: 0 });
    w.setField(p, Exposure, "sheltered", 1); w.setField(far, Exposure, "sheltered", 1);
    w.setField(p, Exposure, "wetness", 0.5); w.setField(far, Exposure, "wetness", 0.5);
    spawnStation(w, StationKind.Campfire, 1, 0);
    w.step(1 / 20);
    const near = w.get(p, Exposure)!, cold = w.get(far, Exposure)!;
    expect(near.feltTemp).toBeGreaterThan(cold.feltTemp + 10);
    expect(near.wetness).toBeLessThan(cold.wetness);
  });

  it("cold raises hunger multiplier; weather sets thirst/stamina multipliers", () => {
    const w = rainy(); setTimeOfDay(w, 0 * 24);
    const p = spawnPlayer(w, { x: 0, y: 0 });
    w.step(1 / 20);
    const m = w.get(p, VitalsModifiers)!;
    expect(w.get(p, Exposure)!.feltTemp).toBeLessThan(vt.comfortMin);
    expect(m.hungerMul).toBeCloseTo(vt.coldHungerMul);
    expect(m.thirstMul).toBeCloseTo(0.8);
    expect(m.staminaRegenMul).toBeCloseTo(0.9);
  });
});
