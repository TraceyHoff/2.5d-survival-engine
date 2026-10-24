/**
 * World integration: ProceduralGenerator bands from data/worldgen.json, ChunkManager hooks that spawn resource
 * nodes on load (authority) and despawn them on unload, and the terrain lookup used by building validation.
 */
import { defineResource, entityIndex, Transform, type Entity, type World } from "@engine/core";
import { chunkKeyOf, tileToChunk, tileToLocal, type ChunkKey, type ChunkManager, type NodePlacement, type ProceduralOptions, type TileMap } from "@engine/world";
import { ResourceNode } from "./components.js";
import { gameplayDefs, isAuthority } from "./config.js";
import type { GameDefs } from "./defs.js";
import { spawnResourceNode } from "./spawn.js"; // not ./install.js: that edge made an ESM cycle (CROP_EVERY TDZ, ADR-115)

/** Bands for `new ProceduralGenerator({ seed, bands: worldgenBands(defs) })` (node kinds = resource ids). */
export function worldgenBands(defs: GameDefs): NonNullable<ProceduralOptions["bands"]> {
  return defs.worldgen.bands.map((b) => ({ max: b.max, tile: b.tile, nodeKinds: [...b.nodes], nodeChance: b.nodeChance }));
}

export interface Terrain { tileAt(tx: number, ty: number): number; heightAt(tx: number, ty: number): number }
export const TerrainRes = defineResource<Terrain>("gameplay.Terrain");
export function terrainFromTileMap(map: TileMap): Terrain {
  return {
    tileAt: (tx, ty) => map.getTile(tx, ty),
    heightAt: (tx, ty) => map.getChunk(tileToChunk(tx), tileToChunk(ty))?.getHeight(tileToLocal(tx), tileToLocal(ty)) ?? 0,
  };
}

/** Resource nodes spawned per chunk (so unload despawns them). */
export const ChunkNodes = defineResource<Map<ChunkKey, Entity[]>>("gameplay.ChunkNodes");

/**
 * Hooks gameplay into a ChunkManager: terrain lookup, node spawning on load (authority only; clients receive
 * nodes by replication) and despawn on unload. Returns a detach function.
 */
export function attachWorldStreaming(world: World, chunks: ChunkManager): () => void {
  world.setResource(TerrainRes, terrainFromTileMap(chunks));
  if (!world.getResource(ChunkNodes)) world.setResource(ChunkNodes, new Map());
  const offLoad = chunks.onLoad((chunk, nodes) => { if (isAuthority(world)) spawnChunkNodes(world, chunk.key, nodes); });
  const offUnload = chunks.onUnload((chunk) => despawnChunkNodes(world, chunk.key));
  return () => { offLoad(); offUnload(); };
}

export function spawnChunkNodes(world: World, key: ChunkKey, nodes: readonly NodePlacement[]): Entity[] {
  const defs = gameplayDefs(world); const out: Entity[] = [];
  for (const n of nodes) if (defs.resources.has(n.kind)) out.push(spawnResourceNode(world, n.kind, n.tx + 0.5, n.ty + 0.5));
  let m = world.getResource(ChunkNodes); if (!m) world.setResource(ChunkNodes, (m = new Map()));
  m.set(key, [...(m.get(key) ?? []), ...out]);
  return out;
}
export function despawnChunkNodes(world: World, key: ChunkKey): number {
  const m = world.getResource(ChunkNodes); const l = m?.get(key); if (!l) return 0;
  let n = 0; for (const e of l) if (world.isAlive(e) && world.has(e, ResourceNode)) { world.destroy(e); n++; }
  m!.delete(key); return n;
}
/** Chunk key of an entity's position. */
export function chunkOfEntity(world: World, e: Entity): ChunkKey | undefined {
  const tf = world.store(Transform); const s = tf.slot(entityIndex(e)); if (s < 0) return undefined;
  return chunkKeyOf(tf.data.x[s]!, tf.data.y[s]!);
}
