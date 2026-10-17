import type { World } from "@engine/core";
import { newStats, type FrameStats } from "./gl/util.js";

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
  readonly stats: FrameStats = newStats();
  resize(): void {}
  render(): void { this.frames++; }
  dispose(): void {}
}
