import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteWorldStore } from "../src/node.js";
import { buildBase, makeWorld, spawnCrate, step, PIECES } from "./helpers.js";

const PERF = process.env["PERF"] === "1";
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("autosave benchmark", () => {
  it("500 dirty chunks: autosave never blocks a tick for more than ~2 ms (encode budgeted, commit on worker)", async () => {
    const d = mkdtempSync(join(tmpdir(), "persist-bench-")); dirs.push(d);
    const store = await SqliteWorldStore.open(join(d, "bench.db"));
    // 23x23 = 529 resident chunks around one source.
    const a = makeWorld(store, { loadRadius: 11, cacheSize: 0, encodeBudgetMs: 1.5 });
    a.chunks.setSource({ id: 1, x: 16, y: 16 }); step(a.world);
    const keys = [...a.chunks.loadedChunks()].slice(0, 500);
    const foundation = PIECES.byKey("foundation").id;
    let k = 0;
    for (const c of keys) {
      const ox = c.cx * 32, oy = c.cy * 32;
      c.set(k % 32, (k * 7) % 32, 60 + (k % 5));
      for (let i = 0; i < 40; i++) a.buildings.place(foundation, ox + (i % 8), oy + Math.floor(i / 8), 0); // a small hut per chunk
      spawnCrate(a.world, ox + 20.5, oy + 20.5, k); k++;
    }
    buildBase(a.buildings, 3, 3, 3000); // plus one big base
    step(a.world);
    // single big-chunk encode cost (worst single unit of work)
    const t0 = performance.now(); for (let i = 0; i < 10; i++) a.persist.encode("3,3"); const bigMs = (performance.now() - t0) / 10; // includes JIT warm-up

    a.persist.resetMaxTick();
    expect(a.persist.beginRound()).toBe(true);
    const tickMs: number[] = []; let ticks = 0;
    while (a.persist.roundInProgress && ticks < 1000) { step(a.world); tickMs.push(a.persist.stats.lastTickMs); ticks++; }
    const w0 = performance.now(); await store.flush(); const waitMs = performance.now() - w0;
    const sorted = [...tickMs].sort((x, y) => x - y); const p95 = sorted[Math.floor(sorted.length * 0.95)]!; const max = sorted[sorted.length - 1]!;
    const st = a.persist.stats, ss = store.stats();
    console.log(`[bench] autosave ${st.lastRoundChunks} dirty chunks over ${st.lastRoundTicks} ticks: encode total ${st.lastRoundEncodeMs.toFixed(1)} ms, ` +
      `per-tick p95 ${p95.toFixed(2)} ms, max ${max.toFixed(2)} ms; 3000-piece chunk encode ${bigMs.toFixed(2)} ms; ` +
      `worker commit ${ss.lastCommitMs.toFixed(1)} ms (${(ss.bytesWritten / 1024).toFixed(0)} KiB), main-thread wait after last tick ${waitMs.toFixed(1)} ms`);
    expect(st.lastRoundChunks).toBeGreaterThanOrEqual(500);
    expect(store.count("chunks")).toBeGreaterThanOrEqual(500);
    // Strict ~2 ms ceiling only with PERF=1 (`pnpm bench`): under the parallel `pnpm check` other suites steal the CPU.
    if (PERF) { expect(p95).toBeLessThan(2.5); expect(max).toBeLessThan(3.5); }
    else { expect(p95).toBeLessThan(50); expect(max).toBeLessThan(50); }
    await store.close();
  }, 30000);
});
