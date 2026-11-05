// @vitest-environment jsdom
// Task 26 smoothness: the world map used to redraw every tile (~2700 fillRects) on every rAF while open,
// even when the player stood still. Now it repaints only when an input changed. jsdom has no canvas
// context, so the test stubs getContext with a recording mock and counts fillRect calls across frames.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { World, Transform } from "@engine/core";
import { createWorldMap } from "../src/world-map.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("Task 26: world map repaints only on change", () => {
  let counts = { fillRect: 0, clearRect: 0 };
  let origGetContext: typeof HTMLCanvasElement.prototype.getContext;
  beforeEach(() => {
    counts = { fillRect: 0, clearRect: 0 };
    document.body.innerHTML = "";
    origGetContext = HTMLCanvasElement.prototype.getContext;
    const mock = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "fillRect") return () => { counts.fillRect++; };
        if (prop === "clearRect") return () => { counts.clearRect++; };
        if (typeof prop === "string") return () => undefined;
        return undefined;
      },
      set() { return true; },
    });
    HTMLCanvasElement.prototype.getContext = (() => mock) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  afterEach(() => { HTMLCanvasElement.prototype.getContext = origGetContext; vi.restoreAllMocks(); });

  it("a steady-state map stops repainting; moving the player repaints", async () => {
    const world = new World(); const player = world.create();
    world.add(player, Transform, { x: 10, y: 20, z: 0, facing: 0 });
    // A small mock TileMap: 1 chunk, every tile known (id 1), version 0.
    const tiles = { chunkCount: 1, getTile: () => 1, getChunk: () => ({ version: 0 }) };
    const m = createWorldMap({ world: () => world, player: () => player, tiles: () => tiles as never, send: () => true } as never);
    document.body.append(m.el);
    await sleep(700); // several rAF frames + past the 250 ms idle settle (rose -> north)
    const settled = counts.fillRect;
    expect(settled).toBeGreaterThan(0); // it did paint at least once
    await sleep(400); // more frames, nothing changed
    expect(counts.fillRect).toBe(settled); // steady state: no more tile repaints
    // Move the player: the following centre moves, so the map must repaint.
    world.setField(player, Transform, "x", 16);
    await sleep(200);
    expect(counts.fillRect).toBeGreaterThan(settled);
    m.destroy();
  }, 15000);
});
