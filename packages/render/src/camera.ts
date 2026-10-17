/**
 * Isometric camera: a 2D pan/zoom over iso pixel space (output of worldToScreen).
 * Owned by the client app (not an ECS component) so input can drive it at frame rate.
 */
import { screenToWorld, worldToScreen, DEFAULT_ISO, type IsoConfig } from "@engine/world";

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export class IsoCamera {
  /** Center of the view in iso pixels. */
  x = 0; y = 0;
  zoom = 1;
  minZoom = 0.25; maxZoom = 4;
  /** Drawing-buffer size in device pixels. */
  viewW = 1; viewH = 1;
  /** CSS->device pixel ratio, so zoom=1 means 1 iso px = 1 CSS px. */
  dpr = 1;

  constructor(readonly iso: IsoConfig = DEFAULT_ISO) {}

  get scale(): number { return this.zoom * this.dpr; }

  setViewport(w: number, h: number, dpr: number): void { this.viewW = w; this.viewH = h; this.dpr = dpr; }

  /** Center the camera on a world (tile-unit) position. */
  lookAt(wx: number, wy: number, wz = 0): void { const s = worldToScreen(wx, wy, wz, this.iso); this.x = s.sx; this.y = s.sy; }

  /** Pan by a CSS-pixel delta (e.g. a mouse drag). */
  panScreen(dxCss: number, dyCss: number): void { this.x -= dxCss / this.zoom; this.y -= dyCss / this.zoom; }

  /** Zoom by factor keeping the iso point under the given CSS pixel fixed. */
  zoomAt(factor: number, cssX: number, cssY: number): void {
    const before = this.cssToIso(cssX, cssY);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.cssToIso(cssX, cssY);
    this.x += before.x - after.x; this.y += before.y - after.y;
  }

  cssToIso(cssX: number, cssY: number): { x: number; y: number } {
    const w = this.viewW / this.dpr, h = this.viewH / this.dpr;
    return { x: this.x + (cssX - w / 2) / this.zoom, y: this.y + (cssY - h / 2) / this.zoom };
  }

  /** World position on ground plane z under a CSS pixel. */
  cssToWorld(cssX: number, cssY: number, z = 0): { x: number; y: number } {
    const p = this.cssToIso(cssX, cssY); return screenToWorld(p.x, p.y, z, this.iso);
  }

  /** Visible rect in iso pixels, expanded by margin (iso px). */
  visibleRect(margin = 0, out: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 }): Rect {
    const hw = this.viewW / (2 * this.scale), hh = this.viewH / (2 * this.scale);
    out.x0 = this.x - hw - margin; out.x1 = this.x + hw + margin;
    out.y0 = this.y - hh - margin; out.y1 = this.y + hh + margin;
    return out;
  }

  /** Uniform for GLSL_COMMON's uView. */
  viewUniform(out: Float32Array): Float32Array {
    out[0] = this.x; out[1] = this.y; out[2] = (2 * this.scale) / this.viewW; out[3] = (-2 * this.scale) / this.viewH;
    return out;
  }
}
