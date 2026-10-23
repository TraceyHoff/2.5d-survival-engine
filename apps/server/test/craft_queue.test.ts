import { describe, it, expect, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlayerId, Transform, World, type Entity } from "@engine/core";
import { addItem, countItem, defaultDefs, BuildPiece, CraftQueue, CraftQueuesRes, Health, CancelQueuedCraftCmd, QueueCraftCmd } from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { AccountAssigned, wordsToToken, ClaimAccount, MemoryWorldStore, tokenToWords, type WorldStore } from "@engine/persist";
import { SqliteWorldStore } from "@engine/persist/node";
import { createGameServer, applyMoveInput, installDemoWorld, gameplayNet, onGameplayRejected, DEMO_COMMANDS, DEMO_EVENTS, type GameplayRejection } from "../src/main.js";

const d = defaultDefs(); const id = (k: string) => d.itemId(k); const AXE = d.recipeId("stone_axe");
const dirs: string[] = [];
afterEach(() => { for (const x of dirs.splice(0)) rmSync(x, { recursive: true, force: true }); });

function setup(store: WorldStore, net = new LoopbackNetwork(3), seed = 5) {
  const gs = createGameServer({ transport: net.createServer(), store, seed, autosaveSeconds: 1, playerSaveSeconds: 1 });
  const clients: NetClient[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const connect = async (token?: string | ((t: string) => void)): Promise<{ c: NetClient; e: Entity }> => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; clients.push(c);
    if (typeof token === "function") { const cb = token; c.onEvent(AccountAssigned, (a) => cb(wordsToToken(a))); token = undefined; }
    c.sendCommand(ClaimAccount, token ? tokenToWords(token) : { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(3);
    return { c, e: gs.players.get(c.clientId!)!.entity };
  };
  return { gs, net, tick, connect };
}
const stock = (w: World, e: Entity) => { addItem(w, e, id("wood"), 10); addItem(w, e, id("stone"), 4); addItem(w, e, id("fiber"), 4); };
/** Client-side replicated CraftQueue rows (entity has the component on that client). */
const queuesOn = (c: NetClient) => [...c.world.query([CraftQueue])].map((e) => c.world.get(e, CraftQueue) as unknown as Record<string, number[]>);
const busy = (row: Record<string, number[]>) => row.recipeId!.some((v) => v !== 0);

describe("apps/server craft queue", () => {
  it("queueing a craft over the net consumes ingredients, replicates progress to the owner only, and completes", async () => {
    const s = setup(new MemoryWorldStore()); const w = s.gs.world;
    const A = await s.connect(); const B = await s.connect(); stock(w, A.e); s.tick(2);
    A.c.sendCommand(gameplayNet(QueueCraftCmd), { recipe: AXE, count: 2 }); s.tick(4);
    expect(countItem(w, A.e, id("stone"))).toBe(0);
    expect(w.resource(CraftQueuesRes).jobs(A.e)).toHaveLength(1);
    expect(queuesOn(A.c).some(busy)).toBe(true);
    expect(queuesOn(B.c).some(busy)).toBe(false); // owner scope
    s.tick(90);
    expect(countItem(w, A.e, id("stone_axe"))).toBe(2);
    expect(w.resource(CraftQueuesRes).jobs(A.e)).toEqual([]);
    expect(queuesOn(A.c).some(busy)).toBe(false);
  });

  it("cancelling a queued craft over the net refunds the ingredients", async () => {
    const s = setup(new MemoryWorldStore()); const w = s.gs.world; const A = await s.connect(); stock(w, A.e); s.tick(2);
    A.c.sendCommand(gameplayNet(QueueCraftCmd), { recipe: AXE, count: 2 }); s.tick(3);
    const slot = w.resource(CraftQueuesRes).jobs(A.e)[0]!.slot;
    A.c.sendCommand(gameplayNet(CancelQueuedCraftCmd), { slot }); s.tick(3);
    expect(w.resource(CraftQueuesRes).jobs(A.e)).toEqual([]);
    expect(countItem(w, A.e, id("stone"))).toBe(4); expect(countItem(w, A.e, id("wood"))).toBe(10);
    s.tick(90); expect(countItem(w, A.e, id("stone_axe"))).toBe(0);
  });

  it("rejections (missing_ingredients, no_job) reach the client with the gameplay command", async () => {
    const s = setup(new MemoryWorldStore()); const A = await s.connect(); s.tick(2);
    const got: GameplayRejection[] = []; onGameplayRejected(A.c, (r) => got.push(r));
    A.c.sendCommand(gameplayNet(QueueCraftCmd), { recipe: AXE, count: 1 });
    A.c.sendCommand(gameplayNet(CancelQueuedCraftCmd), { slot: 2 }); s.tick(4);
    expect(got.map((r) => [r.command, r.reason])).toEqual([[QueueCraftCmd, "missing_ingredients"], [CancelQueuedCraftCmd, "no_job"]]);
  });

  it("a queue survives save + restart, is re-armed on reclaim, and finishes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cq-")); dirs.push(dir); const path = join(dir, "w.db");
    const s1 = setup(await SqliteWorldStore.open(path)); let token = "";
    const A = await s1.connect((t) => { token = t; }); const w1 = s1.gs.world; stock(w1, A.e);
    A.c.sendCommand(gameplayNet(QueueCraftCmd), { recipe: AXE, count: 2 }); s1.tick(10);
    expect(countItem(w1, A.e, id("stone_axe"))).toBe(0);
    await s1.gs.shutdown();
    const s2 = setup(await SqliteWorldStore.open(path));
    const B = await s2.connect(token); const w2 = s2.gs.world;
    expect(w2.resource(CraftQueuesRes).jobs(B.e)).toHaveLength(1);
    s2.tick(100);
    expect(countItem(w2, B.e, id("stone_axe"))).toBe(2);
    await s2.gs.shutdown();
  });

  it("loads a pre-81a7b11 save (no CraftQueue anywhere): player + chunk entities restore, CraftQueue absent, no schema-hash failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cq-old-")); dirs.push(dir); const path = join(dir, "w.db");
    copyFileSync(new URL("./fixtures/pre81a7b11.sqlite.bin", import.meta.url), path);
    const fx = JSON.parse(readFileSync(new URL("./fixtures/pre81a7b11.json", import.meta.url), "utf8")) as { account: string; pid: number; pieceX: number; pieceY: number };
    const logs: string[] = []; const s = setup(await SqliteWorldStore.open(path), new LoopbackNetwork(3), 5);
    const P = await s.connect(fx.account); const w = s.gs.world; s.tick(5);
    expect(w.getField(P.e, PlayerId, "id")).toBe(fx.pid);
    const hp = w.getField(P.e, Health, "hp")!; expect(hp).toBeGreaterThanOrEqual(41); expect(hp).toBeLessThan(45); // saved 41, then regen
    expect(countItem(w, P.e, id("wood"))).toBe(7);
    const pieces = [...w.query([BuildPiece])].filter((e) => { const t = w.get(e, Transform)!; return Math.abs(t.x - fx.pieceX) < 3 && Math.abs(t.y - fx.pieceY) < 3; });
    expect(pieces.length).toBeGreaterThan(0);
    for (const e of w.query([CraftQueue])) expect(e === P.e ? w.resource(CraftQueuesRes).jobs(e) : [e]).toEqual([]); // only a fresh empty queue may exist
    for (const e of pieces) expect(w.has(e, CraftQueue)).toBe(false);
    expect(s.gs.persist!.stats.decodeErrors).toBe(0); void logs;
    // and the loaded world is still writable: queue a craft and finish it
    stock(w, P.e); P.c.sendCommand(gameplayNet(QueueCraftCmd), { recipe: AXE, count: 1 }); s.tick(60);
    expect(countItem(w, P.e, id("stone_axe"))).toBe(1);
    await s.gs.shutdown();
  });
});
