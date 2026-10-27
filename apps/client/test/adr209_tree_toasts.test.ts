import { describe, expect, test } from "vitest";
import * as G from "@engine/gameplay";
import { toastText, treeXpToasts } from "../src/gather-fx.js";

describe("ADR-209 per-tree XP toasts", () => {
  test("name the tree; level-ups say which tree", () => {
    const base = G.TREE_KEYS.map(() => ({ xp: 0, level: 1 })); const ci = G.treeIndex("combat");
    const cur = base.map((t, i) => (i === ci ? { xp: 3, level: 2 } : t));
    const out = treeXpToasts(base, cur); const name = G.treeShortName(ci);
    expect(out.find((o) => o.label === `${name} XP`)!.count).toBe(G.treeXpToNext(1) + 3);
    expect(toastText({ name: `${name} level`, count: 2 })).toBe(`${name} level 2!`);
    expect(out.every((o) => o.label.startsWith(name))).toBe(true);
    expect(treeXpToasts(undefined, cur)).toEqual([]);
  });
});
