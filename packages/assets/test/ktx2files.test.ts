import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs"; import { join } from "node:path";
import { validateAssetFiles, loadManifest } from "../src/index.js";
import { FIXTURE_DIR, PACK_DIR, imageSizeOf } from "../src/node.js";

const ktx2Files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? ktx2Files(join(d, e.name)) : e.name.endsWith(".ktx2") ? [join(d, e.name)] : []));

describe("KTX2 files", () => {
  it("validator flags 0-byte ktx2", () => {
    const m = JSON.parse(readFileSync(FIXTURE_DIR + "manifest.json", "utf8")); const a = m.atlases[0]; a.ktx2 = "x.ktx2"; a.masksKtx2 = { tintmask: "y.ktx2" };
    const { registry } = loadManifest(m);
    const issues = validateAssetFiles(registry, { exists: () => true, imageSize: (p) => imageSizeOf(FIXTURE_DIR + p), fileSize: (p) => (p.endsWith(".ktx2") ? 0 : 1) });
    expect(issues.filter((i) => i.includes("0 bytes")).length).toBe(2);
  });
  it("every pack .ktx2 is non-empty and has a mip chain", () => {
    const bad = ktx2Files(PACK_DIR).filter((f) => { const n = statSync(f).size; return n < 44 || readFileSync(f).readUInt32LE(40) <= 1; });
    expect(bad).toEqual([]);
  });
});
