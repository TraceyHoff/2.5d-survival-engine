/**
 * Crafting replication pattern (fake components standing in for gameplay's Crafter/Inventory):
 *  - the client predicts PROGRESS only (Craft.progress, via the shared sim system on its predicted entity);
 *  - the result arrives through the owner-scoped inventory component + a reliable owner-scoped event;
 *  - the client never creates items locally (its sim system skips the completion branch when not authoritative);
 *  - a server-side refusal is forwarded as a command rejection and reconciliation resets predicted progress.
 */
import { describe, expect, it } from "vitest";
import { defineComponent, Owner, Transform, type Entity, type World } from "@engine/core";
import { LoopbackNetwork, NetClient, NetServer, defineCommand, defineNetEvent } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

const Craft = defineComponent("Craft", { recipe: "u16", progress: "u16", total: "u16" }, { networked: true });
const Bag = defineComponent("Bag", { item: { type: "u16", length: 4 }, count: { type: "u16", length: 4 } }, { networked: true });
const StartCraft = defineCommand("StartCraft", { recipe: "u16" });
const CraftDone = defineNetEvent("CraftDone", { recipe: "u16", item: "u16", count: "u16" });
const RECIPE = { 5: { item: 77, count: 2, ticks: 10, needs: 11 } } as Record<number, { item: number; count: number; ticks: number; needs: number }>;

function mk(authority: boolean, emit?: (e: Entity, recipe: number) => void): World {
  const w = makeWorld(); w.register(Craft); w.register(Bag);
  w.addSystem("simulation", "craft", (world) => {
    for (const e of world.query([Craft])) {
      const c = world.get(e, Craft)!; if (!c.recipe) continue;
      if (!authority && !world.predicted.has(e)) continue;
      if (c.progress + 1 < c.total) { world.setField(e, Craft, "progress", c.progress + 1); continue; }
      if (!authority) { world.setField(e, Craft, "progress", c.total); continue; } // client: hold at 100%, wait for the server
      const r = RECIPE[c.recipe]!;
      const b = world.get(e, Bag)! as unknown as { item: number[]; count: number[] };
      const i = b.item.indexOf(r.needs); b.item[i] = r.item; b.count[i] = r.count; // consume ingredient, add output (atomic here)
      world.set(e, Bag, b as never);
      world.set(e, Craft, { recipe: 0, progress: 0, total: 0 });
      emit?.(e, c.recipe);
    }
  });
  return w;
}

describe("crafting replication pattern", () => {
  it("client predicts progress only; items arrive via owner-scoped inventory + reliable event", async () => {
    const net = new LoopbackNetwork(31); let server!: NetServer; let doneTick = -1; const ents = new Map<number, Entity>();
    const sw = mk(true, (e, recipe) => { doneTick = sw.tick; const o = sw.getField(e, Owner, "clientId")!; const r = RECIPE[recipe]!; server.emitEvent(CraftDone, { recipe, item: r.item, count: r.count }, { reliable: true, scope: { owner: o } }); });
    server = new NetServer({ world: sw, transport: net.createServer(), commands: [StartCraft], events: [CraftDone], interest: false,
      onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: s.clientId, y: 0 }).add(e, Owner, { clientId: s.clientId }).add(e, Craft, {}).add(e, Bag, { item: [11, 0, 0, 0], count: [1, 0, 0, 0] }); ents.set(s.clientId, e); } });
    server.setScope(Bag, "owner").setScope(Craft, "owner");
    server.onCommand(StartCraft, (s, p, w) => {
      const e = ents.get(s.clientId)!; const b = w.get(e, Bag) as unknown as { item: number[] };
      if (!b.item.includes(RECIPE[p.recipe]!.needs)) { server.rejectCommand(s.clientId, StartCraft, 1, "MissingIngredients"); return; }
      w.set(e, Craft, { recipe: p.recipe, progress: 0, total: RECIPE[p.recipe]!.ticks });
    });
    const clients = [0, 1].map(() => new NetClient({ world: mk(false), transport: net.createClient({ latencyMs: 60, loss: 0.1 }), commands: [StartCraft], events: [CraftDone] }));
    for (const c of clients) await join(net, c);
    const [A, B] = clients as [NetClient, NetClient];
    const step = (n = 1) => frames(net, [sw, A.world, B.world], n);
    step(5);
    const me = A.entityOf([...A.owned][0]!)!;
    const bagWrites: number[] = []; // every local Bag change on the client must come from a snapshot
    const bag0 = JSON.stringify(A.world.get(me, Bag));
    A.sendCommand(StartCraft, { recipe: 5 }); step(4);
    // the client starts predicting once the server's job state arrives (owner-scoped Craft), then runs ahead locally
    const progress: number[] = [];
    let done: { item: number; count: number } | undefined;
    A.onEvent(CraftDone, (p) => { done = { item: p.item, count: p.count }; });
    for (let i = 0; i < 20; i++) {
      step(); progress.push(A.world.getField(me, Craft, "progress")!);
      A.pollEvents(Infinity);
      const now = JSON.stringify(A.world.get(me, Bag)); if (now !== bag0) bagWrites.push(A.latestTick);
    }
    expect(Math.max(...progress)).toBeGreaterThan(3); // progress was visible (predicted + reconciled)
    expect(done).toEqual({ item: 77, count: 2 }); // reliable owner event
    const bag = A.world.get(me, Bag) as unknown as { item: number[]; count: number[] };
    expect(bag.item[0]).toBe(77); expect(bag.count[0]).toBe(2); // result came through the owner-scoped inventory
    expect(B.pollEvents(Infinity).filter((e) => e.def === CraftDone).length).toBe(0); // not B's event
    const aOnB = B.entityOf(server.netIds.netIdOf(ents.get(1)!)!)!; expect(B.world.has(aOnB, Bag)).toBe(false); // owner scope
    // the client never minted the item itself: its Bag only changed once the server's snapshot carried it
    expect(bagWrites.length).toBeGreaterThan(0); expect(bagWrites[0]!).toBeGreaterThanOrEqual(doneTick);
    // refusal: no ingredient left -> rejection reaches the client, predicted progress stays 0
    A.sendCommand(StartCraft, { recipe: 5 }); step(6);
    expect(A.rejections.at(-1)).toMatchObject({ reason: 1, detail: "MissingIngredients" });
    expect(A.world.getField(me, Craft, "recipe")).toBe(0);
  });
});
