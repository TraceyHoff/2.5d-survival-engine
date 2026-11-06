/**
 * ADR-257: wild lettuce, wheat and hay — unique sprite keys + every-seed worldgen coverage.
 * Spawn guarantee comes from ADR-255 (NODE_GUARANTEE_RADIUS); this pins the three starter-crop
 * wild nodes explicitly and asserts they do not reuse another plant's sheet when pack art is present.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ProceduralGenerator, NODE_GUARANTEE_RADIUS } from "@engine/world";
import * as G from "../src/index.js";
import { resolveSprite, resolveIcon } from "../src/sprite-fallback.js";

const WILD = ["wild_lettuce", "wild_wheat", "wild_hay"] as const;

const manifestKeys = (rel: string): string[] => {
  const j = JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")) as { sprites: { key: string }[] };
  return j.sprites.map((s) => s.key);
};
const packHas = new Set<string>([
  ...manifestKeys("../../assets/pack/manifest.json"),
  ...manifestKeys("../../assets/pack/nature/manifest.nature.json"),
  ...manifestKeys("../../assets/pack/task34/manifest.task34.json"),
  ...manifestKeys("../../assets/pack/task256/manifest.task256.json"),
]);
const has = (k: string): boolean => packHas.has(k);

describe("ADR-257: unique wild lettuce / wheat / hay", () => {
  it("pack ships distinct sprite keys for lettuce and hay (wheat already in nature_crops)", () => {
    expect(has("wild_lettuce")).toBe(true);
    expect(has("crop_lettuce")).toBe(true);
    expect(has("wild_hay")).toBe(true);
    expect(has("crop_hay")).toBe(true);
    expect(has("wild_wheat")).toBe(true);
    expect(has("crop_wheat")).toBe(true);
    expect(has("hay")).toBe(true);
    expect(has("hay_seeds")).toBe(true);
  });

  it("resolveSprite returns each plant as itself — no wheat/carrot cross-reuse", () => {
    expect(resolveSprite("wild_lettuce", has)).toMatchObject({ key: "wild_lettuce", tint: 0, scale: 1 });
    expect(resolveSprite("crop_lettuce", has)).toMatchObject({ key: "crop_lettuce", tint: 0, scale: 1 });
    expect(resolveSprite("wild_hay", has)).toMatchObject({ key: "wild_hay", tint: 0, scale: 1 });
    expect(resolveSprite("crop_hay", has)).toMatchObject({ key: "crop_hay", tint: 0, scale: 1 });
    expect(resolveSprite("wild_wheat", has)).toMatchObject({ key: "wild_wheat", tint: 0, scale: 1 });
    expect(resolveSprite("crop_hay_0", has)).toMatchObject({ key: "crop_hay_0", scale: 1 });
    expect(resolveSprite("crop_lettuce_3", has)).toMatchObject({ key: "crop_lettuce_3", scale: 1 });
    expect(resolveIcon("hay", "resource", has)).toBe("hay");
    expect(resolveIcon("hay_seeds", "resource", has)).toBe("hay_seeds");
  });

  it("emergency fallbacks never draw hay as wheat or lettuce as carrot_patch", () => {
    const emergency = (k: string): boolean =>
      k === "fiber_grass" || k === "flax" || k === "bush" || k === "wild_herbs"
      || k === "wild_wheat" || k === "carrot_patch" || k === "crop_wheat";
    expect(resolveSprite("wild_hay", emergency)!.key).not.toBe("wild_wheat");
    expect(resolveSprite("wild_hay", emergency)!.key).not.toBe("crop_wheat");
    expect(resolveSprite("crop_hay", emergency)!.key).not.toBe("wild_wheat");
    expect(resolveSprite("wild_lettuce", emergency)!.key).not.toBe("carrot_patch");
    expect(resolveSprite("crop_lettuce", emergency)!.key).not.toBe("carrot_patch");
  });

  it("worldgen lists all three wild crops in the grass band with weight ≥ 2", () => {
    const defs = G.defaultDefs();
    const grass = defs.worldgen.bands.find((b) => b.tile === 3)!;
    for (const k of WILD) {
      const id = defs.resourceId(k);
      expect(grass.nodes.filter((n) => n === id).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("every seed places wild_lettuce, wild_wheat and wild_hay inside NODE_GUARANTEE_RADIUS", () => {
    const defs = G.defaultDefs();
    const bands = G.worldgenBands(defs);
    const ids = WILD.map((k) => defs.resourceId(k));
    for (let i = 0; i < 16; i++) {
      const seed = ((i * 2654435761) >>> 0) || 1;
      const g = new ProceduralGenerator({ seed, bands });
      const found = new Set<number>();
      const R = NODE_GUARANTEE_RADIUS; const cs = 32;
      for (let cy = Math.floor(-R / cs) - 1; cy <= Math.floor(R / cs) + 1; cy++)
        for (let cx = Math.floor(-R / cs) - 1; cx <= Math.floor(R / cs) + 1; cx++)
          for (const n of g.load(cx, cy).nodes) {
            if (Math.abs(n.tx) >= R || Math.abs(n.ty) >= R) continue;
            found.add(n.kind);
          }
      const miss = ids.filter((id) => !found.has(id)).map((id) => defs.resources.get(id)?.key ?? `#${id}`);
      expect(miss, `seed ${seed}`).toEqual([]);
    }
  });
});
