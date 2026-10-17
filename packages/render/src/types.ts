import type { World } from "@engine/core";
import type { FrameStats } from "./gl/util.js";

/** Renderer contract: read-only consumer of the World, driven by createGameLoop's render(world, alpha). */
export interface Renderer {
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  render(world: World, alpha: number): void;
  dispose(): void;
  readonly stats: FrameStats;
}

/** Headless/server placeholder (no GPU). */
export class NullRenderer implements Renderer {
  frames = 0;
  readonly stats: FrameStats = { drawCalls: 0, sprites: 0, lights: 0, tiles: 0, chunks: 0, particles: 0, cpuMs: 0 };
  resize(): void {}
  render(): void { this.frames++; }
  dispose(): void {}
}
