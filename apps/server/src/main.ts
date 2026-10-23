/**
 * Headless authoritative server (Node). Usage:
 *   tsx src/main.ts [--port 7777] [--host 0.0.0.0] [--save saves/demo.db | --no-save] [--fresh] [--seed N] [--stats 5]
 * Env: PORT, HOST, SAVE_PATH. SIGINT/SIGTERM => full save, then exit.
 */
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { PROTOCOL_VERSION } from "@engine/net";
import { createGameServer, devBotsFromEnv, type GameMode, type GameServer } from "./game.js";

export { createGameServer } from "./game.js";
export * from "./protocol.js";

export interface ServerArgs { port: number; host: string; save: string | undefined; fresh: boolean; seed: number; statsSec: number; mode: GameMode }
function parseMode(m: string): GameMode { if (m !== "singleplayer" && m !== "multiplayer") throw new Error(`--mode must be singleplayer or multiplayer, got ${m}`); return m; }
export function parseServerArgs(argv: readonly string[], env: Record<string, string | undefined> = {}): ServerArgs {
  const a: ServerArgs = { port: Number(env["PORT"] ?? 7777), host: env["HOST"] ?? "0.0.0.0", save: env["SAVE_PATH"] ?? "saves/demo.db", fresh: false, seed: 1234, statsSec: 5, mode: parseMode(env["GAME_MODE"] ?? "multiplayer") };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!, v = (): string => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === "--") continue;
    if (k === "--port") a.port = Number(v()); else if (k === "--host") a.host = v(); else if (k === "--save") a.save = v();
    else if (k === "--no-save") a.save = undefined; else if (k === "--fresh") a.fresh = true; else if (k === "--seed") a.seed = Number(v());
    else if (k === "--stats") a.statsSec = Number(v()); else if (k === "--mode") a.mode = parseMode(v()); else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

/** Periodic one-line health report: tick timing, clients, bytes per client, persistence. */
export function statsReporter(gs: GameServer, periodSec: number, print: (s: string) => void): () => void {
  let lastTick = gs.world.tick, lastT = performance.now(); const lastBytes = new Map<number, number>();
  const timer = setInterval(() => {
    const now = performance.now(), secs = (now - lastT) / 1000, ticks = gs.world.tick - lastTick;
    const times = gs.tickTimes.splice(0); const sorted = [...times].sort((x, y) => x - y);
    const avg = times.length ? times.reduce((s, x) => s + x, 0) / times.length : 0;
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0, max = sorted[sorted.length - 1] ?? 0;
    let bytes = 0; const live = new Set<number>();
    for (const s of gs.net.sessions.values()) { live.add(s.clientId); bytes += s.stats.bytesSent - (lastBytes.get(s.clientId) ?? 0); lastBytes.set(s.clientId, s.stats.bytesSent); }
    for (const id of [...lastBytes.keys()]) if (!live.has(id)) lastBytes.delete(id);
    const clients = gs.players.size; const p = gs.persist?.stats;
    print(`[stats] tick=${gs.world.tick} rate=${(ticks / secs).toFixed(1)}Hz ms/tick avg=${avg.toFixed(2)} p99=${p99.toFixed(2)} max=${max.toFixed(2)} ` +
      `clients=${clients} bytes/client/s=${clients ? Math.round(bytes / clients / secs) : 0} entities=${gs.world.entityCount} chunks=${gs.chunks.chunkCount}` +
      (p ? ` persist: dirty=${p.dirtyChunks} rounds=${p.roundsCompleted} lastRound=${p.lastRoundChunks}ch/${p.lastRoundTicks}t maxPersistMs=${p.maxTickMs.toFixed(2)} playersSaved=${p.playersSaved} stored=${gs.persist!.store.count("chunks")}ch/${gs.persist!.store.count("players")}pl` : ""));
    gs.persist?.resetMaxTick(); lastTick = gs.world.tick; lastT = now;
  }, periodSec * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

async function main(): Promise<void> {
  const args = parseServerArgs(process.argv.slice(2), process.env);
  const { WsServerTransport } = await import("@engine/net/node");
  const { SqliteWorldStore } = await import("@engine/persist/node");
  let store;
  if (args.save) {
    const path = resolve(args.save);
    if (args.fresh) for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) rmSync(f);
    store = await SqliteWorldStore.open(path);
    const m = store.readMeta();
    console.log(`server: save ${path}${m ? ` (seed ${m.seed}, tick ${m.tick}, ${store.count("chunks")} chunks, ${store.count("players")} players)` : " (new world)"}`);
  } else console.log("server: no save (in-memory world)");
  const transport = new WsServerTransport();
  const port = await transport.listen(args.port, args.host);
  // Cosmetics catalog from the art pack (enables character customization); the server still runs without it.
  let catalog: import("@engine/core").CosmeticCatalogLike | undefined;
  try { const { loadDefaultManifest } = await import("@engine/assets/node"); catalog = loadDefaultManifest().registry.cosmetics; } catch (e) { console.log(`assets: no cosmetics catalog (${String(e)})`); }
  if (!catalog) console.log("assets: customization disabled (no cosmetics in the pack manifest)");
  const gs = createGameServer({ transport, ...(store ? { store } : {}), ...(catalog ? { catalog, randomAppearance: true } : {}), seed: args.seed, mode: args.mode, devBots: devBotsFromEnv(process.env), log: (m) => console.log(m) });
  console.log(`server: mode ${gs.mode} (human bots ${gs.modeConfig.humanBots ? "on" : "off"})`);
  console.log(`server: listening ws://${args.host}:${port} protocol v${PROTOCOL_VERSION}, ${1000 / gs.loop.dtMs}Hz, seed ${gs.world.seed}, schema ${gs.world.getSchemaHash().toString(16)}`);
  let last = performance.now(); // wall clock lives OUTSIDE the sim
  const tick = setInterval(() => { const now = performance.now(); gs.loop.advance(now - last); last = now; }, gs.loop.dtMs / 4);
  const stopStats = statsReporter(gs, args.statsSec, (s) => console.log(s));
  let stopping = false;
  const stop = async (sig: string): Promise<void> => {
    if (stopping) { console.log("server: forced exit"); process.exit(1); }
    stopping = true; clearInterval(tick); stopStats();
    console.log(`server: ${sig}, saving...`);
    const t0 = performance.now(); const r = await gs.shutdown();
    console.log(`server: saved ${r.chunks} chunks, ${r.players} players in ${(performance.now() - t0).toFixed(0)} ms; bye`);
    await transport.close(); process.exit(0);
  };
  process.on("SIGINT", () => void stop("SIGINT")); process.on("SIGTERM", () => void stop("SIGTERM"));
}

const isMain = process.argv[1]?.endsWith("main.ts") || process.argv[1]?.endsWith("main.js");
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
