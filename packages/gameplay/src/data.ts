/** Default data tables shipped with the package (JSON in ../data). */
import items from "../data/items.json";
import recipes from "../data/recipes.json";
import resources from "../data/resources.json";
import vitals from "../data/vitals.json";
import environment from "../data/environment.json";
import { loadDefs, type GameDefs, type RawDefs } from "./defs.js";

export const DEFAULT_RAW_DEFS: RawDefs = { items, recipes, resources, vitals, environment } as RawDefs;
let cached: GameDefs | undefined;
export function defaultDefs(): GameDefs { return (cached ??= loadDefs(DEFAULT_RAW_DEFS)); }
