import { logRecoverable } from "../error-log.js";
/**
 * ADR-117 Web Audio mixer: buses master <- {music, ambient, sfx, ui, voice}, per-bus volume/mute (persisted), unlock
 * on first user gesture (mobile / iOS / console browsers), suspend while hidden or paused, voice limits with
 * priority stealing, pooled node chains, decoded buffers for SFX + streamed media elements for music, procedural
 * placeholders for anything without a decodable file, and a low-CPU mode (fewer voices, no filters/compressor,
 * 22 kHz placeholders). Missing keys and every WebAudio failure are silent.
 */
import { BUSES, playableFormats, SoundBank, type BusName, type Resolved, type SoundBankJson } from "./bank.js";
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from "./settings.js";
import { spatialize, OPEN_HZ, type Vec2 } from "./spatial.js";
import { synthesize } from "./synth.js";

type Ctx = AudioContext;
export interface PlayOpts { pos?: Vec2; indoors?: boolean; gain?: number; pitch?: number; maxDist?: number; delay?: number }
export interface MixerDeps {
  createContext?: () => Ctx | undefined; fetchBytes?: (url: string) => Promise<ArrayBuffer>; canPlay?: (mime: string) => string;
  createMedia?: (url: string) => HTMLAudioElement | undefined; storage?: Pick<Storage, "getItem" | "setItem">; lowEnd?: boolean; base?: string; rng?: () => number;
}
interface Chain { gain: GainNode; pan: StereoPannerNode | undefined; filter: BiquadFilterNode | undefined }
interface Voice { id: number; key: string; bus: Exclude<BusName, "master">; priority: number; started: number; loop: boolean; src: AudioBufferSourceNode | undefined; media?: HTMLAudioElement | undefined; mediaNode?: MediaElementAudioSourceNode | undefined; chain: Chain; baseGain: number; ended: boolean; opts: PlayOpts }

const setP = (p: AudioParam | undefined, v: number, t: number, tc = 0.03): void => { if (!p) return; try { if (p.setTargetAtTime) p.setTargetAtTime(v, t, tc); else p.value = v; } catch { p.value = v; } };

export class AudioMixer {
  readonly bank: SoundBank;
  settings: AudioSettings;
  ctx: Ctx | undefined;
  readonly buses = new Map<BusName, GainNode>();
  /** Outdoor-bed lowpass on the ambient bus (weather/biome beds muffle when the listener is under a roof). */
  outdoorBed: BiquadFilterNode | undefined; private outdoorIn: GainNode | undefined;
  unlocked = false; private suspendReasons = new Set<string>();
  readonly voices: Voice[] = []; private pool: Chain[] = []; private nextId = 1;
  private buffers = new Map<string, AudioBuffer | null | Promise<AudioBuffer | null>>();
  listener: Vec2 = { x: 0, y: 0 }; indoors = false;
  constructor(json: SoundBankJson, private deps: MixerDeps = {}) {
    this.settings = loadAudioSettings(deps.storage);
    this.bank = new SoundBank(json, json.formats, deps.rng);
    this.bank.setFormats(playableFormats(json.formats, deps.canPlay ?? ((m) => { try { return document.createElement("audio").canPlayType(m); } catch { return ""; } })));
  }
  get lowCpu(): boolean { return this.settings.lowCpu === "on" || (this.settings.lowCpu === "auto" && !!this.deps.lowEnd); }
  get maxVoices(): number { return this.lowCpu ? 12 : 32; }
  get running(): boolean { return this.ctx?.state === "running"; }

  /** Create the graph lazily (inside a gesture handler on iOS), then resume. Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const C = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
        this.ctx = this.deps.createContext ? this.deps.createContext() : C.AudioContext ? new C.AudioContext({ latencyHint: "interactive" }) : C.webkitAudioContext ? new C.webkitAudioContext() : undefined;
        if (!this.ctx) return; this.build();
      }
      if (this.suspendReasons.size === 0) void this.ctx.resume?.().catch((e: unknown) => logRecoverable("audio context resume", e));
      // iOS: a (silent) buffer started inside the gesture fully unlocks output
      try { const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate || 22050); const s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0); } catch { /* ignore */ }
      this.unlocked = true;
    } catch { /* no audio */ }
  }
  /** Install one-shot unlock listeners for the first pointer / touch / key gesture (gamepads: pollGamepadUnlock). */
  installUnlock(target: Pick<EventTarget, "addEventListener" | "removeEventListener"> = globalThis as unknown as EventTarget): () => void {
    const evs = ["pointerdown", "touchend", "mousedown", "keydown", "click"];
    const h = (): void => { this.unlock(); if (this.unlocked) for (const e of evs) target.removeEventListener(e, h, true); };
    for (const e of evs) target.addEventListener(e, h, true);
    return () => { for (const e of evs) target.removeEventListener(e, h, true); };
  }
  /** Gamepad button press counts as a gesture on console browsers. */
  pollGamepadUnlock(pads: readonly ({ buttons: readonly { pressed: boolean }[] } | null)[] | undefined): void {
    if (this.unlocked || !pads) return; if (pads.some((p) => p?.buttons.some((b) => b.pressed))) this.unlock();
  }
  setSuspended(reason: string, on: boolean): void {
    if (on) this.suspendReasons.add(reason); else this.suspendReasons.delete(reason);
    if (!this.ctx) return;
    try { if (this.suspendReasons.size) void this.ctx.suspend?.().catch(() => undefined); else if (this.unlocked) void this.ctx.resume?.().catch((e: unknown) => logRecoverable("audio context resume", e)); } catch { /* ignore */ }
    for (const v of this.voices) if (v.media) { try { if (this.suspendReasons.size) v.media.pause(); else void v.media.play().catch((e: unknown) => logRecoverable("audio resume", e)); } catch { /* ignore */ } }
  }
  get suspended(): boolean { return this.suspendReasons.size > 0; }

  private build(): void {
    const c = this.ctx!; const master = c.createGain(); this.buses.set("master", master);
    let out: AudioNode = master;
    if (!this.lowCpu && c.createDynamicsCompressor) { const comp = c.createDynamicsCompressor(); master.connect(comp); out = comp; }
    out.connect(c.destination);
    for (const b of BUSES) if (b !== "master") { const g = c.createGain(); g.connect(master); this.buses.set(b, g); }
    this.outdoorIn = c.createGain();
    if (!this.lowCpu) { this.outdoorBed = c.createBiquadFilter(); this.outdoorBed.type = "lowpass"; this.outdoorBed.frequency.value = OPEN_HZ; this.outdoorIn.connect(this.outdoorBed); this.outdoorBed.connect(this.buses.get("ambient")!); }
    else this.outdoorIn.connect(this.buses.get("ambient")!);
    this.applyVolumes();
  }
  /** Effective bus gain (0 when the bus or master is muted is handled by the master node itself). */
  busLevel(b: BusName): number { return this.settings.muted[b] ? 0 : this.settings.volume[b]; }
  applyVolumes(): void { const t = this.ctx?.currentTime ?? 0; for (const b of BUSES) setP(this.buses.get(b)?.gain, this.busLevel(b), t, 0.02); }
  setVolume(b: BusName, v: number): void { this.settings.volume[b] = Math.max(0, Math.min(1, v)); this.applyVolumes(); saveAudioSettings(this.settings, this.deps.storage); }
  setMuted(b: BusName, m: boolean): void { this.settings.muted[b] = m; this.applyVolumes(); saveAudioSettings(this.settings, this.deps.storage); }
  setSettings(s: AudioSettings): void { this.settings = s; this.applyVolumes(); saveAudioSettings(s, this.deps.storage); }
  setListener(pos: Vec2, indoors: boolean): void {
    this.listener = pos; this.indoors = indoors;
    if (this.outdoorBed && this.ctx) setP(this.outdoorBed.frequency, indoors ? 700 : OPEN_HZ, this.ctx.currentTime, 0.25);
  }

  // ---- buffers ----
  private bufKey(r: Resolved): string { return `${r.key}#${r.variant}`; }
  /** Decoded buffer for a resolved sound: file (format fallbacks) -> procedural placeholder. null = unavailable. */
  buffer(r: Resolved): AudioBuffer | null | undefined {
    const k = this.bufKey(r); const hit = this.buffers.get(k);
    if (hit !== undefined && !(hit instanceof Promise)) return hit;
    if (hit instanceof Promise) return undefined;
    if (r.variant < 0) { const b = this.synthBuffer(r); this.buffers.set(k, b); return b; }
    const p = this.loadFile(r).then((b) => { const v = b ?? this.synthBuffer(r); this.buffers.set(k, v); return v; });
    this.buffers.set(k, p); return undefined;
  }
  private async loadFile(r: Resolved): Promise<AudioBuffer | null> {
    const c = this.ctx; if (!c) return null;
    const fetchBytes = this.deps.fetchBytes ?? (async (u: string) => { const res = await fetch(u); if (!res.ok) throw new Error(String(res.status)); return res.arrayBuffer(); });
    let last: unknown;
    for (const u of r.urls) { try { const bytes = await fetchBytes(u); return await new Promise<AudioBuffer>((ok, bad) => { const p = c.decodeAudioData(bytes, ok, bad); if (p && typeof (p as Promise<AudioBuffer>).then === "function") (p as Promise<AudioBuffer>).then(ok, bad); }); } catch (e) { last = e; /* next format */ } }
    if (r.urls.length) logRecoverable(`audio decode ${r.urls[0]}`, last); // ADR-201: every format failed (falls back to synth / silence)
    return null;
  }
  private synthBuffer(r: Resolved): AudioBuffer | null {
    const c = this.ctx; const spec = r.def.synth; if (!c || !spec) return null;
    try { const sr = this.lowCpu ? 22050 : Math.min(44100, c.sampleRate || 44100); const data = synthesize(spec, sr, Math.max(0, r.variant)); const b = c.createBuffer(1, data.length, sr); b.getChannelData(0).set(data); return b; } catch { return null; }
  }
  /** Warm the decoded cache for the given keys (all variants). */
  preload(keys: readonly string[]): void { for (const k of keys) { const h = this.bank.lookup(k); if (!h) continue; const n = Math.max(1, h.def.files?.length ?? 0);
    for (let i = 0; i < n; i++) this.buffer({ key: h.key, def: h.def, variant: h.def.files?.length ? i : -1, urls: h.def.files?.length ? this.bank.urlsFor(h.def.files[i]!, this.deps.base ?? "") : [], pitch: 1, gain: 1 }); } }

  // ---- voices ----
  private chain(): Chain {
    const c = this.ctx!; const p = this.pool.pop(); if (p) return p;
    const gain = c.createGain(); let pan: StereoPannerNode | undefined; let filter: BiquadFilterNode | undefined;
    if (c.createStereoPanner) { pan = c.createStereoPanner(); pan.connect(gain); }
    if (!this.lowCpu) { filter = c.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = OPEN_HZ; filter.connect(pan ?? gain); }
    return { gain, pan, filter };
  }
  private release(v: Voice): void {
    if (v.ended) return; v.ended = true;
    try { v.src?.stop(); } catch { /* already */ } try { v.src?.disconnect(); } catch { /* */ }
    if (v.media) { try { v.media.onerror = null; v.media.onended = null; v.media.pause(); v.media.removeAttribute?.("src"); v.media.load?.(); } catch { /* */ } try { v.mediaNode?.disconnect(); } catch { /* */ } }
    try { v.chain.gain.disconnect(); } catch { /* */ }
    if (this.pool.length < 48) this.pool.push(v.chain);
    const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1);
  }
  /** Admission: per-key limit (steal oldest of the key), then global limit (steal lowest priority, oldest first). */
  private admit(key: string, priority: number, perKey: number): boolean {
    const same = this.voices.filter((v) => v.key === key && !v.loop);
    if (same.length >= perKey) this.release(same[0]!);
    if (this.voices.length < this.maxVoices) return true;
    let victim: Voice | undefined; for (const v of this.voices) if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.started < victim.started)) victim = v;
    if (!victim || victim.priority > priority) return false;
    this.release(victim); return true;
  }
  private spatial(v: { opts: PlayOpts; def?: { maxDist?: number | undefined } }): { gain: number; pan: number; hz: number } {
    if (!v.opts.pos) return { gain: 1, pan: 0, hz: OPEN_HZ };
    const s = spatialize(v.opts.pos, this.listener, { maxDist: v.opts.maxDist ?? v.def?.maxDist ?? 18, indoors: this.indoors, sourceIndoors: v.opts.indoors ?? false });
    return { gain: s.gain, pan: s.pan, hz: s.lowpassHz };
  }
  /** Play an event key. Returns a voice id (0 = dropped: missing key, locked, inaudible, over budget or loading). */
  play(key: string, opts: PlayOpts = {}): number {
    if (!this.ctx || !this.unlocked || this.suspended) return 0;
    const r = this.bank.resolve(key, this.deps.base ?? ""); if (!r) return 0;
    const sp = this.spatial({ opts, def: r.def }); if (sp.gain <= 0.005) return 0;
    if (r.def.stream && r.variant >= 0) return this.playStream(r, opts);
    const buf = this.buffer(r); if (!buf) return 0;
    if (!this.admit(r.key, r.def.priority, this.lowCpu ? Math.max(1, Math.ceil(r.def.maxVoices / 2)) : r.def.maxVoices)) return 0;
    try {
      const c = this.ctx; const chain = this.chain(); const src = c.createBufferSource(); src.buffer = buf; src.loop = r.def.loop;
      src.playbackRate.value = r.pitch * (opts.pitch ?? 1);
      src.connect(chain.filter ?? chain.pan ?? chain.gain);
      chain.gain.connect(r.def.loop && r.def.bus === "ambient" && !opts.pos ? this.outdoorIn! : this.buses.get(r.def.bus)!);
      const v: Voice = { id: this.nextId++, key: r.key, bus: r.def.bus, priority: r.def.priority, started: c.currentTime, loop: r.def.loop, src, chain, baseGain: r.gain * (opts.gain ?? 1), ended: false, opts };
      this.applySpatial(v, true);
      src.onended = () => this.release(v);
      src.start(c.currentTime + (opts.delay ?? 0)); this.voices.push(v); return v.id;
    } catch { return 0; }
  }
  private playStream(r: Resolved, opts: PlayOpts): number {
    const c = this.ctx!; const url = r.urls[0]; if (!url) return 0;
    const media = this.deps.createMedia ? this.deps.createMedia(url) : (() => { try { const a = new Audio(); a.crossOrigin = "anonymous"; a.preload = "auto"; a.src = url; return a; } catch { return undefined; } })();
    if (!media) return 0;
    try {
      media.loop = r.def.loop; const node = c.createMediaElementSource(media); const chain = this.chain(); node.connect(chain.gain); chain.gain.connect(this.buses.get(r.def.bus)!);
      // try the fallback formats if the first one fails to load
      let i = 0; media.onerror = () => { i++; if (i < r.urls.length) { media.src = r.urls[i]!; void media.play().catch((e: unknown) => logRecoverable("audio play", e)); } };
      const v: Voice = { id: this.nextId++, key: r.key, bus: r.def.bus, priority: r.def.priority, started: c.currentTime, loop: r.def.loop, src: undefined, media, mediaNode: node, chain, baseGain: r.gain * (opts.gain ?? 1), ended: false, opts };
      media.onended = () => this.release(v); this.applySpatial(v, true); void media.play().catch((e: unknown) => logRecoverable("audio play", e)); this.voices.push(v); return v.id;
    } catch { return 0; }
  }
  private applySpatial(v: Voice, now = false): void {
    const t = this.ctx?.currentTime ?? 0; const sp = this.spatial(v);
    const g = v.baseGain * sp.gain; if (now) v.chain.gain.gain.value = g; else setP(v.chain.gain.gain, g, t, 0.05);
    if (v.chain.pan) { if (now) v.chain.pan.pan.value = sp.pan; else setP(v.chain.pan.pan, sp.pan, t, 0.05); }
    if (v.chain.filter) setP(v.chain.filter.frequency, sp.hz, t, 0.1);
  }
  voice(id: number): Voice | undefined { return this.voices.find((v) => v.id === id); }
  /** Update a live voice (loops: position, gain multiplier, pitch e.g. engine RPM). */
  update(id: number, o: { pos?: Vec2; gain?: number; pitch?: number; indoors?: boolean }): void {
    const v = this.voice(id); if (!v) return;
    if (o.pos) v.opts.pos = o.pos; if (o.indoors !== undefined) v.opts.indoors = o.indoors;
    if (o.gain !== undefined) { const r = this.bank.lookup(v.key); v.baseGain = (r?.def.volume ?? 1) * o.gain; }
    if (o.pitch !== undefined && v.src && this.ctx) setP(v.src.playbackRate, o.pitch, this.ctx.currentTime, 0.08);
    this.applySpatial(v);
  }
  stop(id: number, fade = 0.3): void {
    const v = this.voice(id); if (!v) return; const c = this.ctx;
    if (!c || fade <= 0) { this.release(v); return; }
    setP(v.chain.gain.gain, 0, c.currentTime, fade / 3); v.loop = false; v.priority = -1;
    setTimeout(() => this.release(v), fade * 1000 + 50);
  }
  /** Re-spatialize every positional voice (call each frame after setListener). */
  tick(): void { for (const v of this.voices) if (v.opts.pos) this.applySpatial(v); }
  stopAll(): void { for (const v of [...this.voices]) this.release(v); }
}
