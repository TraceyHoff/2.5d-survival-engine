import { describe, it, expect } from "vitest";
import { installPermissions, PlayerId, Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const d = G.defaultDefs(); const id = (k: string) => d.itemId(k);
function world() { const w = makeWorld(); installPermissions(w); return w; }
const mk = (w: World, pid: number, x = 0) => { const p = G.spawnPlayer(w, { x, y: 0, clientId: pid }); w.add(p, PlayerId, { id: pid }); return p; };
const xp = (w: World, e: Entity) => w.get(e, G.Progression)!.xp + 0;
const slotOf = (w: World, e: Entity, item: number) => G.listSlots(w, e).find((s) => s.item === item)!.slot;

describe("ADR-135 XP table", () => {
  it("has a source for every activity and kill entries for all victim types", () => {
    for (const k of ["gather", "chop", "mine", "craft", "cook", "eat", "drink", "build", "road", "sign", "farm", "till", "plant", "husbandry", "tame", "heal", "repair", "walk", "vehicle", "kill", "hunt"]) expect(G.XP.sources[k as G.XpSource]).toBeGreaterThan(0);
    for (const k of ["zombie", "animal", "aiHuman", "player"] as const) expect(G.XP.kills[k].base).toBeGreaterThan(0);
  });
  it("XpActivity awards by source and emits XpGained", () => {
    const w = world(); const a = mk(w, 1); const got: number[] = []; w.events.on(G.XpGained as never, (p: { amount: number }) => got.push(p.amount));
    const x0 = xp(w, a); G.emit(w, G.XpActivity, { entity: a, source: "road", units: 3 }); steps(w, 2);
    expect(xp(w, a) - x0).toBeGreaterThanOrEqual(3 * G.XP.sources.road!); expect(got.length).toBeGreaterThan(0);
  });
  it("kill XP scales by zombie kind and victim level", () => {
    const w = world(); const z1 = G.spawnZombie(w, "zombie_walker", 5, 5); const z2 = G.spawnZombie(w, "zombie_brute", 6, 6);
    expect(G.killXpBase(w, z2)).toBeGreaterThan(G.killXpBase(w, z1));
    const b = mk(w, 2, 3); const lo = G.killXpBase(w, b); w.set(b, G.Progression, { level: 30 }); expect(G.killXpBase(w, b)).toBeGreaterThan(lo);
    const wolf = G.spawnAnimal(w, "animal_wolf", 9, 9); expect(G.killXpBase(w, wolf)).toBeGreaterThan(0);
  });
  it("AI humans are typed via the predicate", () => {
    const w = world(); const b = mk(w, 3); expect(G.victimType(w, b)).toBe("player");
    G.setAiHumanPredicate(w, (e) => e === b); expect(G.victimType(w, b)).toBe("aiHuman");
  });
  it("PvP diminishing returns on the same victim, reset after the window", () => {
    const w = world(); const a = mk(w, 1); const b = mk(w, 2, 2);
    const f = [0, 1, 2, 3, 4].map(() => G.pvpFactor(w, a, b));
    expect(f[0]).toBe(1); expect(f[1]).toBeLessThan(1); expect(f[2]).toBeLessThan(f[1]!); expect(f[4]).toBe(0);
    const c = mk(w, 4, 4); expect(G.pvpFactor(w, a, c)).toBe(1); // other victims are unaffected
    w.set(a, G.Progression, { level: 40 }); expect(G.pvpFactor(w, a, mk(w, 5, 5))).toBeLessThan(1); // much lower level
  });
  it("walking awards travel XP; teleports do not", () => {
    const w = world(); const a = mk(w, 1); G.travelStep(w, 20, [a]);
    for (let i = 0; i < 10; i++) { w.tick += 20; w.setField(a, Transform, "x", (i + 1) * 5); var r = G.travelStep(w, 20, [a]); if (r.length) break; }
    expect(r!.some((x) => x.source === "walk")).toBe(true);
    w.tick += 20; w.setField(a, Transform, "x", 9999); expect(G.travelStep(w, 20, [a])).toEqual([]);
  });
});

describe("ADR-135 equipment", () => {
  it("8 wear slots: off-hand knife adds armor, cannot share the main-hand slot; Worn persists", () => {
    const w = world(); const a = mk(w, 1);
    expect(G.WEAR_SLOTS).toBe(8); expect(G.Worn.persistent ?? (G.Worn as { options?: { persistent?: boolean } }).options?.persistent).toBeTruthy();
    G.addItem(w, a, id("iron_knife"), 1); G.addItem(w, a, id("iron_helmet"), 1);
    const k = slotOf(w, a, id("iron_knife")), h = slotOf(w, a, id("iron_helmet"));
    expect(G.wearSlot(w, a, h)).toBe(true); expect(G.wearSlot(w, a, k)).toBe(true);
    const worn = G.wornItems(w, a); expect(worn[6]).toBe(id("iron_knife")); expect(worn[0]).toBe(id("iron_helmet"));
    expect(w.get(a, G.Worn)!.armor).toBeGreaterThan(0);
    w.set(a, G.Equipment, { mainHandSlot: k }); G.refreshWorn(w, a); expect(G.wornItems(w, a)[6]).toBe(0); // moved to main hand
    expect(G.wearSlot(w, a, k)).toBe(false);
  });
  it("equipmentView lists main hand + 8 slots; inventory marks equip kind", () => {
    const w = world(); const a = mk(w, 1); G.addItem(w, a, id("iron_helmet"), 1); G.addItem(w, a, id("iron_sword"), 1);
    G.wearSlot(w, a, slotOf(w, a, id("iron_helmet")));
    const c = { world: w, player: a } as unknown as G.MenuCtx; const ev = G.equipmentView(c);
    expect(ev.length).toBe(9); expect(ev[1]!.name).toMatch(/Helmet/i);
    const inv = G.inventoryView(c);
    expect(inv.find((s) => s.item === id("iron_helmet"))).toMatchObject({ equip: "wear", equipped: true });
    expect(inv.find((s) => s.item === id("iron_sword"))?.equip).toBe("hand");
  });
  it("worn gear maps to paper-doll wearables", () => {
    const w = world(); const a = mk(w, 1); G.addItem(w, a, id("iron_helmet"), 1); G.addItem(w, a, id("leather_backpack"), 1);
    G.wearSlot(w, a, slotOf(w, a, id("iron_helmet"))); G.wearSlot(w, a, slotOf(w, a, id("leather_backpack")));
    expect(Object.fromEntries(G.wornCosmetics(w, a))).toMatchObject({ hat: "hat_helmet", accessory: "acc_backpack" });
  });
});

describe("ADR-135 EquipCmd", () => {
  it("equips a slot into the main hand and toggles off", () => {
    const w = world(); const a = mk(w, 1); G.addItem(w, a, id("iron_knife"), 1); const s = slotOf(w, a, id("iron_knife"));
    w.set(a, G.PlayerIntent, { action: G.IntentAction.Equip, slot: s }); steps(w, 1);
    expect(w.get(a, G.Equipment)!.mainHandSlot).toBe(s); expect(w.get(a, G.Equipment)!.mainHandItem).toBe(id("iron_knife"));
    w.set(a, G.PlayerIntent, { action: G.IntentAction.Equip, slot: s }); steps(w, 1);
    expect(w.get(a, G.Equipment)!.mainHandSlot).toBe(G.NO_SLOT);
  });
});
