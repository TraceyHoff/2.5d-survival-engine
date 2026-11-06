/**
 * Task 29 behaviour-preservation tests: every optimisation must return exactly what the old
 * implementation returned. Each test pins the old behaviour with an independent reference
 * implementation (not by calling the optimised code twice).
 */
import { describe, expect, it } from "vitest";
import { canSee, Membership, PlayerId, Rng, Transform, type Entity, type PerceptionConfig } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";
import { world215 } from "./nav215_fixture.js";

/** The pre-Task-29 canSee (atan2 form) — the reference the dot-product form must match. */
const oldCanSee = (cfg: PerceptionConfig, ax: number, ay: number, facing: number, tx: number, ty: number): boolean => {
  const dx = tx - ax, dy = ty - ay, d = Math.hypot(dx, dy);
  if (d > cfg.sightRange) return false; if (d < 1.5) return true;
  let a = Math.atan2(dy, dx) - facing; a = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.abs(a) <= (cfg.sightConeDeg * Math.PI) / 360;
};

describe("Task 29 canSee equivalence", () => {
  it("matches the atan2 form on a grid of facings, angles and distances", () => {
    const cfg: PerceptionConfig = { sightRange: 12, sightConeDeg: 140, hearingRange: 18, memorySeconds: 20 };
    for (const facing of [0, 0.7, Math.PI / 2, Math.PI, -2.3, 5.9]) {
      for (let ai = 0; ai < 48; ai++) {
        const ang = (ai / 48) * Math.PI * 2;
        for (const d of [0, 0.5, 1.49, 1.51, 5, 11.99, 12, 12.01, 30]) {
          const tx = Math.cos(ang) * d, ty = Math.sin(ang) * d;
          expect(canSee(cfg, 0, 0, facing, tx, ty)).toBe(oldCanSee(cfg, 0, 0, facing, tx, ty));
        }
      }
    }
  });
});

describe("Task 29 pieceAt memo", () => {
  it("finds a placed piece, forgets it on removal, and finds a replacement", () => {
    const { w, put } = world215();
    const campfireId = [...G.gameplayDefs(w).pieces.values()].find((d) => d.key === "campfire")!.id;
    expect(G.pieceAt(w, campfireId, 2, -1.5, 6)).toBeUndefined();
    const c1 = put("campfire", 3, 0);
    expect(G.pieceAt(w, campfireId, 2, -1.5, 6)).toBe(c1);
    expect(G.pieceAt(w, campfireId, 2, -1.5, 6)).toBe(c1); // memo hit, same answer
    G.structures(w).removePiece(c1); w.destroy(c1); // the real removal path bumps StructureIndex.version
    expect(G.pieceAt(w, campfireId, 2, -1.5, 6)).toBeUndefined();
    const c2 = put("campfire", 1, 0);
    expect(G.pieceAt(w, campfireId, 2, -1.5, 6)).toBe(c2);
    put("campfire", 40, 40); // far away: not "near", and the near one still wins
    expect(G.pieceAt(w, campfireId, 2, -1.5, 6)).toBe(c2);
  });
});

describe("Task 29 buildAgentView equivalence", () => {
  it("sees exactly what the old getField/has scan saw", () => {
    const w = makeWorld();
    if (!w.isRegistered(Membership)) w.register(Membership); // buildAgentView's sensors read these (as in the perf bench)
    if (!w.isRegistered(PlayerId)) w.register(PlayerId);
    const bot = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 77 });
    w.set(bot, Transform, { x: 0, y: 0, z: 0, facing: 0 });
    const agent = G.makeAgent(G.makeAgentIdentity(5, 0, "bot_gatherer"), 1);
    const zk = G.gameplayDefs(w).zombies.keys().next().value!;
    const zIn = G.spawnZombie(w, zk, 5, 0); // in cone, in range
    const zBehind = G.spawnZombie(w, zk, -5, 0); // behind: out of cone, in range, within hearing
    const zFar = G.spawnZombie(w, zk, 20, 0); // out of sight range (and out of hearing)
    const zDead = G.spawnZombie(w, zk, 3, 3); w.add(zDead, G.Dead, {});
    const node = G.spawnResourceNode(w, "pine_tree", 4, 3); // in cone
    const nodeEmpty = G.spawnResourceNode(w, "pine_tree", 4, -3); w.setField(nodeEmpty, G.ResourceNode, "amount", 0); // depleted
    const kinds = G.animalDefs().filter((a) => !a.spriteKey.includes("dog_") && !a.spriteKey.includes("cat_")).map((a) => a.spriteKey);
    const animal = G.spawnAnimal(w, kinds[0]!, -4, 3); // behind-left: out of cone, animals are never heard
    const other = G.spawnPlayer(w, { x: 2, y: 5, maxWeight: 0, clientId: 78 }); // in cone
    const cands = [zIn, zBehind, zFar, zDead, node, nodeEmpty, animal, other, bot];
    // Reference: the pre-Task-29 loop, inline (getField/has + the atan2 canSee).
    const cfg = agent.perception;
    const expected: { id: number; kind: string; x: number; y: number }[] = [];
    for (const e of cands) {
      if (e === bot) continue; if (w.has(e, G.Dead)) continue;
      const ox = w.getField(e, Transform, "x"); if (ox === undefined) continue;
      const oy = w.getField(e, Transform, "y")!;
      const kind = w.has(e, G.Zombie) ? "zombie" : w.has(e, G.ResourceNode) ? "node" : w.has(e, G.Animal) ? "animal" : w.has(e, G.Health) ? "player" : undefined;
      if (!kind) continue; if (kind === "node" && w.getField(e, G.ResourceNode, "amount") === 0) continue;
      if (oldCanSee(cfg, 0, 0, 0, ox, oy)) expected.push({ id: e, kind, x: ox, y: oy });
    }
    const view = G.buildAgentView(w, bot, agent, { x: 0, y: 0 }, "friend", cands);
    expect(view?.world.seen).toEqual(expected);
    // Hearing: the zombie behind is remembered as heard; the far and dead ones are not.
    expect(agent.memory.items.get(zBehind)?.heard).toBe(true);
    expect(agent.memory.items.has(zFar)).toBe(false);
    expect(agent.memory.items.has(zDead)).toBe(false);
  });
});

describe("Task 29 rebuildGrid equivalence", () => {
  it("kind queries + dedup return the same perceivable set (and cells) as the full Transform scan", () => {
    const { w, put } = world215();
    const rng = new Rng(11);
    for (let i = 0; i < 4; i++) put("foundation", -30 + i * 2 + 0.5, -30.5); // BuildPiece noise for the scan
    const kinds = G.animalDefs().filter((a) => !a.spriteKey.includes("dog_") && !a.spriteKey.includes("cat_")).map((a) => a.spriteKey);
    for (let i = 0; i < 20; i++) G.spawnAnimal(w, kinds[i % kinds.length]!, rng.range(-30, 30), rng.range(-30, 30));
    const zk = G.gameplayDefs(w).zombies.keys().next().value!;
    for (let i = 0; i < 5; i++) G.spawnZombie(w, zk, rng.range(-30, 30), rng.range(-30, 30));
    for (let i = 0; i < 30; i++) G.spawnResourceNode(w, "pine_tree", rng.range(-30, 30), rng.range(-30, 30));
    for (let i = 0; i < 3; i++) G.spawnPlayer(w, { x: rng.range(-30, 30), y: rng.range(-30, 30), maxWeight: 0, clientId: 20 + i });
    // Old: the full Transform scan from apps/client/src/local.ts (pre-Task-29).
    const oldScan = (): Entity[] => {
      const out: Entity[] = [];
      for (const e of w.query([Transform], [G.Dead])) {
        if (!w.has(e, G.Zombie) && !w.has(e, G.ResourceNode) && !w.has(e, G.Animal) && !w.has(e, G.Health)) continue;
        out.push(e);
      }
      return out.sort((a, b) => a - b);
    };
    // New: the 4 kind queries + dedup (mirrors the Task 29 local.ts rebuildGrid).
    const newScan = (): Entity[] => {
      const seenIds = new Set<Entity>(); const out: Entity[] = [];
      for (const def of [G.Zombie, G.ResourceNode, G.Animal, G.Health] as const) {
        for (const e of w.query([def, Transform], [G.Dead])) { if (seenIds.has(e)) continue; seenIds.add(e); out.push(e); }
      }
      return out.sort((a, b) => a - b);
    };
    const oldSet = oldScan(), newSet = newScan();
    expect(newSet).toEqual(oldSet);
    expect(newSet.length).toBeGreaterThan(40); // the test world actually exercises the overlap (zombies/animals carry Health)
    // Same 3x3-cell grouping around a point, as sets (insertion order within a cell differs by design).
    const CELL = 24; const cellKey = (cx: number, cy: number): number => (cx + 0x8000) * 0x10000 + (cy + 0x8000);
    const group = (list: Entity[]): Map<number, Entity[]> => {
      const cells = new Map<number, Entity[]>();
      for (const e of list) {
        const t = w.get(e, Transform)!;
        const k = cellKey(Math.floor(t.x / CELL), Math.floor(t.y / CELL));
        let l = cells.get(k); if (!l) { l = []; cells.set(k, l); } l.push(e);
      }
      return cells;
    };
    const nearby = (cells: Map<number, Entity[]>, x: number, y: number): Entity[] => {
      const out: Entity[] = []; const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const l = cells.get(cellKey(cx + dx, cy + dy)); if (l) for (const e of l) out.push(e); }
      return out.sort((a, b) => a - b);
    };
    const oldCells = group(oldSet), newCells = group(newSet);
    for (const [x, y] of [[0, 0], [-20, 10], [15, -25]] as const) expect(nearby(newCells, x, y)).toEqual(nearby(oldCells, x, y));
  });
});
