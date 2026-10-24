/** Minimal fake Web Audio graph for ADR-117 mixer tests. */
export class FakeParam { value: number; constructor(v = 1) { this.value = v; } setTargetAtTime(v: number): void { this.value = v; } }
export class FakeNode { out: FakeNode[] = []; connect(n: FakeNode): FakeNode { this.out.push(n); return n; } disconnect(): void { this.out = []; } }
export class FakeGain extends FakeNode { gain = new FakeParam(1); }
export class FakeSrc extends FakeNode { buffer: unknown; loop = false; playbackRate = new FakeParam(1); started = false; stopped = false; onended: (() => void) | null = null; start(): void { this.started = true; } stop(): void { this.stopped = true; } }
export class FakeCtx {
  state = "suspended"; currentTime = 0; sampleRate = 22050; destination = new FakeNode(); sources: FakeSrc[] = []; resumed = 0; suspended = 0;
  async resume(): Promise<void> { this.state = "running"; this.resumed++; }
  async suspend(): Promise<void> { this.state = "suspended"; this.suspended++; }
  createGain(): FakeGain { return new FakeGain(); }
  createStereoPanner(): FakeNode & { pan: FakeParam } { return Object.assign(new FakeNode(), { pan: new FakeParam(0) }); }
  createBiquadFilter(): FakeNode & { type: string; frequency: FakeParam } { return Object.assign(new FakeNode(), { type: "", frequency: new FakeParam(20000) }); }
  createDynamicsCompressor(): FakeNode { return new FakeNode(); }
  createBuffer(_c: number, len: number, sr: number): { length: number; sampleRate: number; getChannelData(): Float32Array } { const d = new Float32Array(len); return { length: len, sampleRate: sr, getChannelData: () => d }; }
  createBufferSource(): FakeSrc { const s = new FakeSrc(); this.sources.push(s); return s; }
  createMediaElementSource(): FakeNode { return new FakeNode(); }
  decodeAudioData(_b: ArrayBuffer, ok: (b: unknown) => void): void { ok(this.createBuffer(1, 10, 22050)); }
}
export const memStorage = (): Pick<Storage, "getItem" | "setItem"> & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };
