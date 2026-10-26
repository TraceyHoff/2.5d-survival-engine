import { expect, test } from "vitest";
import { AudioMixer } from "../src/audio/mixer.js";
import type { SoundBankJson } from "../src/audio/bank.js";
import { FakeCtx, memStorage } from "./audio_fake.js";

class FakeMedia { private s = ""; get src(): string { return this.s; } set src(v: string) { this.s = v; if (v === "") this.onerror?.(); } loop = false; onerror: (() => void) | null = null; onended: (() => void) | null = null; plays = 0;
  pause(): void {} play(): Promise<void> { this.plays++; return Promise.resolve(); } removeAttribute(a: string): void { if (a === "src") this.src = ""; } load(): void {} }
const J = { version: 1, basePath: "art/pack/", formats: ["ogg", "m4a"], sounds: {
  "music.x": { bus: "music", volume: 1, pitchJitter: 0, volumeJitter: 0, loop: true, priority: 10, maxVoices: 2, stream: true, files: ["audio/music/x_1"] },
} } as unknown as SoundBankJson;

test("ADR-168: a stopped music stream is unloaded without falling back to the next format", () => {
  const c = new FakeCtx(); const medias: FakeMedia[] = [];
  const m = new AudioMixer(J, { createContext: () => c as unknown as AudioContext, canPlay: () => "probably", storage: memStorage(), lowEnd: false,
    fetchBytes: async () => new ArrayBuffer(8), createMedia: (u: string) => { const f = new FakeMedia(); f.src = u; medias.push(f); return f as unknown as HTMLAudioElement; } });
  m.unlock(); const id = m.play("music.x"); expect(id).toBeGreaterThan(0); expect(medias).toHaveLength(1);
  m.stop(id, 0); (m as unknown as { release(v: unknown): void }).release(m.voice(id) ?? { ended: true });
  expect(medias[0]!.src).toBe(""); expect(medias[0]!.plays).toBe(1); // no m4a refetch + replay after release
});
