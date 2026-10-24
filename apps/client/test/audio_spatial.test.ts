import { describe, expect, test } from "vitest";
import { attenuation, pan, spatialize, OCCLUDED_HZ, OPEN_HZ } from "../src/audio/spatial.js";
import { synthesize } from "../src/audio/synth.js";
import { DEFAULT_AUDIO, loadAudioSettings, saveAudioSettings, normalizeAudioSettings } from "../src/audio/settings.js";
import { memStorage } from "./audio_fake.js";
describe("ADR-117 spatial math", () => {
  test("attenuation: full inside ref, monotonic, silent past max", () => {
    expect(attenuation(0)).toBe(1); expect(attenuation(2)).toBe(1); expect(attenuation(18)).toBe(0); expect(attenuation(30)).toBe(0);
    let prev = 1; for (let d = 2; d <= 18; d += 0.5) { const a = attenuation(d); expect(a).toBeLessThanOrEqual(prev); prev = a; }
  });
  test("pan follows iso screen x ((dx-dy)/2), clamped", () => {
    expect(pan(0, 0)).toBe(0); expect(pan(4, 0)).toBeGreaterThan(0); expect(pan(0, 4)).toBeLessThan(0); expect(pan(3, 3)).toBeCloseTo(0);
    expect(pan(100, 0)).toBeLessThanOrEqual(1); expect(pan(-100, 0)).toBeGreaterThanOrEqual(-1);
  });
  test("occlusion lowpass only across the indoor/outdoor boundary", () => {
    const L = { x: 0, y: 0 }, S = { x: 3, y: 0 };
    expect(spatialize(S, L, { indoors: false, sourceIndoors: false }).lowpassHz).toBe(OPEN_HZ);
    expect(spatialize(S, L, { indoors: true, sourceIndoors: true }).lowpassHz).toBe(OPEN_HZ);
    expect(spatialize(S, L, { indoors: true, sourceIndoors: false }).lowpassHz).toBe(OCCLUDED_HZ);
    expect(spatialize({ x: 50, y: 0 }, L, {}).audible).toBe(false);
  });
});
describe("ADR-117 procedural placeholders + settings", () => {
  test("synth is deterministic, finite, bounded; unknown recipe still makes a sound", () => {
    for (const r of ["step", "gunshot", "engine", "music_explore", "zzz_unknown"]) {
      const a = synthesize({ r, f: 300, len: 0.3 }, 8000, 1), b = synthesize({ r, f: 300, len: 0.3 }, 8000, 1);
      expect(a.length).toBeGreaterThan(0); expect(Array.from(a)).toEqual(Array.from(b)); for (const v of a) { expect(Number.isFinite(v)).toBe(true); expect(Math.abs(v)).toBeLessThanOrEqual(1); }
    }
  });
  test("settings persist and normalize garbage", () => {
    const st = memStorage(); expect(loadAudioSettings(st)).toEqual(DEFAULT_AUDIO);
    const s = { ...DEFAULT_AUDIO, volume: { ...DEFAULT_AUDIO.volume, music: 0.3 }, muted: { ...DEFAULT_AUDIO.muted, sfx: true } }; saveAudioSettings(s, st);
    expect(loadAudioSettings(st).volume.music).toBe(0.3); expect(loadAudioSettings(st).muted.sfx).toBe(true);
    const n = normalizeAudioSettings({ volume: { master: 7, music: "x" }, lowCpu: "maybe" }); expect(n.volume.master).toBe(1); expect(n.volume.music).toBe(DEFAULT_AUDIO.volume.music); expect(n.lowCpu).toBe("auto");
  });
});
