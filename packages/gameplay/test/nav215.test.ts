/**
 * ADR-215 creature navigation: animals and pets collide with walls, L / inner / angled corners, closed doors and
 * stations, path around them through doorways and open doors, pets follow their owner into a room through an open
 * door (not a closed one) and a catch-up teleport never lands on the far side of a wall. Open ground is unchanged.
 */
import { describe, expect, it } from "vitest";
import { PlayerId, Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { pos, room, setDoor, tp, world215 } from "./nav215_fixture.js";
import { steps } from "./helpers.js";

const DT = 1 / 20; const R = G.defaultDefs().movement.bodyRadius;
const never = (): boolean => false;
const passive = (): string => G.animalDefs().find((a) => a.aggro.mode === "passive" && !a.attack && !a.key.includes("dog_") && !a.key.includes("cat_"))!.key;
/** Strictly inside the n x n room interior at (ox, oy) (the body never overlaps the rim walls from inside or outside). */
const inside = (p: { x: number; y: number }, ox: number, oy: number, n: number): boolean => p.x > ox && p.x < ox + n && p.y > oy && p.y < oy + n;
/** ADR-212 edge collision samples the body's lateral extent at +-0.8 r, so a body may clip a wall end by up to 0.2 r. */
const SLOP = R * 0.2 + 2e-3;
const bodyClearOfRim = (p: { x: number; y: number }, ox: number, oy: number, n: number): boolean => {
  const near = (v: number, e: number): boolean => Math.abs(v - e) < R - 2e-3;
  const inSpanX = p.x > ox - R + SLOP && p.x < ox + n + R - SLOP, inSpanY = p.y > oy - R + SLOP && p.y < oy + n + R - SLOP;
  return !((inSpanY && (near(p.x, ox) || near(p.x, ox + n))) || (inSpanX && near(p.y, oy + n)) || (inSpanX && near(p.y, oy) && !(p.x > ox + 2 + R - SLOP && p.x < ox + 3 - R + SLOP)));
};
function drive(w: World, e: Entity, gx: number, gy: number, ticks: number, sp = 0.15, stopAt = 0, check?: (p: { x: number; y: number }) => void): void {
  for (let i = 0; i < ticks; i++) { G.creatureStep(w, e, gx, gy, sp, stopAt, never, DT); w.step(DT); check?.(pos(w, e)); }
}

describe("ADR-215 creature nav", () => {
  it("open ground keeps the legacy straight step (creatureStep defers)", () => {
    const { w } = world215(); const a = G.spawnAnimal(w, passive(), 100, 100);
    expect(G.creatureStep(w, a, 105, 100, 0.1, 0, never, DT)).toBeUndefined();
    const f = world215(); room(f.w, f.put, 0, 0, 4); const b = G.spawnAnimal(f.w, passive(), 100, 100);
    expect(G.creatureStep(f.w, b, 105, 100, 0.1, 0, never, DT)).toBeUndefined(); // structures far away: still legacy
  });
  it("an animal driven at a goal behind a wall paths round through the doorway; a closed door keeps it out", () => {
    const { w, put } = world215(); const { door } = room(w, put, 0, 0, 4, { door: true });
    const a = G.spawnAnimal(w, passive(), 2.5, 6.5); // south of the room, goal inside: the straight line crosses the south wall
    drive(w, a, 2.5, 2.5, 600, 0.15, 0, (p) => { expect(bodyClearOfRim(p, 0, 0, 4), `rim ${p.x},${p.y}`).toBe(true); expect(inside(p, 0, 0, 4)).toBe(false); });
    expect(pos(w, a).y).toBeGreaterThan(4); // closed door: never got in
    setDoor(w, door!, true);
    let entered = -1; drive(w, a, 2.5, 2.5, 600, 0.15, 0, (p) => { expect(bodyClearOfRim(p, 0, 0, 4), `rim ${p.x},${p.y}`).toBe(true); if (entered < 0 && inside(p, 0, 0, 4)) entered = w.tick; });
    expect(entered).toBeGreaterThan(0); const p = pos(w, a); expect(Math.hypot(p.x - 2.5, p.y - 2.5)).toBeLessThan(0.2);
    expect(p.z).toBeCloseTo(G.defaultDefs().movement.deckStandHeight, 3); // walked onto the foundation deck
  });
  it("an animal inside a closed room stays in; a workbench blocks and is walked round", () => {
    const { w, put } = world215(); room(w, put, 0, 0, 4, { door: true, bench: true });
    const a = G.spawnAnimal(w, passive(), 1.5, 1.5);
    drive(w, a, 1.5, 9, 300, 0.15, 0, (p) => expect(inside(p, 0, 0, 4)).toBe(true));
    // the workbench covers tiles (2,3)-(3,3): walk from (1.5,3.5) past it to (3.6,2.4) without overlapping it
    expect(G.solidCell(G.structures(w), 2, 3, 0) && G.solidCell(G.structures(w), 3, 3, 0)).toBe(true);
    tp(w, a, 1.5, 3.5, 0.75); const bench = (p: { x: number; y: number }): boolean => p.x > 2 - R + SLOP && p.x < 4 + R - SLOP && p.y > 3 - R + SLOP && p.y < 4 + R - SLOP;
    drive(w, a, 3.6, 2.4, 300, 0.15, 0, (p) => expect(bench(p), `bench ${p.x},${p.y}`).toBe(false));
    expect(Math.hypot(pos(w, a).x - 3.6, pos(w, a).y - 2.4)).toBeLessThan(0.2);
  });
  it("inner and angled corner posts block creatures too", () => {
    const { w, put } = world215(); for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) put("foundation", x + 0.5, y + 0.5);
    const c = put("wall_corner_inner", 2, 2, 0, 0); const g = put("wall_corner_angled", 3, 3, 0, 4); steps(w, 2);
    const idx = G.structures(w); const boxes = [...G.cornerPostBoxes(idx.def(c)!, 0, 2, 2), ...G.cornerPostBoxes(idx.def(g)!, 4, 3, 3)];
    const hit = (p: { x: number; y: number }): boolean => { for (let i = 0; i < boxes.length; i += 4) if (Math.abs(p.x - boxes[i]!) < R + boxes[i + 2]! - 2e-3 && Math.abs(p.y - boxes[i + 1]!) < R + boxes[i + 3]! - 2e-3) return true; return false; };
    for (const [sx, sy, gx, gy] of [[0.5, 2, 4.5, 2], [2, 0.5, 2, 4.5], [0.5, 0.5, 4.5, 4.5], [4.5, 2.5, 0.5, 3.5], [2.6, 4.5, 3.4, 1.5]] as const) {
      const a = G.spawnAnimal(w, passive(), sx, sy); drive(w, a, gx, gy, 400, 0.15, 0, (p) => expect(hit(p), `post from ${sx},${sy}: ${p.x},${p.y}`).toBe(false));
      expect(Math.hypot(pos(w, a).x - gx, pos(w, a).y - gy), `reach ${gx},${gy}`).toBeLessThan(0.3); w.destroy(a);
    }
  });
  it("animal AI: wandering / fleeing animals around a closed house never cross its walls", () => {
    const { w, put } = world215(); w.addSystem("simulation", "gameplay.animalAI", G.animalAISystem); room(w, put, 0, 0, 4, { door: true, bench: true });
    const out = [[2, -2], [-2, 2], [6, 2], [2, 6], [-1.5, -1.5], [5.5, 5.5]].map(([x, y]) => G.spawnAnimal(w, passive(), x!, y!));
    const inn = [G.spawnAnimal(w, passive(), 1.5, 1.5), G.spawnAnimal(w, passive(), 2.5, 2.5)];
    const scare = G.spawnPlayer(w, { x: 2, y: 8, maxWeight: 0, clientId: 9 }); // a player passing by makes them flee
    for (let i = 0; i < 1500; i++) {
      if (i % 200 === 0) tp(w, scare, [2, 8, -4, 2][(i / 200) % 4]!, [8, 2, 2, -4][(i / 200) % 4]!);
      w.step(DT);
      for (const a of out) expect(inside(pos(w, a), 0, 0, 4), `outsider ${a} @${pos(w, a).x},${pos(w, a).y}`).toBe(false);
      for (const a of inn) expect(inside(pos(w, a), 0, 0, 4), `insider ${a}`).toBe(true);
    }
    expect(out.some((a) => { const p = pos(w, a); return Math.hypot(p.x - 2, p.y - 2) > 3; })).toBe(true); // they did move about
  });
});

describe("ADR-215 pets and structures", () => {
  const owned = (): { w: World; p: Entity; dog: Entity; door: Entity } => {
    const { w, put } = world215(); if (!w.isRegistered(PlayerId)) w.register(PlayerId);
    const { door } = room(w, put, 0, 0, 4, { door: true });
    const p = G.spawnPlayer(w, { x: 2.5, y: -3, maxWeight: 0, clientId: 7 }); if (w.has(p, PlayerId)) w.set(p, PlayerId, { id: 7 }); else w.add(p, PlayerId, { id: 7 });
    const dog = G.spawnAnimal(w, "animal_dog_dachshund", 2.5, 7); G.makePet(w, dog, p); steps(w, 2);
    return { w, p, dog, door: door! };
  };
  it("a pet follows its owner into a room through the open door and is kept out by a closed one", () => {
    const { w, p, dog, door } = owned(); tp(w, p, 2.5, 2.5, 0.75);
    for (let i = 0; i < 400; i++) { w.step(DT); expect(inside(pos(w, dog), 0, 0, 4)).toBe(false); expect(bodyClearOfRim(pos(w, dog), 0, 0, 4)).toBe(true); }
    setDoor(w, door, true);
    for (let i = 0; i < 600; i++) { w.step(DT); expect(bodyClearOfRim(pos(w, dog), 0, 0, 4)).toBe(true); }
    expect(inside(pos(w, dog), 0, 0, 4)).toBe(true);
    // owner leaves through the door and goes round the back: the pet follows out the same way
    tp(w, p, 2.5, 7, 0); for (let i = 0; i < 600; i++) { w.step(DT); expect(bodyClearOfRim(pos(w, dog), 0, 0, 4)).toBe(true); }
    const q = pos(w, dog); expect(Math.hypot(q.x - 2.5, q.y - 7)).toBeLessThan(3);
  });
  it("catch-up teleport lands on the owner's side of the walls", () => {
    const { w, p, dog } = owned(); tp(w, p, 0.6, 0.6, 0.75); tp(w, dog, 60, 60); // owner in the room's NW corner: (-1, +0.5) is outside the wall
    w.step(DT); const q = pos(w, dog); expect(inside(q, 0, 0, 4), `${q.x},${q.y}`).toBe(true); expect(w.get(dog, Transform)!.z).toBeCloseTo(0.75, 3);
    const o = world215(); if (!o.w.isRegistered(PlayerId)) o.w.register(PlayerId); // legacy offset on open ground
    const p2 = G.spawnPlayer(o.w, { x: 10, y: 10, maxWeight: 0, clientId: 8 }); o.w.add(p2, PlayerId, { id: 8 });
    const d2 = G.spawnAnimal(o.w, "animal_dog_dachshund", 60, 60); G.makePet(o.w, d2, p2); o.w.step(DT);
    expect(pos(o.w, d2).x).toBeCloseTo(9, 3); expect(pos(o.w, d2).y).toBeCloseTo(10.5, 3);
  });
});
