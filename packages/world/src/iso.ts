/** 2:1 dimetric isometric projection. World = float tile units (x east-ish, y south-ish), z = height in tiles. */
export interface IsoConfig { tileW: number; tileH: number; zStep: number }
export const DEFAULT_ISO: IsoConfig = { tileW: 64, tileH: 32, zStep: 16 };
export function worldToScreen(x: number, y: number, z = 0, c: IsoConfig = DEFAULT_ISO): { sx: number; sy: number } {
  return { sx: (x - y) * (c.tileW / 2), sy: (x + y) * (c.tileH / 2) - z * c.zStep };
}
/** Inverse at a given z plane (default ground). */
export function screenToWorld(sx: number, sy: number, z = 0, c: IsoConfig = DEFAULT_ISO): { x: number; y: number } {
  const a = sx / (c.tileW / 2); const b = (sy + z * c.zStep) / (c.tileH / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}
export const screenToTile = (sx: number, sy: number, c: IsoConfig = DEFAULT_ISO): { tx: number; ty: number } => {
  const w = screenToWorld(sx, sy, 0, c); return { tx: Math.floor(w.x), ty: Math.floor(w.y) };
};
/** Painter's sort key: larger draws later. */
export const isoDepth = (x: number, y: number, z = 0): number => x + y + z * 0.001;
