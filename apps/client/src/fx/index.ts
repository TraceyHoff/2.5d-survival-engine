/**
 * ADR-214 VFX layer mount: one pooled particle system + screen cues for both renderers. Runs after the renderer each
 * frame (camera already placed), reads the replicated world + the audio director's per-frame events, and drives two
 * renderer knobs: the view camera's shake offset (pre-render) and the renderer's effect clock (hit-stop). Neither
 * touches the sim, input or zoom.
 */
import { Weather, type World, type Entity } from "@engine/core";
import { computeDayLighting, newDayLighting, readDayNumber } from "@engine/render";
import type { SoundEvent } from "../audio/events.js";
import type { WorldAudioState } from "../audio/snapshot.js";
import { Fx } from "./effects.js";
import { FxDirector, type FxView, type FxFrame } from "./director.js";
import { FxDraw, type DrawEnv } from "./draw.js";
import { loadFx, resolveFx, particleBudget, FX_SETTINGS_KEY, type FxResolved, type FxSettings } from "./settings.js";

export { loadFx, saveFx, DEFAULT_FX, FX_SETTINGS_KEY, type FxSettings } from "./settings.js";
/** Desktop look: 2048-slot pool, 1400 live particles at the high tier. */
const CAPACITY = 2048, BASE_BUDGET = 1400;
/** ADR-214 console profile (Xbox Edge, ADR-212 memory budget): half the pool/budget and a 720p overlay backing store
 * (soft sprites upscale invisibly); same effects, same palette, PC untouched. */
export const FX_CONSOLE = { capacity: 1024, budget: 800, maxPixels: 1280 * 720 } as const;

interface CamFull { x: number; y: number; drawZoom: number; viewW: number; viewH: number; dpr: number }
interface RendererLike {
  readonly kind?: string; camera: CamFull; timeScale?: number; indoor?: { active?: boolean } | unknown;
  quality?: { tier: { particles: number } }; lighting?: { ambient: readonly number[]; fog: readonly number[]; daylight: number; sunElevation: number };
}
export interface FxDeps {
  world(): World; player(): Entity | undefined; renderer(): RendererLike | undefined;
  view(): { camShake: { x: number; y: number } } | undefined;
  audio(): { lastSnap: WorldAudioState | undefined; lastEvents: readonly SoundEvent[] } | undefined;
  ground(x: number, y: number, z: number): number; tile(x: number, y: number): number;
  hidden(): boolean; lowEnd?: boolean; /** ADR-212 console memory profile */ console?: boolean;
}
export interface FxStats { active: number; peak: number; dropped: number; stolen: number; spawned: number; drawn: number; ms: number; budget: number; on: boolean;
  /** canvas backing-store bytes owned by the layer (overlay + 2 atlases + baked sources); constant after warm-up */ texBytes: number }
export interface FxHandle {
  readonly fx: Fx; readonly director: FxDirector; readonly stats: FxStats;
  /** Before iso.render: camera shake offset + renderer effect clock. */ pre(): void;
  /** After iso.render: simulate + draw. */ draw(dayFrac: number): void;
  settings(): FxSettings; apply(s?: FxSettings): void; dispose(): void;
}

export function mountFx(root: HTMLElement, d: FxDeps): FxHandle {
  const cap = d.console ? FX_CONSOLE.capacity : CAPACITY, base = d.console ? FX_CONSOLE.budget : BASE_BUDGET;
  const fx = new Fx(cap, base), director = new FxDirector(fx), painter = new FxDraw(root, d.console ? FX_CONSOLE.maxPixels : undefined);
  const stats: FxStats = { active: 0, peak: 0, dropped: 0, stolen: 0, spawned: 0, drawn: 0, ms: 0, budget: base, on: true, texBytes: 0 };
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : undefined;
  let warm = false, wasHidden = false, settings = loadFx(), res: FxResolved = resolveFx(settings, !!mq?.matches), tierP = -1, last = -1, ema = 0, texTick = 0;
  const day = newDayLighting(), view: FxView = { x0: 0, y0: 0, x1: 0, y1: 0 }, weather = { kind: 0, intensity: 0, windDir: 0, windSpeed: 0 };
  // Zero per-frame allocation: the director frame and draw env are two long-lived objects mutated in place.
  const NO_EVENTS: readonly SoundEvent[] = [], NO_LIGHT: readonly number[] = [1, 1, 1];
  const frame: FxFrame = { world: d.world(), local: undefined, snap: undefined, events: NO_EVENTS, dt: 0, daylight: 1, sunElev: 0, indoors: false,
    ground: d.ground, tile: d.tile, view, weather, ambient: true };
  const env: DrawEnv = { cam: { x: 0, y: 0, drawZoom: 1 }, w: 1, h: 1, dpr: 1, time: 0, ambient: NO_LIGHT, fog: NO_LIGHT, daylight: 1, canvasFallback: false, weather, indoors: false,
    glows: director.glows, glowCount: 0, vignette: true, flicker: true };
  const apply = (s?: FxSettings): void => {
    if (s) settings = s; res = resolveFx(settings, !!mq?.matches);
    fx.density = res.density; fx.shakeScale = res.shake; fx.hitStopOn = res.hitStop; fx.flickerOn = res.flicker;
    if (!res.on) { fx.pool.clear(); painter.canvas.style.display = "none"; painter.shrink(); } else painter.canvas.style.display = "";
    tierP = -1; stats.on = res.on;
  };
  apply();
  const onMq = (): void => apply(); mq?.addEventListener?.("change", onMq);
  const onStorage = (e: StorageEvent): void => { if (e.key === FX_SETTINGS_KEY) apply(loadFx()); }; addEventListener("storage", onStorage);

  const pre = (): void => {
    const r = d.renderer(), v = d.view(); if (!r || !v) return;
    if (!res.on) { v.camShake.x = 0; v.camShake.y = 0; if (r.timeScale !== undefined) r.timeScale = 1; return; }
    // shake: CSS px -> iso px -> tile offset (inverse of worldToScreen at z = 0)
    const z = r.camera.drawZoom || 1, sx = fx.shakeX / z, sy = fx.shakeY / z;
    v.camShake.x = (sx / 32 + sy / 16) / 2; v.camShake.y = (sy / 16 - sx / 32) / 2;
    if (r.timeScale !== undefined) r.timeScale = fx.timeScale;
  };
  const draw = (dayFrac: number): void => {
    const t0 = performance.now(), dtReal = last < 0 ? 1 / 60 : Math.min(0.1, (t0 - last) / 1000); last = t0;
    const r = d.renderer(), w = d.world(); if (!r || !res.on) return;
    const hidden = d.hidden(); if (hidden !== wasHidden) { wasHidden = hidden; painter.canvas.style.visibility = hidden ? "hidden" : ""; if (hidden) painter.shrink(); }
    const tp = r.quality?.tier.particles ?? (d.lowEnd ? 0.5 : 1);
    if (tp !== tierP) { tierP = tp; fx.pool.budget = stats.budget = particleBudget(base, tp, res.density, cap); }
    const fallback = r.kind === "canvas2d";
    const lit = r.lighting ?? computeDayLighting(dayFrac, readDayNumber(w), day);
    if (w.isAlive(w.environment) && w.has(w.environment, Weather)) { const e = w.environment;
      weather.kind = w.getField(e, Weather, "kind") ?? 0; weather.intensity = w.getField(e, Weather, "intensity") ?? 0; weather.windDir = w.getField(e, Weather, "windDir") ?? 0; weather.windSpeed = w.getField(e, Weather, "windSpeed") ?? 0; }
    else { weather.kind = 0; weather.intensity = 0; weather.windSpeed = 0; }
    const cam = r.camera, cw = cam.viewW / cam.dpr, ch = cam.viewH / cam.dpr;
    { // visible world rect = bounds of the 4 screen corners through the inverse iso projection (32x16 tiles), allocation-free
      const z = cam.drawZoom || 1, A = cw / 2 / z / 16, B = ch / 2 / z / 8, a0 = cam.x / 16, b0 = cam.y / 8, hx = (A + B) / 2;
      const mx = (a0 + b0) / 2, my = (b0 - a0) / 2; view.x0 = mx - hx; view.x1 = mx + hx; view.y0 = my - hx; view.y1 = my + hx; }
    const au = d.audio(), indoors = !!(r.indoor as { active?: boolean } | undefined)?.active || !!au?.lastSnap?.indoors;
    const sdt = fx.step(dtReal);
    frame.world = w; frame.local = d.player(); frame.snap = au?.lastSnap; frame.events = au?.lastEvents ?? NO_EVENTS; frame.dt = dtReal; frame.daylight = lit.daylight;
    frame.sunElev = lit.sunElevation ?? 0; frame.indoors = indoors; frame.ambient = res.ambient && !hidden;
    director.step(frame);
    fx.pool.shedAmbient = ema > 2; // governor: ambient life yields first if the layer gets expensive
    fx.pool.update(sdt);
    if (!hidden) { env.cam = cam; env.w = cw; env.h = ch; env.dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1); env.time = fx.time; env.ambient = lit.ambient; env.fog = lit.fog;
      env.daylight = lit.daylight; env.canvasFallback = fallback; env.indoors = indoors; env.glows = director.glows; env.glowCount = director.glowCount; env.vignette = res.vignette; env.flicker = res.flicker; }
    stats.drawn = hidden ? 0 : painter.draw(fx, env);
    if (!warm && !hidden && performance.now() - t0 < 4) warm = painter.prewarm(Math.max(lit.ambient[0] ?? 1, lit.ambient[1] ?? 1, lit.ambient[2] ?? 1), 12);
    const ms = performance.now() - t0; ema = ema ? ema * 0.95 + ms * 0.05 : ms;
    const s = fx.pool.stats; stats.active = s.active; stats.peak = s.peak; stats.dropped = s.dropped; stats.stolen = s.stolen; stats.spawned = s.spawned; stats.ms = ema;
    if ((++texTick & 63) === 0) stats.texBytes = painter.texBytes();
  };
  return { fx, director, stats, pre, draw, settings: () => settings, apply,
    dispose: () => { mq?.removeEventListener?.("change", onMq); removeEventListener("storage", onStorage); painter.dispose(); } };
}
