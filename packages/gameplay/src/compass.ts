/**
 * Compass: world facing -> compass heading.
 * World axes: +x is east-ish, +y is south-ish (packages/world iso.ts), so north is -y and east is +x.
 * A world facing angle (atan2(dy, dx), as stored on Transform) converts to a clockwise-from-north heading:
 * heading = atan2(dx, -dy). East (1, 0) -> 90°, south (0, 1) -> 180°, north (0, -1) -> 0°.
 * Pure, shared by the HUD compass strip and the world-map compass rose.
 */
/** Heading in degrees, 0 = north, clockwise, in [0, 360). */
export const compassHeading = (facing: number): number => {
  const deg = (Math.atan2(Math.cos(facing), -Math.sin(facing)) * 180) / Math.PI;
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
