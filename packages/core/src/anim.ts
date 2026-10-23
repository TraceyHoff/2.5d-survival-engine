/**
 * Shared animation state ids (ADR-093). Replicated as u8 (gameplay `AnimState.anim`), so values are WIRE-STABLE:
 * never renumber; append only. Hit/Death are aliases of Hurt/Die (same value), not new states.
 */
export const enum AnimState {
  Idle = 0, Walk = 1, Run = 2, Attack = 3, Hurt = 4, Die = 5, Gather = 6, Build = 7,
  Eat = 8, Graze = 9, Shamble = 10, Crawl = 11, Feed = 12,
  Hit = Hurt, Death = Die,
}
/** Canonical name per AnimState value (index = value). Append in step with the enum. */
export const ANIM_STATE_NAMES: readonly string[] = Object.freeze(["idle", "walk", "run", "attack", "hurt", "die", "gather", "build", "eat", "graze", "shamble", "crawl", "feed"]);
export const animStateName = (s: number): string | undefined => ANIM_STATE_NAMES[s];
