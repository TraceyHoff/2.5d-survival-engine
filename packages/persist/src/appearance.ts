import { Appearance, defaultAppearance, getAppearance, setAppearance, validateAppearance, type CosmeticCatalogLike, type Entity, type World } from "@engine/core";

/** "skipped": the world does not register Appearance (registering here would change the schema hash). */
export type AppearanceRepair = "defaulted" | "repaired" | "ok" | "skipped";
/**
 * Load-time Appearance policy (docs/CHARACTER_CUSTOMIZATION.md): a player without Appearance (old save) gets
 * `defaultAppearance(cat)`; a loaded one is run through `validateAppearance` in clamp mode and rewritten only when it
 * had issues (retired parts, bad palette index). All writes go through core's `setAppearance` (bumps version).
 */
export function ensureAppearance(world: World, e: Entity, cat: CosmeticCatalogLike): AppearanceRepair {
  if (!world.isRegistered(Appearance)) return "skipped";
  const cur = getAppearance(world, e);
  if (!cur) { setAppearance(world, e, validateAppearance(cat, defaultAppearance(cat)).value!); return "defaulted"; }
  const v = validateAppearance(cat, cur, { mode: "clamp" });
  if (!v.issues.length) return "ok";
  setAppearance(world, e, v.value!); return "repaired";
}
