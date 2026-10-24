/** ADR-117 persisted audio settings (localStorage `survivaz.audio.v1`): per-bus volume 0..1 + mute, low-CPU mode. */
import { BUSES, type BusName } from "./bank.js";
export type LowCpuMode = "auto" | "on" | "off";
export interface AudioSettings { volume: Record<BusName, number>; muted: Record<BusName, boolean>; lowCpu: LowCpuMode }
export const AUDIO_SETTINGS_KEY = "survivaz.audio.v1";
export const DEFAULT_AUDIO: AudioSettings = Object.freeze({
  volume: { master: 0.8, music: 0.55, ambient: 0.7, sfx: 0.85, ui: 0.7, voice: 0.85 },
  muted: { master: false, music: false, ambient: false, sfx: false, ui: false, voice: false }, lowCpu: "auto" as LowCpuMode,
}) as AudioSettings;
type Store = Pick<Storage, "getItem" | "setItem">;
const store = (): Store | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };
const clamp01 = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
export function normalizeAudioSettings(raw: unknown): AudioSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AudioSettings>;
  const volume = {} as Record<BusName, number>, muted = {} as Record<BusName, boolean>;
  for (const b of BUSES) { volume[b] = clamp01(r.volume?.[b], DEFAULT_AUDIO.volume[b]); muted[b] = r.muted?.[b] === true; }
  return { volume, muted, lowCpu: r.lowCpu === "on" || r.lowCpu === "off" ? r.lowCpu : "auto" };
}
export function loadAudioSettings(s: Store | undefined = store()): AudioSettings {
  try { return normalizeAudioSettings(JSON.parse(s?.getItem(AUDIO_SETTINGS_KEY) ?? "null")); } catch { return normalizeAudioSettings(null); }
}
export function saveAudioSettings(v: AudioSettings, s: Store | undefined = store()): void { try { s?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(v)); } catch { /* private mode */ } }
