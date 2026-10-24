import { describe, expect, test } from "vitest";
import { AudioMixer } from "../src/audio/mixer.js";
import type { SoundBankJson } from "../src/audio/bank.js";
import { FakeCtx, memStorage, type FakeGain } from "./audio_fake.js";
const def = (bus: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ bus, volume: 1, pitchJitter: 0, volumeJitter: 0, loop: false, priority: 10, maxVoices: 4, synth: { r: "tick", f: 1000, len: 0.05 }, ...extra });
const J = { version: 1, basePath: "art/pack/", formats: ["ogg"], sounds: {
  "ui.click": def("ui"), "hit": def("sfx", { maxVoices: 2 }), "low": def("sfx", { priority: 1, maxVoices: 99 }), "high": def("sfx", { priority: 90, maxVoices: 99 }),
  "bed": def("ambient", { loop: true }), "file": def("sfx", { files: ["audio/sfx/x_1"] }),
} } as unknown as SoundBankJson;
const mk = (o: { lowEnd?: boolean; storage?: ReturnType<typeof memStorage> } = {}): { m: AudioMixer; c: FakeCtx } => { const c = new FakeCtx();
  const m = new AudioMixer(J, { createContext: () => c as unknown as AudioContext, canPlay: () => "probably", storage: o.storage ?? memStorage(), lowEnd: !!o.lowEnd, fetchBytes: async () => new ArrayBuffer(8) }); return { m, c }; };
describe("ADR-117 mixer", () => {
  test("silent until unlocked; unlock creates graph and resumes", async () => {
    const { m, c } = mk(); expect(m.play("ui.click")).toBe(0); m.unlock(); await Promise.resolve();
    expect(c.resumed).toBe(1); expect(m.running).toBe(true); expect(m.play("ui.click")).toBeGreaterThan(0); expect(m.play("missing.key")).toBe(0);
  });
  test("bus volume and mute persist and drive bus gain (master multiplies)", () => {
    const st = memStorage(); const { m } = mk({ storage: st }); m.unlock();
    m.setVolume("music", 0.5); m.setVolume("master", 0.5); expect((m.buses.get("music") as unknown as FakeGain).gain.value).toBeCloseTo(0.5);
    expect((m.buses.get("master") as unknown as FakeGain).gain.value).toBeCloseTo(0.5);
    m.setMuted("sfx", true); expect((m.buses.get("sfx") as unknown as FakeGain).gain.value).toBe(0);
    const again = mk({ storage: st }).m; expect(again.settings.volume.music).toBe(0.5); expect(again.settings.muted.sfx).toBe(true);
  });
  test("suspend while hidden; resume only when every reason clears", async () => {
    const { m, c } = mk(); m.unlock(); await Promise.resolve();
    m.setSuspended("hidden", true); m.setSuspended("pause", true); await Promise.resolve(); expect(c.state).toBe("suspended"); expect(m.play("ui.click")).toBe(0);
    m.setSuspended("hidden", false); await Promise.resolve(); expect(c.state).toBe("suspended");
    m.setSuspended("pause", false); await Promise.resolve(); expect(c.state).toBe("running");
  });
  test("per-key voice limit steals the oldest of that key", () => {
    const { m } = mk(); m.unlock(); for (let i = 0; i < 5; i++) m.play("hit"); expect(m.voices.filter((v) => v.key === "hit").length).toBe(2);
  });
  test("global limit: higher priority steals lowest; lower priority is dropped when full", () => {
    const { m } = mk({ lowEnd: true }); m.unlock(); expect(m.maxVoices).toBe(12);
    for (let i = 0; i < 12; i++) expect(m.play("low")).toBeGreaterThan(0);
    expect(m.play("high")).toBeGreaterThan(0); expect(m.voices.length).toBe(12);
    for (let i = 0; i < 11; i++) m.play("high"); expect(m.voices.every((v) => v.key === "high")).toBe(true); expect(m.play("low")).toBe(0);
  });
  test("positional voices beyond max distance are culled, near ones panned", () => {
    const { m } = mk(); m.unlock(); m.setListener({ x: 0, y: 0 }, false);
    expect(m.play("hit", { pos: { x: 80, y: 0 } })).toBe(0); const id = m.play("hit", { pos: { x: 4, y: 0 } }); expect(m.voice(id)!.chain.pan!.pan.value).toBeGreaterThan(0);
  });
  test("files load async with synth fallback; loops can be updated and stopped", async () => {
    const { m } = mk(); m.unlock(); expect(m.play("file")).toBe(0); await new Promise((r) => setTimeout(r, 0)); expect(m.play("file")).toBeGreaterThan(0);
    const id = m.play("bed"); expect(m.voice(id)!.loop).toBe(true); m.update(id, { gain: 0.5 }); expect(m.voice(id)!.baseGain).toBeCloseTo(0.5); m.stop(id, 0); expect(m.voice(id)).toBeUndefined();
  });
  test("low-CPU mode skips filters", () => { const { m } = mk({ lowEnd: true }); m.unlock(); const id = m.play("hit"); expect(m.voice(id)!.chain.filter).toBeUndefined(); expect(m.outdoorBed).toBeUndefined(); });
});
