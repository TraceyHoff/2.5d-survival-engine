import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultAppearance, resolveLayers, slotIndex, validateAppearance } from "@engine/core";
import { loadManifest, mergeManifests, type ManifestJson } from "../src/index.js";

// ADR-137: gloves live on the dedicated "hands" cosmetic slot, drawn over hands + front sleeves, never on the accessory layer.
const dir = fileURLToPath(new URL("../pack/", import.meta.url));
const read = (f: string) => JSON.parse(readFileSync(f, "utf8")) as ManifestJson;
const merged = mergeManifests([{ name: "pack", manifest: read(dir + "manifest.json") }, { name: "customization", manifest: read(dir + "customization/manifest.customization.json") }]);
const { registry } = loadManifest(merged.manifest, { lock: JSON.parse(readFileSync(dir + "ids.lock.json", "utf8")) });
const cat = registry.cosmetics!;
const GLOVES = ["acc_cloth_gloves", "acc_leather_gloves", "acc_fur_mittens", "acc_gauntlets"];

describe("hands cosmetic slot (ADR-137)", () => {
  it("every glove wearable is a hands-slot wearable", () => { for (const k of GLOVES) expect(cat.byKey(k)?.slot, k).toBe("hands"); });
  it("gloves + cape + tee: all draw; gloves over the body and front sleeves on front facings, cape kept", () => {
    const a = defaultAppearance(cat, 0);
    a.parts[slotIndex("top")] = cat.byKey("top_tee")!.id; a.parts[slotIndex("accessory")] = cat.byKey("acc_cape")!.id;
    a.parts[slotIndex("hands")] = cat.byKey("acc_leather_gloves")!.id;
    const v = validateAppearance(cat, a, { unlocked: new Set(["gear", "founder"]) }).value!; expect(v.parts[slotIndex("hands")]).toBe(a.parts[slotIndex("hands")]);
    for (const facing of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) {
      const l = resolveLayers(cat, v, facing); const idx = (s: string, n?: string) => l.findIndex((x) => x.slot === s && (n === undefined || (x as { layerName?: string }).layerName === n));
      expect(idx("hands"), `facing ${facing}`).toBeGreaterThan(idx("body")); expect(idx("accessory")).toBeGreaterThanOrEqual(0);
      expect(idx("hands")).toBeGreaterThan(idx("top", "main"));
    }
    const s = resolveLayers(cat, v, Math.PI / 2); // screen-south (front) facing
    const sl = s.findIndex((x) => x.slot === "top" && (x as { layerName?: string }).layerName === "sleeves_front");
    if (sl >= 0) expect(s.findIndex((x) => x.slot === "hands")).toBeGreaterThan(sl);
  });
});
