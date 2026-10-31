// ADR-248: a dedicated server builds the client's merged manifest, so customization, the cosmetics handshake hash, the
// ADR-245 skin-tone migration and appearance replication all work headless.
import { beforeAll, describe, expect, it } from "vitest";
import { Appearance, SKIN_TONE_SCHEME, World, cosmeticsHashes, defaultAppearance, getAppearance, setAppearance, validateAppearance, type CosmeticCatalogLike } from "@engine/core";
import { AppearanceResult, LoopbackNetwork, NetClient, NetRejectedError, RejectReason } from "@engine/net";
import { ClaimAccount, MemoryWorldStore } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, loadServerCatalog, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";
import { SPAWN } from "../src/game.js";

let catalog: CosmeticCatalogLike; const logs: string[] = [];
beforeAll(async () => { const c = await loadServerCatalog((m) => logs.push(m)); expect(c).toBeDefined(); catalog = c!; });

function boot(store = new MemoryWorldStore()) {
  const net = new LoopbackNetwork(3);
  const gs = createGameServer({ transport: net.createServer(), spawnPoints: [SPAWN], store, seed: 5, catalog, randomAppearance: true });
  const clients: NetClient[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const client = (hashes?: Record<string, number>): NetClient => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    return new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, ...(hashes ? { hashes } : {}), sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
  };
  const connect = async (c: NetClient, token = 0): Promise<NetClient> => {
    const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; clients.push(c);
    c.sendCommand(ClaimAccount, { t0: token, t1: 0, t2: 0, t3: 0 }); tick(4); return c;
  };
  return { net, gs, tick, client, connect, store };
}
const entOf = (gs: ReturnType<typeof boot>["gs"], c: NetClient) => gs.players.get(c.clientId!)!.entity;

describe("ADR-248 dedicated server cosmetics", () => {
  it("boots with the merged customization catalog and offers the client's cosmetics hash", () => {
    expect(catalog.skinTones.length).toBe(18);
    expect(catalog.skinTones.map((t) => t.key).slice(0, 2)).toEqual(["porcelain", "ivory"]);
    expect(catalog.skinTones.some((t) => t.key === "goblin")).toBe(false);
    const h = cosmeticsHashes(catalog)["cosmetics"]!;
    expect(h).toBeGreaterThan(0);
    expect(logs.some((l) => l.includes(`hash 0x${h.toString(16).padStart(8, "0")}`) && l.includes("customization"))).toBe(true);
    const { gs } = boot();
    expect(gs.appearance).toBeDefined(); // customization on
    expect(gs.net.offeredHashes["cosmetics"]).toBe(h);
    console.log(`[adr248] dedicated cosmetics hash 0x${h.toString(16).padStart(8, "0")}, ${catalog.skinTones.length} skin tones`);
  });

  it("accepts a client with the same cosmetics hash (or none) and rejects a mismatched one", async () => {
    const { gs, client, connect } = boot(); const h = cosmeticsHashes(catalog)["cosmetics"]!;
    await connect(client({ cosmetics: h })); await connect(client());
    expect(gs.players.size).toBe(2);
    await expect(connect(client({ cosmetics: (h ^ 1) >>> 0 }))).rejects.toSatisfy((e: unknown) => e instanceof NetRejectedError && e.reason === RejectReason.HashMismatch);
    expect(gs.players.size).toBe(2);
  });

  it("replicates appearances: B sees A's chosen look and A sees B's", async () => {
    const { gs, tick, client, connect } = boot(); const hashes = cosmeticsHashes(catalog);
    const lookA = { ...defaultAppearance(catalog, 1), skinTone: 16 }; // ebony
    const ca = client(hashes); ca.appearance.setInitial(lookA);
    const A = await connect(ca, 1);
    const B = await connect(client(hashes), 2);
    const lookB = { ...defaultAppearance(catalog, 0), skinTone: 2 };
    setAppearance(gs.world, entOf(gs, B), validateAppearance(catalog, lookB).value!); tick(8);
    expect(getAppearance(gs.world, entOf(gs, A))!.skinTone).toBe(16);
    const tonesOn = (c: NetClient) => [...c.world.query([Appearance])].map((e) => c.world.get(e, Appearance)!).map((a) => `${a.bodyType}:${a.skinTone}`).sort();
    expect(tonesOn(B)).toEqual(["0:2", "1:16"]);
    expect(tonesOn(A)).toEqual(["0:2", "1:16"]);
    const onB = [...B.world.query([Appearance])].find((e) => B.world.get(e, Appearance)!.skinTone === 16)!;
    expect([...B.world.get(onB, Appearance)!.parts]).toEqual([...getAppearance(gs.world, entOf(gs, A))!.parts]);
    // a later wardrobe-less change is still gated by gameplay (customization is live, not disabled)
    const r = A.appearance.set({ ...lookA, skinTone: 3 }); tick(3);
    expect((await r).result).not.toBe(AppearanceResult.Ok);
  });

  it("migrates a returning player's legacy skin tone (ADR-245) on a dedicated server", async () => {
    const store = new MemoryWorldStore();
    const s1 = boot(store); const a = await s1.connect(s1.client(cosmeticsHashes(catalog)), 7);
    const e = entOf(s1.gs, a);
    setAppearance(s1.gs.world, e, { ...defaultAppearance(catalog, 0), skinTone: 9 }); // legacy 12-tone ebony...
    s1.gs.world.setField(e, Appearance, "skinScheme", 0); // ...saved before ADR-245
    const p = s1.gs.players.get(a.clientId!)!; await s1.gs.persist!.savePlayer(p.account, e, p.name);
    const s2 = boot(store); const b = await s2.connect(s2.client(cosmeticsHashes(catalog)), 7); s2.tick(4);
    const v = s2.gs.world.get(entOf(s2.gs, b), Appearance)!;
    expect(v.skinTone).toBe(16); expect(v.skinScheme).toBe(SKIN_TONE_SCHEME);
    expect(catalog.skinTones[v.skinTone]!.key).toBe("ebony");
  });
});
