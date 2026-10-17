import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV_NET_ID, Membership, NetId, PlayerId, Transform, World, type Entity } from "@engine/core";
import { Health } from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { AccountAssigned, ClaimAccount, MemoryWorldStore, SetName, nameToWords, tokenToWords, wordsToToken } from "@engine/persist";
import { SqliteWorldStore } from "@engine/persist/node";
import { createGameServer, parseServerArgs, Act, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

interface TestClient { client: NetClient; world: World; input: { buttons: number }; account?: string; restored?: boolean }
async function setup(store?: ConstructorParameters<typeof Object>[0]) {
  const net = new LoopbackNetwork(7);
  const gs = createGameServer({ transport: net.createServer(), ...(store ? { store } : {}), seed: 99, autosaveSeconds: 2, playerSaveSeconds: 1 });
  const clients: TestClient[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.client.pollEvents(Infinity); } } };
  const join = async (token?: string, name = "p"): Promise<TestClient> => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const input = { buttons: 0 };
    const client = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: input.buttons, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    const tc: TestClient = { client, world, input };
    client.onEvent(AccountAssigned, (p) => { tc.account = wordsToToken(p); tc.restored = p.restored === 1; });
    const p = client.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p;
    clients.push(tc);
    client.sendCommand(ClaimAccount, token ? tokenToWords(token) : { t0: 0, t1: 0, t2: 0, t3: 0 });
    client.sendCommand(SetName, nameToWords(name));
    tick(3);
    return tc;
  };
  const leave = (c: TestClient): void => { c.client.close(); clients.splice(clients.indexOf(c), 1); tick(2); };
  return { gs, net, tick, join, leave };
}
const playerOf = (gs: ReturnType<typeof createGameServer>, i = 0): Entity => [...gs.players.values()][i]!.entity;

describe("server sim", () => {
  it("is deterministic for a given seed and assigns NetIds through NetServer", () => {
    const mk = () => createGameServer({ transport: new LoopbackNetwork().createServer(), seed: 7 });
    const a = mk(), b = mk();
    for (let i = 0; i < 20; i++) { a.loop.advance(50); b.loop.advance(50); }
    expect(a.world.tick).toBe(20); expect(a.chunks.getTile(10, 10)).toBe(b.chunks.getTile(10, 10));
    expect(a.world.rng.state).toBe(b.world.rng.state);
    expect(a.world.getField(a.world.environment, NetId, "id")).toBe(ENV_NET_ID);
    expect(a.world.entityCount).toBeGreaterThan(1); // resource nodes spawned from streamed chunks
  });
  it("parses CLI args", () => {
    expect(parseServerArgs(["--fresh", "--port", "9000"], { SAVE_PATH: "x.db" })).toMatchObject({ fresh: true, port: 9000, save: "x.db" });
    expect(parseServerArgs(["--no-save"]).save).toBeUndefined();
  });
});

describe("multiplayer (loopback)", () => {
  it("two clients join, get accounts, move with predicted input; leaving despawns the player", async () => {
    const { gs, tick, join, leave } = await setup(new MemoryWorldStore());
    const a = await join(undefined, "alice"), b = await join(undefined, "bob");
    expect(gs.players.size).toBe(2); expect(a.account).toMatch(/^[0-9a-f]{32}$/); expect(a.account).not.toBe(b.account);
    const pa = playerOf(gs, 0); const x0 = gs.world.get(pa, Transform)!.x;
    a.input.buttons = Act.MoveRight; tick(20); a.input.buttons = 0; tick(5);
    expect(gs.world.get(pa, Transform)!.x).toBeGreaterThan(x0 + 1);
    expect([...gs.players.values()][0]!.name).toBe("alice");
    leave(b); expect(gs.players.size).toBe(1);
  });
});

describe("persistence across server restarts", () => {
  it("restores world edits and the player (position, vitals) after a restart; reconnect by account token", async () => {
    const d = mkdtempSync(join(tmpdir(), "server-persist-")); dirs.push(d); const path = join(d, "world.db");
    // --- run 1
    const s1 = await SqliteWorldStore.open(path);
    const r1 = await setup(s1);
    const c = await r1.join(undefined, "carol"); const account = c.account!;
    c.input.buttons = Act.MoveDown; r1.tick(30); c.input.buttons = 0; r1.tick(3);
    const pe = playerOf(r1.gs); const pos = { ...r1.gs.world.get(pe, Transform)! };
    r1.gs.world.setField(pe, Health, "hp", 37);
    r1.gs.chunks.setTile(3, 4, 222); // a world edit (as a gameplay tool would)
    // social: carol founds a clan (banner), a party with a later player, and the clan claims the spawn area
    const carolId = r1.gs.world.getField(pe, PlayerId, "id")!; expect(carolId).toBeGreaterThan(0);
    const groups = r1.gs.permissions.groups;
    const clan = groups.create(2, carolId); groups.addMember(clan.id, 900, 1);
    groups.setBanner(clan.id, { shape: 2, pattern: 4, colors: [0x112233ff, 0xffeeddff], emblemId: 42 });
    const claim = r1.gs.permissions.claims.add({ ownerGroup: clan.id, x0: 0, y0: 0, x1: 32, y1: 32, flags: 1 | 8, priority: 1 });
    r1.tick(50); // autosave (2 s) + periodic player save (1 s) run on the tick
    expect(r1.gs.persist!.stats.roundsCompleted).toBeGreaterThan(0);
    const tick1 = r1.gs.world.tick;
    const saved = await r1.gs.shutdown(); // SIGINT path: full save + close
    expect(saved.players).toBe(1);
    const hpAtSave = r1.gs.world.getField(pe, Health, "hp")!; expect(hpAtSave).toBeLessThan(60); // regen since 37 is small

    // --- run 2: new process state, same file
    const s2 = await SqliteWorldStore.open(path);
    expect(s2.readMeta()).toMatchObject({ seed: 99 });
    const r2 = await setup(s2);
    expect(r2.gs.world.tick).toBeGreaterThanOrEqual(tick1);
    expect(r2.gs.chunks.getTile(3, 4)).toBe(222);
    const clan2 = r2.gs.permissions.groups.get(clan.id)!;
    expect(clan2.kind).toBe(2); expect([...clan2.members]).toEqual([[carolId, 3], [900, 1]]);
    expect(clan2.banner).toEqual({ shape: 2, pattern: 4, colors: [0x112233ff, 0xffeeddff], emblemId: 42 });
    expect(r2.gs.permissions.claims.get(claim.id)).toEqual(claim); expect(r2.gs.permissions.claims.zoneAt(3, 4)).toBe(1 | 8);
    const c2 = await r2.join(account, "carol");
    expect(c2.restored).toBe(true); expect(c2.account).toBe(account);
    const pe2 = playerOf(r2.gs);
    expect(r2.gs.world.getField(pe2, PlayerId, "id")).toBe(carolId); // same account id after restart
    expect(r2.gs.world.get(pe2, Membership)).toEqual({ partyId: 0, clanId: clan.id });
    expect(r2.gs.world.get(pe2, Transform)).toMatchObject({ x: pos.x, y: pos.y });
    expect(r2.gs.world.getField(pe2, Health, "hp")).toBeCloseTo(hpAtSave, 0);
    // disconnect saves; a reconnect in the same run restores from the new save
    c2.input.buttons = Act.MoveLeft; r2.tick(10); c2.input.buttons = 0; r2.tick(3);
    const pos2 = { ...r2.gs.world.get(pe2, Transform)! };
    r2.leave(c2); await s2.flush();
    const c3 = await r2.join(account);
    expect(c3.restored).toBe(true);
    expect(r2.gs.world.get(playerOf(r2.gs), Transform)).toMatchObject({ x: pos2.x, y: pos2.y });
    // unknown token => fresh player, new account
    const c4 = await r2.join("0f".repeat(16));
    expect(c4.restored).toBe(false); expect(c4.account).toBe("0f".repeat(16));
    expect(r2.gs.world.getField(playerOf(r2.gs, 1), PlayerId, "id")).toBeGreaterThan(carolId); // ids never reused
    await r2.gs.shutdown();
  });

  it("a second connection claiming the same account takes over (old session is saved and dropped)", async () => {
    const { gs, join } = await setup(new MemoryWorldStore());
    const a = await join(); const acct = a.account!;
    const b = await join(acct);
    expect(b.restored).toBe(true); expect(gs.players.size).toBe(1);
  });
});
