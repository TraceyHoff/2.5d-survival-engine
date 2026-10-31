import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Appearance, LEGACY_SKIN_TONE_MAP, SKIN_TONE_SCHEME, SLOT_COUNT, Transform, defineComponent, getAppearance, mapLegacySkinTone, migrateSkinTone, setAppearance, type ComponentDef, type CosmeticCatalogLike, type Schema, type World } from "@engine/core";
import { MemoryWorldStore } from "../src/index.js";
import { makeWorld, step } from "./helpers.js";

/** ADR-245: 12 legacy skin tones -> 18 realistic tones (skin_tones.json v2, goblin removed); saves remap on load. */
const json = JSON.parse(readFileSync(new URL("../../assets/pack/customization/skin_tones.json", import.meta.url), "utf8")) as {
  version: number; count: number; legacyMap: number[]; tones: { key: string }[]; legacy: { old: number; oldKey: string; new: number; newKey: string }[] };
const art = { sprite: 1, anim: "idle" };
const pal = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, key: `c${i}`, color: i }));
const catalog: CosmeticCatalogLike = { wearable: () => undefined, bodySprite: () => art, skinTones: pal(18), hairColors: pal(4), clothingColors: pal(4) };
/** Appearance as saved before skinScheme existed (current 9-slot layout otherwise). */
const s = { ...(Appearance.schema as Record<string, unknown>) }; delete s["skinScheme"];
const OldAppearance = defineComponent("Appearance", s as Schema, { networked: true, persistent: true }) as ComponentDef;
const zeros = (): number[] => new Array<number>(SLOT_COUNT).fill(0);
const legacyLook = (skinTone: number, version = 4) => ({ bodyType: 1, skinTone, version, parts: zeros(), primary: zeros().map((_, i) => i % 4), secondary: zeros() });

describe("ADR-245 skin tone remap", () => {
  it("core map == skin_tones.json legacyMap; scheme == file version; keys line up (ebony stays ebony, goblin -> olive)", () => {
    expect([...LEGACY_SKIN_TONE_MAP]).toEqual(json.legacyMap); expect(SKIN_TONE_SCHEME).toBe(json.version);
    expect(json.tones).toHaveLength(18); expect(json.count).toBe(18);
    for (const l of json.legacy) { expect(mapLegacySkinTone(l.old)).toBe(l.new); expect(json.tones[l.new]!.key).toBe(l.newKey); }
    expect(mapLegacySkinTone(9)).toBe(16); expect(json.tones[16]!.key).toBe("ebony");
    expect(mapLegacySkinTone(11)).toBe(8); expect(json.tones[8]!.key).toBe("olive");
    expect(mapLegacySkinTone(200)).toBe(0); // out of range (never valid) -> 0, as the clamp would
  });
  it("migrateSkinTone: legacy row remapped once via setAppearance (version bump); idempotent; new rows untouched", () => {
    const w = makeWorld(new MemoryWorldStore(), { setup: (x) => x.register(Appearance) }).world;
    const e = w.create(); w.add(e, Appearance, { ...legacyLook(9), skinScheme: 0 } as never);
    expect(migrateSkinTone(w, e)).toBe(true);
    expect(getAppearance(w, e)).toMatchObject({ skinTone: 16, version: 5, primary: zeros().map((_, i) => i % 4) }); expect(w.get(e, Appearance)!.skinScheme).toBe(SKIN_TONE_SCHEME);
    expect(migrateSkinTone(w, e)).toBe(false); expect(migrateSkinTone(w, e)).toBe(false);
    expect(getAppearance(w, e)).toMatchObject({ skinTone: 16, version: 5 });
    const n = w.create(); setAppearance(w, n, { ...legacyLook(9), parts: zeros() }); // a fresh look: index 9 = tan in the new palette
    expect(w.get(n, Appearance)!.skinScheme).toBe(SKIN_TONE_SCHEME); expect(migrateSkinTone(w, n)).toBe(false); expect(w.get(n, Appearance)!.skinTone).toBe(9);
    const none = w.create(); expect(migrateSkinTone(w, none)).toBe(false);
  });

  async function playerRoundTrip(tone: number) {
    const store = new MemoryWorldStore();
    const a = makeWorld(store, { setup: (x) => x.register(OldAppearance) }); const p = a.world.create(); a.world.add(p, OldAppearance, legacyLook(tone) as never);
    await a.persist.savePlayer("tok", p, "Ásta");
    const b = makeWorld(store, { setup: (x) => x.register(Appearance), appearance: { catalog } }); const e = b.world.create();
    const r = b.persist.restorePlayer("tok", e)!;
    return { store, b, e, r };
  }
  it("restored player (also how singleplayer AI humans load: virtual players claim their account): 9 -> 16, 11 -> 8, version bumped", async () => {
    for (const [old, now] of [[9, 16], [11, 8], [0, 0], [4, 9], [10, 8]] as const) {
      const { b, e, r } = await playerRoundTrip(old);
      expect(r.migrated).toContain("Appearance"); expect(r.appearance).toBe("ok");
      expect(getAppearance(b.world, e)).toMatchObject({ bodyType: 1, skinTone: now, version: 5 }); expect(b.persist.stats.skinTonesMigrated).toBe(1);
    }
  });
  it("idempotent across save/load cycles: a migrated player re-saved and restored keeps the new tone", async () => {
    const { store, b, e } = await playerRoundTrip(9);
    await b.persist.savePlayer("tok", e, "Ásta");
    for (let i = 0; i < 2; i++) {
      const c = makeWorld(store, { setup: (x) => x.register(Appearance), appearance: { catalog } }); const q = c.world.create();
      const r = c.persist.restorePlayer("tok", q)!; expect(r.migrated ?? []).not.toContain("Appearance");
      expect(getAppearance(c.world, q)).toMatchObject({ skinTone: 16, version: 5 }); expect(c.persist.stats.skinTonesMigrated).toBe(0);
    }
  });
  const reg = (def: ComponentDef) => (w: World) => { w.register(def); };
  it("chunk-resident Appearance entities (legacy chunk rows) are remapped on chunk load, marked dirty, and stay remapped", async () => {
    const store = new MemoryWorldStore();
    const a = makeWorld(store, { setup: reg(OldAppearance) }); a.chunks.setSource({ id: 1, x: 16, y: 16 }); step(a.world);
    for (const [i, t] of [9, 11, 3].entries()) { const e = a.world.create(); a.world.add(e, Transform, { x: 4 + i, y: 5 }).add(e, OldAppearance, legacyLook(t) as never); }
    step(a.world); await a.persist.saveAll();
    const b = makeWorld(store, { setup: reg(Appearance), chunksFirst: true }); b.chunks.setSource({ id: 1, x: 16, y: 16 }); step(b.world);
    expect(b.persist.stats.decodeErrors).toBe(0); expect(b.persist.stats.skinTonesMigrated).toBe(3);
    const tones = (w: World): number[] => [...w.query([Appearance])].sort((x, y) => w.get(x, Transform)!.x - w.get(y, Transform)!.x).map((e) => w.get(e, Appearance)!.skinTone);
    expect(tones(b.world)).toEqual([16, 8, 6]);
    expect(b.persist.isDirty("0,0")).toBe(true); // marked in track(), after membership saw the loaded entities
    expect((await b.persist.saveAll()).chunks).toBe(1);
    const c = makeWorld(store, { setup: reg(Appearance), chunksFirst: true }); c.chunks.setSource({ id: 1, x: 16, y: 16 }); step(c.world);
    expect(tones(c.world)).toEqual([16, 8, 6]); expect(c.persist.stats.skinTonesMigrated).toBe(0);
  });
});
