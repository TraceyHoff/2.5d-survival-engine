/** Default data tables shipped with the package (JSON in ../data) and the committed id lock. */
import items from "../data/items.json";
import recipes from "../data/recipes.json";
import resources from "../data/resources.json";
import vitals from "../data/vitals.json";
import environment from "../data/environment.json";
import pieces from "../data/pieces.json";
import tiers from "../data/tiers.json";
import zombies from "../data/zombies.json";
import worldgen from "../data/worldgen.json";
import movement from "../data/movement.json";
import vehicleItems from "../data/vehicle_items.json";
import vehicleRecipes from "../data/vehicle_recipes.json";
import idsLock from "../data/ids.lock.json";
import { loadDefs, type GameDefs, type IdLock, type RawDefs } from "./defs.js";

/** Vehicle parts/fuels/kits live in their own tables (data/vehicle_*.json, DESIGN.md §31) and are appended here. */
const allItems = { ...items, items: [...items.items, ...vehicleItems.items] };
const allRecipes = { ...recipes, recipes: [...recipes.recipes, ...vehicleRecipes.recipes] };
export const DEFAULT_RAW_DEFS: RawDefs = { items: allItems, recipes: allRecipes, resources, vitals, environment, pieces, tiers, zombies, worldgen, movement } as unknown as RawDefs;
export const DEFAULT_ID_LOCK: IdLock = idsLock as IdLock;
let cached: GameDefs | undefined;
export function defaultDefs(): GameDefs { return (cached ??= loadDefs(DEFAULT_RAW_DEFS, { lock: DEFAULT_ID_LOCK })); }
