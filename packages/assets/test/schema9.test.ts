import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadManifest, ManifestError, CATEGORIES, ALL_CATEGORIES } from "../src/index.js";
import { FIXTURE_DIR, loadDefaultManifest } from "../src/node.js";

const sample = JSON.parse(readFileSync(FIXTURE_DIR + "manifest.json", "utf8"));
const mutate = (fn: (m: typeof sample) => void) => { const m = structuredClone(sample); fn(m); return m; };
const issuesOf = (json: unknown): string => { try { loadManifest(json); return ""; } catch (e) { return (e as ManifestError).issues.join("\n"); } };
const spr = (m: typeof sample, k: string) => m.sprites.find((s: { key: string }) => s.key === k);

describe("schema additions: critter, piece states, rotationArt, sway, loop points", () => {
  it("critter is an optional category", () => {
    expect(CATEGORIES).not.toContain("critter"); expect(ALL_CATEGORIES).toContain("critter");
    const { registry } = loadManifest(mutate((m) => { m.sprites.push({ ...spr(m, "player"), key: "critter_bunny", category: "critter" }); }));
    expect(registry.byCategory("critter").map((s) => s.key)).toEqual(["critter_bunny"]);
  });
  it("piece states with per-state frames; mirror rotation derivation with flipX", () => {
    const { registry } = loadManifest(mutate((m) => {
      const w = spr(m, "wall"); w.building.frames = [[1, 5, 9, 13], [2, 6, 10, 14]];
      w.building.states = { closed: [[1, 5, 9, 13]], open: [[3, 7, 11, 15], [0, 4, 8, 12]] };
    }));
    const id = registry.id("wall"); const s = registry.sprite(id);
    expect(s.building!.stateNames).toEqual(["closed", "open"]); expect(registry.stateIndex(id, "open")).toBe(1); expect(s.building!.rotationArt).toBe("mirror");
    expect(registry.buildingFrame(id, 1, 0).frame).toBe(2); expect(registry.buildingFrame(id, 3, 0)).toMatchObject({ frame: 2, flipX: true });
    expect(registry.buildingFrame(id, 0, 2).flipX).toBeUndefined();
    expect(registry.buildingFrame(id, 2, 1, 1)).toMatchObject({ frame: 7, flipX: true }); expect(registry.buildingFrame(id, 2, 0, 0).frame).toBe(1);
    expect(registry.buildingFrame(id, 0, 0, 9).frame).toBe(1); // unknown state -> default frames
  });
  it("sway and loop points are typed and exposed", () => {
    const { registry } = loadManifest(mutate((m) => { spr(m, "tree").sway = { amp: 1.5, freq: 0.4, stiffness: 0.7 }; m.sounds.find((s: { key: string }) => s.key === "amb_rain").loop = { start: 0.25, end: 3.5 }; }));
    expect(registry.sprite(registry.id("tree")).sway).toEqual({ amp: 1.5, freq: 0.4, stiffness: 0.7 });
    expect(registry.sound("amb_rain")).toMatchObject({ loop: true, loopPoints: { start: 0.25, end: 3.5 } });
    expect(registry.sound("sfx_chop").loopPoints).toBeUndefined();
  });
  it("validation of the new fields", () => {
    const msg = issuesOf(mutate((m) => {
      const w = spr(m, "wall"); w.rotationArt = "unique4"; w.building.states = { "Bad Name": [[1, 5, 9, 13]], half: [[1, 2], [1, 5, 9, 13], [1, 5, 9, 13], [1, 5, 9, 13]] };
      spr(m, "pillar").rotationArt = "spin"; spr(m, "tree").rotationArt = "mirror"; spr(m, "player").sway = { amp: -1, freq: 1, stiffness: 2 };
      m.sounds[0].loop = { start: 2, end: 1 }; m.sprites.push({ ...spr(m, "player"), key: "dragon", category: "dragon" });
    }));
    for (const s of ["frames needs 4 rotations for rotationArt unique4", "bad state name", "rotation 0 needs 4 damage stages", "rotationArt must be mirror|unique4",
      "rotationArt only applies to building sprites", "sway needs", "loop points need", "unknown category \"dragon\""]) expect(msg).toContain(s);
  });
  it("the default pack validates with the typed fields", () => {
    const { registry } = loadDefaultManifest();
    expect(registry.sprite(registry.id("tree")).sway).toBeDefined(); expect(registry.sprite(registry.id("door")).building!.rotationArt).toBe("unique4");
  });
});
