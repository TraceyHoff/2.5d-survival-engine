/**
 * Headless server-only replication benchmark: many fake sessions (no client sims), auto-acking 2 ticks late.
 * Prints ms/tick and bytes/client/tick; assertions are deliberately loose (CI noise) - read the log.
 */
import { describe, expect, it } from "vitest";
import { Owner, Rng, Transform, World, type Entity } from "@engine/core";
import { NetServer, encodeHello, encodeInput, type Channel, type ConnId, type ServerTransport } from "../src/index.js";
import { DT, makeWorld } from "./fixture.js";

class FakeTransport implements ServerTransport {
  bytes = new Map<ConnId, number>();
  private msg: ((c: ConnId, b: Uint8Array, ch: Channel) => void)[] = [];
  onConnect(): void {} onDisconnect(): void {}
  onMessage(fn: (c: ConnId, b: Uint8Array, ch: Channel) => void): void { this.msg.push(fn); }
  send(c: ConnId, b: Uint8Array): void { this.bytes.set(c, (this.bytes.get(c) ?? 0) + b.length); }
  disconnect(): void {} close(): void {}
  inject(c: ConnId, b: Uint8Array): void { for (const f of this.msg) f(c, b, "reliable"); }
}

interface Scenario { name: string; clients: number; entities: number; worldTiles: number; clusterTiles?: number; movingFraction: number; budget?: number }

function run(sc: Scenario) {
  const w: World = makeWorld(); const rng = new Rng(99);
  const t = new FakeTransport();
  const players: Entity[] = [];
  const spread = (): number => rng.range(0, sc.worldTiles);
  const server = new NetServer({ world: w, transport: t, randomToken: () => new Uint8Array(16).fill(1 + players.length % 200),
    ...(sc.budget !== undefined && { budgetBytes: sc.budget }),
    onClientJoin: (s, world) => {
      const c = sc.clusterTiles; const e = world.create();
      world.add(e, Transform, { x: c ? rng.range(0, c) : spread(), y: c ? rng.range(0, c) : spread() }).add(e, Owner, { clientId: s.clientId });
      players.push(e);
    } });
  const ents: Entity[] = [];
  for (let i = 0; i < sc.entities; i++) { const e = w.create(); w.add(e, Transform, { x: spread(), y: spread() }); ents.push(e); }
  for (let c = 1; c <= sc.clients; c++) t.inject(c, encodeHello({ hashes: server.requiredHashes, token: new Uint8Array(16) }));
  const moving = Math.floor(sc.entities * sc.movingFraction);
  const tick = (): void => {
    for (let i = 0; i < moving; i++) { const e = ents[rng.int(0, ents.length)]!; w.setField(e, Transform, "x", w.getField(e, Transform, "x")! + rng.range(-0.2, 0.2)); }
    for (const p of players) w.setField(p, Transform, "y", w.getField(p, Transform, "y")! + 0.2);
    w.step(DT);
    for (let c = 1; c <= sc.clients; c++) t.inject(c, encodeInput({ ackTick: Math.max(0, w.tick - 3), cmds: [] }));
  };
  for (let i = 0; i < 30; i++) tick(); // warm-up incl. initial full snapshots
  t.bytes.clear();
  const N = 40; const t0 = performance.now(); let capture = 0; let enc = 0, shared = 0;
  for (let i = 0; i < N; i++) { tick(); capture += server.perf.captureMs; enc += server.perf.encoded; shared += server.perf.shared; }
  const ms = (performance.now() - t0) / N;
  const total = [...t.bytes.values()].reduce((a, b) => a + b, 0);
  const perClient = total / sc.clients / N;
  const r = { scenario: sc.name, msPerTick: +ms.toFixed(2), captureMsPerTick: +(capture / N).toFixed(2), bytesPerClientTick: Math.round(perClient), kbpsPerClient: +(perClient * 20 * 8 / 1000).toFixed(1), encodesPerTick: Math.round(enc / N), sharedPerTick: Math.round(shared / N) };
  console.log(JSON.stringify(r));
  return r;
}

/** Strict timing ceilings only with PERF=1 (`pnpm bench`); otherwise a loose sanity bound so parallel CI stays green. */
const PERF = process.env["PERF"] === "1";

describe("replication benchmark (server only)", () => {
  it("100 clients x 10k entities spread over a large world", () => {
    const r = run({ name: "100c x 10k spread (2048x2048 tiles)", clients: 100, entities: 10_000, worldTiles: 2048, movingFraction: 0.1 });
    expect(r.msPerTick).toBeLessThan(PERF ? 30 : 500); // ~13 ms on the dev box
    expect(r.bytesPerClientTick).toBeLessThan(4000);
  }, 60_000);
  it("100 clients clustered in one area with 10k entities (worst case, budgeted)", () => {
    const r = run({ name: "100c clustered x 10k (512x512, 4 KiB budget)", clients: 100, entities: 10_000, worldTiles: 512, clusterTiles: 64, movingFraction: 0.1, budget: 4096 });
    expect(r.bytesPerClientTick).toBeLessThanOrEqual(4096 + 64);
    expect(r.msPerTick).toBeLessThan(PERF ? 60 : 500); // ~25 ms on the dev box
    expect(r.sharedPerTick).toBeGreaterThan(r.encodesPerTick * 5); // per-(state,baseline) encodings are reused across clients
  }, 120_000);
});

/** AOI radius bonus (watchtower): half the clients flicker on/off a tower every 10 ticks. Chunk churn with vs without hysteresis. */
function towerFlicker(holdTicks: number) {
  const w: World = makeWorld(); const rng = new Rng(7); const t = new FakeTransport(); let n = 0;
  const server = new NetServer({ world: w, transport: t, randomToken: () => new Uint8Array(16).fill(1 + n % 200), viewBonus: { max: 2, holdTicks },
    onClientJoin: (s, world) => { n++; const e = world.create(); world.add(e, Transform, { x: rng.range(0, 2048), y: rng.range(0, 2048) }).add(e, Owner, { clientId: s.clientId }); } });
  for (let i = 0; i < 5000; i++) { const e = w.create(); w.add(e, Transform, { x: rng.range(0, 2048), y: rng.range(0, 2048) }); }
  const C = 100; for (let c = 1; c <= C; c++) t.inject(c, encodeHello({ hashes: server.requiredHashes, token: new Uint8Array(16) }));
  const ids = () => [...server.sessions.keys()];
  const tick = (k: number): void => {
    if (k % 10 === 0) for (const id of ids()) if (id % 2) server.setViewRadiusBonus(id, (k / 10) % 2 ? 0 : 9); // 9 -> capped at 2
    w.step(DT); for (let c = 1; c <= C; c++) t.inject(c, encodeInput({ ackTick: Math.max(0, w.tick - 3), cmds: [] }));
  };
  for (let k = 0; k < 30; k++) tick(k);
  let churn = 0; const N = 120; const t0 = performance.now();
  for (let k = 30; k < 30 + N; k++) { tick(k); for (const id of ids()) { const g = server.interest!.grid.get(id)!; churn += g.enteredChunks.length + g.leftChunks.length; } }
  const r = { scenario: `100c tower flicker (hold ${holdTicks})`, msPerTick: +((performance.now() - t0) / N).toFixed(2), chunkChurnPerTick: +(churn / N).toFixed(1), maxBonus: Math.max(...ids().map((id) => server.viewRadiusBonus(id))) };
  console.log(JSON.stringify(r));
  for (const id of ids()) server.setViewRadiusBonus(id, 0); // leave the tower for good: bonus drops after holdTicks
  for (let k = 0; k <= holdTicks; k++) { w.step(DT); for (let c = 1; c <= C; c++) t.inject(c, encodeInput({ ackTick: Math.max(0, w.tick - 3), cmds: [] })); }
  return { ...r, afterLeave: Math.max(...ids().map((id) => server.viewRadiusBonus(id))) };
}
describe("AOI radius bonus benchmark", () => {
  it("capped server-side; hysteresis keeps a flickering tower bonus from thrashing chunks", () => {
    const held = towerFlicker(60), raw = towerFlicker(0);
    expect(held.maxBonus).toBe(2); // asked for 9
    expect(held.afterLeave).toBe(0); expect(raw.afterLeave).toBe(0);
    expect(held.chunkChurnPerTick).toBeLessThan(raw.chunkChurnPerTick / 4);
    expect(held.msPerTick).toBeLessThan(PERF ? 30 : 500);
  }, 60_000);
});
