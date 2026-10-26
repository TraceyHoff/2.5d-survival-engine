import { AsyncReadback } from "@engine/render";
/** Never silently black: on-screen overlay for renderer exceptions, lost contexts and all-black frames, with GPU diagnostics. */
import { mountUi } from "./ui-root.js";
let box: HTMLDivElement | undefined; const seen = new Set<string>();
export function showRenderError(title: string, detail: string): void {
  const k = title + detail; if (seen.has(k)) return; seen.add(k);
  if (!box) {
    box = document.createElement("div"); box.id = "render-error";
    box.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:50;max-width:min(92vw,640px);background:#2a1d17ee;color:#ffe9c9;font:13px/1.4 system-ui,sans-serif;padding:12px 14px;border:2px solid #e8833a;border-radius:10px;white-space:pre-wrap;word-break:break-word";
    mountUi(box);
  }
  box.textContent += `${box.textContent ? "\n\n" : ""}⚠ ${title}\n${detail}\nTry ?renderer=debug or ?safe=1 — please report this text.`;
  console.error("[render]", title, detail);
}
export function glInfo(gl: WebGL2RenderingContext | undefined): string {
  if (!gl) return "renderer: Canvas2D sprites (no WebGL2)";
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const r = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return `GPU: ${String(r)} | maxTex ${gl.getParameter(gl.MAX_TEXTURE_SIZE)} | maxRB ${gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)} | canvas ${gl.drawingBufferWidth}x${gl.drawingBufferHeight} | dpr ${devicePixelRatio} | glError 0x${gl.getError().toString(16)}`;
}
/** Samples a 5x5 grid of the just-drawn default framebuffer (same task, so it is still valid). */
export function frameIsBlack(gl: WebGL2RenderingContext | undefined): boolean {
  if (!gl) return false;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4);
  for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) {
    gl.readPixels(Math.floor((w * i) / 6), Math.floor((h * j) / 6), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (px[0]! + px[1]! + px[2]! > 12) return false;
  }
  return true;
}

/** ADR-148: the same 5x5 grid via a non-blocking readback (PBO + fence; no CPU/GPU stall). start() right after a frame,
 *  poll() on later frames: null while the GPU is busy, else whether that frame was black. */
export class BlackFrameCheck {
  private rb: AsyncReadback | undefined;
  constructor(readonly gl: WebGL2RenderingContext | undefined) {}
  get pending(): boolean { return !!this.rb?.pending; }
  start(): void {
    const gl = this.gl; if (!gl || this.pending) return; this.rb ??= new AsyncReadback(gl);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight; const pts: [number, number][] = [];
    for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) pts.push([Math.floor((w * i) / 6), Math.floor((h * j) / 6)]);
    this.rb.start([{ fbo: null, pts }]);
  }
  poll(): boolean | null { const px = this.rb?.poll(); if (!px) return null; return px.every((p) => p[0] + p[1] + p[2] <= 12); }
}
