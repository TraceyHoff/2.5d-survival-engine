import { Weather, World, type EventType } from "@engine/core";
import { installGameplay, type GameplayOptions, type GEvent } from "../src/index.js";

export const DT = 1 / 20;
/** Standalone world; weather pinned to Clear unless `liveWeather` (tests stay independent of weather rolls). */
export function makeWorld(opts: GameplayOptions & { liveWeather?: boolean } = {}, seed = 42, maxEntities = 1 << 14): World {
  const w = new World({ seed, maxEntities });
  const { liveWeather, ...rest } = opts;
  installGameplay(w, rest);
  if (!liveWeather) w.env(Weather).endsAtTick = 0xffffffff;
  return w;
}
export function steps(w: World, n: number): void { for (let i = 0; i < n; i++) w.step(DT); }
/** Collects delivered events of one type. */
export function collect<T>(w: World, type: GEvent<T>): (T & { tick: number })[] { const out: (T & { tick: number })[] = []; w.events.on(type as EventType<T & { tick: number }>, (p) => out.push(p)); return out; }
