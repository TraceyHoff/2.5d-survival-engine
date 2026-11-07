import { expect, it } from "vitest";
import { TileMap } from "@engine/world";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

it("far-world terrain edits and roads no longer alias a tile 65,536 tiles away", () => {
  const w = makeWorld(), map = new TileMap(); const a = [0, 60000] as const, b = [1, -5536] as const;
  map.setTile(...a, 3); map.setTile(...b, 3); w.setResource(G.TerrainRes, G.terrainFromTileMap(map));
  G.setTerrainDig(w, ...a, -3); G.setTerrainDig(w, ...b, 2);
  expect(G.terrainDigAt(w, ...a)).toBe(-3); expect(G.terrainDigAt(w, ...b)).toBe(2);
  const ra = G.spawnRoad(w, ...a, G.RoadSurface.Path), rb = G.spawnRoad(w, ...b, G.RoadSurface.Gravel);
  expect(G.roadAt(w, ...a)).toBe(ra); expect(G.roadAt(w, ...b)).toBe(rb);
  expect(G.roadSpeedMul(w, ...a)).not.toBe(G.roadSpeedMul(w, ...b));
});
