import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { World, Transform, defineComponent } from "@engine/core";
import { loadManifest, mergeManifests, type ManifestJson } from "@engine/assets";
import {
  BurningFx, FireState, fireAnimTime, fireFrameIndex, hash01, HearthFx, hearthParticles, isFireAnim, pieceFireFrame, VfxLayer,
  type BurningDefT,
} from "../src/index.js";
import type { AtlasManager } from "../src/assets/atlasManager.js";

const ROOT = join(__dirname, "../../..");
const json = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as T;
const bld = json<ManifestJson>("packages/assets/pack/building/manifest.building.json");
const base = json<ManifestJson>("packages/assets/pack/manifest.json");
const { registry: reg } = loadManifest(mergeManifests([{ name: "base", manifest: base }, { name: "building", manifest: bld }]).manifest);
const atlas = { registry: reg, pieceInfo: () => ({ fw: 1, fh: 1 }) } as unknown as AtlasManager;

describe("ADR-218 fire clock", () => {
  it("advances with render time and loops through every frame", () => {
    const seen = new Set<number>();
    for (let t = 0; t < 2; t += 0.05) seen.add(fireFrameIndex(t, 3, 8, 10));
    expect(seen.size).toBe(8);
    expect(fireAnimTime(1, 5)).toBeGreaterThan(fireAnimTime(0, 5));
  });
  it("neighbouring fires are desynced (phase + rate per entity)", () => {
    const frames = [1, 2, 3, 4, 5, 6].map((s) => fireFrameIndex(10, s, 8, 10));
    expect(new Set(frames).size).toBeGreaterThan(2);
    for (let s = 0; s < 50; s++) { const h = hash01(s); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(1); }
  });
  it("single-frame or fps 0 art stays on frame 0", () => {
    expect(fireFrameIndex(3.3, 1, 1, 10)).toBe(0); expect(fireFrameIndex(3.3, 1, 6, 0)).toBe(0);
  });
});

describe("ADR-218 pieceFireFrame (real pack art)", () => {
  const camp = reg.id("bonfire"); const furn = reg.id("furnace");
  it("campfire / furnace art has a looping idle flame + unlit anim", () => {
    for (const id of [camp, furn]) { const d = reg.sprite(id); expect(isFireAnim(d)).toBe(true); expect(d.animations.has("unlit")).toBe(true); }
  });
  it("a lit fired piece animates over time, desynced per entity", () => {
    const xs = new Set<number>(); for (let t = 0; t < 1.2; t += 0.04) xs.add(pieceFireFrame(reg, camp, 0, 0, -1, FireState.Hearth, false, t, 7).x * 1e4 + pieceFireFrame(reg, camp, 0, 0, -1, FireState.Hearth, false, t, 7).y);
    expect(xs.size).toBeGreaterThanOrEqual(6);
    const a = [1, 2, 3, 4, 5].map((s) => { const f = pieceFireFrame(reg, camp, 0, 0, -1, 2, false, 4.2, s); return `${f.x},${f.y}`; });
    expect(new Set(a).size).toBeGreaterThan(1);
  });
  it("unlit furnace (no own building state) shows its unlit frame; damaged / ghost / non-fired keep the building frame", () => {
    const st = reg.buildingFrame(furn, 0, 0, -1); const out = pieceFireFrame(reg, furn, 0, 0, -1, FireState.Out, false, 1, 1);
    const unlit = reg.animFrame(furn, "unlit", 0, 0); expect(out.x).toBe(unlit.x); expect(out.y).toBe(unlit.y);
    expect(`${out.x},${out.y}`).not.toBe(`${st.x},${st.y}`);
    const dmg = pieceFireFrame(reg, furn, 0, 2, -1, FireState.Hearth, false, 1, 1); const bd = reg.buildingFrame(furn, 0, 2, -1);
    expect([dmg.x, dmg.y]).toEqual([bd.x, bd.y]);
    const gh = pieceFireFrame(reg, camp, 0, 0, -1, FireState.Hearth, true, 1, 1); const bg = reg.buildingFrame(camp, 0, 0, -1);
    expect([gh.x, gh.y]).toEqual([bg.x, bg.y]);
    const nf = pieceFireFrame(reg, camp, 0, 0, -1, undefined, false, 1, 1); expect([nf.x, nf.y]).toEqual([bg.x, bg.y]);
  });
});

describe("ADR-218 VfxLayer lifetime bookkeeping", () => {
  it("age back-dates birth, kill ends an infinite instance, eviction marks dead", () => {
    const v = new VfxLayer(); v.update(5);
    const a = v.spawn({ spriteId: 0, x: 0, y: 0, lifetime: Infinity, age: 2 }); expect(a.born).toBe(3);
    v.update(6); expect(v.active).toContain(a); v.kill(a); v.update(6.1); expect(v.active).not.toContain(a); expect(a.dead).toBe(true);
    v.maxActive = 2; const b = v.spawn({ spriteId: 0, x: 0, y: 0, lifetime: 9 }); v.spawn({ spriteId: 0, x: 0, y: 0 }); v.spawn({ spriteId: 0, x: 0, y: 0 });
    expect(b.dead).toBe(true);
  });
});

describe("ADR-218 BurningFx persistent flames (no 0.8 s respawn pulse)", () => {
  const Burning = defineComponent("Adr218Burning", { lit: "u8", intensity: "u8", startTick: "u32" }) as unknown as BurningDefT;
  it("keeps the same flame instances alive while burning and kills them when the burn stops", () => {
    const w = new World(); w.register(Transform); w.register(Burning);
    const e = w.create(); w.add(e, Transform, { x: 2, y: 3, z: 0 }); w.add(e, Burning, { lit: 1, intensity: 120, startTick: 0 });
    const fx = new BurningFx(); const v = new VfxLayer(); let t = 0;
    fx.update(w, Burning, undefined, atlas, v, t, 0.016);
    expect(fx.flameCount).toBe(1); const first = v.active.find((x) => x.lifetime === Infinity)!; expect(first).toBeDefined();
    for (let k = 0; k < 300; k++) { t += 1 / 60; v.update(t); fx.update(w, Burning, undefined, atlas, v, t, 1 / 60); }
    expect(v.active).toContain(first); expect(first.alpha).toBe(1); expect(fx.flameCount).toBe(1);
    w.setField(e, Burning, "lit", 0); fx.update(w, Burning, undefined, atlas, v, t, 1 / 60); v.update(t + 0.02);
    expect(fx.flameCount).toBe(0); expect(v.active).not.toContain(first);
  });
});

describe("ADR-218 HearthFx + Canvas2D hearth particles", () => {
  it("emits embers/smoke for hearths (state 2) and lit stations only", () => {
    const Lit = defineComponent("Adr218Lit", { lit: "u8" });
    const w = new World(); w.register(Transform); w.register(Lit);
    const a = w.create(); w.add(a, Transform, { x: 1, y: 1, z: 0 }); const b = w.create(); w.add(b, Transform, { x: 4, y: 4, z: 0 });
    const s = w.create(); w.add(s, Transform, { x: 8, y: 8, z: 0 }); w.add(s, Lit, { lit: 0 });
    const h = new HearthFx(); const v = new VfxLayer();
    for (let k = 0; k < 120; k++) h.update(w, new Map([[a, FireState.Lit], [b, FireState.Out]]), Lit, undefined, atlas, v, 1 / 60);
    expect(h.spawned).toBe(0);
    for (let k = 0; k < 120; k++) h.update(w, new Map([[a, FireState.Hearth]]), Lit, undefined, atlas, v, 1 / 60);
    const n = h.spawned; expect(n).toBeGreaterThan(0); expect(v.active.every((p) => Math.abs(p.x - 1.5) < 1 && Math.abs(p.y - 1.5) < 1)).toBe(true);
    w.setField(s, Lit, "lit", 1); for (let k = 0; k < 120; k++) h.update(w, undefined, Lit, undefined, atlas, v, 1 / 60);
    expect(h.spawned).toBeGreaterThan(n);
  });
  it("stateless particles rise, stay bounded and fade (alpha 0..1), embers + smoke mixed", () => {
    for (let t = 0; t < 5; t += 0.13) {
      const ps = hearthParticles(t, 9, 9, 64); expect(ps).toHaveLength(9);
      expect(ps.some((p) => p.ember) && ps.some((p) => !p.ember)).toBe(true);
      for (const p of ps) { expect(p.alpha).toBeGreaterThanOrEqual(0); expect(p.alpha).toBeLessThanOrEqual(1); expect(p.dy).toBeLessThan(0); expect(p.dy).toBeGreaterThan(-64 * 2); expect(Math.abs(p.dx)).toBeLessThan(64); }
    }
    expect(hearthParticles(1, 9, 9, 64)[0]).not.toEqual(hearthParticles(1.2, 9, 9, 64)[0]);
  });
});
