/**
 * Data-driven definitions. JSON tables use string keys; numeric ids come from core StableIdRegistry +
 * data/ids.lock.json (append-only, so old ids never move). loadDefs() validates everything, resolves every
 * cross-reference to numeric ids and returns the updated lock. Build pieces go through @engine/world
 * loadBuildPieces (engine fields) plus gameplay extras.
 *
 * Visuals are owned by Art & Assets: defs only carry a manifest key (`sprite`, default = key) and an
 * optional resolved numeric visualId (from an @engine/assets registry via opts.resolveSprite).
 */
import { fnv1a, StableIdRegistry } from "@engine/core";
import { loadBuildPieces, type BuildPieceDef, type BuildPieceRegistry, type RawBuildPiece } from "@engine/world";

/** Weather kind ids (u8 in core Weather.kind). Owned by gameplay; append-only. */
export const enum WeatherKind { Clear = 0, Rain = 1, Storm = 2, Snow = 3, Fog = 4 }

export const enum ItemCategory { Resource = 0, Food = 1, Tool = 2, Placeable = 3, Weapon = 4, Clothing = 5, Armor = 6, Ammo = 7, Explosive = 8 }
/** Worn slots (Worn component index). Append only. */
export const enum WearSlot { Head = 0, Torso = 1, Legs = 2, Feet = 3, Hands = 4, Back = 5 }
export const WEAR_SLOTS = 6;
export const enum ToolKind { None = 0, Axe = 1, Pickaxe = 2, Shovel = 3, Knife = 4 }
export const enum StationKind { None = 0, Campfire = 1, Workbench = 2, Furnace = 3, Anvil = 4, Garage = 5 }
export const enum Placement { Cell = 0, Edge = 1, Opening = 2, Free = 3, Tri = 4 }
/** BuildingGrid socket kinds. */
export const enum SocketKind { Edge = 1, Door = 2, Window = 3, Hatch = 4 }

const CATEGORY: Record<string, ItemCategory> = { resource: ItemCategory.Resource, food: ItemCategory.Food, tool: ItemCategory.Tool, placeable: ItemCategory.Placeable, weapon: ItemCategory.Weapon, clothing: ItemCategory.Clothing, armor: ItemCategory.Armor, ammo: ItemCategory.Ammo, explosive: ItemCategory.Explosive };
const WEAR: Record<string, WearSlot> = { head: WearSlot.Head, torso: WearSlot.Torso, legs: WearSlot.Legs, feet: WearSlot.Feet, hands: WearSlot.Hands, back: WearSlot.Back };
const TOOL: Record<string, ToolKind> = { none: ToolKind.None, axe: ToolKind.Axe, pickaxe: ToolKind.Pickaxe, shovel: ToolKind.Shovel, knife: ToolKind.Knife };
const STATION: Record<string, StationKind> = { none: StationKind.None, campfire: StationKind.Campfire, workbench: StationKind.Workbench, furnace: StationKind.Furnace, anvil: StationKind.Anvil, garage: StationKind.Garage };
const WEATHER: Record<string, WeatherKind> = { clear: WeatherKind.Clear, rain: WeatherKind.Rain, storm: WeatherKind.Storm, snow: WeatherKind.Snow, fog: WeatherKind.Fog };
const PLACEMENT: Record<string, Placement> = { cell: Placement.Cell, edge: Placement.Edge, opening: Placement.Opening, free: Placement.Free, tri: Placement.Tri };
const OPENING: Record<string, SocketKind> = { door: SocketKind.Door, window: SocketKind.Window, hatch: SocketKind.Hatch };

// ---- resolved definitions -------------------------------------------------------------------------

export interface FoodDef { readonly hunger: number; readonly thirst: number; readonly health: number }
export interface ToolDef { readonly kind: ToolKind; readonly tier: number }
export interface WeaponDef { readonly damage: number; readonly range: number; readonly cooldownSeconds: number; readonly staminaCost: number; readonly structureMul: number }
/** Wearable (clothing / armor): insulation in deg C added to felt temperature, waterproof 0..1 (fraction of rain
 * wetting blocked; worn slots average), armor points (combat/explosion damage x 100/(100+armor)), carryBonus kg. */
export interface WearDef { readonly slot: WearSlot; readonly insulation: number; readonly waterproof: number; readonly armor: number; readonly carryBonus: number }
/** Ranged mode: shots need loaded ammo (Reload), chargeSeconds > 0 = draw weapon (Charge hold scales damage minChargeMul..1). */
export interface RangedDef { readonly ammo: readonly number[]; readonly damage: number; readonly range: number; readonly magazine: number; readonly reloadSeconds: number; readonly cooldownSeconds: number; readonly staminaCost: number; readonly chargeSeconds: number; readonly minChargeMul: number; readonly structureMul: number }
/** Throwable weapon (spears, axes): Attack beyond melee reach throws it; it lands in a loot bag at the target. */
export interface ThrownDef { readonly damage: number; readonly range: number }
export interface AmmoDef { readonly damageMul: number; readonly structureMul: number; readonly armorPierce: number; readonly ignite: boolean }
/** Thrown charge: detonates fuseSeconds after the throw; linear falloff to 25% at radius. */
export interface ExplosiveDef { readonly damage: number; readonly radius: number; readonly structureDamage: number; readonly fuseSeconds: number; readonly throwRange: number; readonly ignite: boolean }
export interface Visual { readonly spriteKey: string; readonly visualId: number }
export interface ItemDef extends Visual {
  readonly id: number; readonly key: string; readonly name: string; readonly category: ItemCategory;
  readonly maxStack: number; readonly weight: number; readonly food: FoodDef | null; readonly tool: ToolDef | null;
  readonly weapon: WeaponDef | null; readonly fuelSeconds: number;
  /** 0 = never spoils. Freshness = core decayAt(createdTick, 1/spoilTicks x spoilMul, tick). */
  readonly spoilSeconds: number;
  /** Durability for tools/weapons (data `durability`, default 200; 0 = n/a). */
  readonly maxDurability: number;
  /** May be traded (default true). */
  readonly tradeable: boolean;
  /** Liquid container (water_flask): sips when full; current fill lives in the slot's durability (0..sips). 0 = n/a. */
  readonly sips: number;
  /** Progression tier (1 primitive, 2 bronze, 3 iron, 4 steel, 5 advanced; 0 = untiered) and balance family. */
  readonly tier: number; readonly family: string;
  readonly wear: WearDef | null; readonly ranged: RangedDef | null; readonly thrown: ThrownDef | null; readonly ammo: AmmoDef | null; readonly explosive: ExplosiveDef | null;
}
export interface SpoilStage { readonly key: string; readonly minFresh: number; readonly nutritionMul: number; readonly sick: boolean }
export interface ItemCount { readonly item: number; readonly count: number }
export interface RecipeDef { readonly id: number; readonly key: string; readonly station: StationKind; readonly seconds: number; readonly ingredients: readonly ItemCount[]; readonly output: ItemCount; readonly skill: { readonly key: string; readonly level: number } | null }
export interface YieldDef { readonly item: number; readonly min: number; readonly max: number; readonly chance: number }
export interface ResourceDef extends Visual {
  readonly id: number; readonly key: string; readonly requiredTool: ToolKind; readonly minTier: number; readonly capacity: number;
  readonly respawnSeconds: number; readonly cooldownSeconds: number; readonly staminaCost: number; readonly bonusPerTier: number; readonly yields: readonly YieldDef[]; /** ADR-110: removed when depleted (harvested crops) */ readonly oneShot: boolean;
}
export interface WeatherDef {
  readonly kind: WeatherKind; readonly weight: number; readonly durationSeconds: readonly [number, number]; readonly intensity: readonly [number, number];
  readonly tempOffset: number; readonly wetnessPerSec: number; readonly thirstMul: number; readonly staminaRegenMul: number;
  /** Wind speed range (tiles/s) rolled with the weather; direction is uniform. */
  readonly windSpeed: readonly [number, number];
}
export interface VitalsTuning {
  readonly maxHealth: number; readonly maxStamina: number; readonly hungerDecayPerSec: number; readonly thirstDecayPerSec: number;
  readonly starvationDps: number; readonly dehydrationDps: number; readonly healthRegenPerSec: number; readonly wellFedThreshold: number;
  readonly lowNeedsThreshold: number; readonly lowNeedsStaminaRegenMul: number; readonly staminaRegenPerSec: number;
  readonly sprintStaminaDrainPerSec: number; readonly staminaRegenDelaySeconds: number; readonly bodyTempNormal: number;
  readonly bodyTempMin: number; readonly bodyTempMax: number; readonly bodyTempChangePerDegreePerSec: number; readonly bodyTempRecoverPerSec: number;
  readonly hypothermiaBelow: number; readonly hyperthermiaAbove: number; readonly exposureDps: number; readonly comfortMin: number;
  readonly comfortMax: number; readonly coldHungerMul: number; readonly heatThirstMul: number;
}
export interface EnvironmentTuning {
  readonly dayLengthSeconds: number; readonly startTimeOfDay: number; readonly baseTemp: number; readonly dayNightAmplitude: number;
  readonly nightThreatMul: number; readonly wetChill: number; readonly dryPerSec: number; readonly heatDryMul: number;
  readonly shelterTempBonus: number; readonly weather: readonly WeatherDef[];
  readonly altitudeLapse: number; readonly humidityPerIntensity: number; readonly windChillPerSpeed: number;
  readonly surface: { readonly rainPerSec: number; readonly dryPerSec: number; readonly windDryMul: number; readonly sunDryMul: number };
  readonly wetBuffThreshold: number; readonly coldBuffBelow: number;
  readonly spoilage: { readonly tempRefC: number; readonly mulPerDegree: number; readonly minMul: number; readonly maxMul: number; readonly rebaseThreshold: number; readonly sickSeconds: number; readonly spoiledItem: string; readonly staleFreshness: number;
    /** Four freshness stages, descending minFresh (fresh, stale, spoiling, rotten). */
    readonly stages?: readonly SpoilStage[] };
}
export interface TierDef { readonly id: number; readonly key: string; readonly hpMul: number; readonly vertLoss: number; readonly horizLoss: number; readonly repairMul: number; readonly cost: readonly ItemCount[];
  /** Raid damage multipliers for player-caused damage to pieces of this tier (ADR-104); 1 when omitted. */
  readonly raid: RaidMuls }
export interface RaidMuls { readonly melee: number; readonly explosive: number; readonly fire: number }
export interface BuildingTuning {
  readonly buildReach: number; readonly playerMaxSpeed: number; readonly levelHeight: number; readonly maxLevel: number;
  readonly minStability: number; readonly groundStability: number; readonly maxPiecesPerZone: number; readonly repairBlockedSeconds: number;
  readonly demolishRefund: number; readonly damageStages: readonly number[]; readonly freeSnapSubtiles: number; readonly freeRotSteps: number;
  readonly maxSlope: number; readonly maxContainerViewers: number; readonly containerReach: number;
}
/** Engine BuildPieceDef + gameplay rules. */
export interface PieceDef extends BuildPieceDef, Visual {
  readonly placement: Placement; readonly tiered: boolean; readonly costScale: number; readonly fixedTier: number;
  readonly groundOnly: boolean; readonly ground: boolean; readonly minLevel: number; readonly needsDeck: boolean;
  readonly supportsAbove: boolean; readonly roof: boolean; readonly blocksPath: boolean; readonly opening: SocketKind | 0;
  readonly fits: SocketKind | 0; readonly door: boolean; readonly station: StationKind; readonly fired: boolean;
  readonly heat: number; readonly heatRadius: number; readonly light: boolean; readonly container: number;
  readonly privilegeRadius: number; readonly paintable: boolean; readonly variants: number; readonly spoilMul: number;
  /** Art skin name per variant index (`<piece>@<name>` sprite lookup); empty = unnamed. */
  readonly variantNames: readonly string[];
  /** ADR-112 build-menu category (structure|crafting|defense|furniture|lighting|decor|plants|wall|rugs|outdoor). */
  readonly category: string;
  /** Fuel efficiency: each fuel item burns fuelSeconds x fuelMul here (1 = campfire). */
  readonly fuelMul: number;
  /** Trade stall: listing slots (= stock Container slots) and whether only a clan may own it. null = not a stall. */
  readonly stall: { readonly listings: number; readonly clanOnly: boolean } | null;
  /** Feature data (windsock, contact damage, alarm, gate breach, clan lock, sight bonus); {} when none. */
  readonly features: PieceFeatures;
  /** Modular set (ADR-104). rotSteps: rotation steps (0 = placement default: 4, free freeRotSteps, tri 12). */
  readonly rotSteps: number;
  /** Snap hint for free pieces: "" (sub-tile grid) or "vertex" (tile corners, corner pieces). */
  readonly snap: "" | "vertex";
  /** Ground slope tolerance override (raised/stilted foundations); -1 = building.maxSlope. */
  readonly maxSlope: number;
  /** Lowest material tier allowed (new modular pieces: 1 = wood, no twig). */
  readonly minTier: number;
  /** Extra per-piece ingredients on top of the tier cost (only from fromTier up), e.g. glass for windows. */
  readonly extraCost: readonly (ItemCount & { readonly fromTier: number })[];
  /** Modular family for art/menus ("foundation" | "wall" | "floor" | "corner" | "roof" | ""). */
  readonly family: string;
}
export interface PieceFeatures {
  readonly windsock?: boolean; readonly clanTint?: boolean; readonly clanLock?: boolean; readonly breachAt?: number; readonly sightBonus?: number;
  /** Mirror / wardrobe: players in range may re-edit their look (data/cosmetics.json wardrobeRange). */
  readonly wardrobe?: boolean;
  /** ADR-112 wall mount: Edge piece hung on one face (rot & 2) of an existing wall; supported by (and destroyed with) it. */
  readonly mount?: boolean;
  /** ADR-112 planter: placing spawns tilled soil (Crop kind 0) on the piece; crops planted there ignore the terrain tile rule. */
  readonly planter?: boolean;
  readonly contact?: { readonly dps: number; readonly radius: number; readonly slowMul: number; readonly slowSeconds: number };
  readonly alarm?: { readonly radius: number; readonly cooldownSeconds: number };
  /** ADR-108 auto turret: shoots the nearest hostile in range every cooldownSeconds, using one `ammo` item (any listed key)
   *  from its Container per shot. igniteChance > 0 = flame turret (ignites the target). */
  readonly turret?: { readonly range: number; readonly damage: number; readonly cooldownSeconds: number; readonly ammo: readonly string[]; readonly igniteChance?: number };
  /** ADR-108 one-shot trap (bear trap): springs on the first hostile within radius, damage + root (MoveSpeed x0) for rootSeconds, re-arms after rearmSeconds. */
  readonly trap?: { readonly radius: number; readonly damage: number; readonly rootSeconds: number; readonly rearmSeconds: number };
}
/** ADR-108 light behaviour of a zombie kind (zombies.json `light`). Absent = avoids lit areas at night. */
export interface ZombieLightDef { readonly ignoresLight: boolean; readonly targetsLights: boolean; readonly seekRange: number; readonly snuffDamage: number; readonly extinguishChance: number }
/** ADR-108 night light avoidance tuning (zombies.json `lightAvoid`). */
export interface LightAvoidTuning { readonly phases: readonly ("night" | "dawn" | "day" | "dusk")[]; readonly gridCell: number; readonly rebuildTicks: number; readonly edgeMargin: number; readonly paceSeconds: number; readonly headlightRadius: number; readonly minRadius: number }
export interface ZombieDef extends Visual {
  readonly id: number; readonly key: string; readonly hp: number; readonly speed: number; readonly damage: number; readonly structureDamage: number;
  readonly attackRange: number; readonly attackCooldownSeconds: number; readonly sightRange: number; readonly hearingMul: number; readonly variants: number;
  /** ADR-108: render tint (rgb 0..1) for visually distinct kinds; light behaviour (absent = light-shy). */
  readonly tint?: readonly [number, number, number]; readonly light?: ZombieLightDef;
}
export const DEFAULT_LIGHT_AVOID: LightAvoidTuning = { phases: ["night", "dusk"], gridCell: 8, rebuildTicks: 10, edgeMargin: 0.75, paceSeconds: 3, headlightRadius: 9, minRadius: 2 };
export type PhaseTable<T> = { readonly night: T; readonly dawn: T; readonly day: T; readonly dusk: T };
export interface SpawnTuning {
  readonly checkSeconds: number; readonly ratePerMinute: PhaseTable<number>; readonly cap: PhaseTable<number>; readonly capRadius: number;
  readonly minDistance: number; readonly maxDistance: number; readonly noiseRateMul: number; readonly weights: PhaseTable<readonly number[]>;
}
export interface AiTuning {
  readonly thinkTicks: number; readonly repathTicks: number; readonly maxSearchRadius: number; readonly maxExpandedNodes: number;
  readonly breakCostMul: number; readonly wanderRadius: number; readonly loseTargetMul: number; readonly investigateSeconds: number;
  readonly dayDps: number; readonly despawnDistance: number; readonly corpseSeconds: number;
}
export interface NoiseTuning { readonly gather: number; readonly build: number; readonly attack: number; readonly structureHit: number; readonly door: number; readonly decayPerSec: number }
export interface WorldgenBand { readonly max: number; readonly tile: number; readonly nodes: readonly number[]; readonly nodeChance: number; readonly temp: number; readonly humidity: number }
export interface WorldgenDef { readonly bands: readonly WorldgenBand[]; readonly unbuildableTiles: ReadonlySet<number>; readonly unwalkableTiles: ReadonlySet<number> }

export interface MovementTuning { readonly walkSpeed: number; readonly sprintMul: number; readonly encumberedFrom: number; readonly encumberedMinMul: number; readonly wetSlowMul: number; readonly bodyRadius: number;
  /** ADR-107 swimming: terrain ids players may swim in, and the speed multiplier there. */ readonly swimTiles: ReadonlySet<number>; readonly swimSpeedMul: number }

export interface IdLock { items: Record<string, number>; resources: Record<string, number>; recipes: Record<string, number>; pieces: Record<string, number>; zombies: Record<string, number> }

export interface GameDefs {
  readonly items: ReadonlyMap<number, ItemDef>;
  readonly recipes: ReadonlyMap<number, RecipeDef>;
  readonly resources: ReadonlyMap<number, ResourceDef>;
  /** Unarmed gathering of low-tier tool nodes (resources.json bareHands, ADR-107). */
  readonly bareHands: BareHandsDef;
  readonly pieces: ReadonlyMap<number, PieceDef>;
  readonly pieceRegistry: BuildPieceRegistry;
  readonly tiers: readonly TierDef[];
  readonly building: BuildingTuning;
  readonly zombies: ReadonlyMap<number, ZombieDef>;
  /** Zombie ids in data order (spawning.weights index). */
  readonly zombieKinds: readonly number[];
  /** Item id that spoiled food turns into (0 = none). */
  readonly spoiledItem: number;
  readonly spawning: SpawnTuning;
  readonly ai: AiTuning;
  readonly noise: NoiseTuning;
  /** ADR-108 night light avoidance. */ readonly lightAvoid: LightAvoidTuning;
  readonly vitals: VitalsTuning;
  readonly environment: EnvironmentTuning;
  readonly movement: MovementTuning;
  readonly worldgen: WorldgenDef;
  /** Updated id lock (persist to data/ids.lock.json when it changes). */
  readonly lock: IdLock;
  /** Hashes of (key,id) tables, embedded in saves and mixed into the world schema hash. */
  readonly hashes: { readonly items: number; readonly pieces: number; readonly all: number };
  itemId(key: string): number; recipeId(key: string): number; resourceId(key: string): number; pieceId(key: string): number; zombieId(key: string): number;
  piece(key: string): PieceDef;
}

/** resources.json `bareHands`: which tool nodes fists can work, and how poorly (ADR-107). */
export interface BareHandsDef { readonly maxMinTier: number; readonly tools: ReadonlySet<ToolKind>; readonly yieldMul: number; readonly minYield: number; readonly cooldownMul: number }

// ---- raw JSON shapes ----------------------------------------------------------------------------

interface RawVisual { sprite?: string }
export interface RawItem extends RawVisual { key: string; name: string; category: string; maxStack: number; weight: number; food?: FoodDef; tool?: { kind: string; tier: number }; weapon?: WeaponDef; fuelSeconds?: number; spoilSeconds?: number; durability?: number; tradeable?: boolean; sips?: number;
  tier?: number; family?: string; wear?: { slot: string; insulation?: number; waterproof?: number; armor?: number; carryBonus?: number };
  ranged?: Omit<RangedDef, "ammo" | "chargeSeconds" | "minChargeMul" | "staminaCost" | "structureMul"> & { ammo: string[]; chargeSeconds?: number; minChargeMul?: number; staminaCost?: number; structureMul?: number };
  thrown?: ThrownDef; ammo?: { damageMul: number; structureMul?: number; armorPierce?: number; ignite?: boolean }; explosive?: Omit<ExplosiveDef, "ignite"> & { ignite?: boolean } }
export interface RawRecipe { key: string; station: string; seconds: number; ingredients: { item: string; count: number }[]; output: { item: string; count: number }; skill?: { key: string; level: number } }
export interface RawResource extends RawVisual { key: string; requiredTool: string; minTier: number; capacity: number; respawnSeconds: number; cooldownSeconds: number; staminaCost: number; bonusPerTier: number; yields: { item: string; min: number; max: number; chance: number }[]; oneShot?: boolean }
export interface RawWeather { kind: string; weight: number; durationSeconds: number[]; intensity: number[]; tempOffset: number; wetnessPerSec: number; thirstMul: number; staminaRegenMul: number; windSpeed?: number[] }
export interface RawPiece extends RawVisual {
  key: string; placement: string; layer?: number; footprint?: { w: number; h: number }; levels?: number; solid?: boolean; hp: number;
  sockets?: { x: number; y: number; z?: number; kind: number }[]; cost?: { resource: string; amount: number }[];
  tiered?: boolean; costScale?: number; tier?: number; groundOnly?: boolean; ground?: boolean; minLevel?: number; needsDeck?: boolean;
  supportsAbove?: boolean; roof?: boolean; blocksPath?: boolean; opening?: string; fits?: string; door?: boolean; station?: string;
  fired?: boolean; heat?: number; heatRadius?: number; light?: boolean; container?: number; privilegeRadius?: number; paintable?: boolean; variants?: number; variantNames?: string[]; spoilMul?: number; fuelMul?: number;
  stall?: { listings: number; clanOnly?: boolean };
  features?: PieceFeatures;
  rotSteps?: number; category?: string; snap?: "vertex"; maxSlope?: number; minTier?: number; extraCost?: { item: string; count: number; fromTier?: number }[]; family?: string;
}
export interface RawZombie extends RawVisual { key: string; hp: number; speed: number; damage: number; structureDamage: number; attackRange: number; attackCooldownSeconds: number; sightRange: number; hearingMul: number; variants: number; tint?: [number, number, number]; light?: ZombieLightDef }
export interface RawDefs {
  items: { items: RawItem[] };
  recipes: { recipes: RawRecipe[] };
  resources: { resources: RawResource[]; bareHands?: { maxMinTier: number; tools: string[]; yieldMul: number; minYield: number; cooldownMul: number } };
  vitals: VitalsTuning & { $comment?: string };
  environment: Omit<EnvironmentTuning, "weather"> & { weather: RawWeather[]; $comment?: string };
  pieces: { pieces: RawPiece[] };
  tiers: { tiers: (Omit<TierDef, "id" | "cost" | "raid"> & { cost: { item: string; count: number }[]; raid?: Partial<RaidMuls> })[]; building: BuildingTuning };
  zombies: { zombies: RawZombie[]; spawning: SpawnTuning; ai: AiTuning; noise: NoiseTuning; lightAvoid?: LightAvoidTuning };
  movement: Omit<MovementTuning, "swimTiles" | "swimSpeedMul"> & { $comment?: string; swimTiles?: number[]; swimSpeedMul?: number };
  worldgen: { bands: { max: number; tile: number; nodes: string[]; nodeChance: number; temp?: number; humidity?: number }[]; unbuildableTiles: number[]; unwalkableTiles: number[] };
}

export class DefsError extends Error {
  constructor(readonly issues: string[]) { super(`Invalid gameplay data:\n  - ${issues.join("\n  - ")}`); }
}

export interface LoadDefsOptions {
  lock?: Partial<IdLock>;
  /** Maps a manifest key to a numeric sprite id (e.g. AssetRegistry.ids.tryId). Unresolved -> visualId 0. */
  resolveSprite?: (key: string) => number | undefined;
}

const KEY = /^[a-z0-9_]+$/;

export function loadDefs(raw: RawDefs, opts: LoadDefsOptions = {}): GameDefs {
  const issues: string[] = [];
  const err = (m: string): void => { issues.push(m); };
  const lockIn = opts.lock ?? {};

  function registry(name: keyof IdLock, keys: string[], maxId = 0xffff): { reg: StableIdRegistry; lock: Record<string, number> } {
    const seen = new Set<string>();
    for (const k of keys) { if (!KEY.test(k)) err(`${name}: bad key "${k}"`); if (seen.has(k)) err(`${name}: duplicate key ${k}`); seen.add(k); }
    const reg = new StableIdRegistry(name, maxId);
    try { return { reg, lock: reg.assign(keys, lockIn[name] ?? {}) }; } catch (e) { err(String((e as Error).message)); return { reg, lock: {} }; }
  }
  const itemsR = registry("items", raw.items.items.map((i) => i.key));
  const resR = registry("resources", raw.resources.resources.map((r) => r.key));
  const recR = registry("recipes", raw.recipes.recipes.map((r) => r.key));
  const zomR = registry("zombies", raw.zombies.zombies.map((z) => z.key), 0xff);

  const visual = (key: string, sprite?: string): Visual => { const s = sprite ?? key; return { spriteKey: s, visualId: opts.resolveSprite?.(s) ?? 0 }; };
  const enumOf = <E>(map: Record<string, E>, v: string, where: string): E => {
    const r = map[v]; if (r === undefined) { err(`${where}: unknown value "${v}" (expected ${Object.keys(map).join("|")})`); return map[Object.keys(map)[0]!]!; }
    return r;
  };
  const itemRef = (key: string, where: string): number => { const id = itemsR.reg.tryId(key); if (id === undefined) { err(`${where}: unknown item "${key}"`); return 0; } return id; };
  const posInt = (n: number, where: string): void => { if (!Number.isInteger(n) || n < 1) err(`${where}: must be a positive integer (got ${n})`); };

  const items = new Map<number, ItemDef>();
  for (const r of raw.items.items) {
    const where = `item ${r.key}`;
    posInt(r.maxStack, `${where}.maxStack`); if (r.maxStack > 0xffff) err(`${where}.maxStack exceeds u16`);
    if (!(r.weight >= 0)) err(`${where}.weight must be >= 0`);
    const category = enumOf(CATEGORY, r.category, `${where}.category`);
    if (category === ItemCategory.Food && !r.food) err(`${where}: food item needs "food"`);
    if (category === ItemCategory.Tool && !r.tool) err(`${where}: tool item needs "tool"`);
    if (category === ItemCategory.Weapon && !r.weapon) err(`${where}: weapon item needs "weapon"`);
    if (r.sips && (r.maxStack !== 1 || r.durability !== r.sips)) err(`${where}: liquid containers need maxStack 1 and durability = sips`);
    if ((r.tool || r.weapon) && r.maxStack !== 1) err(`${where}: tools/weapons are non-stackable (maxStack 1)`);
    const isWear = category === ItemCategory.Clothing || category === ItemCategory.Armor;
    if (isWear !== !!r.wear) err(`${where}: clothing/armor items (only) need "wear"`);
    if ((category === ItemCategory.Ammo) !== !!r.ammo) err(`${where}: ammo items (only) need "ammo"`);
    if ((category === ItemCategory.Explosive) !== !!r.explosive) err(`${where}: explosive items (only) need "explosive"`);
    if ((r.ranged || r.thrown) && !r.weapon) err(`${where}: ranged/thrown weapons also need melee "weapon" stats`);
    if (isWear && r.maxStack !== 1) err(`${where}: wearables are non-stackable`);
    if (r.tier !== undefined && !(Number.isInteger(r.tier) && r.tier >= 0 && r.tier <= 5)) err(`${where}.tier must be 0..5`);
    if (r.wear && !((r.wear.waterproof ?? 0) >= 0 && (r.wear.waterproof ?? 0) <= 1)) err(`${where}.wear.waterproof must be 0..1`);
    if (r.ranged) { posInt(r.ranged.magazine, `${where}.ranged.magazine`); if (r.ranged.magazine > 255) err(`${where}.ranged.magazine > 255`); if (!r.ranged.ammo.length) err(`${where}.ranged.ammo empty`); }
    if (r.explosive && !(r.explosive.radius > 0 && r.explosive.fuseSeconds >= 0)) err(`${where}.explosive: radius > 0, fuseSeconds >= 0`);
    const id = itemsR.reg.tryId(r.key) ?? 0;
    const rg = r.ranged;
    items.set(id, {
      id, key: r.key, name: r.name, category, maxStack: r.maxStack, weight: r.weight, ...visual(r.key, r.sprite),
      food: r.food ? { ...r.food } : null, tool: r.tool ? { kind: enumOf(TOOL, r.tool.kind, `${where}.tool.kind`), tier: r.tool.tier } : null,
      weapon: r.weapon ? { ...r.weapon } : null, fuelSeconds: r.fuelSeconds ?? 0, spoilSeconds: r.spoilSeconds ?? 0, maxDurability: r.durability ?? (r.tool || r.weapon ? 200 : 0), tradeable: r.tradeable ?? true, sips: r.sips ?? 0,
      tier: r.tier ?? 0, family: r.family ?? "",
      wear: r.wear ? { slot: enumOf(WEAR, r.wear.slot, `${where}.wear.slot`), insulation: r.wear.insulation ?? 0, waterproof: r.wear.waterproof ?? 0, armor: r.wear.armor ?? 0, carryBonus: r.wear.carryBonus ?? 0 } : null,
      ranged: rg ? { ammo: rg.ammo.map((k, i) => itemRef(k, `${where}.ranged.ammo[${i}]`)), damage: rg.damage, range: rg.range, magazine: rg.magazine, reloadSeconds: rg.reloadSeconds, cooldownSeconds: rg.cooldownSeconds, staminaCost: rg.staminaCost ?? 0, chargeSeconds: rg.chargeSeconds ?? 0, minChargeMul: rg.minChargeMul ?? 1, structureMul: rg.structureMul ?? 0.1 } : null,
      thrown: r.thrown ? { ...r.thrown } : null,
      ammo: r.ammo ? { damageMul: r.ammo.damageMul, structureMul: r.ammo.structureMul ?? 1, armorPierce: r.ammo.armorPierce ?? 0, ignite: r.ammo.ignite ?? false } : null,
      explosive: r.explosive ? { ...r.explosive, ignite: r.explosive.ignite ?? false } : null,
    });
  }

  for (const d of items.values()) for (const a of d.ranged?.ammo ?? []) if (a && items.get(a)?.category !== ItemCategory.Ammo) err(`item ${d.key}.ranged.ammo: ${items.get(a)?.key} is not ammo`);
  const recipes = new Map<number, RecipeDef>();
  for (const r of raw.recipes.recipes) {
    const where = `recipe ${r.key}`;
    if (!(r.seconds > 0)) err(`${where}.seconds must be > 0`);
    if (r.ingredients.length === 0) err(`${where}: needs at least one ingredient`);
    const ingredients = r.ingredients.map((g, i) => { posInt(g.count, `${where}.ingredients[${i}].count`); return { item: itemRef(g.item, `${where}.ingredients[${i}]`), count: g.count }; });
    posInt(r.output.count, `${where}.output.count`);
    if (r.skill && !(KEY.test(r.skill.key) && Number.isInteger(r.skill.level) && r.skill.level >= 1)) err(`${where}.skill needs a key and level >= 1`);
    const id = recR.reg.tryId(r.key) ?? 0;
    recipes.set(id, { id, key: r.key, station: enumOf(STATION, r.station, `${where}.station`), seconds: r.seconds, ingredients, output: { item: itemRef(r.output.item, `${where}.output`), count: r.output.count }, skill: r.skill ? { ...r.skill } : null });
  }

  const resources = new Map<number, ResourceDef>();
  for (const r of raw.resources.resources) {
    const where = `resource ${r.key}`;
    posInt(r.capacity, `${where}.capacity`);
    if (!(r.respawnSeconds > 0)) err(`${where}.respawnSeconds must be > 0`);
    if (!(r.cooldownSeconds >= 0)) err(`${where}.cooldownSeconds must be >= 0`);
    const yields = r.yields.map((y, i) => {
      const w = `${where}.yields[${i}]`;
      if (!(Number.isInteger(y.min) && Number.isInteger(y.max) && y.min >= 0 && y.max >= y.min)) err(`${w}: need integers 0 <= min <= max`);
      if (!(y.chance > 0 && y.chance <= 1)) err(`${w}.chance must be in (0,1]`);
      return { item: itemRef(y.item, w), min: y.min, max: y.max, chance: y.chance };
    });
    if (yields.length === 0) err(`${where}: needs at least one yield`);
    const id = resR.reg.tryId(r.key) ?? 0;
    resources.set(id, { id, key: r.key, ...visual(r.key, r.sprite), requiredTool: enumOf(TOOL, r.requiredTool, `${where}.requiredTool`), minTier: r.minTier, capacity: r.capacity, respawnSeconds: r.respawnSeconds, cooldownSeconds: r.cooldownSeconds, staminaCost: r.staminaCost, bonusPerTier: r.bonusPerTier, yields, oneShot: r.oneShot === true });
  }

  const env = raw.environment;
  if (!(env.dayLengthSeconds > 0)) err("environment.dayLengthSeconds must be > 0");
  const weather: WeatherDef[] = env.weather.map((w, i) => {
    const where = `environment.weather[${i}]`;
    const pair = (a: number[], name: string): [number, number] => { if (a.length !== 2 || !(a[0]! <= a[1]!)) err(`${where}.${name} must be [min, max]`); return [a[0] ?? 0, a[1] ?? 0]; };
    return { kind: enumOf(WEATHER, w.kind, `${where}.kind`), weight: w.weight, durationSeconds: pair(w.durationSeconds, "durationSeconds"), intensity: pair(w.intensity, "intensity"), tempOffset: w.tempOffset, wetnessPerSec: w.wetnessPerSec, thirstMul: w.thirstMul, staminaRegenMul: w.staminaRegenMul, windSpeed: w.windSpeed ? pair(w.windSpeed, "windSpeed") : [0, 0] };
  });
  if (!weather.some((w) => w.weight > 0)) err("environment.weather: at least one entry needs weight > 0");

  // tiers
  const tiers: TierDef[] = raw.tiers.tiers.map((t, i) => ({ id: i, key: t.key, hpMul: t.hpMul, vertLoss: t.vertLoss, horizLoss: t.horizLoss, repairMul: t.repairMul, cost: t.cost.map((c) => ({ item: itemRef(c.item, `tier ${t.key}`), count: c.count })),
    raid: { melee: t.raid?.melee ?? 1, explosive: t.raid?.explosive ?? 1, fire: t.raid?.fire ?? 1 } }));
  if (tiers.length === 0 || tiers.length > 8) err("tiers: need 1..8 tiers");

  // pieces: engine validation + gameplay extras
  let pieceRegistry: BuildPieceRegistry | undefined; let pieceLock: Record<string, number> = {};
  const pieces = new Map<number, PieceDef>();
  try {
    const engineRaw: RawBuildPiece[] = raw.pieces.pieces.map((p) => ({
      key: p.key, hp: p.hp, ...(p.footprint && { footprint: p.footprint }), ...(p.levels !== undefined && { levels: p.levels }),
      layer: p.layer ?? (p.placement === "edge" || p.placement === "opening" ? 1 : 2), solid: p.solid ?? (p.blocksPath ?? true),
      ...(p.sockets && { sockets: p.sockets }), ...(p.cost && { cost: p.cost }), sprite: p.sprite ?? p.key,
    }));
    const res = loadBuildPieces(engineRaw, {
      lock: lockIn.pieces ?? {},
      resolveResource: (k) => itemsR.reg.tryId(k),
      ...(opts.resolveSprite && { resolveSprite: opts.resolveSprite }),
    });
    pieceRegistry = res.registry; pieceLock = res.lock;
  } catch (e) { err(String((e as Error).message)); }
  if (pieceRegistry) for (const p of raw.pieces.pieces) {
    const where = `piece ${p.key}`; const base = pieceRegistry.byKey(p.key);
    const placement = enumOf(PLACEMENT, p.placement, `${where}.placement`);
    const station = enumOf(STATION, p.station ?? "none", `${where}.station`);
    if (placement === Placement.Opening && !p.fits) err(`${where}: opening piece needs "fits"`);
    if (!p.tiered && p.tier === undefined) err(`${where}: needs "tiered" or a fixed "tier"`);
    if (p.tier !== undefined && !(p.tier >= 0 && p.tier < tiers.length)) err(`${where}.tier out of range`);
    if ((p.container ?? 0) > 96) err(`${where}.container exceeds 96 slots (CONTAINER_MAX_SLOTS)`);
    if (p.variantNames && p.variantNames.length !== Math.max(1, p.variants ?? 1)) err(`${where}.variantNames must have one name per variant`);
    pieces.set(base.id, {
      ...base, ...visual(p.key, p.sprite), placement, tiered: p.tiered ?? false, costScale: p.costScale ?? 1, fixedTier: p.tier ?? 1,
      groundOnly: p.groundOnly ?? false, ground: p.ground ?? false, minLevel: p.minLevel ?? 0, needsDeck: p.needsDeck ?? false,
      supportsAbove: p.supportsAbove ?? false, roof: p.roof ?? false, blocksPath: p.blocksPath ?? false,
      opening: p.opening ? enumOf(OPENING, p.opening, `${where}.opening`) : 0, fits: p.fits ? enumOf(OPENING, p.fits, `${where}.fits`) : 0,
      door: p.door ?? false, station, fired: p.fired ?? false, heat: p.heat ?? 0, heatRadius: p.heatRadius ?? 0, light: p.light ?? false,
      container: p.container ?? 0, privilegeRadius: p.privilegeRadius ?? 0, paintable: p.paintable ?? false, variants: Math.max(1, p.variants ?? 1), variantNames: p.variantNames ?? [], category: p.category ?? defaultPieceCategory(p), spoilMul: p.spoilMul ?? 1, fuelMul: p.fuelMul ?? 1,
      stall: p.stall ? { listings: p.stall.listings, clanOnly: p.stall.clanOnly ?? false } : null, features: p.features ?? {},
      rotSteps: p.rotSteps ?? 0, snap: p.snap ?? "", maxSlope: p.maxSlope ?? -1, minTier: p.minTier ?? 0, family: p.family ?? "",
      extraCost: (p.extraCost ?? []).map((c) => ({ item: itemRef(c.item, where), count: c.count, fromTier: c.fromTier ?? 0 })),
    });
    if (placement === Placement.Tri && (p.footprint && (p.footprint.w !== 1 || p.footprint.h !== 1))) err(`${where}: tri pieces are 1x1`);
    if (p.rotSteps !== undefined && !(Number.isInteger(p.rotSteps) && p.rotSteps >= 1 && p.rotSteps <= 16)) err(`${where}.rotSteps must be 1..16`);
    if (p.minTier !== undefined && !(p.minTier >= 0 && p.minTier < tiers.length)) err(`${where}.minTier out of range`);
    if (p.stall && (p.stall.listings !== (p.container ?? 0))) err(`${where}.stall.listings must equal container`);
    for (const a of p.features?.turret?.ammo ?? []) itemRef(a, `${where}.features.turret.ammo`);
    if (p.features?.turret && !(p.container ?? 0)) err(`${where}.features.turret needs a container (ammo)`);
  }

  const zombies = new Map<number, ZombieDef>();
  for (const z of raw.zombies.zombies) {
    if (!(z.hp > 0 && z.speed > 0 && z.attackCooldownSeconds > 0)) err(`zombie ${z.key}: hp, speed, attackCooldownSeconds must be > 0`);
    const id = zomR.reg.tryId(z.key) ?? 0;
    zombies.set(id, { ...z, id, ...visual(z.key, z.sprite), variants: Math.max(1, z.variants) });
  }
  const zk = raw.zombies.zombies.length;
  for (const ph of ["night", "dawn", "day", "dusk"] as const) if (raw.zombies.spawning.weights[ph].length !== zk) err(`zombies.spawning.weights.${ph} needs ${zk} entries`);

  const bands: WorldgenBand[] = raw.worldgen.bands.map((b, i) => ({
    max: b.max, tile: b.tile, nodeChance: b.nodeChance, temp: b.temp ?? 15, humidity: b.humidity ?? 0.5,
    nodes: b.nodes.map((k) => { const id = resR.reg.tryId(k); if (id === undefined) err(`worldgen.bands[${i}]: unknown resource "${k}"`); return id ?? 0; }),
  }));

  const spoiledItem = itemsR.reg.tryId(env.spoilage.spoiledItem); if (spoiledItem === undefined) err(`environment.spoilage.spoiledItem: unknown item "${env.spoilage.spoiledItem}"`);
  if (issues.length) throw new DefsError(issues);

  const bh = raw.resources.bareHands;
  const bareHands: BareHandsDef = bh ? { maxMinTier: bh.maxMinTier, tools: new Set(bh.tools.map((t, i) => enumOf(TOOL, t, `resources.bareHands.tools[${i}]`))), yieldMul: bh.yieldMul, minYield: bh.minYield, cooldownMul: bh.cooldownMul }
    : { maxMinTier: -1, tools: new Set(), yieldMul: 0, minYield: 0, cooldownMul: 1 };
  if (!(bareHands.yieldMul >= 0 && bareHands.yieldMul <= 1) || !(bareHands.cooldownMul >= 1)) err("resources.bareHands: yieldMul must be 0..1 and cooldownMul >= 1");
  const strip = <T extends { $comment?: string }>(o: T): Omit<T, "$comment"> => { const { $comment: _c, ...rest } = o; return rest; };
  const { weather: _w, ...envRest } = strip(env);
  const lock: IdLock = { items: itemsR.lock, resources: resR.lock, recipes: recR.lock, pieces: pieceLock, zombies: zomR.lock };
  const lookup = (r: StableIdRegistry) => (key: string): number => r.id(key);
  const pieceHash = pieceRegistry!.hash;
  const all = [itemsR.reg.hash, resR.reg.hash, recR.reg.hash, pieceHash, zomR.reg.hash].reduce((h, x) => fnv1a(`${x};`, h), 0x811c9dc5);
  return {
    items, recipes, resources, pieces, pieceRegistry: pieceRegistry!, tiers, building: { ...raw.tiers.building }, zombies,
    zombieKinds: raw.zombies.zombies.map((z) => zomR.reg.id(z.key)), spoiledItem: spoiledItem ?? 0,
    spawning: raw.zombies.spawning, ai: raw.zombies.ai, noise: raw.zombies.noise, lightAvoid: raw.zombies.lightAvoid ?? DEFAULT_LIGHT_AVOID,
    vitals: strip(raw.vitals), environment: { ...envRest, weather }, movement: { ...strip(raw.movement), swimTiles: new Set(raw.movement.swimTiles ?? []), swimSpeedMul: raw.movement.swimSpeedMul ?? 1 },
    worldgen: { bands, unbuildableTiles: new Set(raw.worldgen.unbuildableTiles), unwalkableTiles: new Set(raw.worldgen.unwalkableTiles) },
    lock, hashes: { items: itemsR.reg.hash, pieces: pieceHash, all }, bareHands,
    itemId: lookup(itemsR.reg), recipeId: lookup(recR.reg), resourceId: lookup(resR.reg), zombieId: lookup(zomR.reg),
    pieceId: (key) => pieceRegistry!.byKey(key).id,
    piece: (key) => pieces.get(pieceRegistry!.byKey(key).id)!,
  };
}

/** Seconds -> whole ticks (at least 1) for the fixed dt the system was called with. */
export const secondsToTicks = (seconds: number, dt: number): number => Math.max(1, Math.ceil(seconds / dt - 1e-9));

/** All manifest keys gameplay references (for Art & Assets). */
export function manifestKeys(defs: GameDefs): { items: string[]; resources: string[]; pieces: string[]; zombies: string[] } {
  const k = <T extends Visual>(m: ReadonlyMap<number, T>) => [...m.values()].map((d) => d.spriteKey);
  return { items: k(defs.items), resources: k(defs.resources), pieces: k(defs.pieces), zombies: k(defs.zombies) };
}

/** ADR-112: build-menu category when pieces.json omits one. */
export function defaultPieceCategory(p: { layer?: number; station?: string; placement?: string; fired?: boolean; light?: boolean }): string {
  if (p.station) return "crafting";
  if ((p.layer ?? 1) >= 2) return p.light ? "lighting" : (p.layer ?? 0) >= 3 ? "decor" : "furniture";
  return "structure";
}
