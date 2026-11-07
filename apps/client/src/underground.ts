/**
 * ADR-263 (Task 36): renderer underground darkness from the player's dig depth (replicated TerrainEdit). At 3+ levels
 * below ground the ambient light falls to UNDERGROUND_DARK; local lights (held torch / lantern, campfires, lamps) still
 * draw through the renderer's light pass, so an underground base is dark until it is lit. Shallow pits darken a little.
 * Eased so climbing in / out of a pit fades instead of popping.
 */
import { Transform, type Entity, type World } from "@engine/core";
import { TERRAIN, undergroundDepthAt } from "@engine/gameplay";

/** Target darkness for a depth (levels below ground): 0.15 per level, full darkness from TERRAIN.undergroundDepth. */
export function undergroundTarget(depth: number): number {
  return depth >= TERRAIN.undergroundDepth ? 1 : Math.max(0, depth) * 0.15;
}
/** Frame-rate independent ease toward `target` (about 0.35 s to settle). */
export function easeUnderground(cur: number, target: number, dtSec: number): number {
  const k = 1 - Math.exp(-Math.max(0, dtSec) * 8); return cur + (target - cur) * k;
}
let last = 0;
/** Per frame: write the eased darkness onto the renderer (IsoRenderer / Canvas2D `underground`). */
export function syncUnderground(renderer: { underground?: number } | undefined, world: World, player: Entity | undefined): void {
  if (!renderer) return; const now = performance.now(); const dt = last ? (now - last) / 1000 : 0; last = now;
  const t = player !== undefined && world.isAlive(player) ? world.get(player, Transform) : undefined;
  const target = t ? undergroundTarget(undergroundDepthAt(world, t.x, t.y)) : 0;
  renderer.underground = easeUnderground(renderer.underground ?? 0, target, Math.min(0.25, dt));
}
