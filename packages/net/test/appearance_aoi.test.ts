/** Regression ("characters pop in/out, customizations don't reliably show"): a remote player's full Appearance rides
 *  every entity create and survives AOI leave / re-enter; edge jitter never despawns it (interestLinger). */
import { describe, expect, it } from "vitest";
import { Appearance, Owner, Transform, defaultAppearance, getAppearance, setAppearance, type CosmeticCatalogLike, type Entity, type WearableDef } from "@engine/core";
import { CHUNK_SIZE } from "@engine/world";
import { LoopbackNetwork, NetClient, NetServer } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";
const art = { sprite: 1, anim: "idle" };
const wear = (id: number, slot: WearableDef["slot"]): WearableDef => ({ id, key: `w${id}`, slot, bodies: { male: art, female: art }, layer: 0, z: 0, tintChannels: 1, hidesSlots: [], hatHair: false, unlockTags: [] });
const W = new Map([[1, wear(1, "hair")], [3, wear(3, "top")]]);
const pal = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, key: `c${i}`, color: i }));
const cat: CosmeticCatalogLike = { wearable: (id) => W.get(id), bodySprite: () => art, skinTones: pal(4), hairColors: pal(4), clothingColors: pal(4), defaults: { hair: 1 } };

const aw = () => { const w = makeWorld(); w.register(Appearance); return w; };

describe("remote appearance across AOI leave / re-enter (two clients)", () => {
  it("B sees A's exact look on first spawn, after jitter at the AOI edge, and after a full leave + re-enter with a change made while away", async () => {
    const net = new LoopbackNetwork(11); const sw = aw(); const players = new Map<number, Entity>();
    const server = new NetServer({ world: sw, transport: net.createServer(), interest: { radius: 1, hysteresis: 1 },
      onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: 5, y: 5 + s.clientId }).add(e, Owner, { clientId: s.clientId }); players.set(s.clientId, e); } });
    const A = new NetClient({ world: aw(), transport: net.createClient({ latencyMs: 15 }) });
    const B = new NetClient({ world: aw(), transport: net.createClient({ latencyMs: 25 }) });
    await join(net, A); await join(net, B);
    const eA = players.get(1)!; const look = defaultAppearance(cat); look.skinTone = 3; look.parts[0] = 1; look.parts[3] = 3; look.primary[3] = 2;
    setAppearance(sw, eA, look);
    const ws = [sw, A.world, B.world]; const step = (n: number) => frames(net, ws, n);
    const idA = () => server.netIds.netIdOf(eA)!;
    const onB = () => { const e = B.entityOf(idA()); return e === undefined ? undefined : getAppearance(B.world, e); };
    let spawnsWithoutLook = 0, spawns = 0;
    (B as unknown as { opts: { onSpawn?: (e: Entity, id: number, owned: boolean, w: typeof sw) => void } }).opts.onSpawn = (e, id, _o, w) => {
      if (id !== idA()) return; spawns++; if (!w.has(e, Appearance)) spawnsWithoutLook++; };
    step(8);
    expect(onB()).toMatchObject({ skinTone: 3 }); expect(onB()!.parts.slice(0, 4)).toEqual([1, 0, 0, 3]);
    const firstOnB = B.entityOf(idA());
    // walk A along B's AOI edge (chunk leave radius r + h = 2): no despawn / respawn churn on B
    for (let k = 0; k < 16; k++) { sw.setField(eA, Transform, "x", (k & 1 ? 3.2 : 2.8) * CHUNK_SIZE); step(2); expect(B.entityOf(idA())).toBe(firstOnB); }
    // far away: B drops A; A changes its look meanwhile
    sw.setField(eA, Transform, "x", 9 * CHUNK_SIZE); step(server.tickHz * 2 + 8);
    expect(B.entityOf(idA())).toBeUndefined();
    const look2 = { ...look, skinTone: 1, parts: [...look.parts] }; look2.parts[3] = 0; setAppearance(sw, eA, look2);
    step(4);
    // back in view: fresh create carries the full, current Appearance on the very same snapshot
    sw.setField(eA, Transform, "x", 6); step(8);
    expect(onB()).toMatchObject({ skinTone: 1 }); expect(onB()!.parts.slice(0, 4)).toEqual([1, 0, 0, 0]);
    expect(onB()!.version).toBe(getAppearance(sw, eA)!.version);
    expect(spawns).toBeGreaterThanOrEqual(2); expect(spawnsWithoutLook).toBe(0);
  });
});
