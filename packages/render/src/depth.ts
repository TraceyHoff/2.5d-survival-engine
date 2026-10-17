import { DEFAULT_ISO, type IsoConfig } from "@engine/world";

/**
 * Depth key used for the hardware depth buffer: key = x + y + z * zFactor (larger = closer).
 * zFactor is what a true orthographic camera consistent with the 2:1 projection implies
 * (exactly 1/3 for 64x32 tiles with zStep 16). @engine/world's isoDepth uses z*0.001, which is
 * fine for painter-sorting flat sprites but not for per-vertex depth on cliffs/billboards.
 * Derivation: elevation e has sin(e) = tileH/tileW; d/d(x+y) = (tileW/2)cos(e); d/dz = zStep*tan(e).
 */
export function isoZDepthFactor(c: IsoConfig = DEFAULT_ISO): number {
  const s = c.tileH / c.tileW;
  const cos = Math.sqrt(1 - s * s);
  return (c.zStep * (s / cos)) / ((c.tileW / 2) * cos);
}
