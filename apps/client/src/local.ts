/**
 * Local/offline mode: the authoritative server game module (@engine/server/game, the same code `pnpm demo` runs)
 * hosted in the browser over @engine/net's in-memory LoopbackNetwork, with browser-safe persistence
 * (IndexedDB when available, else memory). Singleplayer by default: the population spawner fills the world with
 * zombies, animals and human bots. Human bots are VIRTUAL PLAYERS: real loopback NetClients (own replica, own
 * PlayerId/account/inventory) driven by an AgentController that only emits the input stream a human sends.
 * mode: "multiplayer" disables human bots entirely (and ignores `bots`). No Node-only imports.
 */
import { CommandRegistry, DEFAULT_TICK_HZ, FixedLoop, Owner, World, type CosmeticCatalogLike, type Agent, type AgentOutput, type Entity } from "@engine/core";
import { agentOutputFrame, applyAgentEmote, buildAgentView, flushSocialMemory, makeAgent, makeAgentIdentity, survivorController } from "@engine/gameplay";
import { ChatChannel, LoopbackNetwork, MultiServerTransport, NetClient, type ClientTransport, type ServerTransport } from "@engine/net";
import { ClaimAccount, IndexedDbWorldStore, MemoryWorldStore, SetName, nameToWords, tokenToWords, type WorldStore } from "@engine/persist";
import { createGameServer, SPAWN, type GameMode, type GameServer } from "@engine/server/game";
import { Act, applyDemoInput, VEHICLE_CLIENT_OPTIONS, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "@engine/server/protocol";

export interface LocalServerOptions {
  store?: WorldStore; seed?: number;
  /** Default "singleplayer". "multiplayer" = no human bots at all (bots ignored). */
  mode?: GameMode;
  /** Dev: connect this many virtual players immediately at spawn (in addition to natural spawns; singleplayer only). */
  bots?: number;
  /** Ambient population spawner (zombies, animals, bots). Default true. */
  population?: boolean;
  /** Unused (kept for API compatibility); bot behavior is seeded from the world seed. */
  rng?: () => number; log?: (s: string) => void;
  /** Cosmetics catalog: enables customization + random placeholder appearances (players and bots). */
  catalog?: CosmeticCatalogLike;
  /** P2P host: extra server transports (e.g. RtcServerTransport for WebRTC guests) served by the same NetServer. */
  extraTransports?: ServerTransport[];
  /** Player cap incl. the host's own client; extra joins are rejected (ServerFull + serverFullDetail). */
  maxClients?: number; serverFullDetail?: string;
  /** Distant-entity delta throttle forwarded to the NetServer (P2P host; ADR-102). */
  distantThrottle?: { nearTiles: number; interval: number };
}
export interface VirtualPlayer { client: NetClient; world: World; agent: Agent; output: AgentOutput; home: { x: number; y: number } }
export interface LocalServer {
  game: GameServer; network: LoopbackNetwork;
  /** A fresh client transport connected to this in-memory server (pass to ClientSession.connect / NetClient). */
  createTransport(): ClientTransport;
  /** Advance wall time: delivers loopback messages, steps the server sim and the virtual players. */
  pump(ms: number): void;
  /** Connected virtual players (human bots). Always empty in multiplayer. */
  bots: VirtualPlayer[];
  stop(): Promise<void>;
}

/**
 * Singleplayer local-server lifecycle, for the ?diag=1 overlay and the camera fallback. `store` names the backend actually
 * used; `error` is the last startup problem (also set when the store fell back to memory).
 */
export const localStatus: { state: "idle" | "opening-store" | "starting" | "connecting" | "running" | "failed"; store: string; error: string | undefined } = { state: "idle", store: "", error: undefined };

type IdbFactory = NonNullable<NonNullable<Parameters<typeof IndexedDbWorldStore.open>[1]>["factory"]>;
/**
 * Opens a browser-safe store: IndexedDB if present, else in-memory. Never hangs: an IndexedDB open that is blocked
 * (an older tab / installed PWA still holds the DB during a schema upgrade, onblocked) or simply never answers
 * (seen on Android) falls back to an in-memory world after `timeoutMs`, with `localStatus.error` set. Before this,
 * a stuck open left singleplayer waiting forever: no server, no player, an empty (clear-colour) scene.
 */
export async function openBrowserStore(dbName = "engine-local-world", timeoutMs = 4000): Promise<WorldStore> {
  const idb = (globalThis as { indexedDB?: IdbFactory }).indexedDB;
  if (!idb) { localStatus.store = "memory (no IndexedDB)"; return new MemoryWorldStore(); }
  let blocked = false;
  const factory: IdbFactory = { deleteDatabase: (n) => idb.deleteDatabase(n), open: (n, v) => { const r = idb.open(n, v); (r as { onblocked?: unknown }).onblocked = () => { blocked = true; }; return r; } };
  const opening = IndexedDbWorldStore.open(dbName, { factory });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((res) => { timer = setTimeout(() => res("timeout"), timeoutMs); });
  try {
    const r = await Promise.race([opening, timeout]);
    if (r !== "timeout") { localStatus.store = `indexeddb ${dbName}`; return r; }
    localStatus.error = `IndexedDB "${dbName}" ${blocked ? "upgrade blocked (another tab or app still has the game open)" : "did not open"} within ${timeoutMs} ms; this session is not saved`;
    void opening.then((s) => s.close(), () => undefined); // a late open must not keep the DB locked
  } catch (e) {
    localStatus.error = `IndexedDB "${dbName}" failed: ${e instanceof Error ? e.message : String(e)}; this session is not saved`;
  } finally { clearTimeout(timer); }
  console.warn(`[local] ${localStatus.error}`);
  localStatus.store = "memory (fallback)";
  return new MemoryWorldStore();
}

const hex32 = (s: string): string => { let h = 0x811c9dc5, out = ""; for (let k = 0; k < 4; k++) { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i) ^ k, 0x01000193) >>> 0; out += h.toString(16).padStart(8, "0"); } return out; };

const NO_COMMANDS = new CommandRegistry();
const ACT_MASK = Act.MoveUp | Act.MoveDown | Act.MoveLeft | Act.MoveRight | Act.Sprint | Act.Gather;
export async function createLocalServer(o: LocalServerOptions = {}): Promise<LocalServer> {
  const seed = o.seed ?? 1234; const mode: GameMode = o.mode ?? "singleplayer";
  const network = new LoopbackNetwork(seed);
  const transport = network.createServer();
  const serverTransport: ServerTransport = o.extraTransports?.length ? new MultiServerTransport([transport, ...o.extraTransports]) : transport;
  const bots: VirtualPlayer[] = [];
  const controller = survivorController({ seed });
  let slot = 0, stopped = false; const connecting: Promise<void>[] = [];
  const store = o.store;
  // Called from inside the server tick: defer (the handshake must not re-enter game.loop).
  const queued: { x: number; y: number }[] = [];
  const connectBot = (x: number, y: number): boolean => { queued.push({ x, y }); return true; };
  const game = createGameServer({
    transport: serverTransport, ...(store ? { store } : {}), seed, mode,
    ...(o.maxClients !== undefined ? { maxClients: o.maxClients } : {}), ...(o.serverFullDetail ? { serverFullDetail: o.serverFullDetail } : {}), ...(o.log ? { log: o.log } : {}), ...(o.catalog ? { catalog: o.catalog, randomAppearance: true } : {}),
    ...(o.population === false ? { population: false } : {}), ...(o.distantThrottle ? { distantThrottle: o.distantThrottle } : {}),
    ...(mode === "singleplayer" ? { virtualPlayers: { connect: connectBot, disconnect: (cid: number) => dropBot(cid) } } : {}),
  });

  async function addBot(x: number, y: number, drive = true): Promise<void> {
    const identity = (() => { const id = makeAgentIdentity(seed, slot++); return { ...id, ...(game.agents.get(id.id) ?? {}) }; })();
    const agent = makeAgent(identity, (seed ^ (slot * 0x9e3779b1)) >>> 0, DEFAULT_TICK_HZ); controller.add(agent);
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const vp: VirtualPlayer = { client: undefined as unknown as NetClient, world, agent, output: { moveX: 0, moveY: 0, aimX: 0, aimY: 0, sprint: false, actions: [] }, home: { x, y } };
    // The exact input path a human client uses: buttons + aim sampled each client tick.
    const sample = (): { buttons: number; aimX: number; aimY: number } => {
      const f = agentOutputFrame(vp.output, 0, NO_COMMANDS); // gameplay intentToFrame; GameplayActions bits 0-5 == Act bits
      return { buttons: f.actions & ACT_MASK, aimX: f.aimX, aimY: f.aimY };
    };
    const client = new NetClient({ world, transport: network.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: sample, ...VEHICLE_CLIENT_OPTIONS, applyInput: (w, e, cmd) => applyDemoInput(w, e, cmd) });
    vp.client = client;
    let ok = false, err: unknown; const conn = client.connect().then(() => { ok = true; }, (e: unknown) => { err = e; ok = true; });
    if (drive) for (let k = 0; k < 200 && !ok; k++) { network.advance(10); game.loop.advance(10); await Promise.resolve(); } // handshake on the virtual clock
    else await conn; // progresses as pump() advances the loopback
    if (stopped) { client.close(); controller.remove(agent); return; }
    if (err || !ok) { controller.remove(agent); throw new Error(`virtual player failed to connect: ${String(err ?? "timeout")}`); }
    if (!game.markVirtual(client.clientId)) { controller.remove(agent); client.close(); return; } // refused (multiplayer)
    client.sendCommand(ClaimAccount, tokenToWords(hex32(identity.id))); // persistent account: inventory/stats saved like a human's
    client.sendCommand(SetName, nameToWords(identity.name));
    game.agents.put(identity.id, { ...identity }); // persisted ("agents" records); gameplay updates relationship / party / clan memory via game.agents.put
    bots.push(vp);
  }
  const putAgent = (id: string, partial: Parameters<typeof game.agents.put>[1]): unknown => game.agents.put(id, partial);
  function dropBot(clientId: number): void {
    const i = bots.findIndex((b) => b.client.clientId === clientId); if (i < 0) return;
    const b = bots[i]!; flushSocialMemory([b.agent], putAgent, game.world.tick, true); controller.remove(b.agent); b.client.close(); bots.splice(i, 1);
  }
  const serverEntityOf = (cid: number): Entity | undefined => { for (const e of game.world.query([Owner])) if (game.world.getField(e, Owner, "clientId") === cid) return e; return undefined; };
  const selfOf = (vp: VirtualPlayer): Entity | undefined => { for (const e of vp.world.query([Owner])) if (vp.world.getField(e, Owner, "clientId") === vp.client.clientId) return e; return undefined; };
  const loops = new Map<VirtualPlayer, FixedLoop>();
  const agentLoop = new FixedLoop({ tickHz: DEFAULT_TICK_HZ, step: () => {
    const outs = controller.tick(game.world.tick, (a) => { const vp = bots.find((b) => b.agent === a); const e = vp && selfOf(vp); return vp && e !== undefined ? buildAgentView(vp.world, e, a, vp.home) : undefined; });
    for (const vp of bots) { const out = outs.get(vp.agent); if (!out) continue; vp.output = out; if (out.chat) vp.client.chat.send(ChatChannel.Local, out.chat.text); if (out.emote) { const e = serverEntityOf(vp.client.clientId); if (e !== undefined) applyAgentEmote(game.world, e, out); } if (out.commands) sendAgentCommands(vp.client, out.commands); }
    flushSocialMemory(bots.map((b) => b.agent), putAgent, game.world.tick); // debounced social-memory write-through
  } });
  const pump = (ms: number): void => {
    for (const q of queued.splice(0)) connecting.push(addBot(q.x, q.y, false).catch((e) => o.log?.(`bot failed: ${String(e)}`)));
    network.advance(ms);
    game.loop.advance(ms);
    agentLoop.advance(ms);
    for (const vp of bots) {
      let l = loops.get(vp); if (!l) loops.set(vp, (l = new FixedLoop({ tickHz: DEFAULT_TICK_HZ, step: (dt) => vp.world.step(dt) })));
      l.advance(ms); vp.client.pollEvents(Infinity);
    }
  };
  const server: LocalServer = {
    game, network, bots, pump,
    createTransport: () => network.createClient(),
    async stop() { stopped = true; await Promise.allSettled(connecting); flushSocialMemory(bots.map((b) => b.agent), putAgent, game.world.tick, true); for (const b of bots) b.client.close(); await game.shutdown(); serverTransport.close(); },
  };
  if (mode === "singleplayer") for (let i = 0; i < (o.bots ?? 0); i++) await addBot(SPAWN.x + i, SPAWN.y + 2);
  return server;
}

/**
 * Sends an agent's discrete commands through the bot's NetClient exactly as human input does (same wire path, rate limits and
 * server validation). Looks the def up by name in DEMO_COMMANDS; entity fields are replica entities, which NetClient.sendCommand
 * maps to network ids. Returns how many were sent (unknown names / unmapped targets are dropped).
 */
export function sendAgentCommands(client: NetClient, cmds: readonly { type: string; payload: unknown }[]): number {
  let n = 0;
  for (const c of cmds) {
    const def = DEMO_COMMANDS.find((d) => d.name === c.type);
    if (def && client.sendCommand(def as never, (c.payload ?? {}) as never)) n++;
  }
  return n;
}
