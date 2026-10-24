/**
 * Sprite.frameId encoding for "pick a named animation" on non-animated sprites (ADR-120 sign facings idle/idle_r1..r3).
 * Plain frameId (high bit clear) = frame (variant) of the sprite's first animation, as before.
 * High bit set = animation index (frameId & 0x7fff) in the sprite's animList, first frame. Both renderers decode it.
 */
export const FRAME_ANIM = 0x8000;
export const animFrameId = (animIndex: number): number => FRAME_ANIM | (animIndex & 0x7fff);
/** Animation index selected by a frameId, or -1 when it is a plain frame. */
export const frameAnim = (frameId: number): number => ((frameId & FRAME_ANIM) !== 0 ? frameId & 0x7fff : -1);
/** frameId that shows `anim` of a sprite with these animation names (plain 0 when absent). */
export function frameIdForAnim(animNames: readonly string[], anim: string): number {
  const i = animNames.indexOf(anim); return i < 0 ? 0 : animFrameId(i);
}
/** ADR-120: sign facing animation for Sign.rot (0 -> idle, n -> idle_r<n>). */
export const signFacingAnim = (rot: number): string => ((rot & 3) === 0 ? "idle" : `idle_r${rot & 3}`);
