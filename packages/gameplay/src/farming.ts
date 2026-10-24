/**
 * ADR-110 farming: hoe -> tilled soil, seeds / saplings planted with Use (IntentAction.Use on the item's slot), growth
 * stages with watering + fertilizer, maturity -> a resource node (crop_* nodes are oneShot and may drop seeds back).
 * Seeds come only from gathering wild plants and harvesting crops (resources.json yields); there are no seed recipes.
 * Authority-only and RNG-free; Crop is networked + persistent so fields survive restarts and replicate to clients.
 */
import { DEFAULT_TICK_HZ, Transform, Weather, entityIndex, type Entity, type World } from "@engine/core";
import { installSpatialIndex } from "@engine/world";
import raw from "../data/farming.json";
import { BuildPiece, Crop, Dead, Equipment, IntentAction, PlayerIntent, ResourceNode } from "./components.js";
import { gameplayDefs, isAuthority } from "./config.js";
import { countItem, slotItem, takeFromSlot } from "./inventory.js";
import { emit, FarmFailed } from "./events.js";
import { indexEntity, spawnResourceNode } from "./spawn.js";
import { hasPrivilege } from "./building/place.js";
import { populationTile } from "./population.js";
import { nearWater } from "./systems/vitals.js";
import { isRaining } from "./realism.js";

export type PlantType = "crop" | "bush" | "tree";
export interface Plantable { seed: string; key: string; type: PlantType; growSeconds: number; stages: number; becomes: string; tiles: number[] }
export interface FarmingData { unwateredMul: number; wateredMul: number; wateredSeconds: number; fertilizerMul: number; waterRadius: number; fertilizeRadius: number; plantReach: number; minSpacing: number; tickSeconds: number; plantables: Plantable[] }
export const FARMING: FarmingData = raw as unknown as FarmingData;
export const FARM_TOOL = { hoe: "hoe", wateringCan: "watering_can", fertilizer: "fertilizer" } as const;
/** Crop.kind -> plantable (kind 0 = tilled soil). */
export const plantableOf = (kind: number): Plantable | undefined => (kind > 0 ? FARMING.plantables[kind - 1] : undefined);
export const plantableBySeed = (seed: string): number => FARMING.plantables.findIndex((p) => p.seed === seed) + 1;
/** Render key for a crop entity: farm_soil, or crop_<key>_<stage> / sapling_<key>_<stage> / bush_<key>_<stage>. */
export function cropSpriteKey(kind: number, stage: number): string {
  const p = plantableOf(kind); if (!p) return "farm_soil";
  return p.type === "crop" ? `crop_${p.key}_${stage}` : `sapling_${p.key}_${stage}`;
}

export const enum FarmFail { None = 0, NoPrivilege = 1, BadTile = 2, Occupied = 3, NeedsSoil = 4, NothingToTend = 5, /** crop seed with no soil and no hoe to till it */ NeedsHoe = 6 }

/** Planting spot: one tile in front of the player, snapped to the tile centre. */
export function plantSpot(world: World, e: Entity): { x: number; y: number } {
  const t = world.get(e, Transform)!; const f = t.facing ?? 0;
  return { x: Math.floor(t.x + Math.cos(f)) + 0.5, y: Math.floor(t.y + Math.sin(f)) + 0.5 };
}
function near(world: World, x: number, y: number, r: number): Entity[] {
  return installSpatialIndex(world).queryRadius(x, y, r).filter((o) => { const t = world.get(o, Transform); return !!t && Math.hypot(t.x - x, t.y - y) <= r; }).sort((a, b) => a - b);
}
const tileOk = (world: World, x: number, y: number, tiles: readonly number[]): boolean => { const t = populationTile(world, Math.floor(x), Math.floor(y)); return t === 0 || tiles.includes(t); };

/** ADR-112: a planter piece (features.planter) within half a tile: its soil accepts crops on any terrain / deck. */
export function inPlanter(world: World, x: number, y: number): boolean {
  if (!world.isRegistered(BuildPiece)) return false; const defs = gameplayDefs(world);
  return near(world, x, y, 0.75).some((o) => { const t = world.getField(o, BuildPiece, "type"); return t !== undefined && !!defs.pieces.get(t)?.features.planter; });
}
export function spawnCrop(world: World, x: number, y: number, kind = 0): Entity {
  const e = world.create(); world.add(e, Transform, { x, y }).add(e, Crop, { kind, stage: 0, growth: 0, waterUntilTick: 0, fertilized: 0 }); indexEntity(world, e); return e;
}
/** Till the spot (hoe). */
export function till(world: World, e: Entity, x: number, y: number, dryRun = false): FarmFail {
  if (hasForeignZone(world, e, x, y)) return FarmFail.NoPrivilege;
  if (!tileOk(world, x, y, [3, 4])) return FarmFail.BadTile;
  if (near(world, x, y, FARMING.minSpacing).some((o) => world.has(o, Crop) || world.has(o, ResourceNode))) return FarmFail.Occupied;
  if (!dryRun) spawnCrop(world, x, y, 0); return FarmFail.None;
}
const hasForeignZone = (world: World, e: Entity, x: number, y: number): boolean => !hasPrivilege(world, e, x, y);
/** Plant `seed` (item key) at x,y. Crops need tilled soil there; trees / bushes need a free spot. */
export function plant(world: World, e: Entity, seed: string, x: number, y: number, dryRun = false): FarmFail {
  const kind = plantableBySeed(seed); const p = plantableOf(kind); if (!p) return FarmFail.BadTile;
  if (hasForeignZone(world, e, x, y)) return FarmFail.NoPrivilege;
  const around = near(world, x, y, FARMING.minSpacing);
  if (!(p.type === "crop" && inPlanter(world, x, y)) && !tileOk(world, x, y, p.tiles)) return FarmFail.BadTile;
  if (p.type === "crop") {
    const soil = around.find((o) => world.get(o, Crop)?.kind === 0); if (soil === undefined) return hasHoe(world, e) ? FarmFail.NeedsSoil : FarmFail.NeedsHoe;
    if (!dryRun) world.set(soil, Crop, { kind, stage: 0, growth: 0 }); return FarmFail.None;
  }
  if (around.some((o) => world.has(o, Crop) || world.has(o, ResourceNode))) return FarmFail.Occupied;
  if (!dryRun) spawnCrop(world, x, y, kind); return FarmFail.None;
}
export function water(world: World, x: number, y: number): number {
  const until = world.tick + Math.round(FARMING.wateredSeconds * DEFAULT_TICK_HZ); let n = 0;
  for (const o of near(world, x, y, FARMING.waterRadius)) if ((world.get(o, Crop)?.kind ?? 0) > 0) { world.set(o, Crop, { waterUntilTick: until }); n++; }
  return n;
}
const hasHoe = (world: World, e: Entity): boolean => { const id = [...gameplayDefs(world).items.values()].find((d) => d.key === FARM_TOOL.hoe)?.id; return !!id && countItem(world, e, id) > 0; };
const crops = (world: World, x: number, y: number, r: number): Entity[] => near(world, x, y, r).filter((o) => (world.get(o, Crop)?.kind ?? 0) > 0);
export function fertilize(world: World, x: number, y: number): boolean {
  const c = near(world, x, y, FARMING.fertilizeRadius).find((o) => { const k = world.get(o, Crop); return !!k && k.kind > 0 && k.fertilized === 0; });
  if (c === undefined) return false; world.set(c, Crop, { fertilized: 1 }); return true;
}

/** IntentAction.Use on a hoe / seed / sapling / watering can / fertilizer (authority; the client is corrected by replication). */
export function farmUseSystem(world: World): void {
  if (!isAuthority(world) || world.isReplaying) return;
  const defs = gameplayDefs(world); const intent = world.store(PlayerIntent);
  for (const e of world.query([PlayerIntent, Transform], [Dead])) {
    const s = intent.slot(entityIndex(e)); if (intent.data.action[s] !== IntentAction.Use) continue;
    const slot = intent.data.slot[s]!; const { item, count } = slotItem(world, e, slot); if (!count) continue;
    const key = defs.items.get(item)?.key; if (!key) continue;
    const at = plantSpot(world, e); const me = world.get(e, Transform)!;
    let r = FarmFail.None;
    if (key === FARM_TOOL.hoe) r = till(world, e, at.x, at.y);
    else if (key === FARM_TOOL.wateringCan) { if (!water(world, me.x, me.y)) r = FarmFail.NothingToTend; }
    else if (key === FARM_TOOL.fertilizer) { if (fertilize(world, at.x, at.y) || fertilize(world, me.x, me.y)) takeFromSlot(world, e, slot); else r = FarmFail.NothingToTend; }
    else if (plantableBySeed(key) > 0) { r = plant(world, e, key, at.x, at.y); if (r === FarmFail.None) takeFromSlot(world, e, slot); }
    else continue;
    if (r !== FarmFail.None) emit(world, FarmFailed, { entity: e, reason: r });
  }
}

/** Growth multiplier right now (watered by can or rain, fertilizer). */
export function growthMul(world: World, c: { waterUntilTick: number; fertilized: number }): number {
  const wet = c.waterUntilTick > world.tick || isRaining(world.env(Weather).kind);
  return (wet ? FARMING.wateredMul : FARMING.unwateredMul) * (c.fertilized ? FARMING.fertilizerMul : 1);
}
export const CROP_EVERY = Math.round(FARMING.tickSeconds * DEFAULT_TICK_HZ);
/** Every CROP_EVERY ticks: grow, advance stages, mature into the resource node. */
export function cropGrowthSystem(world: World): void {
  if (!isAuthority(world) || world.isReplaying) return;
  const dt = CROP_EVERY / DEFAULT_TICK_HZ;
  for (const e of [...world.query([Crop, Transform])].sort((a, b) => a - b)) {
    const c = world.get(e, Crop)!; const p = plantableOf(c.kind); if (!p) continue;
    const growth = Math.min(1, c.growth + (dt / p.growSeconds) * growthMul(world, c));
    if (growth >= 1) { const t = world.get(e, Transform)!; world.destroy(e); spawnResourceNode(world, p.becomes, t.x, t.y); continue; }
    const stage = Math.min(p.stages - 1, Math.floor(growth * p.stages));
    world.set(e, Crop, stage !== c.stage ? { growth, stage } : { growth });
  }
}

/** Short toast text per failure (ADR-110 follow-up). */
export const FARM_FAIL_TEXT: Readonly<Record<number, string>> = {
  [FarmFail.NoPrivilege]: "Inside someone else's claim", [FarmFail.BadTile]: "Can't farm on this ground", [FarmFail.Occupied]: "Too close to another plant",
  [FarmFail.NeedsSoil]: "Needs tilled soil — use a hoe first", [FarmFail.NothingToTend]: "No crops here to tend", [FarmFail.NeedsHoe]: "You need a hoe to till soil first",
};
export type FarmAction = "Till" | "Plant" | "Water" | "Fertilize" | "Harvest" | "Tame" | "Feed" | "Eat" | "Drink"; // Eat / Drink: ADR-128 quick-use consume; Tame / Feed: ADR-113 husbandryPrompt
export interface FarmPrompt { action: FarmAction; /** Use slot (Harvest goes through Interact / gather instead) */ slot?: number; target?: Entity; /** predicted failure (dry run) */ fail: FarmFail; label: string }
/** Context prompt for the player's held farming item / a ripe farmed node in front (pure read; client-predicted). */
export function farmPrompt(world: World, e: Entity): FarmPrompt | undefined {
  if (!world.has(e, Transform)) return undefined;
  const defs = gameplayDefs(world); const at = plantSpot(world, e); const me = world.get(e, Transform)!;
  const slot = world.get(e, Equipment)?.mainHandSlot ?? 255;
  const { item, count } = slot !== 255 ? slotItem(world, e, slot) : { item: 0, count: 0 };
  const key = count ? defs.items.get(item)?.key : undefined;
  const mk = (action: FarmAction, fail: FarmFail, extra: Partial<FarmPrompt> = {}): FarmPrompt => ({ action, slot, fail, label: fail ? `${action}: ${FARM_FAIL_TEXT[fail]}` : action, ...extra });
  if (key === FARM_TOOL.hoe) return mk("Till", till(world, e, at.x, at.y, true));
  if (key === FARM_TOOL.wateringCan) return mk("Water", crops(world, me.x, me.y, FARMING.waterRadius).length ? FarmFail.None : FarmFail.NothingToTend);
  if (key === FARM_TOOL.fertilizer) return mk("Fertilize", crops(world, at.x, at.y, FARMING.fertilizeRadius).length || crops(world, me.x, me.y, FARMING.fertilizeRadius).length ? FarmFail.None : FarmFail.NothingToTend);
  if (key && plantableBySeed(key) > 0) return mk("Plant", plant(world, e, key, at.x, at.y, true));
  const ripe = new Set(FARMING.plantables.map((p) => p.becomes));
  const node = near(world, at.x, at.y, 1).find((o) => { const n = world.get(o, ResourceNode); return !!n && ripe.has(defs.resources.get(n.kind)?.key ?? ""); });
  if (node !== undefined) { const { slot: _s, ...p } = mk("Harvest", FarmFail.None, { target: node }); return p; }
  // ADR-128: quick-use eats/drinks the held consumable; empty hands next to water drink from the tile (slot NO_SLOT)
  const food = key ? defs.items.get(item) : undefined;
  if (food?.food) return mk(food.sips > 0 || (food.food.thirst > 0 && food.food.hunger <= 0) ? "Drink" : "Eat", FarmFail.None);
  if (!key && nearWater(world, me.x, me.y)) return { action: "Drink", slot: 255, fail: FarmFail.None, label: "Drink water" };
  return undefined;
}
