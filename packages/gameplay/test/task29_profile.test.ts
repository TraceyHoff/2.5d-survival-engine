/**
 * Task 29 perf profile: per-system ms/tick of a busy server-style sim (players, animals, zombies, pets,
 * a walled base, 300 crops, 50 containers incl. salt-fuelled, 100 grazed tiles, 500 resource nodes).
 * PERF=1 only (prints numbers; loose assertion).
 * `PERF=1 pnpm vitest run packages/gameplay/test/task29_profile.test.ts`
 */
import { describe, expect, it } from "vitest";
import { canSee, entityIndex, Membership, PlayerId, Rng, Transform, type Entity } from "@engine/core";
import { installSpatialIndex } from "@engine/world";
import * as G from "../src/index.js";
import { room, world215 } from "./nav215_fixture.js";
import { makeWorld, steps, DT } from "./helpers.js";

const PERF = !!process.env.PERF;

function busyWorld(withBase: boolean) {
  const { w, put } = world215();
  if (!w.isRegistered(PlayerId)) w.register(PlayerId);
  w.addSystem("simulation", "gameplay.animalAI", G.animalAISystem);
  if (withBase) for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) room(w, put, gx * 6, gy * 6, 4, { door: (gx + gy) % 2 === 0, bench: true });
  const rng = new Rng(7);
  const kinds = G.animalDefs().filter((a) => !a.spriteKey.includes("dog_") && !a.spriteKey.includes("cat_")).map((a) => a.spriteKey);
  for (let i = 0; i < 160; i++) G.spawnAnimal(w, kinds[i % kinds.length]!, rng.range(-4, 26), rng.range(-4, 26));
  const players: Entity[] = [];
  for (let i = 0; i < 4; i++) {
    const p = G.spawnPlayer(w, { x: 2 + i * 6, y: -1.5, maxWeight: 0, clientId: 10 + i });
    if (w.has(p, PlayerId)) w.set(p, PlayerId, { id: 10 + i }); else w.add(p, PlayerId, { id: 10 + i });
    players.push(p);
  }
  for (let i = 0; i < 16; i++) { const a = G.spawnAnimal(w, "animal_dog_dachshund", 2 + (i % 4) * 6, -2); G.makePet(w, a, players[i % 4]!); }
  const zk = G.gameplayDefs(w).zombies.keys().next().value!;
  for (let i = 0; i < 20; i++) G.spawnZombie(w, zk, rng.range(-4, 26), rng.range(-4, 26));
  // 300 crops at mixed growth (wheat/hay/carrot)
  const seeds = ["wheat_seeds", "hay_seeds", "carrot_seeds"];
  for (let i = 0; i < 300; i++) {
    const c = G.spawnCrop(w, rng.range(-30, 30), rng.range(-30, 30), G.plantableBySeed(seeds[i % 3]!));
    w.set(c, G.Crop, { growth: rng.range(0, 0.95), stage: i % 4, waterUntilTick: 0, fertilized: 0 });
  }
  // 50 containers: 40 plain storage boxes with food, 10 salt-fuelled with food + salt
  const foodId = G.gameplayDefs(w).itemId("cooked_meat");
  const saltId = G.gameplayDefs(w).itemId("salt");
  for (let i = 0; i < 50; i++) {
    const box = put(i % 10 === 0 ? "salt_barrel" : "basic_storage_box", -30 + (i % 10) * 2 + 0.5, -20 + Math.floor(i / 10) * 2 + 0.5);
    const att = G.resolveAttachment(w, box, G.AttachKind.Storage); // AttachKind.Storage = 3
    if (att !== undefined) {
      G.mapSlots(w, att, (v) => { G.slotsAdd(v, foodId, 5, G.gameplayDefs(w), w.tick); if (i % 10 === 0) G.slotsAdd(v, saltId, 10, G.gameplayDefs(w), w.tick); return true; });
    }
  }
  // 100 grazed tiles
  for (let i = 0; i < 100; i++) {
    const e = w.create();
    w.add(e, Transform, { x: rng.range(-30, 30), y: rng.range(-30, 30) }).add(e, G.GrazedTile, { tx: i, ty: 0, regrowTick: w.tick + 3600 });
  }
  // 500 resource nodes (trees, bushes, rocks, wild plants)
  const nodeKinds = ["pine_tree", "birch_tree", "raspberry_bush", "wild_wheat", "stone_node", "iron_node"];
  for (let i = 0; i < 500; i++) {
    try { G.spawnResourceNode(w, nodeKinds[i % nodeKinds.length]!, rng.range(-40, 40), rng.range(-40, 40)); } catch { /* unknown key: skip */ }
  }
  return { w, players };
}

describe.skipIf(!PERF)("Task 29 profile", () => {
  it("per-system ms/tick on a busy world", () => {
    for (const withBase of [false, true]) {
      const { w, players } = busyWorld(withBase);
      runProfile(w, players, withBase ? "base" : "open");
    }
    expect(true).toBe(true);
  }, 300_000);
});

describe.skipIf(!PERF)("Task 29 micro-benches", () => {
  it("inner costs: creatureStep / findPath / bodyAxisMove+settleStandZ / setAnim / dead-sort", () => {
    const { w, players } = busyWorld(true);
    const open = busyWorld(false).w;
    steps(w, 10); steps(open, 10);
    const bench = (label: string, n: number, fn: () => void): void => {
      for (let i = 0; i < 20; i++) fn();
      const t0 = performance.now(); for (let i = 0; i < n; i++) fn();
      console.log(`[task29:micro] ${label}: ${(((performance.now() - t0) / n) * 1000).toFixed(2)} µs/call`);
    };
    const animals = [...w.query([G.Animal, Transform], [G.Dead, G.Pet])].slice(0, 20);
    const zombies = [...w.query([G.Zombie, Transform], [G.Dead])].slice(0, 10);
    const defs = G.gameplayDefs(w);
    const tileBlocked = (tx: number, ty: number): boolean => defs.worldgen.unwalkableTiles.has(G.populationTile(w, tx, ty));
    let ai = 0;
    bench("creatureStep (near base)", 2000, () => { const e = animals[(ai++) % animals.length]!; const t = w.get(e, Transform)!; G.creatureStep(w, e, t.x + 3, t.y + 2, 0.05, 0, tileBlocked, DT); });
    const openAnimals = [...open.query([G.Animal, Transform], [G.Dead, G.Pet])].slice(0, 20);
    const openDefs = G.gameplayDefs(open);
    const openTileBlocked = (tx: number, ty: number): boolean => openDefs.worldgen.unwalkableTiles.has(G.populationTile(open, tx, ty));
    bench("creatureStep (open ground)", 2000, () => { const e = openAnimals[(ai++) % openAnimals.length]!; const t = open.get(e, Transform)!; G.creatureStep(open, e, t.x + 3, t.y + 2, 0.05, 0, openTileBlocked, DT); });
    bench("animalAISystem alone (busy)", 60, () => { G.animalAISystem(w, DT); });
    bench("animalAISystem pinned (no movement)", 60, () => {
      for (const e of w.query([G.Animal, Transform], [G.Dead, G.Pet])) { const t = w.get(e, Transform)!; w.set(e, G.Animal, { goalX: t.x, goalY: t.y, state: 0 }); }
      G.animalAISystem(w, DT);
    });
    bench("world.get x3 + has + hypot (per animal)", 2000, () => {
      for (const e of animals) { const a = w.get(e, G.Animal)!; const t = w.get(e, Transform)!; const hp = w.get(e, G.Health); void a; void t; void hp; void w.has(e, G.Tamed); void Math.hypot(t.x - a.homeX, t.y - a.homeY); }
    });
    bench("swimSpeedMulAt", 5000, () => { const e = animals[(ai++) % animals.length]!; const t = w.get(e, Transform)!; void G.swimSpeedMulAt(w, t.x, t.y); });
    bench("world.get Animal", 5000, () => { const e = animals[(ai++) % animals.length]!; void w.get(e, G.Animal); });
    bench("world.get Transform", 5000, () => { const e = animals[(ai++) % animals.length]!; void w.get(e, Transform); });
    bench("world.get Health", 5000, () => { const e = animals[(ai++) % animals.length]!; void w.get(e, G.Health); });
    bench("shelterAt", 2000, () => { const e = animals[(ai++) % animals.length]!; const t = w.get(e, Transform)!; void G.shelterAt(w, t.x, t.y, t.z ?? 0); });
    bench("ambientTemperature", 2000, () => { const e = animals[(ai++) % animals.length]!; const t = w.get(e, Transform)!; void G.ambientTemperature(w, t.x, t.y); });
    bench("heatAt", 2000, () => { const e = animals[(ai++) % animals.length]!; const t = w.get(e, Transform)!; void G.heatAt(w, t.x, t.y, t.z ?? 0); });
    bench("wallInsulationAt", 2000, () => { const e = animals[(ai++) % animals.length]!; const t = w.get(e, Transform)!; void G.wallInsulationAt(w, t.x, t.y, t.z ?? 0); });
    bench("grid.exposure", 2000, () => { const e = animals[(ai++) % animals.length]!; const t = w.get(e, Transform)!; void w.getResource(G.StructureIndexRes)!.grid.exposure(t.x, t.y, t.z ?? 0, 0); });
    // Bot perception (local.ts ADR-105): one bot's buildAgentView over the 3x3-cell candidate grid,
    // and the per-tick rebuildGrid scan that feeds it. buildAgentView also runs fillAgentSensors /
    // fillGoalSensors / fillHireSensors (Task 22/28 bot work) on every fresh view.
    const bot = players[0]!;
    // buildAgentView's sensors read core components the nav fixture never registers (Membership, ...).
    if (!w.isRegistered(Membership)) w.register(Membership);
    const agent = G.makeAgent(G.makeAgentIdentity(5, 0, "bot_gatherer"), 1);
    const CELL = 24; const cellKey = (cx: number, cy: number): number => (cx + 0x8000) * 0x10000 + (cy + 0x8000);
    // Mirror of apps/client/src/local.ts rebuildGrid (Task 29: kind queries + dedup, not the full scan).
    const rebuildGrid = (): Map<number, Entity[]> => {
      const cells = new Map<number, Entity[]>(); const seenIds = new Set<Entity>();
      for (const def of [G.Zombie, G.ResourceNode, G.Animal, G.Health] as const) {
        for (const e of w.query([def, Transform], [G.Dead])) {
          if (seenIds.has(e)) continue; seenIds.add(e);
          const k = cellKey(Math.floor((w.getField(e, Transform, "x") ?? 0) / CELL), Math.floor((w.getField(e, Transform, "y") ?? 0) / CELL));
          let l = cells.get(k); if (!l) { l = []; cells.set(k, l); } l.push(e);
        }
      }
      return cells;
    };
    const cells = rebuildGrid();
    const nearby = (x: number, y: number): Entity[] => {
      const out: Entity[] = []; const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const l = cells.get(cellKey(cx + dx, cy + dy)); if (l) for (const e of l) out.push(e); }
      return out;
    };
    const bt = w.get(bot, Transform)!;
    const cands = nearby(bt.x, bt.y);
    console.log(`[task29:micro] bot candidates near player: ${cands.length}`);
    bench("rebuildGrid (busy world)", 100, () => { void rebuildGrid(); });
    bench("buildAgentView (1 bot, candidates)", 200, () => { void G.buildAgentView(w, bot, agent, { x: 2, y: -1.5 }, "friend", cands); });
    // Split buildAgentView: perception loop pieces vs the sensor fills that follow it.
    const view0 = G.buildAgentView(w, bot, agent, { x: 2, y: -1.5 }, "friend", cands);
    const seen0 = view0?.world.seen ?? [];
    bench("canSee x401", 200, () => { for (const s of seen0) void canSee(agent.perception, bt.x, bt.y, 0.5, s.x, s.y); });
    bench("memory.see x401", 200, () => { for (const s of seen0) agent.memory.see({ id: s.id, kind: s.kind, x: s.x, y: s.y, tick: w.tick }); });
    bench("fillAgentSensors", 200, () => { const v: Record<string, unknown> = { seen: [], home: { x: 2, y: -1.5 }, playerName: "friend" }; G.fillAgentSensors(w, bot, v as never, false); });
    bench("fillHireSensors", 200, () => { const v: Record<string, unknown> = { seen: [], home: { x: 2, y: -1.5 }, playerName: "friend" }; G.fillHireSensors(w, bot, v as never); });
    bench("fillGoalSensors", 200, () => { const v: Record<string, unknown> = { seen: [], home: { x: 2, y: -1.5 }, playerName: "friend" }; G.fillGoalSensors(w, bot, v as never, agent); });
    const cfId = G.gameplayDefs(w).pieces.values().next().value!.id; // placeholder replaced below
    const campfireDef = [...G.gameplayDefs(w).pieces.values()].find((d) => d.key === "campfire")!;
    bench("pieceAt campfire near home", 200, () => { void G.pieceAt(w, campfireDef.id, 2, -1.5, 6); });
    bench("pieceAt missing type", 200, () => { void G.pieceAt(w, 999999, 2, -1.5, 6); });
    // Cold pieceAt: fresh coordinates each call defeat the memo, measuring the store-direct scan.
    let jx = 0; bench("pieceAt cold scan", 200, () => { void G.pieceAt(w, campfireDef.id, 2 + (jx++ % 50) * 0.01, -1.5, 6); });
    bench("countItem x10", 200, () => { for (let i = 0; i < 10; i++) void G.countItem(w, bot, 1); });
    bench("readSlots", 500, () => { void G.readSlots(w, bot); });
    bench("exposure distinct tiles + time", 60, () => {
      const tiles = new Set<string>(); let n = 0;
      for (const e of w.query([G.Exposure, Transform])) { const t = w.get(e, Transform)!; tiles.add(`${Math.floor(t.x)},${Math.floor(t.y)},${Math.max(0, Math.round((t.z ?? 0) / 3))}`); n++; }
      void tiles; void n;
      const t0 = performance.now(); G.exposureSystem(w, DT); const dt = performance.now() - t0;
      if (n > 0 && tiles.size > 0) console.log(`[task29:micro] exposure entities=${n} distinctTiles=${tiles.size} oneRun=${(dt * 1000).toFixed(0)}us`);
    });
    bench("direct store reads (Animal+Transform+Health)", 5000, () => {
      const e = animals[(ai++) % animals.length]!; const i = entityIndex(e);
      const aS = w.store(G.Animal); const aSlot = aS.slot(i);
      const tS = w.store(Transform); const tSlot = tS.slot(i);
      const hS = w.store(G.Health); const hSlot = hS.slot(i);
      void (aS.data.kind[aSlot]! + tS.data.x[tSlot]! + (hSlot >= 0 ? hS.data.hp[hSlot]! : 0));
    });
    bench("world.getField x3", 5000, () => { const e = animals[(ai++) % animals.length]!; void w.getField(e, G.Animal, "state"); void w.getField(e, Transform, "x"); void w.getField(e, G.Health, "hp"); });
    const aOut = {} as Record<string, number>; const tOut = {} as Record<string, number>;
    bench("getInto Animal+Transform", 5000, () => { const e = animals[(ai++) % animals.length]!; void w.getInto(e, G.Animal, aOut); void w.getInto(e, Transform, tOut); });
    bench("petSystem alone (busy)", 60, () => { G.petSystem(w, DT); });
    bench("zombieAISystem alone (busy)", 60, () => { G.zombieAISystem(w, DT); });
    bench("findPath open 20-tile", 500, () => { G.findPath(open, 2, 2, 22, 12, () => 100); });
    bench("findPath base short 5-tile", 500, () => { G.findPath(w, 2, 2, 7, 5, () => 100); });
    bench("findPath base 20-tile thru village", 100, () => { G.findPath(w, 2, 2, 22, 12, () => 100); });
    bench("findPath base unreachable (sealed room)", 100, () => { G.findPath(w, 1, 1, 13, 13, () => 100); });
    bench("bodyAxisMove x2 + settleStandZ", 5000, () => { const e = zombies[ai++ % zombies.length]!; const t = w.get(e, Transform)!; const x = G.bodyAxisMove(w, t.x, t.y, t.x + 0.05, 0, 0, true); const y = G.bodyAxisMove(w, x, t.y, t.y + 0.05, 1, 0, true); void x; void y; G.settleStandZ(w, e, DT); });
    bench("setAnim", 5000, () => { const e = animals[ai++ % animals.length]!; G.setAnim(w, e, G.Anim.Walk); });
    bench("dead-animal copy+sort (176)", 2000, () => { void [...w.query([G.Animal, G.Dead])].sort((x, y) => x - y); });
    bench("query Animal+Transform (176)", 2000, () => { void [...w.query([G.Animal, Transform], [G.Dead, G.Pet])]; });
    const terrain = w.getResource(G.TerrainRes); const sidx = w.getResource(G.StructureIndexRes)!;
    if (terrain) bench("terrain.tileAt", 20000, () => { void terrain.tileAt(2 + (ai++ % 20), 2 + (ai++ % 10)); });
    bench("stepBlocker (village)", 5000, () => { void G.stepBlocker(sidx, 5 + (ai++ % 15), 5, 6 + (ai % 15), 5); });
    bench("edgeBlocker", 5000, () => { void sidx.edgeBlocker(5 + (ai++ % 15), 5, 0, G.EdgeSide.West); });
    bench("idx.cell", 5000, () => { void sidx.cell(5 + (ai++ % 15), 5, 0, 1); });
    bench("pieceHp", 5000, () => { const es = [...w.query([G.BuildPiece])]; void G.pieceHp(w, es[ai++ % es.length]!); });
    bench("queryRadius 24 (spatial)", 2000, () => { void [...installSpatialIndex(w).queryRadius(10, 10, 24)]; });
    bench("acquire-like: queryRadius 24 + Survival filter", 2000, () => {
      let n = 0; for (const p of installSpatialIndex(w).queryRadius(10, 10, 24)) if (w.has(p, G.Survival)) n++;
      void n;
    });
    expect(true).toBe(true);
  }, 300_000);
});

function runProfile(w: ReturnType<typeof busyWorld>["w"], players: Entity[], label: string): void {    const acc = new Map<string, number>();
    const counts = new Map<string, number>();
    w.profiler = (name, ms) => { acc.set(name, (acc.get(name) ?? 0) + ms); counts.set(name, (counts.get(name) ?? 0) + 1); };
    const tick = (i: number): void => {
      players.forEach((p, k) => {
        const a = ((i / 60) | 0) % 4; const dx = [1, 0, -1, 0][(a + k) % 4]!; const dy = [0, 1, 0, -1][(a + k) % 4]!;
        G.applyMovementInput(w, p, 0, DT, { x: (dx - dy) * Math.SQRT1_2, y: (dx + dy) * Math.SQRT1_2 });
      });
      w.step(DT);
    };
    for (let i = 0; i < 200; i++) tick(i);
    acc.clear(); counts.clear();
    const N = 1200; const t0 = performance.now();
    for (let i = 0; i < N; i++) tick(200 + i);
    const total = performance.now() - t0;
    const rows = [...acc.entries()].map(([name, ms]) => ({ name, perTick: ms / N, calls: counts.get(name) ?? 0 })).sort((a, b) => b.perTick - a.perTick);
    console.log(`[task29:${label}] total ${(total / N).toFixed(3)} ms/tick over ${N} ticks`);
    for (const r of rows.slice(0, 12)) console.log(`[task29:${label}]   ${r.name}: ${r.perTick.toFixed(4)} ms/tick (${r.calls} calls)`);
}
