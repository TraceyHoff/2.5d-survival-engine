/**
 * Data-driven definitions. JSON tables are authored with string keys for readability and carry
 * explicit, stable numeric ids. loadDefs() validates them and resolves every cross-reference to a
 * numeric id, so components only ever store numbers (ADR-007).
 */
/** Weather kind ids (u8 in core Weather.kind). Owned by gameplay; append-only. */
export const enum WeatherKind { Clear = 0, Rain = 1, Storm = 2, Snow = 3, Fog = 4 }

export const enum ItemCategory { Resource = 0, Food = 1, Tool = 2, Placeable = 3 }
export const enum ToolKind { None = 0, Axe = 1, Pickaxe = 2 }
export const enum StationKind { None = 0, Campfire = 1, Workbench = 2 }

const CATEGORY: Record<string, ItemCategory> = { resource: ItemCategory.Resource, food: ItemCategory.Food, tool: ItemCategory.Tool, placeable: ItemCategory.Placeable };
const TOOL: Record<string, ToolKind> = { none: ToolKind.None, axe: ToolKind.Axe, pickaxe: ToolKind.Pickaxe };
const STATION: Record<string, StationKind> = { none: StationKind.None, campfire: StationKind.Campfire, workbench: StationKind.Workbench };
const WEATHER: Record<string, WeatherKind> = { clear: WeatherKind.Clear, rain: WeatherKind.Rain, storm: WeatherKind.Storm, snow: WeatherKind.Snow, fog: WeatherKind.Fog };

// ---- resolved (runtime) definitions -------------------------------------------------------------

export interface FoodDef { readonly hunger: number; readonly thirst: number; readonly health: number }
export interface ToolDef { readonly kind: ToolKind; readonly tier: number }
export interface ItemDef {
  readonly id: number; readonly key: string; readonly name: string; readonly category: ItemCategory;
  readonly maxStack: number; readonly weight: number; readonly food: FoodDef | null; readonly tool: ToolDef | null;
}
export interface ItemCount { readonly item: number; readonly count: number }
export interface RecipeDef {
  readonly id: number; readonly key: string; readonly station: StationKind; readonly seconds: number;
  readonly ingredients: readonly ItemCount[]; readonly output: ItemCount;
}
export interface YieldDef { readonly item: number; readonly min: number; readonly max: number; readonly chance: number }
export interface ResourceDef {
  readonly id: number; readonly key: string; readonly requiredTool: ToolKind; readonly minTier: number;
  readonly capacity: number; readonly respawnSeconds: number; readonly cooldownSeconds: number;
  readonly staminaCost: number; readonly bonusPerTier: number; readonly yields: readonly YieldDef[];
}
export interface WeatherDef {
  readonly kind: WeatherKind; readonly weight: number; readonly durationSeconds: readonly [number, number];
  readonly intensity: readonly [number, number]; readonly tempOffset: number; readonly wetnessPerSec: number;
  readonly thirstMul: number; readonly staminaRegenMul: number;
}
export interface VitalsTuning {
  readonly maxHealth: number; readonly maxStamina: number;
  readonly hungerDecayPerSec: number; readonly thirstDecayPerSec: number;
  readonly starvationDps: number; readonly dehydrationDps: number;
  readonly healthRegenPerSec: number; readonly wellFedThreshold: number;
  readonly lowNeedsThreshold: number; readonly lowNeedsStaminaRegenMul: number;
  readonly staminaRegenPerSec: number; readonly sprintStaminaDrainPerSec: number; readonly staminaRegenDelaySeconds: number;
  readonly bodyTempNormal: number; readonly bodyTempMin: number; readonly bodyTempMax: number;
  readonly bodyTempChangePerDegreePerSec: number; readonly bodyTempRecoverPerSec: number;
  readonly hypothermiaBelow: number; readonly hyperthermiaAbove: number; readonly exposureDps: number;
  readonly comfortMin: number; readonly comfortMax: number; readonly coldHungerMul: number; readonly heatThirstMul: number;
}
export interface EnvironmentTuning {
  readonly dayLengthSeconds: number; readonly startTimeOfDay: number; readonly baseTemp: number;
  readonly dayNightAmplitude: number; readonly nightThreatMul: number; readonly wetChill: number;
  readonly dryPerSec: number; readonly heatDryMul: number; readonly shelterTempBonus: number;
  readonly weather: readonly WeatherDef[];
}

export interface GameDefs {
  readonly items: ReadonlyMap<number, ItemDef>;
  readonly recipes: ReadonlyMap<number, RecipeDef>;
  readonly resources: ReadonlyMap<number, ResourceDef>;
  readonly vitals: VitalsTuning;
  readonly environment: EnvironmentTuning;
  itemId(key: string): number;
  recipeId(key: string): number;
  resourceId(key: string): number;
}

// ---- raw JSON shapes ----------------------------------------------------------------------------

export interface RawItem { id: number; key: string; name: string; category: string; maxStack: number; weight: number; food?: FoodDef; tool?: { kind: string; tier: number } }
export interface RawRecipe { id: number; key: string; station: string; seconds: number; ingredients: { item: string; count: number }[]; output: { item: string; count: number } }
export interface RawResource { id: number; key: string; requiredTool: string; minTier: number; capacity: number; respawnSeconds: number; cooldownSeconds: number; staminaCost: number; bonusPerTier: number; yields: { item: string; min: number; max: number; chance: number }[] }
export interface RawWeather { kind: string; weight: number; durationSeconds: number[]; intensity: number[]; tempOffset: number; wetnessPerSec: number; thirstMul: number; staminaRegenMul: number }
export interface RawDefs {
  items: { items: RawItem[] };
  recipes: { recipes: RawRecipe[] };
  resources: { resources: RawResource[] };
  vitals: VitalsTuning & { $comment?: string };
  environment: Omit<EnvironmentTuning, "weather"> & { weather: RawWeather[]; $comment?: string };
}

export class DefsError extends Error {
  constructor(readonly issues: string[]) { super(`Invalid gameplay data:\n  - ${issues.join("\n  - ")}`); }
}

const MAX_ID = 0xffff; // ids are stored in u16 fields

export function loadDefs(raw: RawDefs): GameDefs {
  const issues: string[] = [];
  const err = (m: string): void => { issues.push(m); };

  function indexTable<T extends { id: number; key: string }>(table: string, rows: readonly T[]): Map<string, number> {
    const byKey = new Map<string, number>(); const ids = new Set<number>();
    for (const r of rows) {
      if (!Number.isInteger(r.id) || r.id < 1 || r.id > MAX_ID) err(`${table} ${r.key}: id ${r.id} must be an integer in 1..${MAX_ID}`);
      if (ids.has(r.id)) err(`${table}: duplicate id ${r.id}`);
      if (byKey.has(r.key)) err(`${table}: duplicate key ${r.key}`);
      ids.add(r.id); byKey.set(r.key, r.id);
    }
    return byKey;
  }
  const itemKeys = indexTable("item", raw.items.items);
  const recipeKeys = indexTable("recipe", raw.recipes.recipes);
  const resourceKeys = indexTable("resource", raw.resources.resources);

  const enumOf = <E>(map: Record<string, E>, v: string, where: string): E => {
    const r = map[v]; if (r === undefined) { err(`${where}: unknown value "${v}" (expected ${Object.keys(map).join("|")})`); return map[Object.keys(map)[0]!]!; }
    return r;
  };
  const itemRef = (key: string, where: string): number => {
    const id = itemKeys.get(key); if (id === undefined) { err(`${where}: unknown item "${key}"`); return 0; } return id;
  };
  const positiveInt = (n: number, where: string): void => { if (!Number.isInteger(n) || n < 1) err(`${where}: must be a positive integer (got ${n})`); };

  const items = new Map<number, ItemDef>();
  for (const r of raw.items.items) {
    const where = `item ${r.key}`;
    positiveInt(r.maxStack, `${where}.maxStack`);
    if (r.maxStack > MAX_ID) err(`${where}.maxStack exceeds u16`);
    if (!(r.weight >= 0)) err(`${where}.weight must be >= 0`);
    const category = enumOf(CATEGORY, r.category, `${where}.category`);
    if (category === ItemCategory.Food && !r.food) err(`${where}: food item needs "food"`);
    if (category === ItemCategory.Tool && !r.tool) err(`${where}: tool item needs "tool"`);
    items.set(r.id, {
      id: r.id, key: r.key, name: r.name, category, maxStack: r.maxStack, weight: r.weight,
      food: r.food ? { hunger: r.food.hunger, thirst: r.food.thirst, health: r.food.health } : null,
      tool: r.tool ? { kind: enumOf(TOOL, r.tool.kind, `${where}.tool.kind`), tier: r.tool.tier } : null,
    });
  }

  const recipes = new Map<number, RecipeDef>();
  for (const r of raw.recipes.recipes) {
    const where = `recipe ${r.key}`;
    if (!(r.seconds > 0)) err(`${where}.seconds must be > 0`);
    if (r.ingredients.length === 0) err(`${where}: needs at least one ingredient`);
    const ingredients = r.ingredients.map((g, i) => { positiveInt(g.count, `${where}.ingredients[${i}].count`); return { item: itemRef(g.item, `${where}.ingredients[${i}]`), count: g.count }; });
    positiveInt(r.output.count, `${where}.output.count`);
    recipes.set(r.id, { id: r.id, key: r.key, station: enumOf(STATION, r.station, `${where}.station`), seconds: r.seconds, ingredients, output: { item: itemRef(r.output.item, `${where}.output`), count: r.output.count } });
  }

  const resources = new Map<number, ResourceDef>();
  for (const r of raw.resources.resources) {
    const where = `resource ${r.key}`;
    positiveInt(r.capacity, `${where}.capacity`);
    if (!(r.respawnSeconds > 0)) err(`${where}.respawnSeconds must be > 0`);
    if (!(r.cooldownSeconds >= 0)) err(`${where}.cooldownSeconds must be >= 0`);
    const yields = r.yields.map((y, i) => {
      const w = `${where}.yields[${i}]`;
      if (!(Number.isInteger(y.min) && Number.isInteger(y.max) && y.min >= 0 && y.max >= y.min)) err(`${w}: need integers 0 <= min <= max`);
      if (!(y.chance > 0 && y.chance <= 1)) err(`${w}.chance must be in (0,1]`);
      return { item: itemRef(y.item, w), min: y.min, max: y.max, chance: y.chance };
    });
    if (yields.length === 0) err(`${where}: needs at least one yield`);
    resources.set(r.id, { id: r.id, key: r.key, requiredTool: enumOf(TOOL, r.requiredTool, `${where}.requiredTool`), minTier: r.minTier, capacity: r.capacity, respawnSeconds: r.respawnSeconds, cooldownSeconds: r.cooldownSeconds, staminaCost: r.staminaCost, bonusPerTier: r.bonusPerTier, yields });
  }

  const env = raw.environment;
  if (!(env.dayLengthSeconds > 0)) err("environment.dayLengthSeconds must be > 0");
  const weather: WeatherDef[] = env.weather.map((w, i) => {
    const where = `environment.weather[${i}]`;
    const pair = (a: number[], name: string): [number, number] => {
      if (a.length !== 2 || !(a[0]! <= a[1]!)) err(`${where}.${name} must be [min, max]`);
      return [a[0] ?? 0, a[1] ?? 0];
    };
    return { kind: enumOf(WEATHER, w.kind, `${where}.kind`), weight: w.weight, durationSeconds: pair(w.durationSeconds, "durationSeconds"), intensity: pair(w.intensity, "intensity"), tempOffset: w.tempOffset, wetnessPerSec: w.wetnessPerSec, thirstMul: w.thirstMul, staminaRegenMul: w.staminaRegenMul };
  });
  if (!weather.some((w) => w.weight > 0)) err("environment.weather: at least one entry needs weight > 0");

  if (issues.length) throw new DefsError(issues);

  const lookup = (m: Map<string, number>, table: string) => (key: string): number => {
    const id = m.get(key); if (id === undefined) throw new Error(`unknown ${table} key "${key}"`); return id;
  };
  const { $comment: _v, ...vitals } = raw.vitals;
  const { $comment: _e, weather: _w, ...envRest } = env;
  return {
    items, recipes, resources, vitals, environment: { ...envRest, weather },
    itemId: lookup(itemKeys, "item"), recipeId: lookup(recipeKeys, "recipe"), resourceId: lookup(resourceKeys, "resource"),
  };
}

/** Seconds -> whole ticks (at least 1) for the fixed dt the system was called with. */
export const secondsToTicks = (seconds: number, dt: number): number => Math.max(1, Math.ceil(seconds / dt - 1e-9));
