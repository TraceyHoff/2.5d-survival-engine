/**
 * ADR-148: non-blocking pixel readback (WebGL2 PIXEL_PACK_BUFFER + fence). readPixels into a pack buffer only queues a
 * GPU copy; the data is fetched with getBufferSubData once the fence has signalled (polled each frame with a 0 timeout),
 * so the CPU never waits for the GPU to drain the frame. A synchronous readPixels to client memory stalls the whole
 * pipeline (a full frame on tile-based mobile GPUs) - the once-a-second blank-frame watchdog was a periodic hitch.
 */
export type Rgba = [number, number, number, number];

export class AsyncReadback {
  private buf: WebGLBuffer | null = null; private fence: WebGLSync | null = null; private n = 0; private cap = 0;
  constructor(private gl: WebGL2RenderingContext) {}
  /** True while a read is queued and not yet collected. */
  get pending(): boolean { return this.fence !== null; }
  /** Queue reads of 1x1 pixels at `pts` (device px) from the bound read framebuffer(s); `reads` = one entry per FBO. */
  start(reads: { fbo: WebGLFramebuffer | null; pts: readonly [number, number][] }[]): boolean {
    const gl = this.gl; if (this.fence) return false;
    const total = reads.reduce((t, r) => t + r.pts.length, 0);
    if (!this.buf || total > this.cap) { if (this.buf) gl.deleteBuffer(this.buf); this.buf = gl.createBuffer(); this.cap = total; }
    // re-specify (orphan) every read: ANGLE drops its readback shadow copy when a fenced buffer is written again
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buf); gl.bufferData(gl.PIXEL_PACK_BUFFER, this.cap * 4, gl.STREAM_READ);
    let off = 0;
    for (const r of reads) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo); if (r.fbo) gl.readBuffer(gl.COLOR_ATTACHMENT0);
      for (const [x, y] of r.pts) { gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, off); off += 4; }
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.n = total; this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
    if (!this.fence) return false;
    return true;
  }
  /** The pixels of the queued read once the GPU has finished it (never blocks), else null. */
  poll(): Rgba[] | null {
    const gl = this.gl; const f = this.fence; if (!f || !this.buf) return null;
    const s = gl.clientWaitSync(f, 0, 0);
    if (s !== gl.ALREADY_SIGNALED && s !== gl.CONDITION_SATISFIED) { if (s === gl.WAIT_FAILED) { gl.deleteSync(f); this.fence = null; } return null; }
    gl.deleteSync(f); this.fence = null;
    const px = new Uint8Array(this.n * 4); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buf); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const out: Rgba[] = []; for (let i = 0; i < this.n; i++) out.push([px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!, px[i * 4 + 3]!]);
    return out;
  }
  /** Drop a queued read (context loss / resize) and free the GL objects. */
  dispose(): void { const gl = this.gl; if (this.fence) gl.deleteSync(this.fence); this.fence = null; if (this.buf) gl.deleteBuffer(this.buf); this.buf = null; this.cap = 0; }
}
