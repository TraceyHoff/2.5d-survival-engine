import { describe, expect, it } from "vitest";
import { Transform, setTimeOfDay, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const d = G.defaultDefs();
const res = (k: string) => [...d.resources.values()].find((r) => r.key === k)!;
const LOGS = new Set(["wood", "hardwood"].map((k) => d.itemId(k)));
const STICKS = d.itemId("sticks");
const gather = (w: World, p: Entity, node: Entity) => { G.setIntent(w, p, { action: G.IntentAction.Gather, target: node }); w.step(1 / 20); steps(w, 30); };
const expected = (k: string, pred: (item: number) => boolean) => res(k).yields.filter((y) => pred(y.item)).reduce((a, y) => a + y.chance * (y.min + y.max) / 2, 0);

describe("ADR-217 tool icon over tool nodes", () => {
  it("a tree shows the axe (not the hand) even with bare hands; bushes / branches / crops keep the hand", () => {
    const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0 });
    const tree = G.spawnResourceNode(w, "tree", 1, 0);
    expect(G.toolHint(w, p)).toMatchObject({ node: tree, icon: "axe", have: true, equipped: false, bare: true });
    expect(G.toolReqSpriteKey(G.toolHint(w, p)!.icon)).toBe("tool_req_axe");
    for (const k of ["berry_bush", "fallen_branches", "fiber_grass", "loose_rocks"]) {
      const w2 = makeWorld(); const p2 = G.spawnPlayer(w2, { x: 0, y: 0 }); G.spawnResourceNode(w2, k, 1, 0);
      expect(G.toolHint(w2, p2)?.icon, k).toBe("hand");
    }
  });
  it("rocks and ore show the pickaxe", () => {
    for (const k of ["boulder", "iron_vein"]) {
      const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0 }); G.spawnResourceNode(w, k, 1, 0);
      expect(G.toolHint(w, p)?.icon, k).toBe("pickaxe");
    }
  });
  it("every axe node shows the axe and every requiredTool-none node the hand", () => {
    for (const r of d.resources.values()) {
      const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0 }); G.spawnResourceNode(w, r.key, 1, 0);
      const h = G.toolHint(w, p); if (!h) continue;
      if (r.requiredTool === G.ToolKind.None) expect(h.icon, r.key).toBe("hand"); else expect(h.icon, r.key).not.toBe("hand");
    }
  });
});

describe("ADR-217 yields: trees give logs, ground sticks give sticks", () => {
  it("every axe tree yields more logs than sticks (expected value)", () => {
    const trees = [...d.resources.values()].filter((r) => r.requiredTool === G.ToolKind.Axe && /tree/.test(r.key));
    expect(trees.length).toBeGreaterThanOrEqual(3);
    for (const t of trees) expect(expected(t.key, (i) => LOGS.has(i)), t.key).toBeGreaterThan(expected(t.key, (i) => i === STICKS));
  });
  it("ground sticks (fallen branches, dry shrub, rotten stump) give far more sticks than logs", () => {
    for (const k of ["fallen_branches", "dry_shrub", "rotten_stump"]) {
      expect(expected(k, (i) => LOGS.has(i)), k).toBeLessThanOrEqual(0.35); // branches: an odd log (35%), shrub / stump none
      expect(expected(k, (i) => i === STICKS), k).toBeGreaterThan(1);
      expect(expected(k, (i) => i === STICKS), k).toBeGreaterThan(4 * expected(k, (i) => LOGS.has(i)));
      expect(res(k).yields[0]!.item, k).toBe(STICKS); // first yield = what bare hands always get
    }
  });
  it("gathering: a tree with a stone axe drops logs > sticks; branches drop mostly sticks", () => {
    const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0 });
    const tree = G.spawnResourceNode(w, "tree", 1, 0); G.addItem(w, p, d.itemId("stone_axe"), 1); w.set(p, G.Equipment, { mainHandSlot: 0 });
    for (let i = 0; i < 6; i++) { gather(w, p, tree); }
    const wood = G.countItem(w, p, d.itemId("wood")), sticks = G.countItem(w, p, STICKS);
    expect(wood).toBeGreaterThan(sticks);
    const w2 = makeWorld(); const p2 = G.spawnPlayer(w2, { x: 0, y: 0 }); const b = G.spawnResourceNode(w2, "fallen_branches", 1, 0);
    for (let i = 0; i < 3; i++) { gather(w2, p2, b); }
    const bw = G.countItem(w2, p2, d.itemId("wood")), bs = G.countItem(w2, p2, STICKS);
    expect(bs).toBeGreaterThanOrEqual(6); expect(bw).toBeLessThanOrEqual(3); expect(bs).toBeGreaterThan(bw);
  });
});

describe("ADR-217 held lights repel zombies", () => {
  const holding = (w: World, item: string, offhand = false): Entity => {
    const p = G.spawnPlayer(w, { x: 20.5, y: 20.5 }); w.set(p, G.Health, { hp: 1e6, max: 1e6 });
    G.addItem(w, p, d.itemId(item), 1);
    if (offhand) { w.set(p, G.Equipment, { mainHandSlot: 9 }); expect(G.wearSlot(w, p, 0)).toBe(true); } else w.set(p, G.Equipment, { mainHandSlot: 0 });
    steps(w, 1); G.invalidateLightGrid(w); return p;
  };
  it("torch / lantern / candle data: radii 5.5 / 5 / 3, torch craftable by hand from sticks + fiber, lantern at a workbench", () => {
    const hl = (k: string) => d.items.get(d.itemId(k))!.heldLight;
    expect(hl("torch")).toBe(5.5); expect(hl("lantern")).toBe(5); expect(hl("tallow_candle")).toBe(3); expect(hl("wood")).toBe(0);
    const r = [...d.recipes.values()].find((x) => x.key === "torch")!;
    expect(r.station).toBe(G.StationKind.None);
    expect(r.ingredients.map((i) => d.items.get(i.item)!.key).sort()).toEqual(["fiber", "sticks"]);
    expect([...d.recipes.values()].find((x) => x.key === "lantern")!.station).toBe(G.StationKind.Workbench);
  });
  it("a torch in the main hand is a 5.5-tile light centred on the bearer that follows them", () => {
    const w = makeWorld(); const p = holding(w, "torch");
    expect(G.heldLightRadius(w, p)).toBe(5.5);
    const L = G.activeLights(w).find((l) => l.e === p)!; expect(L).toMatchObject({ r: 5.5, vehicle: false, x: 20.5, y: 20.5 });
    w.set(p, Transform, { x: 22.5, y: 20.5 }); // between rebuilds the light follows the bearer live
    expect(G.lightAt(w, 27.5, 20.5)?.e).toBe(p); expect(G.lightAt(w, 27.5, 20.5)!.x).toBe(22.5); expect(G.lightAt(w, 16, 20.5)).toBeUndefined();
    w.set(p, Transform, { x: 40.5, y: 20.5 }); G.invalidateLightGrid(w);
    expect(G.lightAt(w, 44, 20.5)?.e).toBe(p); expect(G.lightAt(w, 24, 20.5)).toBeUndefined();
  });
  it("off-hand lantern / candle count too; dead bearers and unlit pockets don't", () => {
    const w = makeWorld(); const p = holding(w, "lantern", true); expect(G.heldLightRadius(w, p)).toBe(5);
    const w2 = makeWorld(); const p2 = holding(w2, "tallow_candle", true); expect(G.activeLights(w2).find((l) => l.e === p2)?.r).toBe(3);
    const w3 = makeWorld(); const p3 = G.spawnPlayer(w3, { x: 1, y: 1 }); G.addItem(w3, p3, d.itemId("torch"), 1); G.invalidateLightGrid(w3);
    expect(G.activeLights(w3)).toHaveLength(0); // carried, not held
    w.add(p, G.Dead, {}); G.invalidateLightGrid(w); expect(G.activeLights(w).some((l) => l.e === p)).toBe(false);
  });
  it("a walker hunting a torch-holding player at night keeps out of the torch radius", () => {
    const w = makeWorld(); setTimeOfDay(w, 0, 0); holding(w, "torch");
    const z = G.spawnZombie(w, "zombie_walker", 30.5, 20.5);
    let minD = Infinity; for (let i = 0; i < 20 * 15; i++) { steps(w, 1); const t = w.get(z, Transform)!; minD = Math.min(minD, Math.hypot(t.x - 20.5, t.y - 20.5)); }
    expect(minD).toBeGreaterThan(5);
  });
  it("without the torch the same walker reaches the player (control)", () => {
    const w = makeWorld(); setTimeOfDay(w, 0, 0); const p = G.spawnPlayer(w, { x: 20.5, y: 20.5 }); w.set(p, G.Health, { hp: 1e6, max: 1e6 });
    const z = G.spawnZombie(w, "zombie_walker", 30.5, 20.5);
    let minD = Infinity; for (let i = 0; i < 20 * 15; i++) { steps(w, 1); const t = w.get(z, Transform)!; minD = Math.min(minD, Math.hypot(t.x - 20.5, t.y - 20.5)); }
    expect(minD).toBeLessThan(2);
  });
  it("horde members obey held lights like placed ones", () => {
    const w = makeWorld(); setTimeOfDay(w, 0, 0); holding(w, "torch");
    const sn = G.snapPlacement(w, { piece: d.pieceId("foundation")!, x: 8, y: 20, level: 0, rot: 0, tier: 0, variant: 0 });
    if (typeof sn !== "object") throw new Error("snap"); const base = G.placePiece(w, 0, sn, { pay: false }); const bt = w.get(base, Transform)!;
    const z = G.spawnZombie(w, "zombie_walker", 30.5, 20.5); w.add(z, G.HordeMember, { horde: 1, target: base, tx: bt.x, ty: bt.y });
    let minD = Infinity; for (let i = 0; i < 20 * 15; i++) { steps(w, 1); if (!w.isAlive(z)) break; const t = w.get(z, Transform)!; minD = Math.min(minD, Math.hypot(t.x - 20.5, t.y - 20.5)); }
    expect(w.has(z, G.HordeMember)).toBe(true); expect(minD).toBeGreaterThan(5);
  });
});
