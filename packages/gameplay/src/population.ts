/**
 * Gameplay side of the ambient population: the spawn table (data/population.json), animal defs + a simple
 * wander/flee AI, and installPopulation(), which wires @engine/world's PopulationSpawner to gameplay rules
 * (walkable tiles, no structures, no land claims / safe zones). Authority only. Human bots are spawned through
 * a host callback (virtual players join through the normal client path; see agents.ts / docs/AI_AGENTS.md).
 */
import { DEFAULT_TICK_HZ, Permissions, Transform, defineResource, type Entity, type World } from "@engine/core";
import { PopulationSpawner, type BuildingGrid, type ChunkKey, type PhaseKey, type PopulationHost, type SpawnEntry, type PopulationViewpoint } from "@engine/world";
import raw from "../data/population.json";
import { Animal, Dead, Health, Survival } from "./components.js";
import { gameplayDefs, isAuthority } from "./config.js";
import { indexEntity } from "./spawn.js";
import { currentPhaseKey, PopulationZombies, spawnZombie } from "./combat/zombies.js";
import { structures } from "./building/structure.js";
import { TerrainRes } from "./world.js";
import { installSpatialIndex } from "@engine/world";

export interface AnimalDef { key: string; spriteKey: string; hp: number; speed: number; fleeSpeed: number; fleeRange: number; wanderRadius: number; drops: string[] }
export interface PopulationData { intervalSeconds: number; spawns: SpawnEntry[]; animals: AnimalDef[] }
export const POPULATION_DATA: PopulationData = raw as unknown as PopulationData;
export const animalDefs = (): readonly AnimalDef[] => POPULATION_DATA.animals;
export const animalKindOf = (key: string): number => { const i = POPULATION_DATA.animals.findIndex((a) => a.key === key); if (i < 0) throw new Error(`unknown animal ${key}`); return i; };

export const enum AnimalState { Idle = 0, Wander = 1, Flee = 2 }
export function spawnAnimal(world: World, kind: number | string, x: number, y: number): Entity {
  const k = typeof kind === "string" ? animalKindOf(kind) : kind; const def = POPULATION_DATA.animals[k]; if (!def) throw new Error(`unknown animal ${kind}`);
  const e = world.create();
  world.add(e, Transform, { x, y }).add(e, Health, { hp: def.hp, max: def.hp }).add(e, Animal, { kind: k, homeX: x, homeY: y, goalX: x, goalY: y, thinkAt: world.tick });
  indexEntity(world, e); return e;
}

/** Tile lookup used by population when the world has no TerrainRes (the server reads ChunkManager directly). */
export const PopulationTiles = defineResource<(tx: number, ty: number) => number>("gameplay.PopulationTiles");
export function populationTile(world: World, tx: number, ty: number): number {
  const t = world.getResource(TerrainRes); if (t) return t.tileAt(tx, ty);
  return world.getResource(PopulationTiles)?.(tx, ty) ?? 0;
}
/** Animal AI (authority, every tick): idle/wander around home; flee from any living Survival entity in fleeRange. */
export function animalAISystem(world: World, dt: number): void {
  if (!isAuthority(world) || world.isReplaying) return;
  const index = installSpatialIndex(world); const unwalk = gameplayDefs(world).worldgen.unwalkableTiles;
  for (const e of world.query([Animal, Transform], [Dead])) {
    const a = world.get(e, Animal)!; const t = world.get(e, Transform)!; const def = POPULATION_DATA.animals[a.kind]; if (!def) continue;
    let threat: { x: number; y: number; d: number } | undefined;
    for (const p of index.queryRadius(t.x, t.y, def.fleeRange)) {
      if (!world.has(p, Survival) || world.has(p, Dead)) continue; const pt = world.get(p, Transform)!; const d = Math.hypot(pt.x - t.x, pt.y - t.y);
      if (!threat || d < threat.d) threat = { x: pt.x, y: pt.y, d };
    }
    let state = a.state, gx = a.goalX, gy = a.goalY;
    if (threat) { state = AnimalState.Flee; const ang = Math.atan2(t.y - threat.y, t.x - threat.x); gx = t.x + Math.cos(ang) * 4; gy = t.y + Math.sin(ang) * 4; }
    else if (world.tick >= a.thinkAt || state === AnimalState.Flee) {
      const rng = world.rngFor("animal.think", e);
      if (rng.next() < 0.5) state = AnimalState.Idle;
      else { state = AnimalState.Wander; const ang = rng.range(-Math.PI, Math.PI), r = rng.range(1, def.wanderRadius); gx = a.homeX + Math.cos(ang) * r; gy = a.homeY + Math.sin(ang) * r; }
      world.setField(e, Animal, "thinkAt", world.tick + Math.round(rng.range(2, 6) * DEFAULT_TICK_HZ));
    }
    if (state !== AnimalState.Idle) {
      const dx = gx - t.x, dy = gy - t.y, d = Math.hypot(dx, dy); const sp = (state === AnimalState.Flee ? def.fleeSpeed : def.speed) * dt;
      if (d < 0.1) state = AnimalState.Idle;
      else {
        const nx = t.x + (dx / d) * Math.min(sp, d), ny = t.y + (dy / d) * Math.min(sp, d);
        if (!unwalk.has(populationTile(world, Math.floor(nx), Math.floor(ny)))) { world.set(e, Transform, { x: nx, y: ny, facing: Math.atan2(dy, dx) }); }
        else state = AnimalState.Idle;
      }
    }
    if (state !== a.state) world.setField(e, Animal, "state", state);
    if (gx !== a.goalX || gy !== a.goalY) { world.setField(e, Animal, "goalX", gx); world.setField(e, Animal, "goalY", gy); }
  }
}

/** Set while a PopulationSpawner owns zombie spawning (the legacy per-player zombieSpawner then stands down). */
export const PopulationRes = defineResource<PopulationSpawner>("gameplay.Population");

export interface InstallPopulationOptions {
  chunks: () => Iterable<ChunkKey>;
  /** Real (human) players: spawn distance + despawn reference. */
  viewpoints: () => PopulationViewpoint[];
  /** Enables the human_bot table entry; spawn is async (virtual players join through the client path). */
  humanBots?: { spawn(x: number, y: number): boolean; despawn(e: Entity): void } | undefined;
  buildings?: BuildingGrid;
  /** Override/extend the data table (tests, mods). */
  spawns?: readonly SpawnEntry[];
  intervalSeconds?: number;
  tickHz?: number;
  /** Tile lookup when the world has no TerrainRes (e.g. the server's ChunkManager.getTile). */
  tileAt?: (tx: number, ty: number) => number;
}
/** Is (tx,ty) off-limits for ambient spawns: unwalkable, under a structure, building grid, or inside a claim. */
export function populationBlocked(world: World, tx: number, ty: number, buildings?: BuildingGrid): boolean {
  if (gameplayDefs(world).worldgen.unwalkableTiles.has(populationTile(world, tx, ty))) return true;
  if (structures(world).deck(tx, ty, 0)) return true;
  if (buildings?.isBlocked(tx, ty)) return true;
  const perms = world.getResource(Permissions); if (perms?.claims.claimAt(tx, ty)) return true;
  return false;
}
export function installPopulation(world: World, o: InstallPopulationOptions): PopulationSpawner {
  if (o.tileAt) world.setResource(PopulationTiles, o.tileAt);
  const spawns = (o.spawns ?? POPULATION_DATA.spawns).filter((s) => s.category !== "human_bot" || o.humanBots);
  const host: PopulationHost = {
    chunks: o.chunks, viewpoints: o.viewpoints,
    phase: (): PhaseKey => currentPhaseKey(world),
    tileAt: (tx, ty) => populationTile(world, tx, ty),
    blocked: (tx, ty) => populationBlocked(world, tx, ty, o.buildings),
    spawn: (entry, x, y) => {
      if (entry.category === "zombie") { const rng = world.rngFor(`pop.variant:${entry.kind}`); return spawnZombie(world, entry.kind, x, y, rng.int(0, 255)); }
      if (entry.category === "animal") return spawnAnimal(world, entry.kind, x, y);
      if (entry.category === "human_bot") return o.humanBots?.spawn(x, y) ? "pending" : undefined;
      return undefined;
    },
    despawn: (e) => { if (world.isAlive(e)) world.destroy(e); },
    position: (e) => { if (!world.isAlive(e) || world.has(e, Dead)) return undefined; const t = world.get(e, Transform); return t ? { x: t.x, y: t.y } : undefined; },
  };
  // Human bots are despawned by their host (session leave), not by destroying the entity.
  const sp = new PopulationSpawner(world, spawns, { ...host, despawn: (e, entry) => { if (entry.category === "human_bot") o.humanBots?.despawn(e); else host.despawn(e, entry); } });
  world.setResource(PopulationRes, sp);
  if (spawns.some((s) => s.category === "zombie")) world.setResource(PopulationZombies, true);
  const every = Math.max(1, Math.round((o.intervalSeconds ?? POPULATION_DATA.intervalSeconds) * (o.tickHz ?? DEFAULT_TICK_HZ)));
  world.addSystem("simulation", "gameplay.population", () => { if (isAuthority(world) && !world.isReplaying) sp.step(); }, { every });
  world.addSystem("simulation", "gameplay.animalAI", animalAISystem);
  return sp;
}
