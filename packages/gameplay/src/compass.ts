/** ADR-273: one geographic compass for every client. North is world (-1,-1), east (+1,-1).
 * Transform.facing and wind directions remain world atan2(dy,dx) radians; grid/art axes do not change. */
import { NORTH_FACING } from "@engine/world";
/** World facing radians from a geographic compass heading (degrees clockwise from north). */
export const compassFacing = (heading: number): number => NORTH_FACING + heading * Math.PI / 180;
/** Heading in degrees, 0 = north, clockwise, in [0, 360). */
export const compassHeading = (facing: number): number => {
  const deg = (facing - NORTH_FACING) * 180 / Math.PI;
  return ((deg % 360) + 360) % 360;
};
/** 8-point compass label for a heading in degrees. */
export const compassDir = (heading: number): string => {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
  return dirs[Math.floor(((heading % 360) + 360) % 360 / 45 + 0.5) % 8]!;
};
/** Heading + label for a world facing angle. */
export const compassOf = (facing: number): { heading: number; dir: string } => {
  const heading = compassHeading(facing); return { heading, dir: compassDir(heading) };
};
