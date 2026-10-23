import { describe, it, expect } from "vitest";
import { CommandRejected, World, defaultAppearance, getAppearance, type CosmeticCatalogLike, type WearableDef } from "@engine/core";
import { HitValidatorRes, RespawnCmd, BuyFromStallCmd, OpenStallCmd, SetAppearanceCmd, hasCreatedLook, hasUnlock } from "@engine/gameplay";
import { AppearanceResult, LoopbackNetwork, NetClient, StallResult } from "@engine/net";
import { ClaimAccount, MemoryWorldStore } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, gameplayNet, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";

const wd = (id: number, slot: WearableDef["slot"]): WearableDef => ({
  id, key: `w${id}`, slot, bodies: { male: { sprite: id, anim: "idle" }, female: { sprite: id, anim: "idle" } }, layer: 1, z: 0, tintChannels: 1, hidesSlots: [], hatHair: false, unlockTags: [],
});
const W = new Map([[1, wd(1, "hair")], [3, wd(3, "hair")]]);
const pal = [{ index: 0, key: "a", color: 0 }, { index: 1, key: "b", color: 1 }];
const catalog: CosmeticCatalogLike = { wearable: (i) => W.get(i), bodySprite: () => ({ sprite: 0, anim: "idle" }), skinTones: pal, hairColors: pal, clothingColors: pal };
const look = (hair: number) => { const a = defaultAppearance(catalog); a.parts[0] = hair; return a; };

async function setup() {
  const net = new LoopbackNetwork(3);
  const gs = createGameServer({ transport: net.createServer(), store: new MemoryWorldStore(), seed: 5, catalog });
  const clients: NetClient[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const connect = async (initial?: ReturnType<typeof look>): Promise<NetClient> => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const client = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    if (initial) client.appearance.setInitial(initial);
    const p = client.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p;
    clients.push(client); return client;
  };
  const close = (c: NetClient): void => { c.close(); clients.splice(clients.indexOf(c), 1); tick(3); };
  return { gs, tick, connect, close };
}

describe("apps/server gameplay wiring", () => {
  it("holds the join-time look until the account is claimed, then it passes the first-join rule once", async () => {
    const { gs, tick, connect } = await setup();
    const c = await connect(look(1));
    tick(5);
    const e = [...gs.players.values()][0]!.entity;
    expect(getAppearance(gs.world, e)).toBeUndefined(); // held: account not claimed yet
    expect(hasCreatedLook(gs.world, e)).toBe(false);
    c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 });
    tick(5);
    expect(getAppearance(gs.world, e)!.parts[0]).toBe(1);
    expect(hasCreatedLook(gs.world, e)).toBe(true); // onChanged -> first-join rule consumed
    expect(hasUnlock(gs.world, e, "founder")).toBe(true);
    expect(gs.appearance!.stats.applied).toBe(1);
    // later change away from a wardrobe: denied by gameplay's gate (net path and command path)
    const res = c.appearance.set(look(3)); tick(3);
    expect((await res).result).toBe(AppearanceResult.Denied);
    const rejected: string[] = []; gs.world.events.on(CommandRejected, (r) => { rejected.push(`${r.command}:${r.reason}`); });
    c.sendCommand(gameplayNet(SetAppearanceCmd), look(3)); tick(3);
    expect(rejected).toContain("gameplay.setAppearance:not_allowed");
    expect(getAppearance(gs.world, e)!.parts[0]).toBe(1);
  });

  it("bridges economy commands into gameplay handlers and routes stall buys through the buy hook", async () => {
    const { gs, tick, connect } = await setup();
    const c = await connect(); c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(3);
    const rejected: string[] = []; gs.world.events.on(CommandRejected, (r) => { rejected.push(`${r.command}:${r.reason}`); });
    c.sendCommand(gameplayNet(OpenStallCmd), { stall: 0 }); // no such stall
    c.sendCommand(gameplayNet(BuyFromStallCmd), { stall: 0, listingSlot: 0, qty: 1, expectedRevision: 0, expectedPriceItem: 0, expectedPriceCount: 0 });
    tick(3);
    expect(rejected.some((r) => r.startsWith("gameplay.openStall:"))).toBe(true);
    expect(rejected.some((r) => r.startsWith("gameplay.buyFromStall:"))).toBe(true);
    const r = c.stalls.buy(999, 1, 0, { itemId: 1, count: 1 }); tick(3);
    expect((await r).reason).toBe(StallResult.NoStall);
  });

  it("view-radius bonus: a new client starts at 0 and the bonus resets on reconnect", async () => {
    const { gs, tick, connect, close } = await setup();
    const a = await connect(); a.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(12); // past a gameplay.viewBonus pass
    const cid = [...gs.players.keys()][0]!;
    expect(gs.net.viewRadiusBonus(cid)).toBe(0);
    expect(gs.net.setViewRadiusBonus(cid, 5)).toBe(2); // capped
    expect(gs.net.viewRadiusBonus(cid)).toBe(2);
    close(a);
    const b = await connect(); b.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(12);
    const cid2 = [...gs.players.keys()][0]!;
    expect(gs.net.viewRadiusBonus(cid2)).toBe(0);
    expect(gs.net.viewRadiusBonus(cid)).toBe(0); // old session's bonus dropped with it
  });

  it("bridges gameplay.respawnPlayer (alive player is rejected) and installs the hit validator", async () => {
    const { gs, tick, connect } = await setup();
    const c = await connect(); c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(3);
    const rejected: string[] = []; gs.world.events.on(CommandRejected, (r) => { rejected.push(`${r.command}:${r.reason}`); });
    c.sendCommand(gameplayNet(RespawnCmd), {}); tick(3);
    expect(rejected.some((r) => r.startsWith("gameplay.respawnPlayer:"))).toBe(true);
    expect(gs.world.getResource(HitValidatorRes)?.fn).toBeTypeOf("function");
  });
});
