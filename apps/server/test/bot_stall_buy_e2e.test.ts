import { describe, it, expect } from "vitest";
import { NetId, PlayerId, Transform, World, type Entity } from "@engine/core";
import {
  addItem, buildAgentView, countItem, defaultDefs, emitAgentCommands, listSlots, makeAgent, makeAgentIdentity, placePiece, setListing, setStallOpen,
  snapPlacement, stallListing, stallOf, stockStall, survivalBehaviors, tillOf, type AgentWorldView,
} from "@engine/gameplay";
import type { AgentContext, AgentOutput } from "@engine/core";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { ClaimAccount, MemoryWorldStore } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";

const d = defaultDefs(); const COIN = d.itemId("coin"), PLANK = d.itemId("planks");

describe("bot buys from a real stall end-to-end (replica sensors -> agent commands -> server)", () => {
  it("stall_trade on the bot's NetClient replica opens the stall, buys, and the server moves goods + coin", async () => {
    const net = new LoopbackNetwork(9);
    const gs = createGameServer({ transport: net.createServer(), store: new MemoryWorldStore(), seed: 5 }); const w = gs.world;
    const cs: NetClient[] = [];
    const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of cs) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
    const connect = async () => {
      const world = new World({ seed: 1 }); installDemoWorld(world, "client");
      const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (ww, e, cmd) => applyMoveInput(ww, e, cmd) });
      const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; cs.push(c);
      c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(3);
      const e = gs.players.get(c.clientId!)!.entity; return { c, e, pid: w.getField(e, PlayerId, "id")! };
    };
    const A = await connect(), B = await connect();
    const pa = w.get(A.e, Transform)!;
    const sn = snapPlacement(w, { piece: d.pieceId("stall_booth"), x: Math.floor(pa.x) + 1, y: Math.floor(pa.y), level: 0, rot: 0, tier: 0, variant: 0 }); if (typeof sn === "number") throw new Error(`snap ${sn}`);
    const stall = stallOf(w, placePiece(w, A.e, sn, { pay: false }))!;
    addItem(w, A.e, PLANK, 20, A.pid);
    expect(stockStall(w, A.e, stall, 0, listSlots(w, A.e).find((x) => x.item === PLANK)!.slot, 20)).toBeUndefined();
    expect(setListing(w, A.e, stall, 0, { priceItem: COIN, priceCount: 3, qty: 5, enabled: 1 })).toBeUndefined();
    expect(setStallOpen(w, A.e, stall, 1)).toBeUndefined();
    addItem(w, B.e, COIN, 10);
    const st = w.get(stall, Transform)!; w.set(B.e, Transform, { x: st.x + 1, y: st.y }); tick(5);

    const agent = makeAgent(makeAgentIdentity(5, 1, "bot_gatherer"), 1);
    const beh = survivalBehaviors().find((b) => b.name === "stall_trade")!;
    const byName = new Map(DEMO_COMMANDS.map((c) => [c.name, c]));
    const sent: string[] = []; const rejected: string[] = []; B.c.onCommandRejected((r) => rejected.push(r.detail ?? ""));
    for (let i = 0; i < 200 && countItem(w, B.e, PLANK) === 0; i++) {
      const self = B.c.entities.get(w.getField(B.e, NetId, "id")!) as Entity | undefined;
      const v = self === undefined ? undefined : buildAgentView(B.c.world, self, agent, { x: st.x, y: st.y });
      if (v) {
        const c: AgentContext<AgentWorldView> = { ...v, bb: agent.bb, memory: agent.memory, traits: agent.identity.traits, rng: agent.rng, agent };
        const o = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, sprint: false, actions: [] as string[] } as AgentOutput & { commands?: { type: string; payload: unknown }[] };
        if (v.world.stall) beh.run(c, o);
        for (const cmd of emitAgentCommands(o).commands ?? []) { sent.push(cmd.type); B.c.sendCommand(byName.get(cmd.type)! as never, cmd.payload as never); }
      }
      tick(5);
    }
    expect(sent).toEqual(["gameplay.openStall", "gameplay.buyFromStall"]); expect(rejected).toEqual([]); // one lot (qty is the lot size)
    expect(countItem(w, B.e, PLANK)).toBe(5); expect(countItem(w, B.e, COIN)).toBe(7);
    expect(countItem(w, tillOf(w, stall)!, COIN)).toBe(3); expect(stallListing(w, stall, 0)!.stock).toBe(15);
    expect(listSlots(w, B.e).filter((x) => x.item === PLANK).every((x) => x.crafterId === A.pid)).toBe(true);
    await gs.shutdown();
  });
});
