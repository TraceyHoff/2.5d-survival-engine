import { describe, expect, it } from "vitest";
import { World } from "@engine/core";
import { defaultDefs, installGameplay, ResourceNode, spawnResourceNode } from "@engine/gameplay";
import { NODE_BAR_MS, NodeHits, nodeBarAlpha, particleKind, ToastStack, TOAST_MAX, TOAST_MS, toastText } from "../src/gather-fx.js";
import { nodeWiggle } from "../src/view.js";

const label = (i: number) => ({ name: `item${i}`, icon: `i${i}` });
describe("ADR-128 gather feedback", () => {
  it("node wiggle is a short damped shake", () => {
    expect(nodeWiggle(-1)).toBeUndefined(); expect(nodeWiggle(400)).toBeUndefined();
    expect(Math.abs(nodeWiggle(45)!)).toBeGreaterThan(0.03); expect(Math.abs(nodeWiggle(350)!)).toBeLessThan(0.01);
  });
  it("health bar alpha shows then fades out by ~3s; particles by tool", () => {
    expect(nodeBarAlpha(0)).toBe(1); expect(nodeBarAlpha(NODE_BAR_MS - 100)).toBeGreaterThan(0); expect(nodeBarAlpha(NODE_BAR_MS)).toBe(0);
    expect([particleKind(1), particleKind(2), particleKind(0)]).toEqual(["wood", "stone", "plant"]);
  });
  it("NodeHits reports a bar when the replicated amount drops, expires after NODE_BAR_MS", () => {
    const w = new World({ seed: 1, maxEntities: 1024 }); installGameplay(w, { defs: defaultDefs() } as never);
    const n = spawnResourceNode(w, "tree", 1, 0); const h = new NodeHits();
    expect(h.scan(w, 0)).toEqual([]);
    const cap = w.get(n, ResourceNode)!.amount; w.set(n, ResourceNode, { amount: cap - 1 });
    const hit = h.scan(w, 100); expect(hit).toHaveLength(1); expect(hit[0]!.frac).toBeLessThan(1); expect(hit[0]!.kind).toBe("wood");
    h.scan(w, 100 + NODE_BAR_MS); expect(h.bars.size).toBe(0);
  });
  it("ToastStack primes, merges per item, caps and expires", () => {
    const s = new ToastStack(); s.update(new Map([[1, 5]]), 0, label); expect(s.toasts).toEqual([]);
    s.update(new Map([[1, 8]]), 10, label); s.update(new Map([[1, 9]]), 20, label);
    expect(s.toasts).toHaveLength(1); expect(toastText(s.toasts[0]!)).toBe("+4 item1");
    s.update(new Map([[1, 9], [2, 1], [3, 1], [4, 1], [5, 1]]), 30, label); expect(s.toasts).toHaveLength(TOAST_MAX);
    s.update(new Map([[1, 9], [2, 1], [3, 1], [4, 1], [5, 1]]), 30 + TOAST_MS, label); expect(s.toasts).toHaveLength(0);
    s.update(new Map([[1, 8]]), 40 + TOAST_MS, label); expect(s.toasts).toHaveLength(0); // losses never toast
  });
});
