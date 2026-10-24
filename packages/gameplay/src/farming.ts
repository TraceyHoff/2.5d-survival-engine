/**
 * ADR-110 farming: hoe -> tilled soil, seeds / saplings planted with Use (IntentAction.Use on the item's slot), growth
 * stages with watering + fertilizer, maturity -> a resource node (crop_* nodes are oneShot and may drop seeds back).
 * Seeds come only from gathering wild plants and harvesting crops (resources.json yields); there are no seed recipes.
 * Authority-only and RNG-free; Crop is networked + persistent so fields survive restarts and replicate to clients.
 */
import { DEFAULT_TICK_HZ, Transform, Weather, entityIndex, type Entity, type World } from "@engine/core";
import { installSpatialIndex } from "@engine/world";
import raw from "../data/farming.json";
import { Crop, Dead, IntentAction, PlayerIntent, ResourceNode } from "./components.js";
import { gameplayDefs, isAuthority } from "./config.js";
import { slotItem, takeFromSlot } from "./inventory.js";
import { indexEntity, spawnResourceNode } from "./spawn.js";
import { hasPrivilege } from "./building/place.js";
import { populationTile } from "./population.js";
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

export const enum FarmFail { None = 0, NoPrivilege = 1, BadTile = 2, Occupied = 3, NeedsSoil = 4, NothingToTend = 5 }

/** Planting spot: one tile in front of the player, snapped to the tile centre. */
export function plantSpot(world: World, e: Entity): { x: number; y: number } {
  const t = world.get(e, Transform)!; const f = t.facing ?? 0;
  return { x: Math.floor(t.x + Math.cos(f)) + 0.5, y: Math.floor(t.y + Math.sin(f)) + 0.5 };
}
function near(world: World, x: number, y: number, r: number): Entity[] {
  return installSpatialIndex(world).queryRadius(x, y, r).filter((o) => { const t = world.get(o, Transform); return !!t && Math.hypot(t.x - x, t.y - y) <= r; }).sort((a, b) => a - b);
}
const tileOk = (world: World, x: number, y: number, tiles: readonly number[]): boolean => { const t = populationTile(world, Math.floor(x), Math.floor(y)); return t === 0 || tiles.includes(t); };

export function spawnCrop(world: World, x: number, y: number, kind = 0): Entity {
  const e = world.create(); world.add(e, Transform, { x, y }).add(e, Crop, { kind, stage: 0, growth: 0, waterUntilTick: 0, fertilized: 0 }); indexEntity(world, e); return e;
}
/** Till the spot (hoe). */
export function till(world: World, e: Entity, x: number, y: number): FarmFail {
  if (hasForeignZone(world, e, x, y)) return FarmFail.NoPrivilege;
  if (!tileOk(world, x, y, [3, 4])) return FarmFail.BadTile;
  if (near(world, x, y, FARMING.minSpacing).some((o) => world.has(o, Crop) || world.has(o, ResourceNode))) return FarmFail.Occupied;
  spawnCrop(world, x, y, 0); return FarmFail.None;
}
const hasForeignZone = (world: World, e: Entity, x: number, y: number): boolean => !hasPrivilege(world, e, x, y);
/** Plant `seed` (item key) at x,y. Crops need tilled soil there; trees / bushes need a free spot. */
export function plant(world: World, e: Entity, seed: string, x: number, y: number): FarmFail {
  const kind = plantableBySeed(seed); const p = plantableOf(kind); if (!p) return FarmFail.BadTile;
  if (hasForeignZone(world, e, x, y)) return FarmFail.NoPrivilege;
  if (!tileOk(world, x, y, p.tiles)) return FarmFail.BadTile;
  const around = near(world, x, y, FARMING.minSpacing);
  if (p.type === "crop") {
    const soil = around.find((o) => world.get(o, Crop)?.kind === 0); if (soil === undefined) return FarmFail.NeedsSoil;
    world.set(soil, Crop, { kind, stage: 0, growth: 0 }); return FarmFail.None;
  }
  if (around.some((o) => world.has(o, Crop) || world.has(o, ResourceNode))) return FarmFail.Occupied;
  spawnCrop(world, x, y, kind); return FarmFail.None;
}
export function water(world: World, x: number, y: number): number {
  const until = world.tick + Math.round(FARMING.wateredSeconds * DEFAULT_TICK_HZ); let n = 0;
  for (const o of near(world, x, y, FARMING.waterRadius)) if ((world.get(o, Crop)?.kind ?? 0) > 0) { world.set(o, Crop, { waterUntilTick: until }); n++; }
  return n;
}
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
    if (key === FARM_TOOL.hoe) till(world, e, at.x, at.y);
    else if (key === FARM_TOOL.wateringCan) water(world, me.x, me.y);
    else if (key === FARM_TOOL.fertilizer) { if (fertilize(world, at.x, at.y) || fertilize(world, me.x, me.y)) takeFromSlot(world, e, slot); }
    else if (plantableBySeed(key) > 0) { if (plant(world, e, key, at.x, at.y) === FarmFail.None) takeFromSlot(world, e, slot); }
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
