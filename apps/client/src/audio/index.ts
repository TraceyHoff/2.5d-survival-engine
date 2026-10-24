/** ADR-117 audio facade: mixer + gameplay director + ambience + adaptive music, driven once per rendered frame. */
import type { World, Entity } from "@engine/core";
import { Weather } from "@engine/core";
import { AudioMixer, type MixerDeps } from "./mixer.js";
import { AudioDirector } from "./events.js";
import { AmbienceDirector, daylight } from "./ambience.js";
import { MusicDriver, type MusicMode } from "./music.js";
import { LoopSet } from "./loops.js";
import { snapshotWorld } from "./snapshot.js";
import bankJson from "./bank.json";
import type { SoundBankJson } from "./bank.js";
export { AudioMixer } from "./mixer.js";
export { BUSES, type BusName } from "./bank.js";

/** Commonly heard one-shots to decode up front (placeholders synthesize instantly anyway). */
const PRELOAD = ["ui.click", "ui.hover", "ui.open", "ui.close", "footstep.grass", "footstep.dirt", "footstep.sand", "combat.swing.fists", "combat.hit", "item.pickup"];
export class AudioSystem {
  readonly mixer: AudioMixer; private director = new AudioDirector(); private amb = new AmbienceDirector(); private music: MusicDriver; private loops: LoopSet; private ambLoops: LoopSet;
  private last = 0; driving = false; maxEventsPerFrame = 12;
  constructor(deps: MixerDeps = {}) {
    this.mixer = new AudioMixer(bankJson as unknown as SoundBankJson, deps);
    this.music = new MusicDriver(this.mixer); this.loops = new LoopSet(this.mixer); this.ambLoops = new LoopSet(this.mixer, 1.2);
  }
  start(target?: EventTarget): void { this.mixer.installUnlock(target); this.mixer.preload(PRELOAD); }
  ui(key: string): void { this.mixer.play(key); }
  /** Per frame. mode "menu" = main menu (menu theme only), "game" = in world. */
  frame(w: World | undefined, local: Entity | undefined, tiles: { getTile(x: number, y: number): number } | undefined, dayFrac: number | undefined, mode: MusicMode, nowSec: number): void {
    const dt = this.last ? Math.min(0.25, Math.max(0, nowSec - this.last)) : 0; this.last = nowSec;
    if (!this.mixer.running) return;
    const night = dayFrac !== undefined && daylight(dayFrac) < 0.5;
    if (mode !== "game" || !w || local === undefined) { this.loops.clear(); this.ambLoops.clear(); this.music.step({ mode, night, threat: 0, dt }); return; }
    const s = snapshotWorld(w, local, tiles); this.driving = s.driving;
    this.mixer.setListener(s.listener, s.indoors);
    const { events, loops } = this.director.step(s.ents, { now: nowSec, listener: s.listener });
    let n = 0; for (const e of events) { if (n++ >= this.maxEventsPerFrame) break; this.mixer.play(e.key, { ...(e.pos ? { pos: e.pos } : {}), ...(e.indoors !== undefined ? { indoors: e.indoors } : {}), ...(e.gain !== undefined ? { gain: e.gain } : {}) }); }
    this.loops.sync(loops);
    let wx = { kind: 0, intensity: 0, windSpeed: 0 }; try { const e = w.env(Weather) as unknown as typeof wx; wx = e; } catch { /* no weather */ }
    const a = this.amb.step({ dayFrac: dayFrac ?? 0.5, weather: wx.kind, intensity: wx.intensity, windSpeed: wx.windSpeed, indoors: s.indoors, biome: s.biome, dt, inGame: true });
    this.ambLoops.sync(a.loops); for (const e of a.events) this.mixer.play(e.key, { ...(e.gain !== undefined ? { gain: e.gain } : {}) });
    this.music.step({ mode, night, threat: s.threat, dt });
    this.mixer.tick();
  }
  /** Local horn (no horn flag is replicated; ADR-117). */
  horn(): void { this.mixer.play("vehicle.horn"); }
  stopWorld(): void { this.loops.clear(); this.ambLoops.clear(); }
}
