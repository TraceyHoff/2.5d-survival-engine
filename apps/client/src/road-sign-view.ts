/**
 * ADR-119/120 view helpers (pure, shared by the WebGL2 and Canvas2D paths through view.ts).
 * Roads: flat ground decals road_<surface>_m<mask>. `mask` is the replicated Road.mask (N1 E2 S4 W8), which the server
 * computes from neighbouring road tiles of ANY surface (roads.ts roadMask): the art's capsule arms run to the tile
 * edge, so a path meeting gravel still joins visually, and a surface change never leaves a dead-end stub.
 * Signs: facing art is the animation idle (rot 0) / idle_r1..r3, picked through a frame-select frameId.
 */
import { frameIdForAnim, signFacingAnim, SpriteFlag } from "@engine/render";

/** Candidate sprite keys for a road tile, best first: the autotile variant, then the plain surface tile. */
export const roadSpriteKeys = (surfaceKey: string | undefined, mask: number): [string, string] => {
  const base = `road_${surfaceKey ?? "path"}`; return [`${base}_m${mask & 15}`, base];
};
/** Roads are ground: Flat so they sort under feet, entities and their shadows (no shadow, no outline). */
export const ROAD_FLAGS = SpriteFlag.Flat | SpriteFlag.NoOutline;
/** Sprite.frameId showing a sign at Sign.rot (0 = idle, n = idle_r<n>; 0 when the art has no such facing). */
export const signFrameId = (animNames: readonly string[], rot: number): number => {
  const want = signFacingAnim(rot); const id = frameIdForAnim(animNames, want);
  return id === 0 && want !== "idle" ? frameIdForAnim(animNames, "idle") : id;
};
