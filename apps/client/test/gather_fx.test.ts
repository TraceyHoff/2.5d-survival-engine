import { describe, expect, it } from "vitest";
import { World } from "@engine/core";
import { defaultDefs, installGameplay, ResourceNode, spawnResourceNode } from "@engine/gameplay";
import { ART_URLS, FX_SPRITE, HPBAR, hpbarSlices, particleFrame, TOAST_SLICE, NODE_BAR_MS, NodeHits, nodeBarAlpha, particleKind, ToastStack, TOAST_MAX, TOAST_MS, toastText } from "../src/gather-fx.js";
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
  it("ADR-128 art: particle frames, hp bar slices and toast 9-slice match the nature manifest", async () => {
    const { readFileSync, existsSync } = await import("node:fs"); const { fileURLToPath } = await import("node:url");
    const man = JSON.parse(readFileSync(new URL("../../../packages/assets/pack/nature/manifest.nature.json", import.meta.url), "utf8")) as { atlases: Array<Record<string, any>>; sprites: Array<{ key: string; atlas: string; animations: { idle: { frames: number[] } } }> };
    const atlas = (k: string) => man.atlases.find((a) => a.key === k)!;
    for (const kind of ["wood", "stone", "plant"] as const) {
      const sp = man.sprites.find((s) => s.key === FX_SPRITE[kind].key)!; expect(sp.atlas).toBe("nature_adr128_fx");
      expect(sp.animations.idle.frames).toEqual([0, 1, 2, 3].map((i) => FX_SPRITE[kind].first + i));
    }
    const fx = atlas("nature_adr128_fx"); expect([fx.frameW, fx.frameH, fx.columns]).toEqual([16, 16, 4]);
    expect(particleFrame("wood", 0)).toEqual({ sx: 0, sy: 0, sw: 16, sh: 16 });
    expect(particleFrame("stone", 1 / 12 + 1e-6)).toEqual({ sx: 16, sy: 16, sw: 16, sh: 16 });
    expect(particleFrame("plant", 3 / 12 + 1e-6, 2)).toEqual({ sx: 96, sy: 64, sw: 32, sh: 32 });
    expect(particleFrame("plant", 4 / 12 + 1e-6).sx).toBe(0); // loops
    const hb = atlas("nature_adr128_hpbar"); expect([hb.frameW, hb.frameH]).toEqual([32, 16]); expect(hb.nineSlice["0"]).toMatchObject({ l: HPBAR.l, r: HPBAR.r });
    expect(HPBAR.y + HPBAR.h / 2).toBe(hb.frameH / 2);
    const sl = hpbarSlices(10, 40); expect(sl[0]).toEqual([0, 2, 10, 4]); expect(sl[1]).toEqual([2, 28, 14, 32]); expect(sl[2]).toEqual([30, 2, 46, 4]);
    expect(hpbarSlices(0, 40, 2)[2]![0]).toBe(60);
    const tb = atlas("nature_adr128_toast"); expect([tb.frameW, tb.frameH]).toEqual([48, 32]); expect(tb.nineSlice["0"]).toEqual(TOAST_SLICE);
    for (const u of [...ART_URLS.fx, ...ART_URLS.hpbar, ...ART_URLS.toast]) expect(existsSync(fileURLToPath(u))).toBe(true);
  });
});

describe("ADR-135 XP popup", () => {
  it("xpGain handles level-ups and merges +XP toasts", async () => {
    const m = await import("../src/gather-fx.js"); const G = await import("@engine/gameplay");
    expect(m.xpGain(undefined, { xp: 5, level: 1 })).toBe(0);
    expect(m.xpGain({ xp: 5, level: 1 }, { xp: 9, level: 1 })).toBe(4);
    expect(m.xpGain({ xp: G.xpToNext(1) - 2, level: 1 }, { xp: 3, level: 2 })).toBe(5);
    const s = new m.ToastStack(); s.addXp(3, 0); s.addXp(2, 100);
    expect(s.toasts.length).toBe(1); expect(m.toastText(s.toasts[0]!)).toBe("+5 XP");
    s.addXp(4, 200, "Level"); expect(m.toastText(s.toasts[1]!)).toBe("Level 4!");
  });
});
