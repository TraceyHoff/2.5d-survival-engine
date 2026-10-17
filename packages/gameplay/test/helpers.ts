import { World, type EventType } from "@engine/core";
import { installGameplay, type GameplayOptions } from "../src/index.js";

export const DT = 1 / 20;
export function makeWorld(opts: GameplayOptions = {}, seed = 42): World {
  const w = new World({ seed, maxEntities: 1024 });
  installGameplay(w, { driveWeather: false, ...opts });
  return w;
}
export function steps(w: World, n: number): void { for (let i = 0; i < n; i++) w.step(DT); }
/** Collects delivered events of one type. */
export function collect<T>(w: World, type: EventType<T>): T[] { const out: T[] = []; w.events.on(type, (p) => out.push(p)); return out; }
