/**
 * Demo app: real @engine/core World + createGameLoop (20 Hz fixed tick) driving IsoRenderer.
 * URL params: time=0..24  weather=clear|rain|storm|snow|fog  intensity=0..1  density=1  survivors=300
 *             size=128  seed=7  zoom=1  freeze=1  ui=0  lights=0  shadows=0  bench=SECONDS  interp=0
 */
import { World, InputState, Action, createGameLoop, setTimeOfDay, TimeOfDay, Weather, Transform, entityIndex, PrevTransform } from "@engine/core";
import { IsoRenderer } from "../src/index.js";
import { generateWorld, DEMO_COMPONENTS } from "./worldgen.js";
import { installDemoSystems } from "./systems.js";
import { DebugUI, WEATHER_NAMES } from "./ui.js";

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => { const v = q.get(k); const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? n : d; };

const canvas = document.getElementById("game") as HTMLCanvasElement;
const world = new World({ seed: num("seed", 7) });
IsoRenderer.registerComponents(world);
for (const c of DEMO_COMPONENTS) world.register(c);

const timeParam = q.get("time");
const tod = world.env(TimeOfDay);
tod.dayLengthTicks = 20 * 60 * 4; setTimeOfDay(world, timeParam !== null ? num("time", 10) : 9.5, 0);
const wName = (q.get("weather") ?? "clear").toLowerCase();
const wKind = Math.max(0, WEATHER_NAMES.indexOf(wName as (typeof WEATHER_NAMES)[number]));
const weather = world.env(Weather);
weather.kind = wKind; weather.intensity = num("intensity", wKind ? 1 : 0); weather.endsAtTick = 0;

const gen = generateWorld(world, { size: num("size", 128), seed: num("seed", 7), density: num("density", 1), survivors: num("survivors", 300) });
const renderer = new IsoRenderer(canvas, { tilemap: gen.map, preserveDrawingBuffer: q.has("bench") || q.has("shot") });
renderer.setFocusEntity(gen.player);
if (q.get("lights") === "0") renderer.settings.lights = false;
if (q.get("shadows") === "0") renderer.settings.shadows = false;
const cam = renderer.camera;
cam.lookAt(gen.camp.x + 1, gen.camp.y + 1, 1);
cam.zoom = num("zoom", 1);

const input = new InputState();
const ui = q.get("ui") === "0" ? null : new DebugUI(world, renderer, q.get("freeze") === "1" || timeParam !== null);
const freezeTime = (): boolean => (ui ? ui.freeze : timeParam !== null || q.get("freeze") === "1");
installDemoSystems(world, { map: gen.map, input, player: gen.player, freezeTime });
if (q.get("interp") === "0" && ui) ui.interpolate = false;

// ---- input: drag / wheel / WASD camera, arrows player --------------------------------------
const keys = new Set<string>();
const arrowMap: Record<string, Action> = { ArrowUp: Action.MoveUp, ArrowDown: Action.MoveDown, ArrowLeft: Action.MoveLeft, ArrowRight: Action.MoveRight };
addEventListener("keydown", (e) => {
  keys.add(e.code); const a = arrowMap[e.code]; if (a !== undefined) { input.press(a); e.preventDefault(); }
  if (e.code === "KeyF" && ui) ui.follow = !ui.follow;
  if (e.code === "KeyH" && ui) ui.root.style.display = ui.root.style.display === "none" ? "" : "none";
});
addEventListener("keyup", (e) => { keys.delete(e.code); const a = arrowMap[e.code]; if (a !== undefined) input.release(a); });
let drag: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => { if (!drag) return; cam.panScreen(e.clientX - drag.x, e.clientY - drag.y); drag = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener("pointerup", () => (drag = null));
canvas.addEventListener("wheel", (e) => { e.preventDefault(); cam.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });

const onResize = (): void => renderer.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1));
addEventListener("resize", onResize); onResize();

// ---- frame stats ----------------------------------------------------------------------------
const frameTimes: number[] = [];
let fpsAvg = 0, msAvg = 0, lastStatUpdate = 0;
const bench = { warmupMs: 1500, durationMs: num("bench", 0) * 1000, start: 0, frames: 0, sumMs: 0, maxMs: 0, sprites: 0, drawCalls: 0, done: false };
declare global { interface Window { __iso?: Record<string, unknown> } }
window.__iso = { ready: false, totalSprites: gen.spriteCount };

// ---- loop: createGameLoop drives world.step at 20 Hz and render(world, alpha) per frame ---
let lastFrameMs = 0;
const loop = createGameLoop(world, {
  render: (w, alpha) => {
    w.runPhase("renderPrep", 0);
    if (ui?.follow) {
      const tr = w.store(Transform), pv = w.store(PrevTransform); const i = entityIndex(gen.player);
      const s = tr.slot(i), p = pv.slot(i);
      if (s >= 0) {
        const a = p >= 0 ? alpha : 1; const lerp = (u: number, v: number): number => u + (v - u) * a;
        const x = p >= 0 ? lerp(pv.data.x[p]!, tr.data.x[s]!) : tr.data.x[s]!, y = p >= 0 ? lerp(pv.data.y[p]!, tr.data.y[s]!) : tr.data.y[s]!;
        const z = p >= 0 ? lerp(pv.data.z[p]!, tr.data.z[s]!) : tr.data.z[s]!;
        cam.lookAt(x, y, z);
      }
    }
    renderer.render(w, ui && !ui.interpolate ? 1 : alpha);
  },
});

let last = performance.now();
function frame(now: number): void {
  const dtMs = now - last; last = now;
  // WASD camera pan at frame rate (CSS px/s)
  const pan = 700 * (dtMs / 1000);
  if (keys.has("KeyW")) cam.panScreen(0, pan); if (keys.has("KeyS")) cam.panScreen(0, -pan);
  if (keys.has("KeyA")) cam.panScreen(pan, 0); if (keys.has("KeyD")) cam.panScreen(-pan, 0);
  loop.advance(dtMs);
  lastFrameMs = dtMs;
  frameTimes.push(dtMs); if (frameTimes.length > 60) frameTimes.shift();
  const st = renderer.stats;
  if (now - lastStatUpdate > 250) {
    lastStatUpdate = now;
    msAvg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length; fpsAvg = 1000 / msAvg;
    ui?.update(
      `FPS ${fpsAvg.toFixed(1)}  frame ${msAvg.toFixed(2)} ms\n` +
      `render CPU ${st.cpuMs.toFixed(2)} ms\n` +
      `draw calls ${st.drawCalls}\n` +
      `sprites ${st.sprites} visible / ${world.store(Transform).size} total\n` +
      `lights ${st.lights}  particles ${st.particles}\n` +
      `chunks ${st.chunks} (${st.tiles} tiles)\n` +
      `tick ${world.tick} @20Hz  alpha ${loop.alpha.toFixed(2)}\n` +
      `weather ${WEATHER_NAMES[world.env(Weather).kind] ?? "?"}  rain ${renderer.weatherState.rain.toFixed(2)} fog ${renderer.weatherState.fog.toFixed(2)}`,
    );
  }
  // benchmark accounting (after warmup)
  if (bench.durationMs > 0 && !bench.done && now > bench.warmupMs) {
    if (bench.start === 0) bench.start = now;
    else { bench.frames++; bench.sumMs += dtMs; bench.maxMs = Math.max(bench.maxMs, dtMs); bench.sprites = st.sprites; bench.drawCalls = st.drawCalls; }
    if (now - bench.start >= bench.durationMs) bench.done = true;
  }
  window.__iso = {
    ready: world.tick > 2, frameMs: lastFrameMs, fps: fpsAvg, stats: { ...st }, totalSprites: world.store(Transform).size,
    bench: bench.done ? { frames: bench.frames, avgFps: (bench.frames * 1000) / bench.sumMs, avgFrameMs: bench.sumMs / bench.frames, maxFrameMs: bench.maxMs, visibleSprites: bench.sprites, drawCalls: bench.drawCalls } : null,
  };
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
