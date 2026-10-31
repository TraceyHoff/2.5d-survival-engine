import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlayerId, Transform, World, type Entity } from "@engine/core";
import { addItem, applyDamage, bagExpiryTick, DeathBagDropped, defaultDefs, DESPAWN, despawnFadeAlpha, dropItem, LootBag, LootSource, transferItem } from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { AccountAssigned, ClaimAccount, MemoryWorldStore, tokenToWords, wordsToToken, type WorldStore } from "@engine/persist";
import { SqliteWorldStore } from "@engine/persist/node";
import { createGameServer, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";
import { SPAWN } from "../src/game.js";

/** ADR-238: server-authoritative ground-loot despawn, replicated to clients and persisted across restarts. */
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const d = defaultDefs(); const PLANK = d.itemId("planks");
const T = (s: number) => Math.ceil(s * 20);

async function setup(store: WorldStore, beforeJoin?: (w: World) => void) {
  const net = new LoopbackNetwork(11);
  const gs = createGameServer({ transport: net.createServer(), spawnPoints: [SPAWN], store, seed: 77, autosaveSeconds: 2, playerSaveSeconds: 1 });
  beforeJoin?.(gs.world);
  const clients: { c: NetClient; world: World }[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const x of clients) { x.world.step(1 / 20); x.c.pollEvents(Infinity); } } };
  const joinP = async (token?: string) => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client"); let account = "";
    const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    c.onEvent(AccountAssigned, (p) => { account = wordsToToken(p); });
    const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; clients.push({ c, world });
    c.sendCommand(ClaimAccount, token ? tokenToWords(token) : { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(3);
    const e = gs.players.get(c.clientId!)!.entity; return { c, world, e, pid: gs.world.getField(e, PlayerId, "id")!, account: () => account };
  };
  return { gs, tick, join: joinP };
}
const near = (w: World, x: number, y: number): Entity[] => [...w.query([LootBag, Transform])].filter((e) => { const t = w.get(e, Transform)!; return Math.hypot(t.x - x, t.y - y) < 0.3; });

describe("ADR-238 ground loot despawn (server + replication)", () => {
  it("the timer fields replicate; the client fades the bag, then sees it removed when the server despawns it", async () => {
    const { gs, tick, join } = await setup(new MemoryWorldStore()); const w = gs.world; const A = await join(); tick(5);
    addItem(w, A.e, PLANK, 4, A.pid); const bag = dropItem(w, A.e, PLANK, 4)!; const at = { ...w.get(bag, Transform)! }; tick(5);
    const [cb] = near(A.world, at.x, at.y); expect(cb).toBeDefined();
    expect(A.world.get(cb!, LootBag)).toMatchObject({ kind: LootSource.Dropped, spawnTick: w.get(bag, LootBag)!.spawnTick, despawnAtTick: w.get(bag, LootBag)!.despawnAtTick });
    expect(despawnFadeAlpha(A.world.get(cb!, LootBag)!, A.world.tick)).toBe(1);
    w.setField(bag, LootBag, "despawnAtTick", w.tick + T(DESPAWN.fadeSeconds / 2)); tick(10); // as if it were 15 s from its end
    expect(despawnFadeAlpha(A.world.get(cb!, LootBag)!, A.world.tick)).toBeLessThan(0.95); // fading on the client
    tick(T(DESPAWN.fadeSeconds / 2) + 30);
    expect(w.isAlive(bag)).toBe(false); expect(near(A.world, at.x, at.y)).toEqual([]); // removal replicated
  });
  it("a death bag looted to empty vanishes for the client ~emptiedSeconds later (not instantly, not after 30 min)", async () => {
    const { gs, tick, join } = await setup(new MemoryWorldStore()); const w = gs.world; const A = await join(); tick(5);
    const drops: Entity[] = []; w.events.on(DeathBagDropped as never, (p: { bag: Entity }) => drops.push(p.bag));
    addItem(w, A.e, PLANK, 6, A.pid); tick(2); applyDamage(w, A.e, 1e6, A.e); tick(3);
    const bag = drops[0]!; const at = { ...w.get(bag, Transform)! }; expect(near(A.world, at.x, at.y).length).toBe(1);
    expect(transferItem(w, bag, A.e, PLANK, 6)).toBe(6); tick(40);
    expect(near(A.world, at.x, at.y).length).toBe(1); // still there, fading (short grace)
    const cl = A.world.get(near(A.world, at.x, at.y)[0]!, LootBag)!; expect(cl.emptiedTick).toBeGreaterThan(0); expect(bagExpiryTick(cl) - cl.emptiedTick).toBe(T(DESPAWN.emptiedSeconds));
    tick(T(DESPAWN.emptiedSeconds));
    expect(w.isAlive(bag)).toBe(false); expect(near(A.world, at.x, at.y)).toEqual([]);
  });
  it("the timer survives a server restart (absolute spawn/despawn ticks + persisted world tick)", { timeout: 30_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "adr238-")); dirs.push(dir); const path = join(dir, "w.db");
    const r1 = await setup(await SqliteWorldStore.open(path)); const A = await r1.join(); r1.tick(5);
    addItem(r1.gs.world, A.e, PLANK, 3, A.pid); const bag = dropItem(r1.gs.world, A.e, PLANK, 3)!; const lb = { ...r1.gs.world.get(bag, LootBag)! }; const at = { ...r1.gs.world.get(bag, Transform)! };
    r1.tick(60); const acct = A.account(); expect(acct).toMatch(/^[0-9a-f]{32}$/); await r1.gs.shutdown();
    let restoredTick = 0;
    const r2 = await setup(await SqliteWorldStore.open(path), (w) => { restoredTick = w.tick; w.tick = lb.despawnAtTick - 60; }); // restart, then ~10 min of uptime pass
    expect(restoredTick).toBeGreaterThan(lb.spawnTick);
    await r2.join(acct); r2.tick(5);
    const [b2] = near(r2.gs.world, at.x, at.y); expect(b2).toBeDefined(); expect(r2.gs.world.get(b2!, LootBag)).toMatchObject({ spawnTick: lb.spawnTick, despawnAtTick: lb.despawnAtTick, kind: LootSource.Dropped });
    r2.tick(80); expect(near(r2.gs.world, at.x, at.y)).toEqual([]);
    await r2.gs.shutdown();
  });
});
