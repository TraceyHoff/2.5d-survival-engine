import { describe, expect, it } from "vitest";
import { PlayerId, Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const pid = (w: World, e: Entity, id: number): void => { if (w.has(e, PlayerId)) w.set(e, PlayerId, { id }); else w.add(e, PlayerId, { id }); };
const setup = (px = 30, py = 0): { w: World; p: Entity; id: (k: string) => number } => {
  const w = makeWorld(); if (!w.isRegistered(PlayerId)) w.register(PlayerId);
  w.addSystem("simulation", "gameplay.animalAI", G.animalAISystem);
  const p = G.spawnPlayer(w, { x: px, y: py, maxWeight: 0, clientId: 7 }); pid(w, p, 7);
  w.add(p, G.Tribe, { id: 5 });
  return { w, p, id: (k) => G.gameplayDefs(w).itemId(k) };
};
const tame = (w: World, p: Entity, a: Entity, item: number): void => {
  G.addItem(w, p, item, 50);
  for (let i = 0; i < 40 && !w.has(a, G.Pet); i++) { G.offerTreat(w, p, a, item); w.step(1 / 20); }
};
const claim = (w: World, x: number, y: number, radius = 10, tribe = 5): Entity => {
  const z = w.create();
  w.add(z, Transform, { x, y }).add(z, G.PrivilegeZone, { radius, tribe }); G.indexEntity(w, z);
  return z;
};
const piece = (w: World, key: string, tx: number, ty: number): Entity => {
  const e = w.create();
  w.add(e, Transform, { x: tx + 0.5, y: ty + 0.5 }).add(e, G.BuildPiece, { type: G.gameplayDefs(w).pieceId(key) });
  G.indexEntity(w, e); return e;
};
/** Closed 5x5 fence ring (fence cells at x/y 0 and 4, interior tiles 1..3); returns the ring pieces. */
const ring = (w: World, gate?: { tx: number; ty: number }): { pieces: Entity[]; gate: Entity | undefined; door: Entity | undefined } => {
  const pieces: Entity[] = []; let gateE: Entity | undefined; let door: Entity | undefined;
  for (let i = 0; i <= 4; i++) for (const [tx, ty] of [[i, 0], [i, 4], [0, i], [4, i]] as const) {
    if (gate && tx === gate.tx && ty === gate.ty) continue;
    if (pieces.some((p) => { const t = w.get(p, Transform)!; return t.x === tx + 0.5 && t.y === ty + 0.5; })) continue;
    pieces.push(piece(w, "fence_picket", tx, ty));
  }
  if (gate) {
    gateE = piece(w, "garden_gate", gate.tx, gate.ty);
    door = w.create();
    w.add(door, G.PieceLink, { tx: gate.tx, ty: gate.ty, z: 0, side: 0, layer: 1, kind: 1 }).add(door, G.DoorState, { open: 0, lockTribe: 0 });
    G.indexEntity(w, door); pieces.push(gateE);
  }
  steps(w, 2); // structureIndexSystem indexes the pieces (and links the gate attachment)
  return { pieces, gate: gateE, door };
};
const pos = (w: World, e: Entity): { x: number; y: number } => w.get(e, Transform)!;

describe("territory defense + fencing (Task 14)", () => {
  it("inClaim / nearestClaimHostile: only hostiles standing inside the owner's claim count", () => {
    const { w } = setup();
    claim(w, 10, 0, 10, 5);
    expect(G.inClaim(w, 5, 10, 0)).toBe(true);
    expect(G.inClaim(w, 5, 30, 0)).toBe(false);
    expect(G.inClaim(w, 9, 10, 0)).toBe(false); // another tribe's claim is not ours
    expect(G.inClaim(w, 0, 10, 0)).toBe(false); // tribe 0 owns nothing
    const zIn = G.spawnZombie(w, 1, 12, 0); const zOut = G.spawnZombie(w, 1, 30, 0);
    expect(G.nearestClaimHostile(w, 10, 0, 8, 5)).toBe(zIn);
    expect(G.nearestClaimHostile(w, 30, 0, 8, 5)).toBeUndefined(); // the near zombie is outside the claim
    expect(G.nearestClaimHostile(w, 10, 0, 8, 9)).toBeUndefined();
    void zOut;
  });

  it("a pet engages a claim intruder beyond its anchor's defend range (territory, not anchor, defense)", () => {
    const { w, p, id } = setup(0, 0);
    claim(w, 9, 0, 10, 5);
    const a = G.spawnAnimal(w, "animal_dog_dachshund", 1, 0); tame(w, p, a, id("dog_biscuit"));
    w.setField(a, G.Pet, "fullness", 100);
    expect(G.setPetCommand(w, p, a, 1)).toBe(G.PetFail.None); // Stay anchor (1, 0)
    w.set(p, Transform, { x: 30, y: 0 }); // owner far away so the zombie does not chase the player instead
    w.set(a, Transform, { x: 5, y: 0 }); // displaced from its anchor, 4 from the intruder, 8 from the anchor
    const z = G.spawnZombie(w, 1, 9, 0);
    steps(w, 60);
    expect(pos(w, a).x).toBeGreaterThan(5.5); // moved TOWARD the intruder, not home to its anchor
    expect(w.isAlive(z) ? w.getField(z, G.Health, "hp")! : 0).toBeLessThan(w.getField(z, G.Health, "max")!);
  });

  it("tame farm animals attack a hostile inside the owner's claim, and ignore one outside it", () => {
    const { w, p } = setup(30, 0);
    claim(w, 2, 0, 10, 5);
    const cow = G.spawnAnimal(w, "animal_cow", 2, 0);
    w.add(cow, G.Tamed, { kind: w.getField(cow, G.Animal, "kind")!, owner: p, fedUntil: w.tick, produceAt: w.tick, breedAt: w.tick });
    const z = G.spawnZombie(w, 1, 4, 0); const hp0 = w.getField(z, G.Health, "hp")!;
    steps(w, 240);
    expect(w.isAlive(z) ? w.getField(z, G.Health, "hp")! : 0).toBeLessThan(hp0);
    // same setup, but the zombie stands outside the claim: no attack
    const w2p = setup(30, 0); const { w: w2, p: p2 } = w2p;
    claim(w2, 30, 0, 10, 5);
    const cow2 = G.spawnAnimal(w2, "animal_cow", 2, 0);
    w2.add(cow2, G.Tamed, { kind: w2.getField(cow2, G.Animal, "kind")!, owner: p2, fedUntil: w2.tick, produceAt: w2.tick, breedAt: w2.tick });
    const z2 = G.spawnZombie(w2, 1, 4, 0); const hp02 = w2.getField(z2, G.Health, "hp")!;
    steps(w2, 240);
    expect(w2.getField(z2, G.Health, "hp")).toBe(hp02);
    expect(w2.getField(cow2, G.Animal, "state")).not.toBe(G.AnimalState.Attack);
  });

  it("fenced-in farm animals do not escape a closed ring", () => {
    const { w } = setup();
    ring(w);
    const c1 = G.spawnAnimal(w, "animal_chicken", 2.5, 2.5);
    const c2 = G.spawnAnimal(w, "animal_sheep", 2.5, 1.5);
    let escaped = false;
    for (let i = 0; i < 60; i++) { steps(w, 10); for (const c of [c1, c2]) { const t = pos(w, c); if (t.x < 0.8 || t.x > 4.2 || t.y < 0.8 || t.y > 4.2) escaped = true; } }
    expect(escaped).toBe(false);
  });

  it("a closed gate holds; an open gate lets fenced animals out; a destroyed gate lets them out", () => {
    // closed gate: same ring with a gate segment, door shut
    const s1 = setup(); const r1 = ring(s1.w, { tx: 2, ty: 4 });
    const g1 = G.spawnAnimal(s1.w, "animal_chicken", 2.5, 3.5);
    let out1 = false;
    for (let i = 0; i < 60; i++) { steps(s1.w, 10); if (pos(s1.w, g1).y > 5) out1 = true; }
    expect(out1).toBe(false);
    // open gate: the same ring, door open — the chicken finds its way out through the gate
    const s2 = setup(); const r2 = ring(s2.w, { tx: 2, ty: 4 });
    s2.w.set(r2.door!, G.DoorState, { open: 1, lockTribe: 0 });
    const g2 = G.spawnAnimal(s2.w, "animal_chicken", 2.5, 3.5);
    const g2b = G.spawnAnimal(s2.w, "animal_sheep", 2.5, 3.5);
    const g2c = G.spawnAnimal(s2.w, "animal_chicken", 1.5, 3.5);
    let out2 = false;
    for (let i = 0; i < 120; i++) { steps(s2.w, 10); for (const c of [g2, g2b, g2c]) if (pos(s2.w, c).y > 5) out2 = true; }
    expect(out2).toBe(true);
    // destroyed gate: the gate piece is gone, so the gap is passable
    const s3 = setup(); const r3 = ring(s3.w, { tx: 2, ty: 4 });
    s3.w.destroy(r3.gate!); steps(s3.w, 2);
    const g3 = G.spawnAnimal(s3.w, "animal_chicken", 2.5, 3.5);
    const g3b = G.spawnAnimal(s3.w, "animal_sheep", 2.5, 3.5);
    let out3 = false;
    for (let i = 0; i < 120; i++) { steps(s3.w, 10); for (const c of [g3, g3b]) if (pos(s3.w, c).y > 5) out3 = true; }
    expect(out3).toBe(true);
    void r1;
  });

  it("territory defense respects fencing: a fenced defender strains but does not leave the ring", () => {
    const { w, p } = setup(30, 0);
    claim(w, 2.5, 2.5, 10, 5);
    ring(w);
    const cow = G.spawnAnimal(w, "animal_cow", 2.5, 2.5);
    w.add(cow, G.Tamed, { kind: w.getField(cow, G.Animal, "kind")!, owner: p, fedUntil: w.tick, produceAt: w.tick, breedAt: w.tick });
    const z = G.spawnZombie(w, 1, 6, 0); // outside the ring, inside the claim, within defend range
    let attacked = false; let escaped = false;
    for (let i = 0; i < 40; i++) {
      steps(w, 10);
      if (w.getField(cow, G.Animal, "state") === G.AnimalState.Attack) attacked = true;
      const t = pos(w, cow); if (t.x < 0.8 || t.x > 4.2 || t.y < 0.8 || t.y > 4.2) escaped = true;
    }
    expect(attacked).toBe(true);
    expect(escaped).toBe(false);
    expect(w.isAlive(z)).toBe(true); // unreachable through the fence: no bite landed
  });
});
