/**
 * Headless bot clients: real NetClients over the Node `ws` WebSocket transport. They claim persistent accounts,
 * wander (random movement inputs, occasional sprint) and gather (Gather bit -> server targets the nearest node).
 * Shoppers: when a replicated stall is in view, bots browse it (gameplay.openStall) and try a buy via client.stalls
 * (the server routes it through gameplay's buy hook); results are counted in bot.stallResults.
 *   tsx src/bots.ts --url ws://127.0.0.1:7777 --count 5 [--duration 20] [--tokens saves/bots.json] [--stats 5]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import WebSocket from "ws";
import { FixedLoop, NetId, Transform, World, DEFAULT_TICK_HZ } from "@engine/core";
import { Listings, OpenStallCmd, StallHeader } from "@engine/gameplay";
import { NetClient, WebSocketClientTransport, type WebSocketCtor } from "@engine/net";
import { AccountAssigned, ClaimAccount, SetName, nameToWords, tokenToWords, wordsToToken } from "@engine/persist";
import { Act, applyMoveInput, gameplayNet, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS, Ping, Pong } from "./protocol.js";

export interface Bot { index: number; client: NetClient; world: World; account: string | undefined; restored: boolean; rttMs: number; connected: boolean; stallResults: Map<number, number>; stop(): void }
export interface BotOptions { url: string; index: number; token?: string; rng?: () => number; onAccount?: (index: number, token: string) => void }

export async function startBot(o: BotOptions): Promise<Bot> {
  const rnd = o.rng ?? Math.random; // bots are outside the sim: wall clock + Math.random are fine here
  const world = new World({ seed: 1 }); installDemoWorld(world, "client");
  let buttons = 0;
  const transport = new WebSocketClientTransport(o.url, WebSocket as unknown as WebSocketCtor);
  const client = new NetClient({
    world, transport, commands: DEMO_COMMANDS, events: DEMO_EVENTS,
    sampleInput: () => ({ buttons, aimX: 0, aimY: 0 }),
    applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd),
  });
  const bot: Bot = { index: o.index, client, world, account: o.token, restored: false, rttMs: NaN, connected: false, stallResults: new Map(), stop: () => {} };
  client.onEvent(AccountAssigned, (p) => { bot.account = wordsToToken(p); bot.restored = p.restored === 1; o.onAccount?.(o.index, bot.account); });
  client.onEvent(Pong, (p) => { bot.rttMs = (Math.round(performance.now()) >>> 0) - p.t; });
  await client.connect();
  bot.connected = true; transport.onClose(() => { bot.connected = false; });
  client.sendCommand(ClaimAccount, o.token ? tokenToWords(o.token) : { t0: 0, t1: 0, t2: 0, t3: 0 });
  client.sendCommand(SetName, nameToWords(`bot-${o.index}`));
  const loop = new FixedLoop({ tickHz: DEFAULT_TICK_HZ, step: (dt) => world.step(dt) });
  let last = performance.now(), nextChange = 0, nextPing = 0, nextShop = 3000 + rnd() * 4000;
  const dirs = [Act.MoveUp, Act.MoveDown, Act.MoveLeft, Act.MoveRight, Act.MoveUp | Act.MoveRight, Act.MoveDown | Act.MoveLeft, 0];
  const timer = setInterval(() => {
    const now = performance.now(); loop.advance(now - last); last = now;
    client.pollEvents(Infinity);
    if (now >= nextChange) {
      nextChange = now + 800 + rnd() * 2200;
      buttons = dirs[Math.floor(rnd() * dirs.length)]!;
      if (rnd() < 0.2) buttons |= Act.Sprint;
      if (rnd() < 0.35) buttons = Act.Gather; // stand still and gather whatever is in reach
    }
    if (now >= nextShop && client.connected) { nextShop = now + 4000 + rnd() * 6000; shop(); }
    if (now >= nextPing && client.connected) { nextPing = now + 2000; client.sendCommand(Ping, { t: Math.round(now) >>> 0 }); }
  }, 1000 / DEFAULT_TICK_HZ / 2);
  /** Nearest visible stall: browse it, then buy one unit of its first stocked listing at the replicated price. */
  function shop(): void {
    const me = [...client.world.predicted][0]; const mt = me !== undefined ? world.get(me, Transform) : undefined; if (!mt) return;
    let best: number | undefined, bd = Infinity;
    for (const s of world.query([StallHeader, Transform, NetId])) { const t = world.get(s, Transform)!; const d = (t.x - mt.x) ** 2 + (t.y - mt.y) ** 2; if (d < bd) { bd = d; best = s; } }
    if (best === undefined) return;
    const netId = world.getField(best, NetId, "id")!;
    client.sendCommand(gameplayNet(OpenStallCmd), { stall: best });
    const L = world.has(best, Listings) ? world.get(best, Listings) : undefined; // viewers scope: present once browsing
    const prices = L ? world.getArray(best, Listings, "priceItem")! : undefined; const slot = prices ? Array.from(prices).findIndex((x) => x > 0) : -1;
    const listingId = Math.max(slot, 0);
    const pi = slot >= 0 ? world.getArray(best, Listings, "priceItem")![slot]! : 0, pc = slot >= 0 ? world.getArray(best, Listings, "priceCount")![slot]! : 0;
    void client.stalls.buy(netId, listingId, L?.revision ?? 0, { itemId: pi, count: pc }, 1).then((r) => bot.stallResults.set(r.reason, (bot.stallResults.get(r.reason) ?? 0) + 1));
  }
  bot.stop = () => { clearInterval(timer); client.close(); };
  return bot;
}

export interface BotSwarm { bots: Bot[]; stop(): void }
export async function startBots(url: string, count: number, tokensFile?: string, log: (s: string) => void = () => {}, rng?: (index: number) => () => number): Promise<BotSwarm> {
  const tokens: Record<string, string> = tokensFile && existsSync(tokensFile) ? JSON.parse(readFileSync(tokensFile, "utf8")) as Record<string, string> : {};
  const save = (): void => { if (!tokensFile) return; mkdirSync(dirname(tokensFile), { recursive: true }); writeFileSync(tokensFile, JSON.stringify(tokens, null, 1)); };
  const bots: Bot[] = [];
  for (let i = 0; i < count; i++) {
    const tok = tokens[String(i)];
    try {
      bots.push(await startBot({ url, index: i, ...(tok ? { token: tok } : {}), ...(rng ? { rng: rng(i) } : {}), onAccount: (idx, t) => { if (tokens[String(idx)] !== t) { tokens[String(idx)] = t; save(); } } }));
    } catch (e) { log(`bot ${i}: connect failed: ${String(e)}`); }
  }
  return { bots, stop: () => { for (const b of bots) b.stop(); } };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2); const get = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const url = get("--url") ?? `ws://127.0.0.1:${process.env["PORT"] ?? 7777}`;
  const count = Number(get("--count") ?? 5), duration = Number(get("--duration") ?? 0), statsSec = Number(get("--stats") ?? 5);
  const swarm = await startBots(url, count, get("--tokens"), (s) => console.log(s));
  console.log(`bots: ${swarm.bots.length}/${count} connected to ${url}`);
  const report = setInterval(() => {
    const b = swarm.bots; const live = b.filter((x) => x.client.connected && x.connected);
    const rtts = live.map((x) => x.rttMs).filter((x) => Number.isFinite(x));
    const restored = b.filter((x) => x.restored).length; const withAccount = b.filter((x) => x.account).length;
    const owned = live.filter((x) => [...x.client.world.predicted].length > 0).length;
    console.log(`[bots] connected=${live.length}/${count} accounts=${withAccount} restored=${restored} ownedPlayer=${owned} rtt avg=${rtts.length ? (rtts.reduce((s, x) => s + x, 0) / rtts.length).toFixed(1) : "-"}ms`);
  }, statsSec * 1000);
  const stop = (): void => { clearInterval(report); swarm.stop(); setTimeout(() => process.exit(0), 200); };
  if (duration > 0) setTimeout(stop, duration * 1000);
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
const isMain = process.argv[1]?.endsWith("bots.ts") || process.argv[1]?.endsWith("bots.js");
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
