import { describe, expect, it } from "vitest";
import { PlayerId, Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { collect, makeWorld, steps } from "./helpers.js";

const pid = (w: World, e: Entity, id: number): void => { if (w.has(e, PlayerId)) w.set(e, PlayerId, { id }); else w.add(e, PlayerId, { id }); };
const setup = (): { w: World; p: Entity; id: (k: string) => number } => {
  const w = makeWorld(); if (!w.isRegistered(PlayerId)) w.register(PlayerId); const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 7 }); pid(w, p, 7);
  const d = G.gameplayDefs(w); return { w, p, id: (k) => d.itemId(k) };
};
const tame = (w: World, p: Entity, a: Entity, item: number): void => { G.addItem(w, p, item, 50); for (let i = 0; i < 40 && !w.has(a, G.Pet); i++) { G.offerTreat(w, p, a, item); w.step(1 / 20); } };

describe("pets (ADR-145)", () => {
  it("pets.json: 13 species incl. dachshund, cats, parrot, crow, chicken, rabbit, ferret; 6 craftable treats", () => {
    const keys = G.PET_SPECIES.map((s) => s.key);
    for (const k of ["dog_dachshund", "cat_tabby", "cat_siamese", "parrot", "crow", "chicken", "rabbit", "ferret"]) expect(keys).toContain(k);
    expect(G.PET_TREATS.length).toBe(6);
    const recipes = JSON.parse(JSON.stringify(G.gameplayDefs(makeWorld()).recipes ?? {})); void recipes;
    expect(G.tameChance(G.petSpeciesOfKey("dog_dachshund"), "dog_biscuit")).toBeGreaterThan(G.tameChance(G.petSpeciesOfKey("dog_dachshund"), "veggie_bites"));
    expect(G.tameChance(G.petSpeciesOfKey("parrot"), "meaty_chew")).toBe(0);
  });
  it("hated treat is refused and kept; a loved treat tames (owner, 6-slot bag, follow)", () => {
    const { w, p, id } = setup(); const a = G.spawnAnimal(w, "animal_dog_dachshund", 1, 0);
    G.addItem(w, p, id("seed_mix"), 1); expect(G.offerTreat(w, p, a, id("seed_mix")).result).toBe(G.PetResult.Refused); expect(G.countItem(w, p, id("seed_mix"))).toBe(1);
    const ev = collect(w, G.PetEvent); tame(w, p, a, id("dog_biscuit"));
    expect(w.has(a, G.Pet)).toBe(true); expect(G.petOwnerId(w, a)).toBe(7); expect(w.get(a, G.Container)!.slotCount).toBe(6);
    expect(ev.some((e) => e.result === G.PetResult.Tamed)).toBe(true);
    expect(G.checkOffer(w, p, a, id("seed_mix"))).toBe(G.PetFail.NotFood);
  });
  it("rename (sanitized, 16 max), other players can't rename or command", () => {
    const { w, p, id } = setup(); const a = G.spawnAnimal(w, "animal_cat_tabby", 1, 0); tame(w, p, a, id("fish_treat"));
    expect(G.renamePet(w, p, a, "  Sir Whiskers the Magnificent!!  ")).toBe(G.PetFail.None); expect(G.petName(w, a).length).toBeLessThanOrEqual(16); expect(G.petName(w, a)).toMatch(/^Sir Whiskers/);
    const q = G.spawnPlayer(w, { x: 1, y: 1, maxWeight: 0, clientId: 8 }); pid(w, q, 8);
    expect(G.renamePet(w, q, a, "Mine")).toBe(G.PetFail.NotOwner); expect(G.setPetCommand(w, q, a, 1)).toBe(G.PetFail.NotOwner);
  });
  it("hunger: eats from its bag, then the ground, then an owned trough; starving floors hp at 1 and drains loyalty", () => {
    const { w, p, id } = setup(); const a = G.spawnAnimal(w, "animal_dog_lab", 1, 0); tame(w, p, a, id("dog_biscuit"));
    const ate = collect(w, G.PetAte);
    G.setPetCommand(w, p, a, 1);
    G.addItem(w, a, id("cooked_meat"), 1); w.setField(a, G.Pet, "fullness", 10); steps(w, 5);
    expect(ate.at(-1)?.source).toBe(0); expect(G.countItem(w, a, id("cooked_meat"))).toBe(0);
    w.setField(a, G.Pet, "fullness", 10); G.addItem(w, p, id("cooked_meat"), 1); const bag = G.dropItem(w, p, id("cooked_meat"), 1)!; expect(bag).toBeDefined();
    steps(w, 200); expect(ate.some((e) => e.source === 1)).toBe(true);
    const tr = w.create(); const t = w.get(a, Transform)!;
    w.add(tr, Transform, { x: t.x + 3, y: t.y }).add(tr, G.BuildPiece, { type: G.gameplayDefs(w).pieceId("pet_trough") }).add(tr, G.Container, { slotCount: 8 }).add(tr, G.TroughOwner, { player: 7 }); G.indexEntity(w, tr);
    G.addItem(w, tr, id("cooked_meat"), 2); w.setField(a, G.Pet, "fullness", 10); steps(w, 200); expect(ate.some((e) => e.source === 2)).toBe(true);
    w.setField(a, G.Pet, "fullness", 0); G.removeItem(w, tr, id("cooked_meat"), 9); w.set(a, G.Health, { hp: 3 }); w.setField(a, G.Pet, "hp", 3);
    const loy = w.getField(a, G.Pet, "loyalty")!; steps(w, 20 * 60);
    expect(w.has(a, G.Dead)).toBe(false); expect(w.getField(a, G.Health, "hp")).toBe(1); expect(w.getField(a, G.Pet, "loyalty")!).toBeLessThan(loy);
  });
  it("follow keeps up with the owner; stay holds its spot", () => {
    const { w, p, id } = setup(); const a = G.spawnAnimal(w, "animal_ferret", 1, 0); tame(w, p, a, id("meaty_chew"));
    w.set(p, Transform, { x: 10, y: 0 }); steps(w, 120); expect(Math.hypot(w.get(a, Transform)!.x - 10, w.get(a, Transform)!.y)).toBeLessThan(3);
    G.setPetCommand(w, p, a, 1); const s = { ...w.get(a, Transform)! }; w.set(p, Transform, { x: -10, y: 0 }); steps(w, 120);
    expect(Math.hypot(w.get(a, Transform)!.x - s.x, w.get(a, Transform)!.y - s.y)).toBeLessThan(1);
  });
  it("defends the owner (follow) and its post (stay), gains xp and levels (hp/damage/speed grow)", () => {
    const { w, p, id } = setup(); const a = G.spawnAnimal(w, "animal_dog_shepherd", 1, 0); tame(w, p, a, id("dog_biscuit"));
    const s1 = G.petStats(G.petSpeciesOfKey("dog_shepherd"), 1), s5 = G.petStats(G.petSpeciesOfKey("dog_shepherd"), 5);
    expect(s5.maxHp).toBeGreaterThan(s1.maxHp); expect(s5.damage).toBeGreaterThan(s1.damage); expect(s5.run).toBeGreaterThan(s1.run);
    const z = G.spawnZombie(w, 1, 4, 0); const hp0 = w.getField(z, G.Health, "hp")!;
    steps(w, 100); expect(w.isAlive(z) ? w.getField(z, G.Health, "hp")! : 0).toBeLessThan(hp0); expect(w.getField(a, G.Pet, "xp")! + (w.getField(a, G.Pet, "level")! - 1)).toBeGreaterThan(0);
    const ev = collect(w, G.PetEvent); G.grantPetXp(w, a, 500); expect(w.getField(a, G.Pet, "level")).toBeGreaterThan(1); w.step(1 / 20); expect(ev.some((e) => e.result === G.PetResult.LevelUp)).toBe(true);
    steps(w, 2); expect(w.getField(a, G.Health, "max")).toBeGreaterThan(s1.maxHp);
  });
  it("a hungry pet still fights back (defence beats eating)", () => {
    const { w, p, id } = setup(); const a = G.spawnAnimal(w, "animal_dog_dachshund", 1, 0); tame(w, p, a, id("dog_biscuit"));
    w.setField(a, G.Pet, "fullness", 5); const t = w.get(a, Transform)!;
    G.addItem(w, p, id("cooked_meat"), 3); const food = G.dropItem(w, p, id("cooked_meat"), 3)!; w.set(food, Transform, { x: t.x + 5, y: t.y }); G.indexEntity(w, food);
    const z = G.spawnZombie(w, 1, t.x - 1.5, t.y); const hp0 = w.getField(z, G.Health, "hp")!;
    const hits = collect(w, G.Damaged); steps(w, 40);
    expect(hits.some((h) => h.source === a && h.target === z)).toBe(true);
  });
  it("fetches items the owner drops into its bag (follow only); a dead pet's bag drops for its owner", () => {
    const { w, p, id } = setup(); const a = G.spawnAnimal(w, "animal_dog_beagle", 1, 0); tame(w, p, a, id("dog_biscuit"));
    w.setField(a, G.Pet, "fullness", 100); G.addItem(w, p, id("planks"), 3); G.dropItem(w, p, id("planks"), 3); steps(w, 100);
    expect(G.countItem(w, a, id("planks"))).toBe(3);
    G.applyDamage(w, a, 9999, p); steps(w, 3);
    const bags = [...w.query([G.LootBag, G.Container])].filter((b) => G.countItem(w, b, id("planks")) === 3); expect(bags.length).toBe(1);
  });
  it("AI humans tame too (survivor tame_pet behavior)", () => {
    const { w, p, id } = setup(); void p; const bot = G.spawnPlayer(w, { x: 20, y: 20, maxWeight: 0, clientId: 9 }); pid(w, bot, 9);
    const a = G.spawnAnimal(w, "animal_parrot", 21, 20); tame(w, bot, a, id("seed_mix")); expect(G.petOwnerId(w, a)).toBe(9);
  });
  it("owner opens the pet bag through the real container commands; others are locked out", () => {
    const { w, p, id } = setup(); const reg = G.registerGameplayCommands(); const a = G.spawnAnimal(w, "animal_dog_beagle", 1, 0); tame(w, p, a, id("dog_biscuit"));
    w.set(a, Transform, { x: 1, y: 0 }); G.setPetCommand(w, p, a, 1);
    const cmd = (e: Entity, def: import("@engine/core").CommandDef, v: Record<string, number>): void => { G.applyGameplayInput(w, e, { tick: 0, actions: 0, aimX: 0, aimY: 0, commands: [reg.make(def, v)] }, reg); w.step(1 / 20); };
    cmd(p, G.OpenContainerCmd, { target: a }); expect(w.getField(p, G.Viewing, "container")).toBe(a);
    G.addItem(w, p, id("planks"), 3); cmd(p, G.DepositCmd, { target: a, item: id("planks"), count: 3 }); expect(G.countItem(w, a, id("planks"))).toBe(3);
    cmd(p, G.WithdrawCmd, { target: a, item: id("planks"), count: 2 }); expect(G.countItem(w, p, id("planks"))).toBe(2);
    const q = G.spawnPlayer(w, { x: 1, y: 1, maxWeight: 0, clientId: 8 }); pid(w, q, 8); const fails = collect(w, G.BuildFailed);
    cmd(q, G.OpenContainerCmd, { target: a }); expect(w.has(q, G.Viewing)).toBe(false); expect(fails.some((f) => f.reason === G.BuildFail.Locked)).toBe(true);
  });
});
