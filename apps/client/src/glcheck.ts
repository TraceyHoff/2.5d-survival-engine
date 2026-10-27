import { AsyncReadback } from "@engine/render";
/** Never silently black: on-screen overlay for renderer exceptions, lost contexts and all-black frames, with GPU diagnostics. */
import { mountUi } from "./ui-root.js";
import { errorLog } from "./error-log.js";
let box: HTMLDivElement | undefined; let hideTimer: ReturnType<typeof setTimeout> | undefined; const lastShown = new Map<string, number>();
/** ADR-198: how long a transient error overlay stays up (was: forever, but deduped once per session). */
export const OVERLAY_MS = 8000;
/** Records every call in the persistent error log; shows (or re-shows, at most every OVERLAY_MS per error) an overlay with the short code. */
export function showRenderError(title: string, detail: string): void {
  const entry = errorLog().record(title, detail);
  console.error("[render]", entry.code, title, detail);
  if (typeof document === "undefined") return;
  const now = Date.now(), prev = lastShown.get(entry.code); if (prev !== undefined && now - prev < OVERLAY_MS) return; lastShown.set(entry.code, now);
  if (!box || !box.isConnected) {
    box = document.createElement("div"); box.id = "render-error";
    box.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:50;max-width:min(92vw,640px);max-height:40vh;overflow:auto;background:#2a1d17ee;color:#ffe9c9;font:13px/1.4 system-ui,sans-serif;padding:12px 14px;border:2px solid #e8833a;border-radius:10px;white-space:pre-wrap;word-break:break-word;pointer-events:auto";
    box.addEventListener("click", () => { box?.remove(); });
    mountUi(box);
  }
  box.textContent += `${box.textContent ? "\n\n" : ""}⚠ ${title} [${entry.code}]\n${detail.slice(0, 600)}\nSaved to Settings → Error log (code ${entry.code}). Try ?renderer=debug or ?safe=1.`;
  if (hideTimer !== undefined) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { box?.remove(); box = undefined; hideTimer = undefined; }, OVERLAY_MS);
}
let lastGpu = "";
export function glInfo(gl: WebGL2RenderingContext | undefined): string {
  if (!gl) return "renderer: Canvas2D sprites (no WebGL2)";
  // ADR-199: a lost context returns null for every parameter ("GPU: null"); remember the GPU from the last live probe
  let r: unknown = gl.isContextLost() ? null : (() => { const dbg = gl.getExtension("WEBGL_debug_renderer_info"); return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })();
  if (r) lastGpu = String(r); else r = lastGpu ? `${lastGpu} (context lost)` : "unknown (context lost)";
  return `GPU: ${String(r)} | maxTex ${gl.getParameter(gl.MAX_TEXTURE_SIZE)} | maxRB ${gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)} | canvas ${gl.drawingBufferWidth}x${gl.drawingBufferHeight} | dpr ${globalThis.devicePixelRatio ?? 1} | glError 0x${gl.getError().toString(16)}`;
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
