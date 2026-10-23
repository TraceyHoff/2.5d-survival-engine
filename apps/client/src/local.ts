/**
 * Local/offline mode: the authoritative server game module (@engine/server/game, the same code `pnpm demo` runs)
 * hosted in the browser over @engine/net's in-memory LoopbackNetwork, with browser-safe persistence
 * (IndexedDB when available, else memory) and a few local AI bots. No Node-only imports (ws, better-sqlite3).
 */
import { DEFAULT_TICK_HZ, FixedLoop, World } from "@engine/core";
import { LoopbackNetwork, NetClient, type ClientTransport } from "@engine/net";
import { IndexedDbWorldStore, MemoryWorldStore, SetName, nameToWords, type WorldStore } from "@engine/persist";
import type { CosmeticCatalogLike } from "@engine/core";
import { createGameServer, type GameServer } from "@engine/server/game";
import { Act, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "@engine/server/protocol";

export interface LocalServerOptions { store?: WorldStore; seed?: number; bots?: number; rng?: () => number; log?: (s: string) => void; catalog?: CosmeticCatalogLike }
export interface LocalServer {
  game: GameServer; network: LoopbackNetwork;
  /** A fresh client transport connected to this in-memory server (pass to ClientSession.connect / NetClient). */
  createTransport(): ClientTransport;
  /** Advance wall time: delivers loopback messages, steps the server sim and the bots. */
  pump(ms: number): void;
  bots: { client: NetClient; world: World }[];
  stop(): Promise<void>;
}

/** Opens a browser-safe store: IndexedDB if present, else in-memory. */
export async function openBrowserStore(dbName = "engine-local-world"): Promise<WorldStore> {
  try { if ((globalThis as { indexedDB?: unknown }).indexedDB) return await IndexedDbWorldStore.open(dbName); } catch { /* fall back */ }
  return new MemoryWorldStore();
}

export async function createLocalServer(o: LocalServerOptions = {}): Promise<LocalServer> {
  const network = new LoopbackNetwork(o.seed ?? 1234);
  const transport = network.createServer();
  const game = createGameServer({ transport, ...(o.store ? { store: o.store } : {}), seed: o.seed ?? 1234, ...(o.log ? { log: o.log } : {}), ...(o.catalog ? { catalog: o.catalog } : {}) });
  const rnd = o.rng ?? Math.random;
  const bots: LocalServer["bots"] = [];
  const botState: { buttons: number; next: number; loop: FixedLoop }[] = [];
  let elapsed = 0;
  const pump = (ms: number): void => {
    elapsed += ms;
    network.advance(ms);
    game.loop.advance(ms);
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i]!, st = botState[i]!;
      if (elapsed >= st.next) {
        st.next = elapsed + 800 + rnd() * 2200;
        const dirs = [Act.MoveUp, Act.MoveDown, Act.MoveLeft, Act.MoveRight, Act.MoveUp | Act.MoveRight, Act.MoveDown | Act.MoveLeft, 0];
        st.buttons = dirs[Math.floor(rnd() * dirs.length)]!;
        if (rnd() < 0.35) st.buttons = Act.Gather;
      }
      st.loop.advance(ms); b.client.pollEvents(Infinity);
    }
  };
  const server: LocalServer = {
    game, network, bots, pump,
    createTransport: () => network.createClient(),
    async stop() { for (const b of bots) b.client.close(); await game.shutdown(); transport.close(); },
  };
  for (let i = 0; i < (o.bots ?? 0); i++) {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const st = { buttons: 0, next: 0, loop: new FixedLoop({ tickHz: DEFAULT_TICK_HZ, step: (dt) => world.step(dt) }) };
    const client = new NetClient({
      world, transport: network.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS,
      sampleInput: () => ({ buttons: st.buttons, aimX: 0, aimY: 0 }),
      applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd),
    });
    let ok = false, err: unknown; client.connect().then(() => { ok = true; }, (e: unknown) => { err = e; ok = true; });
    for (let k = 0; k < 200 && !ok; k++) { network.advance(10); game.loop.advance(10); await Promise.resolve(); } // handshake on the virtual clock
    if (err || !ok) throw new Error(`local bot ${i} failed to connect: ${String(err ?? "timeout")}`);
    client.sendCommand(SetName, nameToWords(`bot-${i}`));
    bots.push({ client, world }); botState.push(st);
  }
  return server;
}
