import { describe, expect, it } from "vitest";
import { installPermissions, PlayerId, Transform, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { debugCamera, lootLabelPoints, lootPrompt } from "../src/loot-labels.js";
import { DEFAULT_ISO, worldToScreen } from "@engine/world";

const d = G.defaultDefs(); const WOOD = d.itemId("wood");

describe("ADR-161 client loot labels", () => {
  it("prompt follows the active device", () => {
    expect(lootPrompt("keyboardMouse", "E")).toBe("[E] Open");
    expect(lootPrompt("gamepad", "X")).toBe("[X] Open");
    expect(lootPrompt("touch", "E")).toBe("Tap ✋ to open");
  });
  it("labels only bags in range with a summary; own death bag reads Your bag", () => {
    const w = new World({ seed: 1, maxEntities: 4096 }); G.installGameplay(w, {}); installPermissions(w);
    const p = G.spawnPlayer(w, { x: 0, y: 0, clientId: 3 }); w.add(p, PlayerId, { id: 3 });
    const cam = { x: 0, y: 0, viewW: 1920, viewH: 1080, dpr: 1, drawZoom: 1, cssToWorld: () => ({ x: 0, y: 0 }) };
    G.addItem(w, p, WOOD, 5); const near = G.dropItem(w, p, WOOD, 2)!;
    const far = w.create(); w.add(far, Transform, { x: 40, y: 40 }).add(far, G.LootBag, { owner: 0, despawnAtTick: 1e9 }).add(far, G.LootSummary, { item: WOOD, count: 1, stacks: 1, source: 4 });
    const mine = w.create(); w.add(mine, Transform, { x: 1, y: 1 }).add(mine, G.LootBag, { owner: 3, despawnAtTick: 1e9 }).add(mine, G.LootSummary, { item: WOOD, count: 1, stacks: 1, source: G.LootSource.Death });
    const pts = lootLabelPoints(w, p, cam);
    expect(pts.map((q) => q.key).sort()).toEqual([near, mine].sort());
    expect(pts.find((q) => q.key === mine)!.text).toBe("Your bag");
    expect(pts.find((q) => q.key === near)!.text).toMatch(/×2$/);
    for (const q of pts) { expect(q.y).toBeLessThan(q.gy); expect(q.gx).toBeGreaterThan(0); expect(q.gx).toBeLessThan(1920); }
  });
  it("ADR-164 Canvas2D fallback camera puts the label just above the fallback's bag dot", () => {
    const w = new World({ seed: 1, maxEntities: 4096 }); G.installGameplay(w, {}); installPermissions(w);
    const p = G.spawnPlayer(w, { x: 10, y: 10, clientId: 3 }); w.add(p, PlayerId, { id: 3 });
    G.addItem(w, p, WOOD, 3); const bag = G.dropItem(w, p, WOOD, 3)!; w.set(bag, Transform, { x: 12, y: 11, z: 0 });
    const W = 1280, H = 720; const cam = debugCamera(worldToScreen(10, 10), W, H, 2);
    const pts = lootLabelPoints(w, p, cam); expect(pts).toHaveLength(1);
    // the fallback draws a bag at (W/2 + s.sx - cam.sx, H/2 + s.sy - cam.sy + tileH/2 - 12)
    const s = worldToScreen(12, 11), c = worldToScreen(10, 10);
    expect(pts[0]!.gx).toBeCloseTo(W / 2 + s.sx - c.sx, 3); expect(pts[0]!.gy).toBeCloseTo(H / 2 + s.sy - c.sy + DEFAULT_ISO.tileH / 2 - 12, 3);
    expect(pts[0]!.y).toBeLessThan(pts[0]!.gy); expect(pts[0]!.text).toContain("×3");
  });
});
