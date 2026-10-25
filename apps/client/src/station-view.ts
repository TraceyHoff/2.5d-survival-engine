import { frameIdForAnim } from "@engine/render";
/**
 * ADR-141: a free-standing station (spawnStation: CraftingStation, no BuildPiece) draws the bonfire sprite. A placed
 * station piece (workbench, anvil, garage …) also carries CraftingStation on its piece entity, and must keep its own
 * piece art. Before this check, every placed workbench/anvil rendered as a bonfire.
 */
export const isFreeStandingStation = (hasStation: boolean, hasPiece: boolean): boolean => hasStation && !hasPiece;
/** ADR-141: the bonfire art has idle (burning, loops) and unlit; an out station showed flames. 0 = default (idle) anim. */
export const stationFireFrame = (animNames: readonly string[], lit: boolean): number => (lit ? 0 : frameIdForAnim(animNames, "unlit"));
