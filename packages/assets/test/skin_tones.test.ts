import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadManifest, mergeManifests, type ManifestJson } from "../src/index.js";
import { readManifestJson } from "../src/node.js";
import { MANIFEST_INDEX, applyFragmentFlags } from "../../../apps/client/src/manifest-index.js";

// Player skin tones: realistic human range only, light -> deep (Monk 1-10 / Fitzpatrick I-VI), each with a cel ramp.
// Source of truth: assets/customization/tools/skin_tones.py -> pack/customization/skin_tones.json (+ base shard skinTones).
const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (f: string) => JSON.parse(readFileSync(root + f, "utf8"));
type Ramp = { base: string; shadow: string; highlight: string };
type Tone = { key: string; color: string; ramp: Ramp; undertone: string; monk: number; fitzpatrick: string };
const data = read("packages/assets/pack/customization/skin_tones.json") as { tones: Tone[]; legacyMap: number[]; artLevels: Record<string, string>; removed: { key: string }[] };
const shard = read("packages/assets/pack/customization/manifest.customization.base.json") as { skinTones: Tone[] };

type RGB = [number, number, number];
const rgb = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const lum = (h: string) => { const [r, g, b] = rgb(h).map((u) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4)) as RGB; return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const hueSat = (h: string) => {
  const [r, g, b] = rgb(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const hue = d === 0 ? 0 : mx === r ? (((g - b) / d) % 6) * 60 : mx === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { hue: (hue + 360) % 360, sat: mx === 0 ? 0 : d / mx };
};

describe("player skin tones", () => {
  it("base shard skinTones == skin_tones.json (key, color, ramp, labels)", () => {
    expect(shard.skinTones).toEqual(data.tones.map(({ key, color, ramp, undertone, monk, fitzpatrick }) => ({ key, color, ramp, undertone, monk, fitzpatrick })));
  });
  it("at least 12 realistic human tones, light -> deep, all undertones, Monk 1..10 covered", () => {
    const T = data.tones; expect(T.length).toBeGreaterThanOrEqual(12);
    for (const t of T) {
      for (const c of [t.ramp.base, t.ramp.shadow, t.ramp.highlight]) {
        const { hue, sat } = hueSat(c);
        expect(hue, `${t.key} ${c}: skin hues are red-orange-yellow`).toBeGreaterThanOrEqual(0); expect(hue, `${t.key} ${c}`).toBeLessThanOrEqual(52);
        expect(sat, `${t.key} ${c}: no neon`).toBeLessThanOrEqual(0.7); expect(sat, `${t.key} ${c}: no grey`).toBeGreaterThanOrEqual(0.08);
      }
      const [r, g, b] = rgb(t.ramp.base); expect(r >= g && g >= b, `${t.key}: R >= G >= B (no green/blue/purple skin)`).toBe(true);
    }
    for (let i = 1; i < T.length; i++) expect(lum(T[i]!.ramp.base), `${T[i - 1]!.key} -> ${T[i]!.key}`).toBeLessThan(lum(T[i - 1]!.ramp.base));
    expect(new Set(T.map((t) => t.undertone))).toEqual(new Set(["cool", "neutral", "warm", "olive"]));
    expect([...new Set(T.map((t) => t.monk))].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(T.map((t) => t.key)).toContain("tan"); // customization_v2_sample palette
  });
  it("multiply path: `color` lands the art's base level on ramp.base (out = art * color / tintNeutral)", () => {
    const art = rgb(data.artLevels.base!).map((v) => v * 255), neutral = 0.78 * 255;
    for (const t of data.tones) {
      const out = rgb(t.color).map((c, i) => (c * 255 * art[i]!) / neutral), want = rgb(t.ramp.base).map((v) => v * 255);
      for (let i = 0; i < 3; i++) expect(Math.abs(out[i]! - want[i]!), `${t.key} ch${i}`).toBeLessThanOrEqual(2);
    }
  });
  it("cel ramp: one hard shade darker, highlight lighter than base", () => {
    for (const t of data.tones) {
      expect(lum(t.ramp.shadow), t.key).toBeLessThan(lum(t.ramp.base) * 0.75);
      expect(lum(t.ramp.highlight), t.key).toBeGreaterThan(lum(t.ramp.base));
    }
  });
  it("legacy save indices map to a valid tone; removed (non-human) tones are gone", () => {
    expect(data.legacyMap).toHaveLength(12);
    for (const n of data.legacyMap) { expect(Number.isInteger(n)).toBe(true); expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(data.tones.length); }
    expect(data.removed.map((r) => r.key)).toEqual(["goblin"]);
    for (const r of data.removed) expect(data.tones.map((t) => t.key)).not.toContain(r.key);
  });
  it("served client manifests yield the catalog skin tones", () => {
    const served = MANIFEST_INDEX.filter((f) => existsSync(root + (f.url.startsWith("pack/") ? "packages/assets/" + f.url : "assets/" + f.url)))
      .map((f) => ({ name: f.name, manifest: applyFragmentFlags(f, readManifestJson<ManifestJson>(root + (f.url.startsWith("pack/") ? "packages/assets/" + f.url : "assets/" + f.url))) }));
    const { registry } = loadManifest(mergeManifests(served).manifest, { lock: read("packages/assets/pack/ids.lock.json") });
    const cat = registry.cosmetics!; expect(cat).toBeDefined();
    expect(cat.skinTones.map((c) => c.key)).toEqual(data.tones.map((t) => t.key));
    expect(cat.skinTones.map((c) => "#" + c.color.toString(16).padStart(6, "0"))).toEqual(data.tones.map((t) => t.color));
  });
});
