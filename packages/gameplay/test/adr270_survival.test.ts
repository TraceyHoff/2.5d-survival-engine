import { describe, expect, it, vi } from "vitest";
import { setTimeOfDay, timeOfDay, Weather } from "@engine/core";
import * as G from "../src/index.js";
import { diseaseSystem } from "../src/systems/diseases.js";
import { weatherSystem } from "../src/systems/environment.js";
import { makeWorld, steps } from "./helpers.js";

const dt = 1 / 20;
describe("ADR-270: a dry first world day", () => {
  it("never rolls rain/storm on day zero; later summer days can still roll both", () => {
    const w = makeWorld({ liveWeather: true, dayLengthTicks: 2000 });
    setTimeOfDay(w, 6, 0);
    while (timeOfDay(w).day === 0) {
      w.env(Weather).endsAtTick = 0;
      weatherSystem(w, dt);
      expect(G.isRaining(w.env(Weather).kind)).toBe(false);
      w.step(dt);
    }
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) { w.env(Weather).endsAtTick = 0; weatherSystem(w, dt); seen.add(w.env(Weather).kind); }
    expect(seen.has(G.WeatherKind.Rain)).toBe(true);
    expect(seen.has(G.WeatherKind.Storm)).toBe(true);
    expect(seen.has(G.WeatherKind.Snow)).toBe(false);
  });
  for (const kind of [G.WeatherKind.Rain, G.WeatherKind.Storm]) it(`ends a loaded day-zero ${kind} immediately, including pinned weather`, () => {
    const w = makeWorld();
    Object.assign(w.env(Weather), { kind, intensity: 1, endsAtTick: G.PINNED_WEATHER });
    weatherSystem(w, dt);
    expect(G.isRaining(w.env(Weather).kind)).toBe(false);
    setTimeOfDay(w, 6, 1);
    Object.assign(w.env(Weather), { kind, intensity: 1, endsAtTick: G.PINNED_WEATHER });
    weatherSystem(w, dt);
    expect(w.env(Weather).kind).toBe(kind); // existing later-day saves are untouched
  });
});

describe("ADR-270: infections are rarer, not removed", () => {
  it("locks old -> new risk reductions and unchanged non-infection exposure tuning", () => {
    const t = G.defaultDefs().diseaseTuning;
    for (const [key, old, next] of [["rawMeatChance", .08, .03], ["rawWaterChance", .10, .025], ["rottenFoodChance", .25, .10], ["sickFoodChance", .05, .02], ["woundChance", .08, .025]] as const) {
      expect(t.causes[key]).toBe(next); expect(next).toBeLessThan(old);
    }
    expect(t.transmission).toMatchObject({ contactSeconds: 60, chance: .05, scanEveryTicks: 20, radiusTiles: 2 });
    expect(t.exposure).toEqual({ coldSeconds: 360, heatSeconds: 180, sprintSeconds: 90, restSeconds: 30 });
  });
  it("a raw meal roll that previously infected no longer does; a lower roll still infects", () => {
    for (const [roll, infected] of [[.04, false], [.02, true]] as const) {
      const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0, clientId: 1 });
      const original = w.rngFor.bind(w);
      vi.spyOn(w, "rngFor").mockImplementation((key, ...rest) => { const r = original(key, ...rest); if (key === "disease.food_poisoning") vi.spyOn(r, "next").mockReturnValue(roll); return r; });
      G.addItem(w, p, G.defaultDefs().itemId("raw_meat"), 1);
      G.setIntent(w, p, { action: G.IntentAction.Use, slot: 0 }); steps(w, 1);
      expect(G.hasDisease(w, p, "food_poisoning")).toBe(infected);
    }
  });
  it("cold needs six sustained minutes rather than three; warmth resets the clock", () => {
    const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0, clientId: 1 });
    G.ensureDiseases(w, p); w.setField(p, G.Survival, "bodyTemp", 34);
    w.setField(p, G.Diseases, "coldTicks", 180 * 20 - 1); diseaseSystem(w, dt);
    expect(G.hasDisease(w, p, "common_cold")).toBe(false);
    w.setField(p, G.Diseases, "coldTicks", 360 * 20 - 1); diseaseSystem(w, dt);
    expect(G.hasDisease(w, p, "common_cold")).toBe(true);
    w.setField(p, G.Survival, "bodyTemp", 37); diseaseSystem(w, dt);
    expect(w.getField(p, G.Diseases, "coldTicks")).toBe(0);
  });
});
