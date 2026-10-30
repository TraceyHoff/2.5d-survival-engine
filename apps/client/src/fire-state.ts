/**
 * ADR-218: which fired pieces are open hearths (flame art + embers/smoke) vs. small lights (lanterns, candles, lamps:
 * light flicker only). Feeds the renderer's GameplayBindings.pieceLit / litPieces (FireState: 0 out, 1 lit, 2 hearth).
 */
export const HEARTH_PIECES: ReadonlySet<string> = new Set(["campfire", "furnace", "fireplace", "wood_stove", "stove_iron", "cook_range", "clay_oven"]);

export function pieceFireState(key: string | undefined, lit: boolean): number {
  if (!lit) return 0; return key && HEARTH_PIECES.has(key) ? 2 : 1;
}
