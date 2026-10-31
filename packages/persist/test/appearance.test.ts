import { describe, it, expect } from "vitest";
import { Appearance, SLOT_COUNT, defaultAppearance, defineComponent, getAppearance, type CosmeticCatalogLike, type WearableDef } from "@engine/core";
import { MemoryWorldStore, ensureAppearance } from "../src/index.js";
import { makeWorld } from "./helpers.js";

const art = { sprite: 1, anim: "idle" };
const wear = (id: number, slot: WearableDef["slot"]): WearableDef => ({ id, key: `w${id}`, slot, bodies: { male: art, female: art }, layer: 0, z: 0, tintChannels: 1, hidesSlots: [], hatHair: false, unlockTags: [] });
const W = new Map([[1, wear(1, "hair")], [3, wear(3, "top")]]);
const pal = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, key: `c${i}`, color: i }));
const catalog: CosmeticCatalogLike = { wearable: (id) => W.get(id), bodySprite: () => art, skinTones: pal(18), hairColors: pal(4), clothingColors: pal(4), defaults: { hair: 1 } };
/** core Appearance as of 81cdf46, before a287243 added `version` (same component name, so it is the "old save" schema). */
const OldAppearance = defineComponent("Appearance", {
  bodyType: "u8", skinTone: "u8",
  parts: { type: "u16", length: SLOT_COUNT }, primary: { type: "u8", length: SLOT_COUNT }, secondary: { type: "u8", length: SLOT_COUNT },
}, { networked: true, persistent: true });
const fill = (n: number, v = 0) => new Array<number>(SLOT_COUNT).fill(v).map((x, i) => (i === n ? x : 0));

async function oldSave(setup: (w: import("@engine/core").World) => void, add?: (w: import("@engine/core").World, e: import("@engine/core").Entity) => void) {
  const store = new MemoryWorldStore();
  const a = makeWorld(store, { setup }); const p = a.world.create(); add?.(a.world, p);
  await a.persist.savePlayer("tok", p, "Ásta");
  const b = makeWorld(store, { setup: (w) => w.register(Appearance), appearance: { catalog } }); const e = b.world.create();
  return { b, e, r: b.persist.restorePlayer("tok", e)! };
}

describe("appearance persistence", () => {
  it("player saved before Appearance existed gets defaultAppearance(cat) on load", async () => {
    const { b, e, r } = await oldSave(() => undefined);
    expect(r.appearance).toBe("defaulted");
    expect(getAppearance(b.world, e)).toEqual({ ...defaultAppearance(catalog), version: 0 });
    expect(getAppearance(b.world, e)!.parts[0]).toBe(1);
  });
  it("Appearance saved without `version` (81cdf46) loads via zero-fill: version 0, all other fields intact", async () => {
    const parts = [1, 0, 0, 3, 0, 0, 0, 0]; const primary = [2, 0, 0, 3, 0, 0, 0, 0]; const secondary = [0, 0, 0, 1, 0, 0, 0, 0];
    const { b, e, r } = await oldSave((w) => w.register(OldAppearance), (w, p) => w.add(p, OldAppearance, { bodyType: 1, skinTone: 3, parts, primary, secondary } as never));
    expect(r.migrated).toBeTruthy(); expect(r.appearance).toBe("ok");
    // ADR-245: such a save predates skinScheme too -> legacy tone 3 (honey) remapped to 6 via setAppearance (version 0 -> 1)
    expect(getAppearance(b.world, e)).toEqual({ bodyType: 1, skinTone: 6, version: 1, parts: [...parts, 0], primary: [...primary, 0], secondary: [...secondary, 0] }); // ADR-137: 8-wide save padded with the hands slot
  });
  it("loaded Appearance with retired parts / bad colors is clamp-repaired through setAppearance (version bumps)", async () => {
    const parts = [1, 0, 0, 99, 0, 0, 0, 0]; // 99 retired from the catalog
    const { b, e, r } = await oldSave((w) => w.register(Appearance), (w, p) => w.add(p, Appearance, { bodyType: 0, skinTone: 30, version: 4, skinScheme: 2, parts, primary: fill(0), secondary: fill(0) } as never));
    expect(r.appearance).toBe("repaired");
    expect(getAppearance(b.world, e)).toMatchObject({ skinTone: 0, version: 5, parts: [1, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(ensureAppearance(b.world, e, catalog)).toBe("ok"); expect(getAppearance(b.world, e)!.version).toBe(5);
  });
});
