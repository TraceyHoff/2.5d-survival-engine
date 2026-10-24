import { describe, it, expect } from "vitest";
import { installPermissions, PlayerId, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { addItem, countItem, defaultDefs, Equipment, Exposure, Health, Inventory, IntentAction, LootBag, setIntent, slotItem, snapPlacement, placePiece, spawnPlayer, Tribe, WeaponState, Worn } from "../src/index.js";
import { collect, makeWorld, steps } from "./helpers.js";

const d = defaultDefs(); const id = (k: string) => d.itemId(k);
const mk = (w: World, pid: number, x = 0) => { const p = spawnPlayer(w, { x, y: 0, clientId: pid }); w.add(p, PlayerId, { id: pid }); return p; };
const slotOf = (w: World, e: Entity, item: number) => { for (let s = 0; s < 32; s++) if (slotItem(w, e, s).item === item) return s; throw new Error("no slot"); };
const hold = (w: World, e: Entity, key: string, n = 1) => { addItem(w, e, id(key), n); const s = slotOf(w, e, id(key)); w.set(e, Equipment, { mainHandSlot: s, mainHandItem: id(key) }); return s; };
const hp = (w: World, e: Entity) => w.getField(e, Health, "hp")!;
function world() { const w = makeWorld(); installPermissions(w); return w; }

describe("registration order", () => {
  it("arms components are appended after vehicles", () => {
    const L = G.GAMEPLAY_COMPONENTS; const i = L.indexOf(G.Hitch);
    expect(L.slice(i + 1)).toEqual([Worn, WeaponState, G.LiveExplosive, G.ExplosiveOwner]);
  });
});

describe("wear (clothing / armor / packs)", () => {
  it("wearing sums insulation, waterproof (mean of 6 slots), armor and carry; toggling off reverts", () => {
    const w = world(); const a = mk(w, 1); const mw0 = w.getField(a, Inventory, "maxWeight")!;
    for (const k of ["oilskin_coat", "iron_helmet", "frame_pack"]) { addItem(w, a, id(k), 1); setIntent(w, a, { action: IntentAction.Wear, slot: slotOf(w, a, id(k)) }); steps(w, 1); setIntent(w, a, { action: IntentAction.None }); }
    const def = (k: string) => d.items.get(id(k))!.wear!;
    expect(w.getField(a, Exposure, "insulation")).toBeCloseTo(def("oilskin_coat").insulation + def("iron_helmet").insulation + def("frame_pack").insulation);
    expect(G.waterproofOf(w, a)).toBeCloseTo((def("oilskin_coat").waterproof + def("iron_helmet").waterproof + def("frame_pack").waterproof) / 6);
    expect(G.armorOf(w, a)).toBeCloseTo(def("oilskin_coat").armor + def("iron_helmet").armor);
    expect(w.getField(a, Inventory, "maxWeight")).toBeCloseTo(mw0 + 30);
    expect(G.wornItems(w, a)).toContain(id("iron_helmet"));
    G.wearSlot(w, a, slotOf(w, a, id("frame_pack"))); expect(w.getField(a, Inventory, "maxWeight")).toBeCloseTo(mw0);
  });
  it("removing a worn item from inventory unequips it", () => {
    const w = world(); const a = mk(w, 1); addItem(w, a, id("steel_cuirass"), 1); G.wearSlot(w, a, slotOf(w, a, id("steel_cuirass")));
    expect(G.armorOf(w, a)).toBeGreaterThan(0); G.removeItem(w, a, id("steel_cuirass"), 1); steps(w, 1);
    expect(G.armorOf(w, a)).toBe(0); expect(w.has(a, Worn)).toBe(true);
  });
  it("armor reduces combat damage; armor pierce bypasses it", () => {
    const w = world(); const a = mk(w, 1); addItem(w, a, id("steel_cuirass"), 1); G.wearSlot(w, a, slotOf(w, a, id("steel_cuirass")));
    const ar = G.armorOf(w, a); expect(G.armorReduce(w, a, 100)).toBeCloseTo(100 * 100 / (100 + ar)); expect(G.armorReduce(w, a, 100, 1)).toBeCloseTo(100);
  });
  it("non-wearables are rejected", () => { const w = world(); const a = mk(w, 1); addItem(w, a, id("wood"), 1); expect(G.wearSlot(w, a, slotOf(w, a, id("wood")))).toBe(false); });
});

describe("ranged: reload / ammo / charge", () => {
  it("reload takes reloadSeconds, consumes inventory ammo up to magazine; shots spend rounds", () => {
    const w = world(); const a = mk(w, 1, 0); const b = mk(w, 2, 8); hold(w, a, "revolver"); addItem(w, a, id("pistol_round"), 10);
    const rel = collect(w, G.Reloaded); steps(w, 1);
    setIntent(w, a, { action: IntentAction.Reload }); steps(w, 1); setIntent(w, a, { action: IntentAction.None });
    expect(w.getField(a, WeaponState, "loaded")).toBe(0); steps(w, 75);
    expect(w.getField(a, WeaponState, "loaded")).toBe(6); expect(countItem(w, a, id("pistol_round"))).toBe(4); expect(rel.length).toBe(1);
    const h0 = hp(w, b); setIntent(w, a, { action: IntentAction.Attack, target: b }); steps(w, 1);
    expect(hp(w, b)).toBeLessThan(h0); expect(w.getField(a, WeaponState, "loaded")).toBe(5);
  });
  it("without ammo a ranged weapon cannot shoot beyond melee reach", () => {
    const w = world(); const a = mk(w, 1, 0); const b = mk(w, 2, 8); hold(w, a, "revolver"); steps(w, 1);
    const h0 = hp(w, b); setIntent(w, a, { action: IntentAction.Attack, target: b }); steps(w, 1); expect(hp(w, b)).toBe(h0);
  });
  it("switching weapons unloads rounds back into the inventory", () => {
    const w = world(); const a = mk(w, 1); hold(w, a, "revolver"); addItem(w, a, id("pistol_round"), 6); steps(w, 1);
    setIntent(w, a, { action: IntentAction.Reload }); steps(w, 1); setIntent(w, a, { action: IntentAction.None }); steps(w, 75);
    expect(countItem(w, a, id("pistol_round"))).toBe(0);
    w.set(a, Equipment, { mainHandSlot: G.NO_SLOT, mainHandItem: 0 }); steps(w, 1);
    expect(countItem(w, a, id("pistol_round"))).toBe(6); expect(w.getField(a, WeaponState, "loaded")).toBe(0);
  });
  it("bow draw scales damage from minChargeMul to 1", () => {
    const w = world(); const a = mk(w, 1); const s = hold(w, a, "longbow"); addItem(w, a, id("iron_arrow"), 2); steps(w, 1);
    const def = d.items.get(id("longbow"))!; expect(G.chargeMul(w, a, def, 1 / 20)).toBeCloseTo(def.ranged!.minChargeMul);
    setIntent(w, a, { action: IntentAction.None, charge: 1 }); steps(w, 40);
    expect(G.chargeMul(w, a, def, 1 / 20)).toBeCloseTo(1); expect(s).toBeGreaterThanOrEqual(0);
  });
});

describe("hybrid & thrown", () => {
  it("bayonet rifle stabs in reach without spending ammo", () => {
    const w = world(); const a = mk(w, 1, 0); const b = mk(w, 2, 1); hold(w, a, "bayonet_rifle"); steps(w, 1);
    const h0 = hp(w, b); setIntent(w, a, { action: IntentAction.Attack, target: b }); steps(w, 1); expect(hp(w, b)).toBeLessThan(h0);
  });
  it("a spear thrown beyond reach damages and lands in a loot bag owned by the thrower", () => {
    const w = world(); const a = mk(w, 1, 0); const b = mk(w, 2, 6); hold(w, a, "stone_spear"); steps(w, 1);
    const h0 = hp(w, b); setIntent(w, a, { action: IntentAction.Attack, target: b }); steps(w, 1);
    expect(hp(w, b)).toBeLessThan(h0); expect(countItem(w, a, id("stone_spear"))).toBe(0);
    const bags = [...w.query([LootBag])].filter((x) => countItem(w, x, id("stone_spear")) === 1);
    expect(bags.length).toBe(1); expect(w.getField(bags[0]!, LootBag, "owner")).toBe(1);
  });
});

describe("explosives", () => {
  function place(w: World, b: Entity, key: string, x: number, y: number): Entity {
    const sn = snapPlacement(w, { piece: d.pieceId(key), x, y, level: 0, rot: 0, tier: 0, variant: 0 }); if (typeof sn === "number") throw new Error(`snap ${sn}`);
    return placePiece(w, b, sn, { pay: false });
  }
  it("fuse delays detonation; damage falls off with distance; event emitted", () => {
    const w = world(); const a = mk(w, 1, 0); const near = mk(w, 2, 6); const far = mk(w, 3, 8.5);
    const s = hold(w, a, "grenade", 2); const ex = collect(w, G.Exploded);
    expect(G.throwExplosive(w, a, s, id("grenade"), 6, 0, 1 / 20)).toBeDefined(); expect(countItem(w, a, id("grenade"))).toBe(1);
    const n0 = hp(w, near), f0 = hp(w, far); steps(w, 20 * 3 - 2); expect(hp(w, near)).toBe(n0);
    steps(w, 4); expect(ex.length).toBe(1);
    expect(n0 - hp(w, near)).toBeGreaterThan(f0 - hp(w, far)); expect(hp(w, far)).toBeLessThan(f0);
  });
  it("owner/tribe live in a server-only side component; replicated LiveExplosive carries only item + fuse", () => {
    const w = world(); const a = mk(w, 1, 0); w.add(a, Tribe, { id: 7 }); const s = hold(w, a, "grenade");
    const live = G.throwExplosive(w, a, s, id("grenade"), 3, 0, 1 / 20)!;
    expect(Object.keys(G.LiveExplosive.schema).sort()).toEqual(["detonateTick", "item"]);
    expect(G.replicationOf(G.ExplosiveOwner)).toBeUndefined(); expect(G.replicationOf(G.LiveExplosive)).toBeDefined();
    expect(G.ExplosiveOwner.networked).toBe(false); expect(G.LiveExplosive.networked).toBe(true);
    expect(w.get(live, G.ExplosiveOwner)).toEqual({ owner: a, ownerTribe: 7 });
  });
  it("own-tribe structures are immune; raid rule can veto enemy pieces", () => {
    const w = world(); const owner = mk(w, 1, 0); w.add(owner, Tribe, { id: 7 }); const raider = mk(w, 2, 0); w.add(raider, Tribe, { id: 9 });
    const wall = place(w, owner, "gate_clan", 4, 4); const php = () => w.getField(wall, G.BuildPiece, "hp")!; const h0 = php();
    const s1 = hold(w, owner, "satchel_charge"); G.throwExplosive(w, owner, s1, id("satchel_charge"), 4, 4, 1 / 20); steps(w, 20 * 7);
    expect(php()).toBe(h0);
    G.setRaidRule(w, () => false); const s2 = hold(w, raider, "satchel_charge"); G.throwExplosive(w, raider, s2, id("satchel_charge"), 4, 4, 1 / 20); steps(w, 20 * 7);
    expect(php()).toBe(h0);
    G.setRaidRule(w, undefined); const s3 = hold(w, raider, "satchel_charge"); G.throwExplosive(w, raider, s3, id("satchel_charge"), 4, 4, 1 / 20); steps(w, 20 * 7);
    expect(php()).toBeLessThan(h0);
  });
});

describe("skill-gated recipes", () => {
  it("SkillTooLow when the provider reports a low level; ignored without a provider", () => {
    const w = world(); const a = mk(w, 1);
    const r = [...d.recipes.values()].find((x) => x.skill)!;
    expect(G.meetsSkill(w, a, r)).toBe(true);
    G.setSkillLevelProvider(w, () => 0); expect(G.meetsSkill(w, a, r)).toBe(false);
    G.setSkillLevelProvider(w, () => r.skill!.level); expect(G.meetsSkill(w, a, r)).toBe(true);
  });
});
