import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadManifest, AssetRegistry, ManifestError } from "../src/index.js";
import { FIXTURE_DIR } from "../src/node.js";

const sample = JSON.parse(readFileSync(FIXTURE_DIR + "manifest.json", "utf8"));
const issuesOf = (json: unknown): string => { try { loadManifest(json); return ""; } catch (e) { return (e as ManifestError).issues.join("\n"); } };
const bld = (m: { sprites: { key: string; category: string }[] }) => m.sprites.find((s) => s.category === "building")! as unknown as Record<string, unknown> & { key: string; building: { frames: number[][] } };

describe("attach points", () => {
  it("sprite attach + per-frame override resolve on FrameRef; x mirrors with flipX", () => {
    const m = structuredClone(sample); const s = bld(m);
    s.building.frames = [s.building.frames[0]!, s.building.frames[0]!.map((f) => f)];
    const f0 = s.building.frames[0]![0]!;
    s.attach = { slot0: { x: -6, y: -10, w: 8, h: 8 }, price: { x: 4, y: -20, z: 1 } };
    s.frameAttach = { [String(f0)]: { price: { x: 5, y: -22 } } };
    const { registry, warnings } = loadManifest(m); expect(warnings).toEqual([]);
    const id = registry.id(s.key);
    const r0 = registry.buildingFrame(id, 0, 0); expect(r0.attach).toEqual({ slot0: { x: -6, y: -10, w: 8, h: 8 }, price: { x: 5, y: -22 } });
    expect(AssetRegistry.attachPoint(r0, "slot0")).toEqual({ x: -6, y: -10, w: 8, h: 8 });
    const r2 = registry.buildingFrame(id, 2, 0); expect(r2.flipX).toBe(true); expect(AssetRegistry.attachPoint(r2, "slot0")!.x).toBe(6);
    expect(AssetRegistry.attachPoint(r2, "missing")).toBeUndefined();
    expect(registry.byKey(s.key).attach!.price).toEqual({ x: 4, y: -20, z: 1 });
  });
  it("validation", () => {
    const bad = (fn: (s: Record<string, unknown>) => void) => { const m = structuredClone(sample); fn(bld(m)); return issuesOf(m); };
    expect(bad((s) => { s.attach = { "Bad Name": { x: 0, y: 0 } }; })).toMatch(/bad attach name/);
    expect(bad((s) => { s.attach = { a: { x: "1", y: 0 } }; })).toMatch(/x and y must be finite/);
    expect(bad((s) => { s.attach = { a: { x: 1, y: 0, w: 0 } }; })).toMatch(/w must be > 0/);
    expect(bad((s) => { s.frameAttach = { "99999": { a: { x: 0, y: 0 } } }; })).toMatch(/frameAttach frame 99999 out of atlas range/);
    expect(bad((s) => { s.attach = []; })).toMatch(/attach must be an object/);
    expect(bad((s) => { s.attach = { name_label: { x: 0, y: -30 } }; })).toBe("");
  });
});
