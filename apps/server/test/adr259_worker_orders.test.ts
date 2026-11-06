import { describe, expect, it } from "vitest";
import { installPermissions, PlayerId, Transform, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { encodePlayer, decodePlayerInto, ClaimAccount } from "@engine/persist";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { createGameServer, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";
import { gameplayNet, GAMEPLAY_NET_COMMANDS } from "../src/protocol.js";

function setup() {
  const w = new World(); G.installGameplay(w); installPermissions(w);
  const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0 }); w.add(p, PlayerId, { id: 7 });
  const bot = G.spawnPlayer(w, { x: 1, y: 0, maxWeight: 0 }); w.add(bot, PlayerId, { id: 9 });
  G.ensureWorker(w, bot); w.set(bot, G.Worker, { owner: 7, job: G.WorkerJob.Gather });
  return { w, p, bot, defs: G.gameplayDefs(w) };
}
describe("ADR-259 persisted and networked worker details", () => {
  for (const job of G.WORKER_JOBS) it(`round-trips assignment for job ${job} with changed runtime entity ids`, () => {
    const { w, p, bot, defs } = setup();
    const selections = job === G.WorkerJob.Gather ? [defs.itemId("wood"), defs.itemId("stone")] : job === G.WorkerJob.Craft ? [[...defs.recipes.values()].find((r) => r.key === "torch")!.id] : [];
    const target = job === G.WorkerJob.Defend ? { kind: 2, target: p } : job === G.WorkerJob.Farm || job === G.WorkerJob.Maintain ? { kind: 1, x: 18, y: 24 } : {};
    expect(G.setWorkerJob(w, p, bot, job, { selections, ...target })).toBe(0);
    const bytes = encodePlayer(w, bot), w2 = new World(); G.installGameplay(w2); installPermissions(w2);
    w2.create(); w2.create();
    const p2 = G.spawnPlayer(w2, { x: 6, y: 5 }); w2.add(p2, PlayerId, { id: 7 });
    const bot2 = G.spawnPlayer(w2, { x: 2, y: 0 }); w2.add(bot2, PlayerId, { id: 9 });
    const result = decodePlayerInto(w2, bot2, bytes); expect(result.restored).toContain("WorkerOrder");
    expect(G.workerSelections(w2, bot2)).toEqual(selections);
    expect(w2.get(bot2, G.WorkerOrder)).toEqual(w.get(bot, G.WorkerOrder));
    expect(w2.getField(bot2, G.Worker, "job")).toBe(job);
    if (job === G.WorkerJob.Defend) expect(G.workerOrderTarget(w2, bot2)).toBe(p2);
    if (job === G.WorkerJob.Follow) expect(G.workerWorkAnchor(w2, bot2)).toEqual({ x: 6, y: 5 });
  });
  it("structure target identity survives the STRC sidecar and resolves after reload", () => {
    const { w, p, bot, defs } = setup();
    const sn = G.snapPlacement(w, { piece: defs.pieceId("foundation"), x: 4, y: 4, level: 0, rot: 0, tier: 0, variant: 0 });
    if (typeof sn === "number") throw new Error("snap");
    const piece = G.placePiece(w, p, sn, { pay: false });
    const ck = G.structures(w).info.get(piece)!.ck; const before = G.structureChunkVersion(w, ck);
    expect(G.setWorkerJob(w, p, bot, G.WorkerJob.Defend, { kind: 2, target: piece })).toBe(0);
    expect(G.structureChunkVersion(w, ck)).toBeGreaterThan(before);
    const bytes = G.encodeStructures(w, 0, 0), player = encodePlayer(w, bot);
    const { w: w2, bot: bot2 } = setup();
    const pieces = G.decodeStructures(w2, bytes).pieces;
    decodePlayerInto(w2, bot2, player);
    expect(pieces).toHaveLength(1); expect(G.workerOrderTarget(w2, bot2)).toBe(pieces[0]);
    expect(w2.getField(pieces[0]!, G.WorkerTarget, "id")).toBe(w.getField(piece, G.WorkerTarget, "id"));
    expect(G.workerWorkAnchor(w2, bot2)).toEqual({ x: w2.get(pieces[0]!, Transform)!.x, y: w2.get(pieces[0]!, Transform)!.y });
  });
  it("command bridge maps both entity references, selections use fixed bounded payload, replicas expose stable ids", () => {
    const cmd = GAMEPLAY_NET_COMMANDS.find((c) => c.core === G.SetWorkerJobCmd)!;
    expect(cmd.net.entityFields).toEqual(["worker", "target"]);
    expect(G.SetWorkerJobCmd.schema.selections).toEqual({ type: "u16", length: 16 });
    expect(G.WorkerOrder.networked && G.WorkerOrder.persistent).toBe(true);
    expect(G.WorkerTarget.networked && G.WorkerTarget.persistent).toBe(true);
  });
  it("two peers receive selections and resolve a stable animal target after owner-authorized commands", async () => {
    const net = new LoopbackNetwork(3); const gs = createGameServer({ transport: net.createServer(), seed: 77, devSandbox: true });
    const clients: NetClient[] = [];
    const tick = (n = 1) => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
    const join = async () => {
      const world = new World(); installDemoWorld(world, "client");
      const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd, 1 / 20) });
      clients.push(c); const promise = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await promise; c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(3);
      gs.world.set(gs.players.get(c.clientId)!.entity, Transform, { x: 16, y: 16 }); tick(6); return c;
    };
    const a = await join(), b = await join(); const actor = gs.players.get(a.clientId)!.entity;
    const pid = gs.world.getField(actor, PlayerId, "id")!, pos = gs.world.get(actor, Transform)!;
    const bot = G.spawnPlayer(gs.world, { x: pos.x + 1, y: pos.y }); gs.world.add(bot, PlayerId, { id: 9001 }); G.ensureWorker(gs.world, bot); gs.world.set(bot, G.Worker, { owner: pid, job: G.WorkerJob.Gather });
    const pet = gs.world.create(); gs.world.add(pet, Transform, { x: pos.x + 2, y: pos.y }).add(pet, G.Pet, { owner: pid, hp: 100 });
    gs.net.netIds.assign(bot); gs.net.netIds.assign(pet);
    tick(10);
    const replica = (c: NetClient) => [...c.world.query([G.Worker])].find((e) => c.world.getField(e, G.Worker, "owner") === pid)!;
    expect(replica(a)).toBeDefined(); expect(replica(b)).toBeDefined();
    const selections = [G.gameplayDefs(gs.world).itemId("stone")];
    expect(a.sendCommand(gameplayNet(G.SetWorkerJobCmd), { worker: replica(a), job: G.WorkerJob.Gather, selections, kind: 0, target: G.WORKER_NO_TARGET, x: 0, y: 0 })).toBe(true); tick(10);
    expect(G.workerSelections(gs.world, bot)).toEqual(selections); expect(G.workerSelections(b.world, replica(b))).toEqual(selections);
    const clientPet = [...a.world.query([G.Pet])].find((e) => a.world.getField(e, G.Pet, "owner") === pid)!;
    expect(a.sendCommand(gameplayNet(G.SetWorkerJobCmd), { worker: replica(a), job: G.WorkerJob.Defend, selections: [], kind: 2, target: clientPet, x: 0, y: 0 })).toBe(true); tick(10);
    expect(G.workerOrderTarget(gs.world, bot)).toBe(pet);
    const targetB = G.workerOrderTarget(b.world, replica(b)); expect(targetB).toBeDefined(); expect(b.world.getField(targetB!, G.Pet, "owner")).toBe(pid);
    expect(b.sendCommand(gameplayNet(G.SetWorkerJobCmd), { worker: replica(b), job: G.WorkerJob.Follow, selections: [], kind: 0, target: G.WORKER_NO_TARGET, x: 0, y: 0 })).toBe(true); tick(10);
    expect(gs.world.getField(bot, G.Worker, "job")).toBe(G.WorkerJob.Defend);
    for (const c of clients) c.close(); await gs.shutdown();
  }, 20_000);

});
