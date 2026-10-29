import { describe, expect, it } from "vitest";
import { World, Transform } from "@engine/core";
import { applyDamage, defaultDefs, installGameplay, spawnZombie } from "@engine/gameplay";
import { ParticlePool, PF, Shape } from "../src/fx/pool.js";
import { DEFAULT_FX, FX_SETTINGS_KEY, loadFx, normalizeFx, particleBudget, resolveFx, saveFx } from "../src/fx/settings.js";
import { Fx } from "../src/fx/effects.js";
import { FxDirector, type FxFrame } from "../src/fx/director.js";
import { FxDraw, FX_MAX_PIXELS, fxScale } from "../src/fx/draw.js";

const sp = (p: ParticlePool, flags = 0, life = 1): number => p.spawn(Shape.Spark, 0, flags, 0, 0, 1, 0, 0, 0, 0, life, 1, 1, 1);
const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

describe("ADR-214 particle pool", () => {
  it("never grows: fixed typed arrays, budget caps live particles, non-priority overflow is dropped", () => {
    const p = new ParticlePool(64, 10); const arr = p.px;
    for (let i = 0; i < 30; i++) sp(p);
    expect(p.count).toBe(10); expect(p.stats.dropped).toBe(20); expect(p.px).toBe(arr); expect(p.px.length).toBe(64);
  });
  it("priority spawns steal a slot when full instead of being lost", () => {
    const p = new ParticlePool(16, 4); for (let i = 0; i < 4; i++) sp(p);
    const i = sp(p, PF.Prio); expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThan(4); expect(p.count).toBe(4); expect(p.stats.stolen).toBe(1);
  });
  it("ambient spawns stop at 60% of the budget and whenever the governor sheds them", () => {
    const p = new ParticlePool(100, 10); for (let i = 0; i < 10; i++) sp(p, PF.Ambient);
    expect(p.count).toBe(6); sp(p); expect(p.count).toBe(7);
    const q = new ParticlePool(100, 10); q.shedAmbient = true; expect(sp(q, PF.Ambient)).toBe(-1); expect(sp(q)).toBe(0);
  });
  it("update swap-removes dead particles and keeps survivors' data intact", () => {
    const p = new ParticlePool(8); sp(p, 0, 0.1); const j = p.spawn(Shape.Glow, 3, 0, 5, 6, 1, 0, 0, 0, 0, 2, 1, 1, 1); sp(p, 0, 0.1);
    expect(j).toBe(1); p.update(0.2); expect(p.count).toBe(1); expect(p.px[0]).toBe(5); expect(p.color[0]).toBe(3);
  });
  it("lowering the budget kills the excess; gravity particles land on their floor", () => {
    const p = new ParticlePool(32); for (let i = 0; i < 20; i++) sp(p); p.budget = 5; expect(p.count).toBe(5);
    const q = new ParticlePool(4); q.spawn(Shape.Drop, 0, 0, 0, 0, 2, 0.5, 0, 0, 0, 5, 1, 1, 1, 0, 20); for (let i = 0; i < 30; i++) q.update(1 / 30);
    expect(q.pz[0]).toBeCloseTo(0.5, 5);
  });
  it("budget scales with the device tier and density but the default (high tier, full) is the full look", () => {
    expect(particleBudget(1400, 1, 1, 2048)).toBe(1400); expect(particleBudget(1400, 1.25, 1, 2048)).toBe(1750);
    expect(particleBudget(1400, 0.5, 1, 2048)).toBe(700); expect(particleBudget(1400, 1, 0.5, 2048)).toBe(700);
    expect(particleBudget(1400, 1, 0, 2048)).toBe(0); expect(particleBudget(4000, 2, 1, 2048)).toBe(2048);
  });
});

describe("ADR-214 settings", () => {
  it("defaults are the full look; garbage normalizes to defaults; round-trips through storage", () => {
    expect(DEFAULT_FX).toEqual({ effects: "full", shake: true, hitStop: true, reduceMotion: "auto", ambient: true, vignette: true });
    expect(normalizeFx({ effects: "ultra", shake: "yes" })).toEqual(DEFAULT_FX);
    const s = memStore(); expect(loadFx(s)).toEqual(DEFAULT_FX);
    saveFx({ ...DEFAULT_FX, effects: "reduced", shake: false }, s); expect(JSON.parse(s.m.get(FX_SETTINGS_KEY)!).effects).toBe("reduced");
    expect(loadFx(s)).toMatchObject({ effects: "reduced", shake: false, hitStop: true });
    s.m.set(FX_SETTINGS_KEY, "{not json"); expect(loadFx(s)).toEqual(DEFAULT_FX);
  });
  it("toggles resolve: off disables everything, reduced halves density, reduce-motion (auto/on) removes shake, hit-stop and flicker", () => {
    expect(resolveFx(DEFAULT_FX, false)).toMatchObject({ on: true, density: 1, shake: 1, hitStop: true, flicker: true, ambient: true, vignette: true });
    expect(resolveFx({ ...DEFAULT_FX, effects: "off" }, false)).toMatchObject({ on: false, density: 0, shake: 0, hitStop: false, ambient: false, vignette: false });
    expect(resolveFx({ ...DEFAULT_FX, effects: "reduced" }, false).density).toBe(0.5);
    const calm = resolveFx(DEFAULT_FX, true); expect(calm).toMatchObject({ calm: true, shake: 0, hitStop: false, flicker: false, density: 1 });
    expect(resolveFx({ ...DEFAULT_FX, reduceMotion: "off" }, true).shake).toBe(1);
    expect(resolveFx({ ...DEFAULT_FX, reduceMotion: "on" }, false).hitStop).toBe(false);
    expect(resolveFx({ ...DEFAULT_FX, shake: false }, false).shake).toBe(0); expect(resolveFx({ ...DEFAULT_FX, ambient: false }, false).ambient).toBe(false);
  });
});

describe("ADR-214 effects state", () => {
  it("hit-stop slows effect time briefly (capped) and is a no-op when disabled", () => {
    const fx = new Fx(); fx.hitStop(1); expect(fx.step(0.016)).toBeCloseTo(0.016 * 0.12, 6);
    for (let i = 0; i < 10; i++) fx.step(0.016); expect(fx.timeScale).toBe(1);
    const off = new Fx(); off.hitStopOn = false; off.hitStop(0.05); expect(off.step(0.016)).toBeCloseTo(0.016, 6);
  });
  it("shake decays and is zero when shake is off", () => {
    const fx = new Fx(); fx.shake(1); fx.step(0.016); expect(Math.hypot(fx.shakeX, fx.shakeY)).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) fx.step(0.016); expect(Math.abs(fx.shakeX)).toBe(0);
    const off = new Fx(); off.shakeScale = 0; off.shake(1); off.step(0.016); expect(Math.abs(off.shakeX) + Math.abs(off.shakeY)).toBe(0);
  });
  it("reduced density spawns fewer particles; impacts spawn without allocating new pool storage", () => {
    const fx = new Fx(256, 200); const arr = fx.pool.px; fx.impact(0, 0, 0, 0, "ichor", 1, true); expect(fx.pool.count).toBeGreaterThan(0); expect(fx.pool.px).toBe(arr);
    const full = new Fx(), half = new Fx(); half.density = 0.5; for (let i = 0; i < 20; i++) { full.impact(0, 0, 0, 0, "blood", 1, true); half.impact(0, 0, 0, 0, "blood", 1, true); }
    expect(half.pool.count).toBeLessThan(full.pool.count * 0.8);
  });
});

describe("ADR-214 director", () => {
  const frame = (w: World, extra: Partial<FxFrame> = {}): FxFrame => ({ world: w, local: undefined, snap: undefined, events: [], dt: 1 / 60, daylight: 1, sunElev: 50, indoors: false,
    ground: () => 0, tile: () => 3, view: { x0: -50, y0: -50, x1: 50, y1: 50 }, weather: { kind: 0, intensity: 0, windDir: 0, windSpeed: 0 }, ambient: false, ...extra });
  it("every sim hit is drawn at the victim (HitReact -> impact particles), after the seed frames", () => {
    const w = new World({ seed: 1, maxEntities: 1024 }); installGameplay(w, { defs: defaultDefs() } as never);
    const z = spawnZombie(w, "zombie_walker", 3, 3); const fx = new Fx(), d = new FxDirector(fx);
    for (let i = 0; i < 22; i++) d.step(frame(w)); expect(fx.pool.count).toBe(0);
    applyDamage(w, z, 5, undefined as never); d.step(frame(w));
    expect(fx.pool.count).toBeGreaterThan(0); const t = w.get(z, Transform)!; expect(Math.abs(fx.pool.px[0]! - t.x)).toBeLessThan(2);
  });
  it("sound events map to effects (footstep dust) and are ignored while seeding", () => {
    const w = new World({ seed: 2, maxEntities: 256 }); installGameplay(w, { defs: defaultDefs() } as never);
    const fx = new Fx(), d = new FxDirector(fx); const ev = { key: "footstep.grass", pos: { x: 1, y: 1 } };
    d.step(frame(w, { events: [ev] })); expect(fx.pool.count).toBe(0);
    for (let i = 0; i < 22; i++) d.step(frame(w)); d.step(frame(w, { events: [ev] })); expect(fx.pool.count).toBeGreaterThan(0);
  });
});

describe("ADR-214 memory (Xbox Edge budget)", () => {
  it("a long fight + ambient + weather run keeps every structure at a hard cap (pool storage identity, bounded maps)", () => {
    const w = new World({ seed: 3, maxEntities: 2048 }); installGameplay(w, { defs: defaultDefs() } as never);
    const zs = Array.from({ length: 60 }, (_, i) => spawnZombie(w, "zombie_walker", (i % 10) * 2, ((i / 10) | 0) * 2));
    const fx = new Fx(2048, 1400), d = new FxDirector(fx), arr = fx.pool.px, flags = fx.pool.flags;
    const evs = [{ key: "footstep.grass", pos: { x: 1, y: 1 } }, { key: "melee.swing", pos: { x: 2, y: 2 } }, { key: "explosion", pos: { x: 3, y: 3 } }];
    const f: FxFrame = { world: w, local: undefined, snap: undefined, events: evs, dt: 1 / 60, daylight: 0.2, sunElev: 5, indoors: false, ground: () => 0, tile: () => 3,
      view: { x0: -20, y0: -20, x1: 40, y1: 40 }, weather: { kind: 2, intensity: 1, windDir: 1, windSpeed: 4 }, ambient: true };
    let peak = 0;
    for (let i = 0; i < 3000; i++) {
      if (i % 3 === 0) for (let k = 0; k < zs.length; k += 7) if (w.isAlive(zs[k]!)) applyDamage(w, zs[k]!, 1, undefined as never);
      d.step(f); fx.pool.update(fx.step(1 / 60)); peak = Math.max(peak, fx.pool.count);
    }
    expect(fx.pool.px).toBe(arr); expect(fx.pool.flags).toBe(flags); expect(fx.pool.px.length).toBe(2048);
    expect(peak).toBeLessThanOrEqual(1400); expect(fx.pool.stats.spawned).toBeGreaterThan(1000);
    const m = d as unknown as Record<string, Map<unknown, unknown>>;
    for (const k of ["hits", "deaths", "byNet", "wakes", "sfx", "subK"]) expect(m[k]!.size, k).toBeLessThanOrEqual(1024);
  });
  it("overlay backing store is capped at ~1080p pixels at any window size / DPR", () => {
    expect(fxScale(1280, 720, 1)).toBe(1); expect(fxScale(1920, 1080, 1)).toBe(1);
    const s = fxScale(3840, 2160, 2); expect(3840 * s * 2160 * s).toBeLessThanOrEqual(FX_MAX_PIXELS + 1);
  });
  it("texture memory is constant after warm-up: two fixed atlases, re-tinted in place across day/night, 1x1 when hidden", () => {
    const g = globalThis as Record<string, unknown>, saved = { OffscreenCanvas: g.OffscreenCanvas, document: g.document };
    const ctx: unknown = new Proxy({}, { get: (_t, k) => (k === "createRadialGradient" || k === "createLinearGradient" ? () => ({ addColorStop() {} }) : () => undefined), set: () => true });
    class FakeCanvas { width: number; height: number; style: Record<string, string> = {}; id = ""; constructor(w = 300, h = 150) { this.width = w; this.height = h; } getContext() { return ctx; } remove() {} }
    let made = 0; g.OffscreenCanvas = class extends FakeCanvas { constructor(w: number, h: number) { super(w, h); made++; } };
    g.document = { createElement: () => new FakeCanvas() };
    try {
      const root = { appendChild() {} } as unknown as HTMLElement, draw = new FxDraw(root), fx = new Fx(2048, 1400);
      const env = { cam: { x: 0, y: 0, drawZoom: 1 }, w: 3840, h: 2160, dpr: 2, time: 0, ambient: [1, 1, 1] as number[], fog: [0.5, 0.5, 0.5], daylight: 1, canvasFallback: true,
        weather: { kind: 1, intensity: 1, windDir: 0 }, indoors: false, glows: new Float32Array(8), glowCount: 1, vignette: true, flicker: true };
      const burst = (): void => { for (let k = 0; k < 6; k++) fx.impact(0, 0, 0, 0, k & 1 ? "blood" : "ichor", 1, true); fx.flash = 0.3; fx.fogAmt = 0.5; fx.hurt = 0.5; fx.dread = 0.5; fx.rays = 0.5; };
      let warm = 0;
      for (let i = 0; i < 400; i++) { // full day/night sweep: every ambient light level is visited
        const a = 0.5 + 0.5 * Math.cos(i / 20); env.ambient[0] = env.ambient[1] = env.ambient[2] = a; env.daylight = a; env.time = i / 60; burst(); fx.pool.update(1 / 60); draw.draw(fx, env); draw.prewarm(a, 24);
        if (i === 120) warm = draw.texBytes();
      }
      const after = draw.texBytes(), canvases = made;
      expect(after).toBe(warm); expect(after).toBeLessThan(16 * 1024 * 1024);
      for (let i = 0; i < 200; i++) { const a = (i % 7) / 6; env.ambient[0] = env.ambient[1] = env.ambient[2] = a; burst(); fx.pool.update(1 / 60); draw.draw(fx, env); }
      expect(draw.texBytes()).toBe(after); expect(made).toBe(canvases);
      const sc = fxScale(3840, 2160, 2), overlay = Math.round(3840 * sc) * Math.round(2160 * sc) * 4;
      draw.shrink(); expect(draw.texBytes()).toBe(after - overlay + 4);
      if (process.env.FX_MEM_REPORT) console.log(`fx texBytes warm=${warm} after=${after} overlay=${overlay} canvases=${canvases}`);
      draw.dispose(); expect(draw.texBytes()).toBe(0);
    } finally { g.OffscreenCanvas = saved.OffscreenCanvas; g.document = saved.document; }
  });
  it("console profile (ADR-212): Xbox UA gets the lighter pool and a 720p overlay; desktop keeps the PC look", async () => {
    const { FX_CONSOLE } = await import("../src/fx/index.js");
    const { memoryProfileFor } = await import("../src/memory-budget.js");
    const xbox = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0";
    expect(memoryProfileFor(xbox, "", false)).toBe("console");
    expect(memoryProfileFor("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36 Edg/120.0", "", false)).toBe("desktop");
    expect(FX_CONSOLE.capacity).toBeLessThan(2048); expect(FX_CONSOLE.budget).toBeLessThanOrEqual(FX_CONSOLE.capacity);
    const s = fxScale(1920, 1080, 1, FX_CONSOLE.maxPixels); expect(1920 * s * 1080 * s).toBeLessThanOrEqual(FX_CONSOLE.maxPixels + 1);
    expect(fxScale(1920, 1080, 1)).toBe(1);
  });
});
