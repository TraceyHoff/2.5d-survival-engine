/**
 * Terrain-edit bench: 100 players spread over 16x16 chunks (512x512 tiles), each digging near itself.
 * Rates: "realistic" = one tile per player per second (5 edits/tick @20 Hz), "frenzy" = one per player per tick.
 * Reports server+100 clients wall ms per server tick (loopback, all worlds stepped) (snapshots + tiles) and the tile channel's bytes/client/tick.
 * Strict timing ceilings only with PERF=1.
 */
import { describe, expect, it } from "vitest";
import { Owner, Transform, type Entity } from "@engine/core";
import { TileMap } from "@engine/world";
import { LoopbackNetwork, NetClient, NetServer, TileSync } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

const PERF = process.env["PERF"] === "1";
async function run(editsPerTick: number) {
  const net = new LoopbackNetwork(17); const sw = makeWorld(); const tiles = new TileMap(); const players: Entity[] = [];
  for (let cy = 0; cy < 16; cy++) for (let cx = 0; cx < 16; cx++) { const c = tiles.ensureChunk(cx, cy); c.tiles.fill(1 + ((cx + cy) % 3)); for (let i = 0; i < 1024; i += 37) c.tiles[i] = 7; }
  tiles.tileChanges();
  const server = new NetServer({ world: sw, transport: net.createServer(), interest: { radius: 2, hysteresis: 0 },
    onClientJoin: (s, w) => { const e = w.create(); const i = s.clientId - 1; w.add(e, Transform, { x: 24 + (i % 10) * 48, y: 24 + Math.floor(i / 10) * 48 }).add(e, Owner, { clientId: s.clientId }); players.push(e); } });
  const sync = new TileSync(server, { tiles });
  const cs: NetClient[] = [];
  for (let i = 0; i < 100; i++) { const c = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 30 }) }); await join(net, c); cs.push(c); }
  const step = (k: number) => frames(net, [sw, ...cs.map((c) => c.world)], k);
  step(60); // initial streaming done
  let rng = 3; const r = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const b0 = cs.map((_, i) => sync.sessionStats(i + 1)!.bytes);
  const dc0 = sync.stats.deltaChunks; const N = 100; let ms = 0;
  for (let t = 0; t < N; t++) {
    for (let k = 0; k < editsPerTick; k++) {
      const p = sw.get(players[Math.floor(r() * players.length)]!, Transform)!;
      tiles.setTile(Math.floor(p.x + r() * 6 - 3), Math.floor(p.y + r() * 6 - 3), 10 + Math.floor(r() * 20));
    }
    const t0 = performance.now(); const tk = sw.tick; let guard = 0; while (sw.tick === tk && guard++ < 10) step(1); ms += performance.now() - t0;
  }
  const dc = sync.stats.deltaChunks - dc0;
  const per = cs.map((_, i) => (sync.sessionStats(i + 1)!.bytes - b0[i]!) / N);
  const avg = per.reduce((a, b) => a + b, 0) / per.length;
  // correctness spot check on one client
  step(10);
  let bad = 0; for (const c of cs[0]!.tiles.tiles.loadedChunks()) { const s = tiles.getChunkByKey(c.key)!; for (let i = 0; i < 1024; i++) if (s.tiles[i] !== c.tiles[i]) bad++; }
  return { editsPerTick, msPerTick: +(ms / N).toFixed(2), tileBytesPerClientTick: +avg.toFixed(1), maxClientBytesPerTick: +Math.max(...per).toFixed(1), deltaChunksPerTick: +(dc / N).toFixed(1), bad };
}

describe("tile edit bench (100 players digging)", () => {
  it("realistic (5 edits/tick) and frenzy (100 edits/tick)", async () => {
    for (const rate of [5, 100]) {
      const r = await run(rate); console.log(JSON.stringify(r));
      expect(r.bad).toBe(0);
      expect(r.tileBytesPerClientTick).toBeLessThan(rate === 5 ? 20 : 200);
      if (PERF) expect(r.msPerTick).toBeLessThan(rate === 5 ? 25 : 40);
    }
  }, 120_000);
});
