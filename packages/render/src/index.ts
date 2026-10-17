/**
 * @engine/render — 2.5D isometric WebGL2 renderer (owned by the Renderer team).
 * Contract: render(world, alpha) is read-only on the World; it interpolates PrevTransform->Transform.
 */
export * from "./types.js";
export * from "./components.js";
export * from "./IsoRenderer.js";
export * from "./camera.js";
export * from "./atlas.js";
export * from "./tilemap.js";
export * from "./sprites.js";
export * from "./lighting.js";
export * from "./weather.js";
export * from "./composite.js";
export * from "./timeOfDay.js";
export * from "./depth.js";
export { newStats, type FrameStats } from "./gl/util.js";
