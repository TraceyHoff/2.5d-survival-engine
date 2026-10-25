import { describe, it, expect } from "vitest";
import { CHUNK_SIZE, type TileMap } from "@engine/world";
import { groundZ } from "../src/view.js";

describe("ADR-142 build ghost is lifted onto the terrain step like placed pieces", () => {
  const height = new Array(CHUNK_SIZE * CHUNK_SIZE).fill(1);
  const tiles = { getChunk: () => ({ height }) } as unknown as TileMap;
  it("raised ground lifts a z=0 preview to the tile height (was buried under terrain)", () => { expect(groundZ(tiles, 3.5, 2.5, 0)).toBe(1); });
  it("upper floors stay above ground; no tiles → sim z", () => { expect(groundZ(tiles, 3.5, 2.5, 4)).toBe(4); expect(groundZ(undefined, 1, 1, 0)).toBe(0); });
});
