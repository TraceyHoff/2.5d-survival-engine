/**
 * ADR-215 perf: ms/tick of a server-style sim with a walled village, wandering / fleeing animals, following pets,
 * zombies and walking players. PERF=1 only (prints numbers; loose assertion). `PERF=1 pnpm vitest run packages/gameplay/test/bench215.test.ts`
 */
import { describe, expect, it } from "vitest";
import { PlayerId, Rng, type Entity } from "@engine/core";
import * as G from "../src/index.js";
import { room, world215 } from "./nav215_fixture.js";

const PERF = !!process.env.PERF;
function scenario(withBase: boolean): number {
  const { w, put } = world215(); if (!w.isRegistered(PlayerId)) w.register(PlayerId);
  w.addSystem("simulation", "gameplay.animalAI", G.animalAISystem);
  if (withBase) for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) room(w, put, gx * 6, gy * 6, 4, { door: (gx + gy) % 2 === 0, bench: true });
  const rng = new Rng(7); const kinds = G.animalDefs().filter((a) => !a.spriteKey.includes("dog_") && !a.spriteKey.includes("cat_")).map((a) => a.spriteKey);
  for (let i = 0; i < 160; i++) G.spawnAnimal(w, kinds[i % kinds.length]!, rng.range(-4, 26), rng.range(-4, 26));
  const players: Entity[] = [];
  for (let i = 0; i < 4; i++) { const p = G.spawnPlayer(w, { x: 2 + i * 6, y: -1.5, maxWeight: 0, clientId: 10 + i }); if (w.has(p, PlayerId)) w.set(p, PlayerId, { id: 10 + i }); else w.add(p, PlayerId, { id: 10 + i }); players.push(p); }
  for (let i = 0; i < 16; i++) { const a = G.spawnAnimal(w, "animal_dog_dachshund", 2 + (i % 4) * 6, -2); G.makePet(w, a, players[i % 4]!); }
  const zk = G.gameplayDefs(w).zombies.keys().next().value!;
  for (let i = 0; i < 20; i++) G.spawnZombie(w, zk, rng.range(-4, 26), rng.range(-4, 26));
  const tick = (i: number): void => {
    players.forEach((p, k) => { const a = ((i / 60) | 0) % 4; const dx = [1, 0, -1, 0][(a + k) % 4]!, dy = [0, 1, 0, -1][(a + k) % 4]!; G.applyMovementInput(w, p, 0, 1 / 20, { x: (dx - dy) * Math.SQRT1_2, y: (dx + dy) * Math.SQRT1_2 }); });
    w.step(1 / 20);
  };
  for (let i = 0; i < 200; i++) tick(i);
  const N = 1200; const t0 = performance.now(); for (let i = 0; i < N; i++) tick(200 + i); return (performance.now() - t0) / N;
}
describe.skipIf(!PERF)("ADR-215 bench", () => {
  it("ms/tick with and without a base", () => {
    const res: Record<string, number[]> = { open: [], base: [] };
    for (let r = 0; r < 3; r++) { res.open!.push(scenario(false)); res.base!.push(scenario(true)); }
    const med = (a: number[]): number => [...a].sort((x, y) => x - y)[1]!;
    console.log(`[bench215] ms/tick median of 3: open ${med(res.open!).toFixed(3)} base ${med(res.base!).toFixed(3)} (runs open ${res.open!.map((x) => x.toFixed(3))} base ${res.base!.map((x) => x.toFixed(3))})`);
    expect(med(res.base!)).toBeLessThan(50);
  }, 300_000);
});
