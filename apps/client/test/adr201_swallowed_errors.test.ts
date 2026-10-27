import { describe, it, expect, vi } from "vitest";
import { reportRenderError, setRenderErrorSink, type RenderErrorReport } from "@engine/render";
import { errorLog, logRecoverable } from "../src/error-log.js";
import { AudioMixer } from "../src/audio/mixer.js";
import type { SoundBankJson } from "../src/audio/bank.js";
import { FakeCtx, memStorage } from "./audio_fake.js";

const count = (k: string): number => errorLog().list().filter((e) => e.kind.startsWith(k)).length;

describe("ADR-201: no silently swallowed render/audio errors", () => {
  it("render errors reach the installed sink (visible flag kept) and never throw", () => {
    const got: RenderErrorReport[] = []; setRenderErrorSink((r) => got.push(r));
    reportRenderError("atlas retier", new Error("swap failed")); reportRenderError("body page-in x", new Error("y"), true);
    expect(got.map((g) => [g.where, g.visible])).toEqual([["atlas retier", false], ["body page-in x", true]]);
    setRenderErrorSink(() => { throw new Error("bad sink"); }); expect(() => reportRenderError("z", 1)).not.toThrow();
    setRenderErrorSink(undefined); const w = vi.spyOn(console, "warn").mockImplementation(() => {}); reportRenderError("q", 2); expect(w).toHaveBeenCalled(); w.mockRestore();
  });
  it("logRecoverable records to the persistent log but skips expected autoplay/abort rejections", () => {
    const n = count("Recoverable: atlas retier"); logRecoverable("atlas retier", new Error("boom")); expect(count("Recoverable: atlas retier")).toBe(n + 1);
    const a = Object.assign(new Error("autoplay"), { name: "NotAllowedError" }); const m = count("Recoverable: audio play"); logRecoverable("audio play", a); expect(count("Recoverable: audio play")).toBe(m);
  });
  it("audio decode failing for every format is logged (was an empty catch)", async () => {
    const J = { version: 1, basePath: "art/pack/", formats: ["ogg"], sounds: { file: { bus: "sfx", volume: 1, pitchJitter: 0, volumeJitter: 0, loop: false, priority: 10, maxVoices: 4, files: ["audio/sfx/x_1"] } } } as unknown as SoundBankJson;
    const c = new FakeCtx(); const m = new AudioMixer(J, { createContext: () => c as unknown as AudioContext, canPlay: () => "probably", storage: memStorage(), lowEnd: false, fetchBytes: async () => { throw new Error("404"); } });
    m.unlock(); const before = count("Recoverable: audio decode"); m.preload(["file"]);
    await vi.waitFor(() => expect(count("Recoverable: audio decode")).toBeGreaterThan(before));
  });
});
