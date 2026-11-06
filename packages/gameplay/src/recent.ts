/**
 * Task 33: "Recently Crafted" lists — the most-recently crafted recipes and placed pieces per player
 * (most recent first, capped at RECENT_MAX). Stored on the player entity in the RecentCrafts /
 * RecentBuilds components (networked + persistent: the player codec encodes every component on the
 * player entity, so the lists survive save/reconnect; old saves simply lack the component = empty).
 * Recorded at completion, not at queue time (a queued craft is not crafted yet) and at placement, not
 * at selection (a chosen piece is not built yet). Duplicates move to the front instead of repeating.
 */
import { entityIndex, type ComponentDef, type Entity, type World } from "@engine/core";
import { RECENT_MAX, RecentBuilds, RecentCrafts } from "./components.js";

function pushRecent(world: World, e: Entity, id: number, comp: ComponentDef, field: "recipe" | "piece"): void {
  if (!world.isRegistered(comp) || id <= 0) return;
  if (!world.has(e, comp)) world.add(e, comp, {});
  const st = world.store(comp); const s = st.slot(entityIndex(e)); if (s < 0) return;
  const data = st.data as unknown as Record<string, number[]>;
  const ids = data[field]!; const n = data.count![s]!;
  const list = [id];
  for (let i = 0; i < n && list.length < RECENT_MAX; i++) { const v = ids[s * RECENT_MAX + i]!; if (v !== 0 && v !== id) list.push(v); }
  for (let i = 0; i < RECENT_MAX; i++) ids[s * RECENT_MAX + i] = list[i] ?? 0;
  data.count![s] = list.length;
  st.markChanged(entityIndex(e));
}

/** Record a finished craft (called from both craft completion paths). */
export function recordRecentCraft(world: World, e: Entity, recipe: number): void { pushRecent(world, e, recipe, RecentCrafts, "recipe"); }
/** Record a placed piece (called from placePiece for real builders; builder 0 = load/worldgen). */
export function recordRecentBuild(world: World, e: Entity, piece: number): void { pushRecent(world, e, piece, RecentBuilds, "piece"); }

/** Most-recently crafted recipe ids (most recent first), or [] when none. */
export function recentCrafts(world: World, e: Entity): number[] {
  const c = world.get(e, RecentCrafts); if (!c) return [];
  return [...c.recipe].slice(0, Math.min(c.count, RECENT_MAX)).filter((v) => v !== 0);
}
/** Most-recently placed piece ids (most recent first), or [] when none. */
export function recentBuilds(world: World, e: Entity): number[] {
  const c = world.get(e, RecentBuilds); if (!c) return [];
  return [...c.piece].slice(0, Math.min(c.count, RECENT_MAX)).filter((v) => v !== 0);
}
