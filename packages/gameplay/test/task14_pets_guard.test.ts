import { describe, expect, it } from "vitest";
import { PlayerId, Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const pid = (w: World, e: Entity, id: number): void => { if (w.has(e, PlayerId)) w.set(e, PlayerId, { id }); else w.add(e, PlayerId, { id }); };
const setup = (): { w: World; p: Entity; id: (k: string) => number } => {
  const w = makeWorld(); if (!w.isRegistered(PlayerId)) w.register(PlayerId);
  const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 7 }); pid(w, p, 7);
  return { w, p, id: (k) => G.gameplayDefs(w).itemId(k) };
};
const tame = (w: World, p: Entity, a: Entity, item: number): void => {
  G.addItem(w, p, item, 50);
  for (let i = 0; i < 40 && !w.has(a, G.Pet); i++) { G.offerTreat(w, p, a, item); w.step(1 / 20); }
};
const petAt = (w: World, a: Entity): { x: number; y: number } => w.get(a, Transform)!;
const dist = (w: World, a: Entity, x: number, y: number): number => { const t = petAt(w, a); return Math.hypot(t.x - x, t.y - y); };

describe("pets guard (Task 14)", () => {
  it("guard a location: pet holds the spot while the owner walks away, status Guard", () => {
    const { w, p, id } = setup();
    const a = G.spawnAnimal(w, "animal_dog_dachshund", 1, 0); tame(w, p, a, id("dog_biscuit"));
    w.setField(a, G.Pet, "fullness", 100);
    expect(G.setGuard(w, p, a, G.GuardKind.Location, a, 1, 0)).toBe(G.PetFail.None);
    expect(w.getField(a, G.Pet, "cmd")).toBe(G.PetCmd.Guard);
    expect(w.get(a, G.PetGuard)).toMatchObject({ kind: 1, x: 1, y: 0 });
    w.set(p, Transform, { x: 20, y: 0 }); steps(w, 120);
    expect(dist(w, a, 1, 0)).toBeLessThan(1);
    expect(w.getField(a, G.PetStatusComp, "status")).toBe(G.PetStatus.Guard);
    expect(G.petView(w, p, a)?.guard).toBe("Location (1.0, 0.0)");
    expect(G.petStatusLabel(G.PetStatus.Guard)).toBe("Guarding");
  });

  it("guard does not teleport to a far owner and does not fetch dropped items", () => {
    const { w, p, id } = setup();
    const a = G.spawnAnimal(w, "animal_dog_beagle", 1, 0); tame(w, p, a, id("dog_biscuit"));
    w.setField(a, G.Pet, "fullness", 100);
    expect(G.setGuard(w, p, a, G.GuardKind.Location, a, 1, 0)).toBe(G.PetFail.None);
    G.addItem(w, p, id("planks"), 3); G.dropItem(w, p, id("planks"), 3);
    w.set(p, Transform, { x: 30, y: 0 }); steps(w, 100);
    expect(dist(w, a, 1, 0)).toBeLessThan(1); // still at its post, not teleported to the owner
    expect(G.countItem(w, a, id("planks"))).toBe(0);
  });

  it("guard an entity: pet tracks a moving player, and a piece by name", () => {
    const { w, p, id } = setup();
    const a = G.spawnAnimal(w, "animal_dog_shepherd", 1, 0); tame(w, p, a, id("dog_biscuit"));
    w.setField(a, G.Pet, "fullness", 100);
    const q = G.spawnPlayer(w, { x: 5, y: 0, maxWeight: 0, clientId: 8 }); pid(w, q, 8);
    expect(G.setGuard(w, p, a, G.GuardKind.Entity, q, 0, 0)).toBe(G.PetFail.None);
    expect(G.petView(w, p, a)?.guard).toBe("Player");
    w.set(q, Transform, { x: 8, y: 0 }); steps(w, 200);
    expect(dist(w, a, 8, 0)).toBeLessThan(1.5);
    // a building piece / station is guardable too (pieces resolve through their Transform)
    const piece = w.create();
    w.add(piece, Transform, { x: 3, y: 3 }).add(piece, G.BuildPiece, { type: G.gameplayDefs(w).pieceId("campfire") }); G.indexEntity(w, piece);
    expect(G.setGuard(w, p, a, G.GuardKind.Entity, piece, 0, 0)).toBe(G.PetFail.None);
    expect(G.petView(w, p, a)?.guard).toBe("campfire");
  });

  it("guard a pet, a farm animal and an AI human (player entity) by kind", () => {
    const { w, p, id } = setup();
    const a = G.spawnAnimal(w, "animal_dog_dachshund", 1, 0); tame(w, p, a, id("dog_biscuit"));
    const b = G.spawnAnimal(w, "animal_cat_tabby", 2, 0); tame(w, p, b, id("fish_treat"));
    expect(G.setGuard(w, p, a, G.GuardKind.Entity, b, 0, 0)).toBe(G.PetFail.None);
    expect(G.petView(w, p, a)?.guard).toBe(G.petName(w, b));
    // farm animal = husbandry livestock (Tamed, no Pet): guardable, labelled by species
    const cow = G.spawnAnimal(w, "animal_cow", 4, 0);
    w.add(cow, G.Tamed, { kind: w.getField(cow, G.Animal, "kind")!, owner: a, fedUntil: w.tick, produceAt: w.tick, breedAt: w.tick });
    expect(G.setGuard(w, p, a, G.GuardKind.Entity, cow, 0, 0)).toBe(G.PetFail.None);
    expect(G.petView(w, p, a)?.guard).toBe("cow");
    // AI humans are player entities in the sim: guarding one labels it as a player
    const bot = G.spawnPlayer(w, { x: 6, y: 0, maxWeight: 0, clientId: 9 }); pid(w, bot, 9);
    expect(G.setGuard(w, p, a, G.GuardKind.Entity, bot, 0, 0)).toBe(G.PetFail.None);
    expect(G.petView(w, p, a)?.guard).toBe("Player");
  });

  it("guard engages a hostile at its post, then returns; status Fight -> Return -> Guard", () => {
    const { w, p, id } = setup();
    const a = G.spawnAnimal(w, "animal_dog_shepherd", 1, 0); tame(w, p, a, id("dog_biscuit"));
    w.setField(a, G.Pet, "fullness", 100);
    expect(G.setGuard(w, p, a, G.GuardKind.Location, a, 1, 0)).toBe(G.PetFail.None);
    const z = G.spawnZombie(w, 1, 1.8, 0); const hp0 = w.getField(z, G.Health, "hp")!;
    steps(w, 60);
    expect(w.isAlive(z) ? w.getField(z, G.Health, "hp")! : 0).toBeLessThan(hp0);
    expect(w.getField(a, G.PetStatusComp, "status")).toBe(G.PetStatus.Fight);
    w.destroy(z); steps(w, 120);
    expect(dist(w, a, 1, 0)).toBeLessThan(1);
    expect(w.getField(a, G.PetStatusComp, "status")).toBe(G.PetStatus.Guard);
  });

  it("guarding ends cleanly: target destroyed, target dies, reassign, recall to Follow", () => {
    const { w, p, id } = setup();
    const a = G.spawnAnimal(w, "animal_dog_dachshund", 1, 0); tame(w, p, a, id("dog_biscuit"));
    const piece = w.create();
    w.add(piece, Transform, { x: 3, y: 3 }).add(piece, G.BuildPiece, { type: G.gameplayDefs(w).pieceId("campfire") }); G.indexEntity(w, piece);
    expect(G.setGuard(w, p, a, G.GuardKind.Entity, piece, 0, 0)).toBe(G.PetFail.None);
    w.destroy(piece); steps(w, 2);
    expect(w.getField(a, G.Pet, "cmd")).toBe(G.PetCmd.Follow); expect(w.has(a, G.PetGuard)).toBe(false);
    const q = G.spawnPlayer(w, { x: 5, y: 0, maxWeight: 0, clientId: 8 }); pid(w, q, 8);
    expect(G.setGuard(w, p, a, G.GuardKind.Entity, q, 0, 0)).toBe(G.PetFail.None);
    G.applyDamage(w, q, 9999, p); steps(w, 2);
    expect(w.getField(a, G.Pet, "cmd")).toBe(G.PetCmd.Follow); expect(w.has(a, G.PetGuard)).toBe(false);
    // reassign moves the anchor; recall (Follow) clears the assignment
    expect(G.setGuard(w, p, a, G.GuardKind.Location, a, 10, 10)).toBe(G.PetFail.None);
    expect(G.setGuard(w, p, a, G.GuardKind.Location, a, -5, 2)).toBe(G.PetFail.None);
    expect(w.get(a, G.PetGuard)).toMatchObject({ kind: 1, x: -5, y: 2 });
    expect(G.setPetCommand(w, p, a, 0)).toBe(G.PetFail.None);
    expect(w.getField(a, G.Pet, "cmd")).toBe(G.PetCmd.Follow); expect(w.has(a, G.PetGuard)).toBe(false);
  });

  it("guard validation: non-owner, bad kind, dead target", () => {
    const { w, p, id } = setup();
    const a = G.spawnAnimal(w, "animal_dog_dachshund", 1, 0); tame(w, p, a, id("dog_biscuit"));
    const q = G.spawnPlayer(w, { x: 1, y: 1, maxWeight: 0, clientId: 8 }); pid(w, q, 8);
    expect(G.setGuard(w, q, a, G.GuardKind.Location, a, 1, 0)).toBe(G.PetFail.NotOwner);
    expect(G.setGuard(w, p, a, 9, a, 1, 0)).toBe(G.PetFail.BadTarget);
    expect(G.setGuard(w, p, a, G.GuardKind.Location, a, Number.NaN, 0)).toBe(G.PetFail.BadTarget);
    const dead = G.spawnPlayer(w, { x: 2, y: 0, maxWeight: 0, clientId: 10 }); pid(w, dead, 10);
    G.applyDamage(w, dead, 9999, p);
    expect(G.setGuard(w, p, a, G.GuardKind.Entity, dead, 0, 0)).toBe(G.PetFail.BadTarget);
    expect(w.getField(a, G.Pet, "cmd")).toBe(G.PetCmd.Follow);
  });

  it("status symbol data updates as activity changes (petView.status)", () => {
    const { w, p, id } = setup();
    const a = G.spawnAnimal(w, "animal_dog_dachshund", 1, 0); tame(w, p, a, id("dog_biscuit"));
    w.setField(a, G.Pet, "fullness", 100);
    steps(w, 10);
    expect(G.petView(w, p, a)?.status).toBe(G.PetStatus.Idle);
    expect(G.setPetCommand(w, p, a, 1)).toBe(G.PetFail.None); steps(w, 10);
    expect(G.petView(w, p, a)?.status).toBe(G.PetStatus.Stay);
    expect(G.setGuard(w, p, a, G.GuardKind.Location, a, 1, 0)).toBe(G.PetFail.None); steps(w, 10);
    expect(G.petView(w, p, a)?.status).toBe(G.PetStatus.Guard);
    expect(G.petStatusLabel(G.petView(w, p, a)!.status)).toBe("Guarding");
  });
});
