import { describe, it, expect } from "vitest";
import { installPermissions, Transform, type World } from "@engine/core";
import * as G from "../src/index.js";
import { Dead, spawnPlayer } from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const PTS = [{ x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }, { x: -100, y: -100 }];
const mk = (w: World, id: number, x: number, y: number) => spawnPlayer(w, { x, y, clientId: id });

describe("spawn points (ADR-106)", () => {
  it("falls back to pvp.json without installed points; exposes installed ones", () => {
    const w = makeWorld(); expect(G.spawnPoints(w)).toEqual(G.PVP.spawnPoints);
    G.setSpawnPoints(w, PTS); expect(G.spawnPoints(w)).toEqual(PTS);
  });
  it("picks the least crowded point, with jitter, deterministically", () => {
    const w = makeWorld(); G.setSpawnPoints(w, PTS);
    mk(w, 1, 100, -100); mk(w, 2, 100, 100); mk(w, 3, -100, 100); mk(w, 4, 101, 101);
    const p = G.pickSpawnPoint(w, "join", 5); expect(p.index).toBe(3);
    expect(Math.hypot(p.x - -100, p.y - -100)).toBeLessThanOrEqual(G.SPAWN_JITTER);
    expect(G.pickSpawnPoint(w, "join", 5)).toEqual(p);
  });
  it("successive joins spread across all four points", () => {
    const w = makeWorld(); G.setSpawnPoints(w, PTS); const used = new Set<number>();
    for (let i = 0; i < 8; i++) { const p = G.pickSpawnPoint(w, "join", i); used.add(p.index); mk(w, 10 + i, p.x, p.y); }
    expect(used.size).toBe(4); expect(G.spawnCrowding(w, PTS)).toEqual([2, 2, 2, 2]);
  });
  it("respawn uses the spawn points, or the bed/claim locator hook when set", () => {
    const w = makeWorld(); installPermissions(w); G.setSpawnPoints(w, PTS);
    const a = mk(w, 1, 0, 0); w.setField(a, G.Health, "hp", 0); steps(w, 1); expect(w.has(a, Dead)).toBe(true);
    steps(w, 20 * G.PVP.respawnSeconds); expect(G.respawnPlayer(w, a)).toBeUndefined();
    const t = w.get(a, Transform)!; expect(PTS.some((p) => Math.hypot(t.x - p.x, t.y - p.y) <= G.SPAWN_JITTER)).toBe(true);
    G.setRespawnLocator(w, () => ({ x: 7, y: 9 })); w.setField(a, G.Health, "hp", 0); steps(w, 1 + 20 * G.PVP.respawnSeconds);
    expect(G.respawnPlayer(w, a)).toBeUndefined(); expect(w.get(a, Transform)).toMatchObject({ x: 7, y: 9 });
  });
});
