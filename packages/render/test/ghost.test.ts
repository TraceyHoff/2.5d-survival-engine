import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { World, Transform, defineComponent } from "@engine/core";
import { AssetRegistry, loadManifest, mergeManifests, type ManifestJson } from "@engine/assets";
import { BuildGhost, type BuildPreview, type BuildPieceDefT } from "../src/index.js";

const ART = join(__dirname, "../../../assets");
const j = <T>(p: string): T => JSON.parse(readFileSync(join(ART, p), "utf8")) as T;
const stalls = j<ManifestJson>("stalls/manifest.fragment.json"), pvp = j<ManifestJson>("pvp_clan/manifest.fragment.json");
const { registry: reg } = loadManifest(mergeManifests([{ name: "stalls", manifest: stalls }, { name: "pvp_clan", manifest: pvp }]).manifest);
const BP = defineComponent("GhostTestBP", { visualId: "u16", variant: "u8", tint: "u32", damageStage: "u8", rotation: "u8", level: "u8", layer: "u8", ghost: "u8" }) as unknown as BuildPieceDefT;
const mk = () => { const w = new World(); w.register(Transform); w.register(BP); return w; };
const pieceSprite = [...reg.allSprites()].find((s) => s.building && s.building.frames.length === 2)!;
const key = pieceSprite.building!.piece;

const SPRITE_FS = readFileSync(join(__dirname, "../src/sprites.ts"), "utf8");
describe("build-placement ghost (buildPreview)", () => {
  it("valid -> ghost 1, invalid -> ghost 2, Transform at x/y, piece sprite via buildPieceVisual", () => {
    const w = mk(); const g = new BuildGhost(w, BP, reg);
    const p: BuildPreview = { pieceKey: key, x: 12, y: 7, rot: 1, valid: true };
    const v = g.sync(p)!; const e = g.entity!;
    expect(v.visualId).toBe(pieceSprite.id); expect(v.ghost).toBe(1);
    expect(w.get(e, BP)).toMatchObject({ visualId: pieceSprite.id, ghost: 1, rotation: 1 });
    expect(w.get(e, Transform)).toMatchObject({ x: 12, y: 7 });
    g.sync({ ...p, valid: false, x: 13, rot: 6 }); expect(g.entity).toBe(e);
    expect(w.get(e, BP)).toMatchObject({ ghost: 2, rotation: 2 }); expect(w.get(e, Transform)!.x).toBe(13);
  });
  it("null preview removes the ghost entity; unknown pieceKey gives visualId 0", () => {
    const w = mk(); const g = new BuildGhost(w, BP, reg);
    g.sync({ pieceKey: key, x: 0, y: 0, rot: 0, valid: true }); const e = g.entity!;
    expect(g.sync(null)).toBeNull(); expect(w.isAlive(e)).toBe(false); expect(g.entity).toBeNull();
    expect(g.sync({ pieceKey: "no_such_piece", x: 0, y: 0, rot: 0, valid: true })!.visualId).toBe(0);
  });
  it("rotation rules through buildingFrame: 2-row mirror flips rot 2/3 with attach x negated", () => {
    for (let r = 0; r < 4; r++) {
      const f = reg.buildingFrame(pieceSprite.id, r, 0); expect(!!f.flipX).toBe(r >= 2);
      const a = AssetRegistry.attachPoint(f, "slot0"), b = AssetRegistry.attachPoint(reg.buildingFrame(pieceSprite.id, r & 1, 0), "slot0");
      if (a && b) expect(a.x).toBeCloseTo(r >= 2 ? -b.x : b.x);
    }
  });
  it("shader: ghosts tint green/red at ~0.5 alpha, bypass the lightmap (emissive r) and not bloom", () => {
    expect(SPRITE_FS).toMatch(/ghost == 1 \? vec3\(0\.35, 1\.0, 0\.45\) : vec3\(1\.0, 0\.3, 0\.3\)/);
    expect(SPRITE_FS).toMatch(/alpha \*= 0\.5 \+ 0\.06 \* sin/);
    expect(SPRITE_FS).toMatch(/oEmissive = vec4\(ghost > 0 \? 1\.0 : e \* uEmisStrength, \(vFlags & 32\) != 0 \? max\(e, 0\.6\) : e/);
  });
});
