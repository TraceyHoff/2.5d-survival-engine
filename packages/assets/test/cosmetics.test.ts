import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Appearance, World, defaultAppearance, resolveLayers, slotIndex, validateAppearance, schemaHash } from "@engine/core";
import { loadManifest, ManifestError } from "../src/index.js";

const dir = fileURLToPath(new URL("../sample/", import.meta.url));
const sample = JSON.parse(readFileSync(dir + "manifest.json", "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type M = any;
function base(edit?: (m: M) => void): M {
  const m: M = structuredClone(sample);
  const ch = m.atlases.find((a: M) => a.key === m.sprites.find((s: M) => s.key === "player").atlas); ch.masks = { ...(ch.masks ?? {}), tintmask: "characters_tint.png" };
  const player = m.sprites.find((s: M) => s.key === "player");
  for (const k of ["body_male", "body_female", "hair_short_m", "hair_short_f", "hair_short_m_hat", "hat_cap", "hat_helm", "top_shirt", "shoes_boots"]) m.sprites.push({ ...structuredClone(player), key: k });
  m.bodyTypes = { male: { sprite: "body_male" }, female: { sprite: "body_female" } };
  m.skinTones = [{ key: "light", color: "#f1c27d" }, { key: "dark", color: "#8d5524" }];
  m.hairColors = [{ key: "black", color: "#111111" }, { key: "blond", color: "#e6c35c" }];
  m.clothingColors = [{ key: "red", color: "#aa2222" }, { key: "blue", color: "#2244aa" }, { key: "white", color: "#ffffff" }];
  m.wearables = [
    { key: "hair_short", slot: "hair", layer: 40, layerByDir: [40, 40, 40, 5], tintChannels: 1, bodies: { male: { sprite: "hair_short_m", hatHair: { sprite: "hair_short_m_hat" } }, female: { sprite: "hair_short_f" } } },
    { key: "hat_cap", slot: "hat", layer: 50, tintChannels: 2, hatHair: true, bodies: { male: { sprite: "hat_cap" }, female: { sprite: "hat_cap" } } },
    { key: "hat_helm", slot: "hat", layer: 50, hidesSlots: ["hair"], unlockTags: ["raid_reward"], bodies: { male: { sprite: "hat_helm" } } },
    { key: "top_shirt", slot: "top", layer: 20, tintChannels: 2, bodies: { male: { sprite: "top_shirt" }, female: { sprite: "top_shirt" } } },
    { key: "shoes_boots", slot: "shoes", layer: 15, z: 1, bodies: { male: { sprite: "shoes_boots" }, female: { sprite: "shoes_boots" } } },
  ];
  edit?.(m); return m;
}
const issues = (m: M): string[] => { try { loadManifest(m); return []; } catch (e) { if (e instanceof ManifestError) return e.issues; throw e; } };

describe("cosmetics manifest", () => {
  it("loads wearables, palettes and stable ids; lock keeps ids", () => {
    const a = loadManifest(base()); const cat = a.registry.cosmetics!;
    expect(cat.size).toBe(5); expect(cat.skinTones[1]).toEqual({ index: 1, key: "dark", color: 0x8d5524 });
    expect(cat.bySlot("hat", "female").map((w) => w.key)).toEqual(["hat_cap"]);
    const lock = a.lock.wearables!; expect(Object.keys(lock).length).toBe(5);
    const b = loadManifest(base((m) => m.wearables.unshift({ ...m.wearables[3], key: "aaa_top" })), { lock: a.lock });
    for (const [k, id] of Object.entries(lock)) expect(b.registry.cosmetics!.byKey(k)!.id).toBe(id);
    expect(b.registry.hash).not.toBe(a.registry.hash);
    expect(loadManifest(sample).registry.cosmetics).toBeUndefined();
  });
  it("validation: refs, body frames, slot conflicts, palettes", () => {
    const list = issues(base((m) => {
      m.wearables.push({ key: "bad1", slot: "cape", layer: 1, bodies: { male: { sprite: "top_shirt" } } });
      m.wearables.push({ key: "bad2", slot: "top", layer: 1, bodies: { male: { sprite: "nope" }, female: { sprite: "top_shirt", anim: "dance" }, robot: { sprite: "top_shirt" } } });
      m.wearables.push({ key: "bad3", slot: "hair", layer: 1, hidesSlots: ["hair", "hat"], hatHair: true, bodies: {} });
      m.wearables.push({ key: "bad3", slot: "bottom", layer: 1.5, tintChannels: 3, bodies: { male: { sprite: "top_shirt" } } });
      m.hairColors.push({ key: "x", color: "red" });
    }));
    for (const s of ['unknown slot "cape"', 'unknown sprite "nope"', 'no anim "dance"', 'unknown body type "robot"', "cannot hide its own slot", "hatHair is only valid on hats",
      "at least one body type", "duplicate key", "layer must be an integer", "tintChannels must be 0|1|2", "color must be #rrggbb", "slot conflict: hair and hat"]) expect(list.join("\n")).toContain(s);
    expect(issues(base((m) => { m.atlases.forEach((a: M) => { delete a.masks?.tintmask; }); }))).toContain("bodyTypes.male: tintChannels 1 but atlas characters has no tintmask".replace("characters", base().sprites.find((s: M) => s.key === "player").atlas));
    expect(issues(base((m) => { delete m.bodyTypes.female; })).join()).toContain("no bodyTypes.female base art");
  });
});

describe("Appearance helpers", () => {
  const cat = loadManifest(base()).registry.cosmetics!;
  const id = (k: string) => cat.byKey(k)!.id;
  const look = (edit: (a: ReturnType<typeof defaultAppearance>) => void) => { const a = defaultAppearance(cat); edit(a); return a; };
  it("Appearance is networked+persistent and compact", () => {
    expect(Appearance.networked && Appearance.persistent).toBe(true);
    const w = new World(); const before = w.getSchemaHash(); w.register(Appearance); expect(w.getSchemaHash()).not.toBe(before); expect(typeof schemaHash(Appearance.schema)).toBe("number");
  });
  it("validateAppearance clamps or rejects", () => {
    const a = look((a) => { a.bodyType = 1; a.skinTone = 9; a.parts[slotIndex("hat")] = id("hat_helm"); a.parts[slotIndex("top")] = id("hair_short"); a.parts[slotIndex("shoes")] = 999; a.primary[slotIndex("top")] = 77; });
    const r = validateAppearance(cat, a);
    expect(r.issues.length).toBe(5); expect(r.value!.parts.every((p) => p === 0)).toBe(true); expect(r.value!.skinTone).toBe(0); expect(r.value!.bodyType).toBe(1);
    expect(validateAppearance(cat, a, { mode: "reject" }).value).toBeUndefined();
    const helm = look((a) => { a.parts[slotIndex("hat")] = id("hat_helm"); });
    expect(validateAppearance(cat, helm, { unlocked: new Set() }).issues[0]).toContain("locked");
    expect(validateAppearance(cat, helm, { unlocked: new Set(["raid_reward"]) }).issues).toEqual([]);
  });
  it("resolveLayers orders by layer and respects hidesSlots / hatHair / facing", () => {
    const a = look((a) => { a.skinTone = 1; a.parts[slotIndex("hair")] = id("hair_short"); a.primary[slotIndex("hair")] = 1; a.parts[slotIndex("top")] = id("top_shirt"); a.primary[slotIndex("top")] = 1; a.secondary[slotIndex("top")] = 2; a.parts[slotIndex("shoes")] = id("shoes_boots"); });
    const l = resolveLayers(cat, a, 0);
    expect(l.map((x) => x.slot)).toEqual(["body", "shoes", "top", "hair"]);
    expect(l[0]!.tintR).toBe(0x8d5524); expect(l[2]!).toMatchObject({ tintR: 0x2244aa, tintG: 0xffffff }); expect(l[3]!.tintR).toBe(0xe6c35c); expect(l[1]!.tintR).toBeUndefined();
    expect(resolveLayers(cat, a, -Math.PI / 2).map((x) => x.slot)[0]).toBe("hair"); // facing N: hair behind body
    a.parts[slotIndex("hat")] = id("hat_cap");
    const capped = resolveLayers(cat, a, 0); expect(capped.find((x) => x.slot === "hair")!.sprite).toBe(cat.byKey("hair_short")!.bodies.male!.hatHair!.sprite);
    a.parts[slotIndex("hat")] = id("hat_helm"); expect(resolveLayers(cat, a, 0).some((x) => x.slot === "hair")).toBe(false);
    a.bodyType = 1; a.parts[slotIndex("hat")] = id("hat_cap"); expect(resolveLayers(cat, a, 0).some((x) => x.slot === "hair")).toBe(false); // female hair lacks hatHair art
  });
});
