import { describe, it, expect } from "vitest";
import { Transform, World, type Entity } from "@engine/core";
import { LoopbackNetwork, NetClient, netIdOf } from "@engine/net";
import { partyInviteIntent, PartyInvites } from "@engine/gameplay";
import { createGameServer, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";
import { gameplayNet, onGameplayRejected } from "../src/protocol.js";
import { ClaimAccount } from "@engine/persist";
import { intentPayload } from "../../client/src/send-intent.js";

describe("QA2: panel intents with entity args (party invite) reach the server", () => {
  it("entity fields the net def maps are not double-converted", async () => {
    const net = new LoopbackNetwork(3);
    const gs = createGameServer({ transport: net.createServer(), seed: 77, devSandbox: true });
    const cs: NetClient[] = [];
    const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of cs) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
    for (let k = 0; k < 2; k++) {
      const world = new World({ seed: 1 }); installDemoWorld(world, "client");
      const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd, 1 / 20) });
      const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; cs.push(c); c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(4);
    }
    tick(10);
    const [A, B] = cs as [NetClient, NetClient];
    const bServer = gs.players.get(B.clientId)!.entity; const bNet = netIdOf(gs.world, bServer)!;
    const bOnA = [...A.world.query([Transform])].find((e) => netIdOf(A.world, e) === bNet) as Entity; expect(bOnA).toBeDefined();
    const rej: string[] = []; onGameplayRejected(A, (r) => rej.push(r.reason));
    const i = partyInviteIntent(bOnA); const def = gameplayNet(i.cmd);
    const args = intentPayload(i.args as Record<string, number>, i.entities, def.entityFields, (e) => netIdOf(A.world, e as Entity));
    expect(args).toEqual({ target: bOnA }); // left for NetClient to convert
    expect(A.sendCommand(def, args as never)).toBe(true); tick(6); expect(rej).toEqual([]);
    expect([...(gs.world.getResource(PartyInvites)?.values() ?? [])].flat().length).toBe(1);
  }, 20_000);
});
