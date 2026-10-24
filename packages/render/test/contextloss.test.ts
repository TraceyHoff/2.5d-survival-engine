import { describe, it, expect } from "vitest";
import { AtlasManager } from "../src/assets/atlasManager.js";
import { PageLRU } from "../src/gl/vram.js";

/** Context loss / restore on the render side (Engine Architect's recovery reloads the client on restore; these keep the
 *  pools honest in the window before that and for embedders that keep the AtlasManager). */
function setup() {
  const canvas = new EventTarget() as EventTarget & { lost?: boolean };
  const gl = { canvas, getParameter: () => 4096, isContextLost: () => !!canvas.lost, getError: () => 0x9242, NO_ERROR: 0, deleteTexture: () => {} } as never;
  const am = new AtlasManager(gl, { registerLoader: () => {} } as never, { textureBudgetMB: 200 }) as any;
  const lru = new PageLRU<string>(4); const pool = { cls: "stream", lru, slotBytes: 1 << 20, k: 1 };
  const mk = (key: string, base: number, state: 0 | 1 | 2) => ({ key, id: base, source: { url: key }, base, count: 1, fw: 8, fh: 8, cols: 1, scale: 1, px: 0, py: 0, layer: state === 2 ? 3 : -1, masks: {}, emis: null, lazy: { w1: 8, h1: 8, state, pool: 4 } });
  const res = mk("res", 0, 2), queued = mk("queued", 1, 1), idle = mk("idle", 2, 0);
  am.atlases = [res, queued, idle]; am.pools = [pool]; am.poolOfA = () => pool; am.poolOn = () => true; am.table = new Float32Array(3 * 8).fill(1); am.tintRowMap = new Map(); am.markTable = () => {};
  lru.allocate("res", 0, 0); am.vram.pageIn(pool.slotBytes); am.queue = [queued];
  return { canvas, am, pool, res, queued, idle };
}
const lose = (c: EventTarget & { lost?: boolean }) => { c.lost = true; c.dispatchEvent(new Event("webglcontextlost")); };
const restore = (c: EventTarget & { lost?: boolean }) => { c.lost = false; c.dispatchEvent(new Event("webglcontextrestored")); };

describe("atlas pools across WebGL context loss / restore", () => {
  it("loss: page-ins stop (queue dropped, in-flight cancelled by gen), no new requests or pumps", () => {
    const { canvas, am, queued, idle } = setup(); const g = am.gen;
    lose(canvas);
    expect(am.contextLost).toBe(true); expect(am.gen).toBe(g + 1); expect(am.queue).toEqual([]); expect(queued.lazy.state).toBe(0);
    am.request(idle, 0); expect(am.queue).toEqual([]); expect(am.ctxStats.losses).toBe(1);
  });
  it("an upload that finishes on a lost context frees its slot quietly: no page fault, no fallback-ladder step", () => {
    const { canvas, am, pool, res } = setup(); let faults = 0; am.onFault = () => { faults++; };
    lose(canvas); const pf = am.pageFaults ?? 0;
    expect(am.droppedByLoss(res, pool)).toBe(true);
    expect(pool.lru.has("res")).toBe(false); expect(res.lazy.state).toBe(0); expect(am.pageFaults ?? 0).toBe(pf); expect(faults).toBe(0); expect(am.ctxStats.uploadsSkipped).toBe(1);
  });
  it("restore: every streamed/wear page is forgotten (LRU empty, VRAM evicted, fallback frames) and flagged for re-upload", () => {
    const { canvas, am, pool, res } = setup();
    lose(canvas); restore(canvas);
    expect(am.contextLost).toBe(false); expect(am.needsReupload).toBe(true); expect(pool.lru.size).toBe(0);
    expect(res.lazy.state).toBe(0); expect(res.layer).toBe(-1); expect(am.vram.streamedBytes).toBe(0); expect(am.ctxStats.pagesDropped).toBe(1);
    expect([...am.table.subarray(0, 8)]).toEqual(new Array(8).fill(0)); // resident page's frame-table rows cleared (fallback draws)
    // requests work again after the restore
    am.pump = () => {}; am.request(res, 0); expect(am.queue).toContain(res);
  });
  it("dispose() removes the canvas listeners", () => {
    const { canvas, am } = setup(); am.dispose(); lose(canvas); expect(am.ctxStats.losses).toBe(0);
  });
});
