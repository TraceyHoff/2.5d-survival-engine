import { defineComponent, Transform, World, type Entity } from "@engine/core";
import { BuildingGrid, ChunkManager, loadBuildPieces, ProceduralGenerator } from "@engine/world";
import { WorldPersistence, type WorldPersistenceOptions, type WorldStore } from "../src/index.js";

/** A persistent test component (gameplay has none yet besides core Transform). */
export const Crate = defineComponent("Crate", { loot: "u16", hp: "f32" }, { persistent: true });
export const PIECES = loadBuildPieces([
  { key: "foundation", layer: 0, hp: 500, footprint: { w: 1, h: 1 } },
  { key: "wall", layer: 1, hp: 250 },
  { key: "door", layer: 2, hp: 150, solid: false },
]).registry;

export interface TestWorld { world: World; buildings: BuildingGrid; chunks: ChunkManager; persist: WorldPersistence }
export function makeWorld(store: WorldStore, opts: Partial<WorldPersistenceOptions> & { seed?: number; loadRadius?: number; cacheSize?: number } = {}): TestWorld {
  const world = new World({ seed: opts.seed ?? 42, maxEntities: 1 << 17 });
  world.register(Crate);
  const buildings = new BuildingGrid(PIECES);
  const persist = new WorldPersistence({ world, store, buildings, generator: new ProceduralGenerator({ seed: opts.seed ?? 42 }), autosaveSeconds: 0, playerSaveSeconds: 0, ...opts });
  const chunks = new ChunkManager({ provider: persist.provider, loadRadius: opts.loadRadius ?? 0, unloadMargin: 0, cacheSize: opts.cacheSize ?? 0 });
  persist.attach(chunks);
  world.addSystem("postSim", "test.chunks", () => chunks.update());
  return { world, buildings, chunks, persist };
}
/** Fills chunk (cx,cy) with `n` building pieces (walls stacked over levels), returns placed count. */
export function buildBase(b: BuildingGrid, cx: number, cy: number, n: number): number {
  const wall = PIECES.byKey("wall").id; let placed = 0;
  for (let i = 0; i < n; i++) {
    const t = i % 1024, z = Math.floor(i / 1024);
    if (b.place(wall, cx * 32 + (t % 32), cy * 32 + Math.floor(t / 32), z, i % 4, 100 + (i % 150))) placed++;
  }
  return placed;
}
export function spawnCrate(w: World, x: number, y: number, loot: number): Entity {
  const e = w.create(); w.add(e, Transform, { x, y }).add(e, Crate, { loot, hp: 10.5 }); return e;
}
export const step = (w: World, n = 1): void => { for (let i = 0; i < n; i++) w.step(1 / 20); };
