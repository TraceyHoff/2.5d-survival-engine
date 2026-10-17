/**
 * @engine/gameplay — OWNED BY Survival Systems team. Stub: example components + day/night system.
 * Gathering, building, combat, weather systems live here and register into World phases.
 */
import { defineComponent, TimeOfDay, Weather, WeatherKind, type World } from "@engine/core";
export const Health = defineComponent("Health", { hp: "f32", max: "f32" }, { networked: true });
export const ResourceNode = defineComponent("ResourceNode", { kind: "u16", amount: "u16" }, { networked: true });
export const GAMEPLAY_COMPONENTS = [Health, ResourceNode] as const;

export function installGameplay(world: World, dayLengthTicks = 20 * 60 * 10): void {
  for (const c of GAMEPLAY_COMPONENTS) world.register(c);
  world.setResource(TimeOfDay, { t: 0.25, dayLengthTicks, day: 0 });
  world.setResource(Weather, { kind: WeatherKind.Clear, intensity: 0, ticksRemaining: 0 });
  world.addSystem("simulation", "dayNight", (w) => {
    const tod = w.resource(TimeOfDay); tod.t += 1 / tod.dayLengthTicks;
    if (tod.t >= 1) { tod.t -= 1; tod.day++; }
  });
}
