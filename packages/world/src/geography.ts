/** ADR-273: shared geographic basis, independent of the local camera and grid/art direction names.
 * North = (-1,-1), east = (+1,-1). Map axes are east/right and south/down, in tile units. */
export const NORTH_FACING = -3 * Math.PI / 4;
export function worldToNorthUp(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * Math.SQRT1_2, y: (x + y) * Math.SQRT1_2 };
}
export function northUpToWorld(x: number, y: number): { x: number; y: number } {
  return { x: (x + y) * Math.SQRT1_2, y: (y - x) * Math.SQRT1_2 };
}
