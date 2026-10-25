/**
 * ADR-141: a free-standing station (spawnStation: CraftingStation, no BuildPiece) draws the bonfire sprite. A placed
 * station piece (workbench, anvil, garage …) also carries CraftingStation on its piece entity, and must keep its own
 * piece art. Before this check, every placed workbench/anvil rendered as a bonfire.
 */
export const isFreeStandingStation = (hasStation: boolean, hasPiece: boolean): boolean => hasStation && !hasPiece;
