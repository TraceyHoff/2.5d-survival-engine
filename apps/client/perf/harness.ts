/**
 * Headless singleplayer perf harness (ADR-105): the real in-tab local server (createLocalServer) with population,
 * virtual-player bots, a human ClientSession and parked/driven vehicles, stepped on a virtual clock.
 * Reports ms/tick for the server sim (per system), the bot agent loop, bot replica worlds, the player client
 * (snapshot decode + step), NetServer snapshot capture/encode, and heap/GC.
 */
import { MemoryWorldStore } from "@engine/persist";
import { VEHICLE_DEFS, spawnVehicle } from "@engine/gameplay";
import { createLocalServer } from "../src/local.js";
import { ClientSession, type KeyValue } from "../src/session.js";

class MapStorage implements KeyValue { m = new Map<string, string>(); getItem(k: string): string | null { return this.m.get(k) ?? null; } setItem(k: string, v: string): void { this.m.set(k, v); } }

export interface PerfReport {
  ticks: number; wallMs: number;
  serverMsPerTick: number; serverP95: number; botsMsPerTick: number; clientMsPerTick: number; totalMsPerTick: number;
  netCaptureMsPerTick: number; netSendMsPerTick: number;
  systems: { name: string; msPerTick: number }[];
  entities: number; bots: number; heapDeltaMB: number; gcCount: number; gcMs: number;
}

export async function runPerfSession(o: { seconds?: number; bots?: number; vehicles?: number; warmupSeconds?: number } = {}): Promise<PerfReport> {
  const local = await createLocalServer({ store: new MemoryWorldStore(), seed: 7, mode: "singleplayer", bots: o.bots ?? 8 });
  const session = new ClientSession({ storage: new MapStorage(), slot: "1", sampleButtons: () => 0 });
  const connecting = session.connect("local", "Perf", local.createTransport());
  let world; for (let i = 0; i < 200 && !world; i++) { local.pump(5); world = await Promise.race([connecting, Promise.resolve(undefined)]); }
  world ??= await connecting;
  const sw = local.game.world;
  const defs = VEHICLE_DEFS.length;
  for (let i = 0; i < (o.vehicles ?? 6) && defs > 0; i++) spawnVehicle(sw, i % defs + 1, 10 + i * 3, 22, 0);
  const frame = async (): Promise<void> => { local.pump(50); world!.step(1 / 20); session.poll(); await Promise.resolve(); };
  for (let t = 0; t < (o.warmupSeconds ?? 10) * 1000; t += 50) await frame(); // population/bots settle, JIT warms

  const sys = new Map<string, number>();
  sw.profiler = (n, ms) => sys.set(n, (sys.get(n) ?? 0) + ms);
  const net = local.game.net as unknown as { perf: { captureMs: number; sendMs: number } };
  let capture = 0, send = 0;
  const tick0 = sw.tick; const tt0 = local.game.tickTimes.length; local.game.tickTimes.length = 0; void tt0;
  let gcCount = 0, gcMs = 0; let obs: { disconnect(): void } | undefined;
  try {
    const { PerformanceObserver } = await import("node:perf_hooks");
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { gcCount++; gcMs += e.duration; } }); po.observe({ entryTypes: ["gc"] }); obs = po;
  } catch { /* browser */ }
  const heap0 = (globalThis as { process?: { memoryUsage(): { heapUsed: number } } }).process?.memoryUsage().heapUsed ?? 0;
  let botsMs = 0, clientMs = 0; const t0 = performance.now();
  for (let t = 0; t < (o.seconds ?? 60) * 1000; t += 50) {
    const a = performance.now(); local.pump(50); const b = performance.now();
    world.step(1 / 20); session.poll(); clientMs += performance.now() - b;
    botsMs += b - a; capture += net.perf.captureMs; send += net.perf.sendMs;
    await Promise.resolve();
  }
  const wallMs = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 0)); // deliver queued gc entries
  sw.profiler = undefined; obs?.disconnect();
  const heap1 = (globalThis as { process?: { memoryUsage(): { heapUsed: number } } }).process?.memoryUsage().heapUsed ?? 0;
  const ticks = sw.tick - tick0;
  const tt = [...local.game.tickTimes].sort((x, y) => x - y);
  const server = tt.reduce((s, x) => s + x, 0);
  const r: PerfReport = {
    ticks, wallMs, serverMsPerTick: server / ticks, serverP95: tt[Math.floor(tt.length * 0.95)] ?? 0,
    botsMsPerTick: (botsMs - server) / ticks, clientMsPerTick: clientMs / ticks, totalMsPerTick: wallMs / ticks,
    netCaptureMsPerTick: capture / ticks, netSendMsPerTick: send / ticks,
    systems: [...sys].map(([name, ms]) => ({ name, msPerTick: ms / ticks })).sort((x, y) => y.msPerTick - x.msPerTick),
    entities: sw.entityCount, bots: local.bots.length, heapDeltaMB: (heap1 - heap0) / 2 ** 20, gcCount, gcMs,
  };
  session.disconnect(); await local.stop();
  return r;
}

export function formatReport(r: PerfReport, top = 15): string {
  const f = (x: number): string => x.toFixed(3);
  return [`ticks ${r.ticks}  entities ${r.entities}  bots ${r.bots}`,
    `total ${f(r.totalMsPerTick)} ms/tick | server sim ${f(r.serverMsPerTick)} (p95 ${f(r.serverP95)}) | bots(agents+replicas+loopback) ${f(r.botsMsPerTick)} | player client ${f(r.clientMsPerTick)}`,
    `net capture ${f(r.netCaptureMsPerTick)} send/encode ${f(r.netSendMsPerTick)} ms/tick | heap Δ ${r.heapDeltaMB.toFixed(1)} MB  gc ${r.gcCount}x ${r.gcMs.toFixed(0)} ms`,
    ...r.systems.slice(0, top).map((s) => `  ${s.name.padEnd(32)} ${f(s.msPerTick)}`)].join("\n");
}
