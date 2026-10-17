import { describe, it, expect } from "vitest";
import { Weather } from "@engine/core";
import { WeatherKind } from "../src/defs.js";
import {
  addItem, countItem, DamageCause, Dead, defaultDefs, Died, Exposure, Health, IntentAction, setIntent,
  spawnPlayer, Survival, Vital, VitalDepleted, ItemConsumed,
} from "../src/index.js";
import { collect, makeWorld, steps } from "./helpers.js";

const vt = defaultDefs().vitals;
const SEC = 20;

/** A world where exposure is neutral: comfortable midday, insulation tuned so felt temp stays in band. */
function neutral() {
  const w = makeWorld();
  const p = spawnPlayer(w, { x: 0, y: 0 });
  w.setField(p, Exposure, "insulation", 6);
  return { w, p };
}

describe("vitals", () => {
  it("decays hunger and thirst per second at the JSON rates", () => {
    const { w, p } = neutral();
    steps(w, 10 * SEC);
    const s = w.get(p, Survival)!;
    expect(s.hunger).toBeCloseTo(100 - vt.hungerDecayPerSec * 10, 3);
    const clearThirstMul = defaultDefs().environment.weather.find((x) => x.kind === WeatherKind.Clear)!.thirstMul;
    expect(s.thirst).toBeCloseTo(100 - vt.thirstDecayPerSec * clearThirstMul * 10, 3);
  });

  it("starvation damages, emits VitalDepleted once, and kills with cause Starvation", () => {
    const { w, p } = neutral();
    const depleted = collect(w, VitalDepleted); const died = collect(w, Died);
    w.set(p, Survival, { hunger: 0.001, thirst: 100 });
    w.set(p, Health, { hp: 2 });
    steps(w, 3 * SEC);
    expect(depleted.filter((d) => d.vital === Vital.Hunger)).toHaveLength(1);
    expect(died).toEqual([{ entity: p, cause: DamageCause.Starvation }]);
    expect(w.get(p, Dead)!.cause).toBe(DamageCause.Starvation);
    const hpAtDeath = w.get(p, Health)!.hp; steps(w, SEC);
    expect(w.get(p, Health)!.hp).toBe(hpAtDeath); // dead entities stop simulating
  });

  it("dehydration damage uses dehydrationDps", () => {
    const { w, p } = neutral();
    w.set(p, Survival, { thirst: 0, hunger: 50 });
    steps(w, 2 * SEC);
    expect(w.get(p, Health)!.hp).toBeCloseTo(vt.maxHealth - vt.dehydrationDps * 2, 3);
  });

  it("sprinting drains stamina; regen waits for the delay, then refills", () => {
    const { w, p } = neutral();
    setIntent(w, p, { moving: 1, sprint: 1 });
    steps(w, 2 * SEC);
    expect(w.get(p, Survival)!.stamina).toBeCloseTo(vt.maxStamina - vt.sprintStaminaDrainPerSec * 2, 3);
    setIntent(w, p, { sprint: 0 });
    const before = w.get(p, Survival)!.stamina;
    steps(w, Math.round(vt.staminaRegenDelaySeconds * SEC) - 1);
    expect(w.get(p, Survival)!.stamina).toBe(before);
    steps(w, 2 * SEC);
    expect(w.get(p, Survival)!.stamina).toBeGreaterThan(before);
    steps(w, 10 * SEC);
    expect(w.get(p, Survival)!.stamina).toBe(vt.maxStamina);
  });

  it("low hunger halves stamina regen", () => {
    const { w, p } = neutral();
    w.set(p, Survival, { stamina: 0, hunger: vt.lowNeedsThreshold - 1 });
    steps(w, SEC);
    expect(w.get(p, Survival)!.stamina).toBeCloseTo(vt.staminaRegenPerSec * vt.lowNeedsStaminaRegenMul, 1);
  });

  it("cold drops body temperature into hypothermia damage", () => {
    const w = makeWorld();
    const p = spawnPlayer(w, { x: 0, y: 0 });
    w.env(Weather).kind = WeatherKind.Snow; w.env(Weather).intensity = 1; w.env(Weather).endsAtTick = 0xffffffff;
    w.set(p, Survival, { bodyTemp: vt.hypothermiaBelow + 0.05 });
    steps(w, 5 * SEC);
    expect(w.get(p, Survival)!.bodyTemp).toBeLessThan(vt.hypothermiaBelow);
    expect(w.get(p, Health)!.hp).toBeLessThan(vt.maxHealth);
  });

  it("eating berries from a slot restores hunger and consumes one unit", () => {
    const { w, p } = neutral();
    const berries = defaultDefs().itemId("berries");
    addItem(w, p, berries, 3);
    w.set(p, Survival, { hunger: 50 });
    const eaten = collect(w, ItemConsumed);
    setIntent(w, p, { action: IntentAction.Use, slot: 0 });
    w.step(1 / 20);
    expect(countItem(w, p, berries)).toBe(2);
    expect(w.get(p, Survival)!.hunger).toBeCloseTo(62, 1);
    expect(eaten).toEqual([{ entity: p, item: berries }]);
  });

  it("well-fed players regenerate health", () => {
    const { w, p } = neutral();
    w.set(p, Health, { hp: 50 });
    steps(w, 4 * SEC);
    expect(w.get(p, Health)!.hp).toBeCloseTo(50 + vt.healthRegenPerSec * 4, 3);
  });
});
