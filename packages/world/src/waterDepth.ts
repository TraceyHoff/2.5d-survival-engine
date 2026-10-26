/**
 * ADR-181: two water depths without a new persisted tile. A water tile is SHALLOW when any land tile lies within
 * `radius` (Chebyshev) of it: shore bands, rivers and ponds. Otherwise it is DEEP (lake / sea centres). The explicit
 * shallow tile id (8, render TileId.ShallowWater) is always shallow. Tile 0 (not loaded / unknown) never counts as
 * land, so a lake at the edge of the loaded area reads as deep rather than flickering to shallow.
 * Gameplay (server + client prediction) and every renderer call this one function, so they always agree.
 */
export const WATER_TILE = 1, SHALLOW_WATER_TILE = 8;
export const WaterDepth = { None: 0, Shallow: 1, Deep: 2 } as const;
export type WaterDepth = (typeof WaterDepth)[keyof typeof WaterDepth];
export const SHALLOW_RADIUS = 2;

export function isWaterId(id: number): boolean { return id === WATER_TILE || id === SHALLOW_WATER_TILE; }

export function waterDepthAt(tileAt: (tx: number, ty: number) => number, tx: number, ty: number, radius = SHALLOW_RADIUS): WaterDepth {
  const id = tileAt(tx, ty);
  if (id === SHALLOW_WATER_TILE) return WaterDepth.Shallow;
  if (id !== WATER_TILE) return WaterDepth.None;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if (!dx && !dy) continue; const n = tileAt(tx + dx, ty + dy); if (n !== 0 && !isWaterId(n)) return WaterDepth.Shallow;
  }
  return WaterDepth.Deep;
}
