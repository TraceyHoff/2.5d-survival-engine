/**
 * Render-side ECS components (numeric fields only, core schema format).
 * Register them on the World (client AND server if they are ever networked; currently local-only).
 */
import { defineComponent } from "@engine/core";

/** Billboard sprite drawn at the entity's (interpolated) Transform foot point. */
export const Sprite = defineComponent("Sprite", {
  atlasId: "u16", // which registered atlas (currently only atlas 0 is drawn)
  frameId: "u16", // frame index within the atlas (see FrameId for the procedural atlas)
  flags: "u8", // SpriteFlag bits
  scale: "f32", // uniform scale, 0 is treated as 1
});

/** Point light (flickering campfire/torch etc.). Colour is linear 0..1, radius in tiles. */
export const LightSource = defineComponent("LightSource", {
  r: "f32", g: "f32", b: "f32",
  radius: "f32",
  intensity: "f32",
  flicker: "f32", // 0 = steady, ~0.3 = torch, ~0.5 = campfire
});

/** Sun-cast projected sprite shadow. Entities without it cast no shadow. */
export const Shadow = defineComponent("Shadow", {
  alpha: "f32", // opacity multiplier (0..1)
  length: "f32", // length multiplier, 1 = default
});

/**
 * Iso occluder: when this sprite covers the renderer's focus entity (the local player) and is in
 * front of it, it fades to `fade` alpha so the player stays visible behind trees/walls.
 */
export const Occluder = defineComponent("Occluder", {
  fade: "f32", // alpha while occluding (e.g. 0.35)
});

export const RENDER_COMPONENTS = [Sprite, LightSource, Shadow, Occluder] as const;

/** Sprite.flags bits. */
export const enum SpriteFlag { FlipX = 1, Emissive = 2, Sway = 4 }

/**
 * Tile ids understood by the terrain palette (TileMap stores u16 ids, 0 = empty).
 * Temporary: should move to a shared tile registry (world/gameplay).
 */
export const enum TileId { Empty = 0, Water = 1, Sand = 2, Grass = 3, Dirt = 4, Stone = 5, Snow = 6 }
