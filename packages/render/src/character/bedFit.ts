/**
 * ADR-244 (c): where a sleeper lies on a bed. The sleep_lie / sleep_lie_under frame pivot goes on the bed piece's
 * footprint centre + bedFits[piece][spot][rot] (1x px, from Art's customization_v2_sample sample.v2.json
 * sleepLie.bedFits; a test keeps this copy in sync). Keys may end in `*` (e.g. `bed_double_*`).
 */
import fits from "./bedFits.json";

type Fit = { x: number; y: number };
export const BED_FITS: Readonly<Record<string, Readonly<Record<string, readonly Fit[]>>>> = fits;
/** Fit table entry for a bed piece key (exact, then `prefix*` wildcard). */
export function bedFitTable(pieceKey: string): Readonly<Record<string, readonly Fit[]>> | undefined {
  if (BED_FITS[pieceKey]) return BED_FITS[pieceKey];
  for (const [k, v] of Object.entries(BED_FITS)) if (k.endsWith("*") && pieceKey.startsWith(k.slice(0, -1))) return v;
  return undefined;
}
/** Pixel offset for (bed piece key, spot name, rotation 0..3); {0,0} when the bed / spot is unknown. */
export function bedFit(pieceKey: string, spot: string, rot: number): Fit {
  const f = bedFitTable(pieceKey)?.[spot]?.[((rot % 4) + 4) % 4]; return f ? { x: f.x || 0, y: f.y || 0 } : { x: 0, y: 0 }; // || 0: Art data has -0
}
