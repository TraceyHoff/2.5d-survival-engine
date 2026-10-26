/**
 * ADR-178: the client replica's terrain lookup over replicated tiles, so prediction runs the same swim speed /
 * water collision as the server (which reads ChunkManager via TerrainRes). Tiles not yet replicated read 0 (land).
 */
import { terrainFromTileMap, type Terrain } from "@engine/gameplay";
import type { TileMap } from "@engine/world";

export function replicaTerrain(tiles: () => TileMap | undefined): Terrain {
  const cache = new WeakMap<TileMap, Terrain>();
  const of = (): Terrain | undefined => { const m = tiles(); if (!m) return undefined; let t = cache.get(m); if (!t) cache.set(m, (t = terrainFromTileMap(m))); return t; };
  return { tileAt: (x, y) => of()?.tileAt(x, y) ?? 0, heightAt: (x, y) => of()?.heightAt(x, y) ?? 0 };
}
