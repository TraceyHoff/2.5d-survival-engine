/**
 * Windsock (pieces with features.windsock). Pure read of the replicated core Weather wind: no gameplay state, so
 * every peer computes the same reading from Weather alone (deterministic, nothing extra on the wire).
 * Art hook: render rotates the sock to `dir` and picks the inflation pose from `stage` (0 limp .. 3 full).
 */
import { Weather, type World } from "@engine/core";

/** Wind speed (tiles/s) at which a sock is fully inflated. */
export const WINDSOCK_FULL_SPEED = 12;
export interface WindsockReading { readonly dir: number; readonly speed: number; readonly strength: number; readonly stage: 0 | 1 | 2 | 3 }
export function windsockReading(world: World): WindsockReading {
  const w = world.env(Weather);
  const speed = Math.max(0, w.windSpeed);
  const strength = Math.min(1, speed / WINDSOCK_FULL_SPEED);
  const stage = (strength < 0.15 ? 0 : strength < 0.5 ? 1 : strength < 0.85 ? 2 : 3) as WindsockReading["stage"];
  return { dir: w.windDir, speed, strength, stage };
}
