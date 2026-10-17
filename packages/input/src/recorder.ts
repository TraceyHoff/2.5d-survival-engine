import type { InputFrame } from "@engine/core";
import type { MapDevice } from "./devices.js";

/** Records device control snapshots per tick for deterministic replay in tests and bug reports. */
export interface InputRecording { version: 1; frames: { tick: number; devices: Record<string, Record<string, number>> }[] }
export class InputRecorder {
  readonly recording: InputRecording = { version: 1, frames: [] };
  constructor(private devices: readonly MapDevice[]) {}
  capture(tick: number): void { this.recording.frames.push({ tick, devices: Object.fromEntries(this.devices.map((d) => [d.id, d.snapshot()])) }); }
  toJSON(): string { return JSON.stringify(this.recording); }
}
/** Applies a recording to devices tick by tick (devices matched by id). */
export class InputReplayer {
  private i = 0;
  constructor(private rec: InputRecording, private devices: readonly MapDevice[]) {}
  apply(tick: number): boolean {
    const f = this.rec.frames.find((x) => x.tick === tick); if (!f) return false;
    for (const d of this.devices) { const snap = f.devices[d.id] ?? {}; for (const k of Object.keys(d.snapshot())) if (!(k in snap)) d.set(k, 0); for (const [k, v] of Object.entries(snap)) d.set(k, v); }
    this.i++; return true;
  }
  get done(): boolean { return this.i >= this.rec.frames.length; }
}
/** Scripted input: control changes at given ticks (for tests and harness bots). */
export type InputScript = { tick: number; device: string; control: string; value: number }[];
export function applyScript(script: InputScript, devices: readonly MapDevice[], tick: number): void {
  for (const s of script) if (s.tick === tick) devices.find((d) => d.id === s.device)?.set(s.control, s.value);
}
/** Frame log for determinism checks (same inputs -> identical frames). */
export class FrameLog { readonly frames: InputFrame[] = []; push(f: InputFrame): void { this.frames.push(structuredClone(f)); } }
