import { describe, it, expect } from "vitest";
import { PlayerId, Transform, World, type Entity } from "@engine/core";
import { addItem, applyDamage, countItem, Dead, deathBagsOf, defaultDefs, Health, isBedKey, LootBag, placePiece, PVP, RespawnCmd, snapPlacement, Survival } from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { ClaimAccount, MemoryWorldStore } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, gameplayNet, onGameplayRejected, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";

const d = defaultDefs(); const PLANK = d.itemId("planks");
async function setup() {
  const net = new LoopbackNetwork(3);
  const gs = createGameServer({ transport: net.createServer(), store: new MemoryWorldStore(), seed: 5 });
  const clients: NetClient[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const connect = async () => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; clients.push(c);
    c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(3);
    const e = gs.players.get(c.clientId!)!.entity; return { c, e, pid: gs.world.getField(e, PlayerId, "id")! };
  };
  return { gs, tick, connect };
}
/** The replica entity a client holds for server entity `e` (by PlayerId). */
const replicaOf = (c: NetClient, pid: number): Entity | undefined => [...c.world.query([PlayerId])].find((x) => c.world.getField(x, PlayerId, "id") === pid);
const T = (n: number) => Math.ceil(n * 20);

describe("ADR-153 die -> respawn (multiplayer, server authoritative)", () => {
  it("death drops a bag both clients see; Respawn resets vitals, moves the player, and the other client sees it alive", async () => {
    const { gs, tick, connect } = await setup(); const w = gs.world;
    const A = await connect(); const B = await connect(); tick(5);
    { const a = w.get(A.e, Transform)!; w.set(B.e, Transform, { x: a.x + 2, y: a.y, z: 0 }); } tick(10); // B stands next to A
    addItem(w, A.e, PLANK, 7, A.pid); tick(2);
    w.setField(A.e, Survival, "hunger", 3); w.setField(A.e, Survival, "thirst", 2);
    const deathAt = { ...w.get(A.e, Transform)! };
    applyDamage(w, A.e, 1e6, A.e); tick(3);
    expect(w.has(A.e, Dead)).toBe(true);
    const ra = replicaOf(A.c, A.pid)!; expect(A.c.world.has(ra, Dead)).toBe(true);
    const bags = deathBagsOf(w, A.pid); expect(bags).toHaveLength(1); expect(bags[0]!.x).toBeCloseTo(deathAt.x, 3);
    expect(countItem(w, A.e, PLANK)).toBe(0);
    expect(B.c.world.has(replicaOf(B.c, A.pid)!, Dead)).toBe(true); // the other client sees the death
    expect(deathBagsOf(B.c.world, A.pid)).toHaveLength(1);
    expect(deathBagsOf(A.c.world, A.pid)).toHaveLength(1); // the owner's compass has a target
    // too soon: rejected, still dead
    A.c.sendCommand(gameplayNet(RespawnCmd), {} as never); tick(3); expect(w.has(A.e, Dead)).toBe(true);
    tick(T(PVP.respawnSeconds));
    const rej: string[] = []; onGameplayRejected(A.c, (r) => rej.push(r.reason));
    A.c.sendCommand(gameplayNet(RespawnCmd), {} as never); tick(5); expect(rej).toEqual([]);
    expect(w.has(A.e, Dead)).toBe(false);
    expect(w.getField(A.e, Health, "hp")).toBeGreaterThan(0);
    expect(w.getField(A.e, Survival, "hunger")).toBeCloseTo(PVP.respawnHunger, 0); expect(w.getField(A.e, Survival, "thirst")).toBeCloseTo(PVP.respawnThirst, 0);
    const at = w.get(A.e, Transform)!; w.set(B.e, Transform, { x: at.x + 1, y: at.y, z: 0 }); tick(10); // B walks over (respawn point may be outside B's view)
    expect(A.c.world.has(replicaOf(A.c, A.pid)!, Dead)).toBe(false);
    const rb = replicaOf(B.c, A.pid)!; expect(rb).toBeDefined(); expect(B.c.world.has(rb, Dead)).toBe(false);
    // the bag stays at the death spot with the items
    const bag = deathBagsOf(w, A.pid)[0]!; expect(w.has(bag.bag, LootBag)).toBe(true); expect(bag.x).toBeCloseTo(deathAt.x, 3);
  });

  it("respawns beside the player's own bed", async () => {
    const { gs, tick, connect } = await setup(); const w = gs.world;
    const A = await connect(); tick(5);
    const p = w.get(A.e, Transform)!; const bx = Math.floor(p.x) + 3, by = Math.floor(p.y) + 3;
    const sn = snapPlacement(w, { piece: d.pieceId("bed"), x: bx, y: by, level: 0, rot: 0, tier: 0, variant: 0 }); if (typeof sn === "number") throw new Error(`snap ${sn}`);
    const bed = placePiece(w, A.e, sn, { pay: false }); const bt = w.get(bed, Transform)!;
    w.set(A.e, Transform, { x: p.x + 40, y: p.y + 40, z: 0 }); tick(2);
    applyDamage(w, A.e, 1e6, A.e); tick(T(PVP.respawnSeconds) + 2);
    A.c.sendCommand(gameplayNet(RespawnCmd), {} as never); tick(3);
    expect(w.has(A.e, Dead)).toBe(false);
    const t = w.get(A.e, Transform)!; expect(Math.hypot(t.x - bt.x, t.y - bt.y)).toBeLessThan(2);
    expect(isBedKey("bed") && isBedKey("bunk_bed") && !isBedKey("garden_bed") && !isBedKey("flower_bed")).toBe(true);
  });
});
describe("ADR-153 no-bed respawn stays local", () => {
  it("respawns at the world spawn point nearest the death spot (tutorial players come back to their start area)", async () => {
    const { gs, tick, connect } = await setup(); const w = gs.world;
    const A = await connect(); tick(5); const start = { ...w.get(A.e, Transform)! };
    w.set(A.e, Transform, { x: start.x + 6, y: start.y + 4, z: 0 }); tick(2);
    applyDamage(w, A.e, 1e6, A.e); tick(T(PVP.respawnSeconds) + 2);
    A.c.sendCommand(gameplayNet(RespawnCmd), {} as never); tick(3);
    expect(w.has(A.e, Dead)).toBe(false);
    const t = w.get(A.e, Transform)!; expect(Math.hypot(t.x - start.x, t.y - start.y)).toBeLessThan(12);
  });
});
