import { describe, it, expect } from "vitest";
import { addItem, defaultDefs, Equipment, ResourceNode, spawnPlayer, spawnResourceNode, TOOL_REQ_ICONS, toolHint, toolReqSpriteKey } from "../src/index.js";
import { makeWorld } from "./helpers.js";

const d = defaultDefs();
describe("tool requirement hint (ADR-126)", () => {
  it("tool-free nodes show a hand; nothing beyond 1.5 tiles", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0 });
    expect(toolHint(w, p)).toBeUndefined();
    spawnResourceNode(w, "berry_bush", 1.6, 0); expect(toolHint(w, p)).toBeUndefined();
    const b = spawnResourceNode(w, "fallen_branches", 1, 0);
    expect(toolHint(w, p)).toMatchObject({ node: b, icon: "hand", have: true, bare: true });
  });
  it("tier-1 tool nodes show their tool even without it (ADR-217: axe over a tree, bare hands only a 25% fallback), the tool once owned, best tier first", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0 });
    spawnResourceNode(w, "tree", 1, 0);
    expect(toolHint(w, p)).toMatchObject({ icon: "axe", have: true, equipped: false, bare: true });
    expect(toolHint(w, p)!.label).toContain("25%");
    addItem(w, p, d.itemId("stone_axe"), 1);
    expect(toolHint(w, p)).toMatchObject({ icon: "axe", have: true, equipped: false, bare: false });
    w.set(p, Equipment, { mainHandSlot: 0 }); expect(toolHint(w, p)).toMatchObject({ icon: "axe", equipped: true });
  });
  it("higher-tier nodes lock until a good enough tool is carried", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0 });
    spawnResourceNode(w, "oak_tree", 0, 1); // axe tier 2, no bare hands
    expect(toolHint(w, p)).toMatchObject({ icon: "axe", have: false, minTier: 2 });
    addItem(w, p, d.itemId("stone_axe"), 1); expect(toolHint(w, p)!.have).toBe(false);
    addItem(w, p, d.itemId("bronze_axe"), 1); expect(toolHint(w, p)).toMatchObject({ icon: "axe", have: true });
  });
  it("picks the nearest live node and skips depleted ones", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0 });
    const near = spawnResourceNode(w, "boulder", 0.5, 0); spawnResourceNode(w, "animal_carcass", 1.2, 0);
    expect(toolHint(w, p)!.node).toBe(near);
    w.set(near, ResourceNode, { amount: 0 }); expect(toolHint(w, p)).toMatchObject({ icon: "knife", have: false });
  });
  it("sprite keys are tool_req_<tool> and cover every resources.json tool", () => {
    expect(TOOL_REQ_ICONS.map(toolReqSpriteKey)).toEqual(["hand", "axe", "pickaxe", "shovel", "hoe", "knife", "sickle"].map((t) => `tool_req_${t}`));
    for (const r of d.resources.values()) expect(r.requiredTool).toBeLessThanOrEqual(4); // none/axe/pickaxe/shovel/knife all have icons
  });
});
