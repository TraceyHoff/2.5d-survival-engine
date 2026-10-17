/**
 * @engine/render — OWNED BY 2.5D Renderer team. Stub interfaces only.
 * Contract: renderer reads a RenderFrame built in the renderPrep phase; it never mutates sim state.
 */
import type { IsoConfig } from "@engine/world";
export interface Sprite { entity: number; atlas: number; frame: number; sx: number; sy: number; depth: number; tint: number }
export interface RenderFrame { alpha: number; camera: { x: number; y: number; zoom: number }; sprites: Sprite[]; ambientLight: number }
export interface Renderer {
  init(canvas: HTMLCanvasElement | OffscreenCanvas, iso: IsoConfig): Promise<void>;
  resize(width: number, height: number, dpr: number): void;
  draw(frame: RenderFrame): void;
  dispose(): void;
}
/** Placeholder until the renderer team lands the WebGL2 backend. */
export class NullRenderer implements Renderer {
  frames = 0;
  async init(): Promise<void> {}
  resize(): void {}
  draw(): void { this.frames++; }
  dispose(): void {}
}
