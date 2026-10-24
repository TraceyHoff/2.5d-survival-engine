/** ADR-115: placed build pieces render their stored BuildPiece.variant (replicated u8), by name from defs variantNames like the ghost. */
export function pieceVariantOpts(variantNames: readonly string[] | undefined, variant: number): { variant?: string | number } {
  const n = variantNames?.[variant]; return n ? { variant: n } : variant ? { variant } : {};
}
