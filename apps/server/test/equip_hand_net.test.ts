import { describe, it, expect } from "vitest";
import { World } from "@engine/core";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { EquipCmd, Equipment, itemIdSafe, listSlots } from "@engine/gameplay";
import { createGameServer, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";
import { gameplayNet } from "../src/protocol.js";

describe("main-hand equip over the network (QA2)", () => {
  it("EquipCmd on the sword slot puts it in the main hand on server and client", async () => {
    const net = new LoopbackNetwork(3);
    const gs = createGameServer({ transport: net.createServer(), seed: 77, devSandbox: true });
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd, 1 / 20) });
    const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); c.world.step(1 / 20); c.pollEvents(Infinity); } };
    const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; tick(4);
    const e = gs.players.get(c.clientId)!.entity; const sword = itemIdSafe(gs.world, "iron_sword")!;
    const slot = listSlots(gs.world, e).find((s) => s.item === sword)!.slot;
    expect(c.sendCommand(gameplayNet(EquipCmd), { slot })).toBe(true); tick(6);
    expect(gs.world.get(e, Equipment)).toMatchObject({ mainHandSlot: slot, mainHandItem: sword });
  }, 20_000);
});
