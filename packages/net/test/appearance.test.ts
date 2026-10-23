import { describe, expect, it } from "vitest";
import { Appearance, Owner, SLOT_COUNT, Transform, defaultAppearance, getAppearance, setAppearance, type CosmeticCatalogLike, type Entity, type WearableDef } from "@engine/core";
import { AppearanceResult, AppearanceServer, LoopbackNetwork, NetClient, NetRejectedError, NetServer, RejectReason } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

const art = { sprite: 1, anim: "idle" };
const wear = (id: number, slot: WearableDef["slot"], unlockTags: string[] = []): WearableDef =>
  ({ id, key: `w${id}`, slot, bodies: { male: art, female: art }, layer: 0, z: 0, tintChannels: 1, hidesSlots: [], hatHair: false, unlockTags });
const W = new Map([[1, wear(1, "hair")], [2, wear(2, "hat", ["crown"])], [3, wear(3, "top")]]);
const pal = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, key: `c${i}`, color: i }));
export const cat: CosmeticCatalogLike = { wearable: (id) => W.get(id), bodySprite: () => art, skinTones: pal(4), hairColors: pal(4), clothingColors: pal(4), defaults: { hair: 1 } };
const look = (parts: Record<number, number>, skinTone = 1) => { const v = defaultAppearance(cat); v.skinTone = skinTone; for (const [i, p] of Object.entries(parts)) v.parts[+i] = p; return v; };
const aw = (o?: { extra?: boolean }) => { const w = makeWorld(o); w.register(Appearance); return w; };

function setup(spawnOnJoin = true) {
  const net = new LoopbackNetwork(5); const sw = aw(); const players = new Map<number, Entity>();
  const spawn = (cid: number) => { const e = sw.create(); sw.add(e, Transform, { x: 0, y: cid }).add(e, Owner, { clientId: cid }); players.set(cid, e); return e; };
  const server = new NetServer({ world: sw, transport: net.createServer(), interest: false, ...(spawnOnJoin ? { onClientJoin: (s: { clientId: number }) => { spawn(s.clientId); } } : {}) });
  const unlocks = new Map<number, Set<string>>();
  const changed: number[] = [];
  const app = new AppearanceServer(server, { catalog: cat, unlocksOf: (s) => unlocks.get(s.clientId) ?? new Set(), rate: { perSec: 0.2, burst: 3 }, onChanged: (_s, _e, _v, ver) => changed.push(ver) });
  const mk = () => new NetClient({ world: aw(), transport: net.createClient({ latencyMs: 20 }) });
  return { net, sw, server, app, players, spawn, unlocks, changed, mk };
}
const flush = async (net: LoopbackNetwork, worlds: { step(dt: number): void }[], n = 6) => { for (let i = 0; i < n; i++) { await Promise.resolve(); frames(net, worlds, 1); } };

describe("appearance", () => {
  it("initial look at first join, replicated with version; later set validated against unlocks; version bumps reach others", async () => {
    const t = setup(); const A = t.mk(); const B = t.mk();
    A.appearance.setInitial(look({ 0: 1, 3: 3 }, 2));
    await join(t.net, A); await join(t.net, B);
    const ws = [t.sw, A.world, B.world];
    await flush(t.net, ws, 8);
    expect(A.appearance.initialResult?.result).toBe(AppearanceResult.Ok);
    const eA = t.players.get(1)!; expect(getAppearance(t.sw, eA)).toMatchObject({ skinTone: 2, version: 0 });
    expect(getAppearance(t.sw, eA)!.parts.slice(0, 5)).toEqual([1, 0, 0, 3, 0]);
    const onB = () => [...B.world.query([Appearance, Transform])].find((e) => B.world.get(e, Transform)!.y === 1)!;
    expect(getAppearance(B.world, onB())).toMatchObject({ skinTone: 2, version: 0 });

    // locked hat: rejected with the first issue; nothing written
    const p1 = A.appearance.set(look({ 0: 1, 1: 2 })); await flush(t.net, ws);
    expect(await p1).toMatchObject({ result: AppearanceResult.Invalid, issue: "hat: wearable w2 is locked" });
    expect(getAppearance(t.sw, eA)!.version).toBe(0);
    t.unlocks.set(1, new Set(["crown"]));
    const p2 = A.appearance.set(look({ 0: 1, 1: 2 }, 3)); await flush(t.net, ws);
    expect((await p2).result).toBe(AppearanceResult.Ok);
    expect(getAppearance(B.world, onB())).toMatchObject({ skinTone: 3, version: 1 });
    expect(getAppearance(B.world, onB())!.parts[1]).toBe(2);
    expect(t.changed).toEqual([0, 1]);
    // bad palette index is invalid too (reject mode never clamps)
    frames(t.net, ws, 120); // refill (burst 3 spent: initial + 2 sets)
    const p3 = A.appearance.set(look({}, 9)); await flush(t.net, ws);
    expect(await p3).toMatchObject({ result: AppearanceResult.Invalid, issue: "bad skinTone 9" });

    expect(getAppearance(t.sw, eA)!.parts.length).toBe(SLOT_COUNT);
  });

  it("rate limited per client (burst 3 incl. initial), refills over time", async () => {
    const t = setup(); const A = t.mk(); await join(t.net, A); const ws = [t.sw, A.world];
    await flush(t.net, ws, 2);
    const ps = [1, 2, 3, 0].map((s) => A.appearance.set(look({}, s))); await flush(t.net, ws);
    const rs = await Promise.all(ps);
    expect(rs.map((r) => r.result)).toEqual([0, 0, 0, AppearanceResult.RateLimited]);
    expect(getAppearance(t.sw, t.players.get(1)!)).toMatchObject({ skinTone: 3, version: 2 });
    frames(t.net, ws, 120); // 0.2/s * 6 s -> 1 token
    const p = A.appearance.set(look({}, 0)); await flush(t.net, ws); expect((await p).result).toBe(AppearanceResult.Ok);
  });

  it("initial look arriving before the player entity exists is applied when it spawns", async () => {
    const t = setup(false); const A = t.mk(); A.appearance.setInitial(look({ 6: 0 }, 3));
    await join(t.net, A); const ws = [t.sw, A.world]; await flush(t.net, ws, 4);
    expect(A.appearance.initialResult).toBeUndefined();
    const e = t.spawn(1); await flush(t.net, ws, 6);
    expect(A.appearance.initialResult?.result).toBe(AppearanceResult.Ok);
    expect(getAppearance(t.sw, e)).toMatchObject({ skinTone: 3, version: 0 });
    // set without an entity -> NoEntity
    t.sw.destroy(e); await flush(t.net, ws, 2);
    const p = A.appearance.set(look({})); await flush(t.net, ws); expect((await p).result).toBe(AppearanceResult.NoEntity);
  });

  it("schema mismatch (client built without Appearance) is rejected with a clear error", async () => {
    const t = setup(); const old = new NetClient({ world: makeWorld(), transport: t.net.createClient({ latencyMs: 20 }) });
    const err = await join(t.net, old).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetRejectedError);
    expect((err as NetRejectedError).reason).toBe(RejectReason.SchemaMismatch);
    expect((err as Error).message).toMatch(/schema hash mismatch.*client and server must ship together/);
    expect(t.server.sessions.size).toBe(0);
  });
});
