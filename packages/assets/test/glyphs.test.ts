import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadManifest, ManifestError } from "../src/index.js";
import { FIXTURE_DIR } from "../src/node.js";

const sample = JSON.parse(readFileSync(FIXTURE_DIR + "manifest.json", "utf8"));
const mutate = (fn: (m: typeof sample) => void) => { const m = structuredClone(sample); fn(m); return m; };
const issuesOf = (j: unknown) => { try { loadManifest(j); return ""; } catch (e) { return (e as ManifestError).issues.join("\n"); } };
const spr = (m: typeof sample, k: string) => m.sprites.find((s: { key: string }) => s.key === k);

describe("batch 12 assets: tint saturation + input glyphs", () => {
  it("tint saturation defaults to 1, validated to [0,4]", () => {
    const { registry } = loadManifest(mutate((m) => { spr(m, "player").tints = { exhausted: { color: "#999999", strength: 0.4, saturation: 0.3 }, wet: { color: "#6688cc", strength: 0.3 } }; }));
    const t = registry.sprite(registry.id("player")).tints; expect(t.exhausted!.saturation).toBe(0.3); expect(t.wet!.saturation).toBe(1);
    expect(issuesOf(mutate((m) => { spr(m, "player").tints = { a: { color: "#000000", strength: 0.1, saturation: 5 } }; }))).toContain("saturation must be within [0,4]");
  });
  it("glyphs map ids to sprite frames; validates ids and sprites", () => {
    const { registry } = loadManifest(mutate((m) => { m.glyphs = { "gamepad.xbox.a": { sprite: "player", frame: 1 }, "kbm.key.e": { sprite: "tree" } }; }));
    expect(registry.glyph("gamepad.xbox.a")).toMatchObject({ sprite: registry.id("player"), frame: 1 }); expect(registry.glyphFrame("kbm.key.e")).toBeDefined(); expect(registry.glyph("touch.tap")).toBeUndefined();
    const msg = issuesOf(mutate((m) => { m.glyphs = { "Bad Id": { sprite: "player" }, "touch.tap": { sprite: "nope" }, "kbm.key.q": { sprite: "player", frame: 99999 } }; }));
    for (const s of ["id must look like", "unknown sprite", "frame out of atlas range"]) expect(msg).toContain(s);
  });
});
