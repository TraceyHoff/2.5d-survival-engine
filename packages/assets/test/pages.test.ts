import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { loadManifest, AssetRegistry, ManifestError, applyLegacySurvival } from "../src/index.js";
import { FIXTURE_DIR } from "../src/node.js";

const sample = JSON.parse(readFileSync(FIXTURE_DIR + "manifest.json", "utf8"));
const mutate = (fn: (m: typeof sample) => void) => { const m = structuredClone(sample); fn(m); return m; };
const atlas = (m: typeof sample, k: string) => m.atlases.find((a: { key: string }) => a.key === k);
const spr = (m: typeof sample, k: string) => m.sprites.find((s: { key: string }) => s.key === k);
const issuesOf = (j: unknown) => { try { loadManifest(j); return ""; } catch (e) { return (e as ManifestError).issues.join("\n"); } };

describe("scale pages, masks, sprite tints", () => {
  it("pages sorted; pickPage by devicePixelRatio; FrameRef carries pages + masks", () => {
    const { registry } = loadManifest(mutate((m) => { atlas(m, "characters").pages = [{ scale: 2, image: "characters@2x.png" }, { scale: 1.5, image: "characters@1.5x.webp" }]; }));
    const at = registry.atlases.get("characters")!;
    expect(at.pages.map((p) => p.scale)).toEqual([1, 1.5, 2]);
    expect([0.5, 1, 1.25, 2, 3].map((d) => registry.pickPage(at, d).scale)).toEqual([1, 1, 1.5, 2, 2]);
    const f = registry.frame(registry.id("player"), "walk", Math.PI / 2, 0.13); expect(f.pages).toBe(at.pages);
    expect(AssetRegistry.scaled(f, 2)).toEqual({ image: "characters@2x.png", scale: 2, x: f.x * 2, y: f.y * 2, w: f.w * 2, h: f.h * 2 });
    expect(AssetRegistry.scaled(f).image).toBe(at.image);
  });
  it("masks: emissive boolean shorthand kept; generalized kinds", () => {
    const { registry } = loadManifest(mutate((m) => { atlas(m, "characters").masks = { sheen: "characters_sheen.png", tintmask: "characters_tint.png", emissive: true }; atlas(m, "resources").masks = { sway: "res_sway.png" }; }));
    const b = registry.atlases.get("buildings")!; expect(b.masks.emissive).toBe("buildings_emissive.png"); expect(b.emissiveImage).toBe("buildings_emissive.png");
    expect(registry.atlases.get("characters")!.masks).toEqual({ sheen: "characters_sheen.png", tintmask: "characters_tint.png", emissive: "characters_emissive.png" });
    expect(registry.frame(registry.id("tree"), "idle", 0, 0).masks.sway).toBe("res_sway.png");
  });
  it("typed sprite tints", () => {
    const { registry } = loadManifest(mutate((m) => { spr(m, "player").tints = { wet: { color: "#6688cc", strength: 0.35 }, frost: { color: "#cfe8ff", strength: 0.5, mode: "screen" } }; }));
    expect(registry.sprite(registry.id("player")).tints).toEqual({ wet: { color: 0x6688cc, strength: 0.35, mode: "multiply" }, frost: { color: 0xcfe8ff, strength: 0.5, mode: "screen" } });
    expect(registry.sprite(registry.id("tree")).tints).toEqual({});
  });
  it("validation", () => {
    const msg = issuesOf(mutate((m) => {
      atlas(m, "characters").pages = [{ scale: 2, image: "a.gif" }, { scale: 2, image: "b.png" }, { scale: 0, image: "c.png" }];
      atlas(m, "zombies").masks = { glow: "x.png", sheen: "x.jpg" };
      spr(m, "player").tints = { "Bad": { color: "red", strength: 2, mode: "burn" } }; spr(m, "tree").sway = { amp: 1, freq: 1, stiffness: 0.5, mask: "m.bmp" };
    }));
    for (const s of ["page image must be", "duplicate page scale 2", "page scale must be", "unknown mask \"glow\"", "mask sheen must be", "bad tint name", "color must be #rrggbb", "strength must be", "mode must be", "sway.mask must be"]) expect(msg).toContain(s);
  });
  it("x_survival legacy alias maps onto typed fields with a deprecation warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const j = mutate((m) => { m.x_survival = {
      hiDpiAtlases: { characters: "fx/characters_2x.png", ghost: "x.png" }, emissivePages: ["buildings_emissive.png", "vfx_emissive.png"],
      sheenMasks: ["fx/sheen/characters_sheen.png"], swayMasks: ["fx/sway/resources_sway.png"], sway: { tree: { amp: 2.2, freq: 0.35, stiffness: 0.6, mask: "fx/sway/resources_sway.png" } }, tuning: "x.json" }; });
    const { registry, warnings } = loadManifest(j);
    const c = registry.atlases.get("characters")!; expect(c.pages).toEqual([{ scale: 1, image: "characters.png" }, { scale: 2, image: "fx/characters_2x.png" }]); expect(c.masks.sheen).toBe("fx/sheen/characters_sheen.png");
    expect(registry.atlases.get("vfx")!.masks.emissive).toBe("vfx_emissive.png"); expect(registry.atlases.get("resources")!.masks.sway).toBe("fx/sway/resources_sway.png");
    expect(registry.sprite(registry.id("tree")).sway!.amp).toBe(2); // typed sway already in the fixture wins over legacy
    expect(warnings[0]).toContain("deprecated"); expect(warnings.join()).toContain("unknown atlas \"ghost\""); expect(warnings.join()).toContain("not mapped (renderer-owned): tuning");
    expect(warn).toHaveBeenCalled(); expect(j.x_survival).toBeDefined(); warn.mockRestore();
    expect(applyLegacySurvival(j, []).x_survival).toBeUndefined();
  });
  it("the real survival_fx fragment loads through the legacy alias", () => {
    const frag = "/workspace/assets/survival_fx/manifest.fragment.json"; if (!existsSync(frag)) return;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registry, warnings } = loadManifest(JSON.parse(readFileSync(frag, "utf8")));
    const night = registry.atlases.get("surv_night")!; expect(night.pages.map((p) => p.scale)).toEqual([1, 2]); expect(night.masks.emissive).toBeDefined();
    expect(warnings.some((w) => w.includes("deprecated"))).toBe(true); warn.mockRestore();
  });
});
