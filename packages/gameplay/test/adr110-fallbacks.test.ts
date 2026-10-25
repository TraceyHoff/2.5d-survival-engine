import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Transform } from "@engine/core";
import { addItem, animalDefs, CLUTTER_KEYS, cropSpriteKey, FARMING, FarmFailed, FARM_FAIL_TEXT, farmPrompt, gameplayDefs, IntentAction, resolveIcon, iconForItem, resolveSprite, mulTint, setIntent, spawnPlayer, SPRITE_FALLBACKS, till, Equipment, farmUseSystem } from "../src/index.js";
import { makeWorld } from "./helpers.js";

const pack = JSON.parse(readFileSync(new URL("../../assets/pack/manifest.json", import.meta.url), "utf8")) as { sprites: Record<string, unknown> | { key: string }[] };
const nature = JSON.parse(readFileSync(new URL("../../assets/pack/nature/manifest.nature.json", import.meta.url), "utf8")) as { sprites: { key: string }[] }; // ADR-145/146: real animal/pet art lives in the nature sub-pack
const PACK = new Set([...(Array.isArray(pack.sprites) ? pack.sprites.map((s) => s.key) : Object.keys(pack.sprites)), ...nature.sprites.map((s) => s.key)]);
const has = (k: string): boolean => PACK.has(k);

describe("ADR-110 sprite / icon fallbacks", () => {
  it("every new sprite key resolves to an existing pack sprite (clutter may be skipped)", () => {
    const w = makeWorld(); const d = gameplayDefs(w); const missing: string[] = [];
    const keys = new Set<string>(["farm_soil"]);
    for (const r of d.resources.values()) keys.add(r.spriteKey);
    for (const a of animalDefs()) keys.add(a.spriteKey);
    FARMING.plantables.forEach((p, i) => { for (let s = 0; s < p.stages; s++) keys.add(cropSpriteKey(i + 1, s)); });
    for (const k of keys) { const r = resolveSprite(k, has); if (!r || !has(r.key)) missing.push(k); }
    expect(missing).toEqual([]);
    for (const k of CLUTTER_KEYS) { const r = resolveSprite(k, has); if (r) expect(has(r.key)).toBe(true); }
    expect(SPRITE_FALLBACKS.sprites["clutter_leaves"]).toBeUndefined();
  });
  it("real art wins; fallbacks tint / scale; stages scale up", () => {
    expect(resolveSprite("oak_tree", has)).toEqual({ key: "oak_tree", tint: 0, scale: 1 });
    const bear = resolveSprite("animal_bear", (k) => k !== "animal_bear" && has(k))!; expect(bear.key).toBe("animal_boar"); expect(bear.scale).toBeGreaterThan(1); expect(bear.tint).not.toBe(0);
    expect(resolveSprite("animal_bear", (k) => k === "animal_bear" || has(k))).toEqual({ key: "animal_bear", tint: 0, scale: 1 });
    const kind = FARMING.plantables.findIndex((p) => p.type === "crop") + 1;
    const noArt = (k: string): boolean => k !== cropSpriteKey(kind, 0) && k !== cropSpriteKey(kind, 3) && has(k); // fallback path even where nature now has real stage art
    const s0 = resolveSprite(cropSpriteKey(kind, 0), noArt)!, s3 = resolveSprite(cropSpriteKey(kind, 3), noArt)!;
    expect(s0.scale).toBeLessThan(s3.scale);
    expect(mulTint(0xff0000ff, 0x80ffffff) >>> 0).toBe(0x800000ff);
    expect(resolveSprite("no_such_thing", has)).toBeUndefined();
  });
  it("icons: own icon, mapped fallback, then per-category generic", () => {
    const icons = new Set(["fiber", "berries", "stone_axe", "sword", ...Object.values(SPRITE_FALLBACKS.categoryIcons)]); const hi = (k: string) => icons.has(k);
    expect(resolveIcon("fiber", "resource", hi)).toBe("fiber");
    expect(resolveIcon("mystery_tool", "tool", hi)).toBe("stone_axe");
    expect(resolveIcon("mystery", "nope", hi)).toBe("fiber");
    const w = makeWorld(); const d = gameplayDefs(w);
    for (const it of d.items.values()) expect(icons.has(iconForItem(it, hi))).toBe(true);
  });
});

describe("ADR-110 farming toasts and context prompt", () => {
  const setup = (item: string, n = 1) => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0.5, y: 0.5 }); const d = gameplayDefs(w);
    w.set(p, Transform, { facing: 0 }); addItem(w, p, d.itemId(item), n);
    w.set(p, Equipment, { mainHandSlot: 0, mainHandItem: d.itemId(item) }); return { w, p, d };
  };
  it("prompt: hoe -> Till, can -> Water (nothing to tend), seed without soil/hoe -> NeedsHoe", () => {
    let { w, p } = setup("hoe"); expect(farmPrompt(w, p)).toMatchObject({ action: "Till", fail: 0, slot: 0 });
    ({ w, p } = setup("watering_can")); expect(farmPrompt(w, p)).toMatchObject({ action: "Water", fail: 5 });
    const seed = FARMING.plantables.find((x) => x.type === "crop")!.seed;
    ({ w, p } = setup(seed)); const pr = farmPrompt(w, p)!; expect(pr.action).toBe("Plant"); expect(pr.fail).toBe(6);
    expect(FARM_FAIL_TEXT[pr.fail]).toMatch(/hoe/);
    addItem(w, p, gameplayDefs(w).itemId("hoe"), 1); expect(farmPrompt(w, p)!.fail).toBe(4);
    till(w, p, 1.5, 0.5); expect(farmPrompt(w, p)!.fail).toBe(0);
  });
  it("failed Use emits FarmFailed with the reason (toast source)", () => {
    const seed = FARMING.plantables.find((x) => x.type === "crop")!.seed;
    const { w, p } = setup(seed); const got: number[] = [];
    w.events.on(FarmFailed, (e) => { got.push((e as { reason: number }).reason); });
    setIntent(w, p, { action: IntentAction.Use, slot: 0 }); farmUseSystem(w); (w.events as { flush?: () => void }).flush?.();
    expect(got).toEqual([6]);
    for (const r of [1, 2, 3, 4, 6]) expect(FARM_FAIL_TEXT[r]!.length).toBeLessThan(40);
  });
});
