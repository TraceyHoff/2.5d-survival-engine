/**
 * Render demo: real @engine/core World + createGameLoop (20 Hz) driving IsoRenderer, content from
 * assets/ (repo root) (if present) or the @engine/assets sample manifest (debug placeholders) + a TexturePacker fixture.
 * URL params: time=0..24 weather=clear|rain|storm|snow|fog|<id> intensity=0..1 density=1 zombies=200 size=128 seed=7
 *             zoom=1 freeze=1 ui=0 lights=0 shadows=0 bench=SECONDS theme=alt gallery=1 inside=1 content=sample interp=0 occtest=1 occ=fade|dither|off sil=0
 *             chars=lineup|facings|crowd n=COUNT cam=chars layers=0 (body only) lod=MINZOOM (drop minor layers below)
 */
import { World, InputState, Action, createGameLoop, Transform, entityIndex, PrevTransform, Weather } from "@engine/core";
import { IsoRenderer, BuildGhost, coreAppearanceBinding } from "../src/index.js";
import { spawnCharacters } from "./characters.js";
import { buildScene, DEMO_COMPONENTS, DEMO_HELD } from "./scene.js";
import { installDemoSystems } from "./systems.js";
import { DebugUI, WEATHER_NAMES } from "./ui.js";
import { BuildPiece, AnimState, Wetness, BodyTemp, Emitter, Fuel, Burning, Equipment } from "./mockGameplay.js";
import { loadContent, makeDebugTheme, ASSETS_BASE } from "./content.js";
import { showGallery } from "./gallery.js";
import { initTime, setWeather } from "./time.js";

declare global { interface Window { __iso?: Record<string, unknown> } }
const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => { const v = q.get(k); const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? n : d; };
window.__iso = { ready: false };
let lookInfo: { warnings: string[]; loaded: string[] } = { warnings: [], loaded: [] };

async function main(): Promise<void> {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const content = await loadContent({ content: q.get("content") === "sample" ? "sample" : "pack", debugCharacters: !!q.get("chars") });
  if (content.issues.length) console.warn("content issues", content.issues);
  const world = new World({ seed: num("seed", 7) });
  IsoRenderer.registerComponents(world);
  for (const c of DEMO_COMPONENTS) world.register(c);

  const timeParam = q.get("time");
  initTime(world, timeParam !== null ? num("time", 10) : 9.5, 20 * 60 * 4);
  const wName = (q.get("weather") ?? "clear").toLowerCase();
  const wKind = /^\d+$/.test(wName) ? Number(wName) : Math.max(0, WEATHER_NAMES.indexOf(wName as (typeof WEATHER_NAMES)[number]));
  setWeather(world, wKind, num("intensity", wKind ? 1 : 0));
  { const w = world.env(Weather); w.windDir = num("windDir", 0.6); w.windSpeed = num("wind", wKind === 2 ? 14 : wKind ? 6 : 2); }

  const renderer = new IsoRenderer(canvas, { preserveDrawingBuffer: q.has("bench") || q.has("shot") });
  (window as unknown as { __renderer: unknown }).__renderer = renderer;
  await renderer.atlas.setRegistry(content.registry, content.sources);
  renderer.atlas.setSway({ ...(content.origin === "sample" ? { tree: { amp: 4, freq: 0.35, stiffness: 0.5 }, berry_bush: { amp: 2, freq: 0.6, stiffness: 0.3 } } : {}), ...content.sway }); // pack: SpriteDef.sway (read by AtlasManager); sample fixture: DEBUG defaults
  if (q.get("look") !== "0") { const look = await renderer.loadLook(q.get("look") ?? "/@art/survival_fx/render_tuning.json"); if (look.warnings.length) console.warn("render tuning:", look.warnings); lookInfo = look; }
  const alt = await makeDebugTheme(content.sources, ["characters", "zombies", "zombies_tp"], 150);
  renderer.atlas.registerTheme("alt", alt);
  if (q.get("theme") === "alt") await renderer.atlas.setTheme("alt");
  if (q.get("gallery") === "1") { showGallery(renderer.atlas, content.registry, `${content.origin === "pack" ? "@engine/assets pack (fetchDefaultManifest)" : "@engine/assets sample fixture (DEBUG)"}${q.get("theme") === "alt" ? " — theme alt" : ""}`); window.__iso = { ready: true, gallery: true }; return; }

  // pack sidecars: BuildPiece.variant groups (piece_variants.json) and per-frame hand anchors (<atlas>.hands.json)
  if (content.origin === "pack") {
    const pv = await fetch(ASSETS_BASE + "pack/piece_variants.json").then((r) => r.ok ? r.json() : null).catch(() => null) as { pieces?: Record<string, string[]> } | null;
    const vi = renderer.atlas.setPieceVariants({ ...(pv?.pieces ?? {}), ...(q.get("wallvariants") !== "0" ? { wall: ["wall", "wall_stone", "wall_metal", "wall_twig"] } : {}) });
    if (vi.length) console.warn("piece variants:", vi);
    for (const a of content.registry.atlases.keys()) {
      if (a.startsWith("dbg_")) continue; // runtime DEBUG layer atlases have no sidecars
      const h = await fetch(`${ASSETS_BASE}pack/atlases/${a}.hands.json`).then((r) => r.ok && (r.headers.get("content-type") ?? "").includes("json") ? r.json() : null).catch(() => null);
      if (h?.hands) renderer.atlas.setHands(a, h);
    }
  }
  const scene = buildScene(world, content.registry, { size: num("size", 128), seed: num("seed", 7), density: num("density", 1), zombies: num("zombies", 200), inside: q.get("inside") === "1", occlusionTest: q.get("occtest") === "1", burn: q.get("burn") !== "0" });
  renderer.tilemap = scene.map;
  const charsMode = q.get("chars"); const plT = world.get(scene.player, Transform)!;
  const chars = charsMode && content.registry.cosmetics?.size ? spawnCharacters(world, content.registry, scene.index, { x: plT.x - 1, y: plT.y + (charsMode === "lineup" ? 4 : 8), z: plT.z }, charsMode, num("n", charsMode === "crowd" ? 200 : 8), scene.players) : null;
  if (q.has("lod")) renderer.setCharacterOptions({ minorLayerMinZoom: num("lod", 1.5) });
  if (charsMode && !chars) console.warn("chars: no cosmetics catalog", content.issues);
  renderer.bindGameplay({ ...(chars && q.get("layers") !== "0" ? { appearance: coreAppearanceBinding(content.registry.cosmetics!), hitFlash: chars.hitFlash } : {}), buildPiece: BuildPiece, animState: AnimState, wetness: Wetness, bodyTemp: BodyTemp, emitter: Emitter, lit: Fuel,
    burning: Burning, equipment: Equipment, heldSprite: (item) => { const k = DEMO_HELD[item]; return k ? content.registry.ids.sprites.tryId(k) : undefined; } });
  renderer.setBuildingGrid(scene.grid);
  renderer.setSpatialIndex(scene.index);
  renderer.setFocusEntity(scene.player);
  const spark = content.registry.ids.sprites.tryId("fx_spark");
  renderer.vfx.onEvent("hit", (ev) => spark === undefined ? null : { spriteId: spark, x: ev.payload.x!, y: ev.payload.y!, z: ev.payload.z ?? 0, lifetime: 0.4, scale: 1.2 });
  try { const r = await fetch("/@art/survival_fx/textures/heat_shimmer_rg_128.png"); if (r.ok && (r.headers.get("content-type") ?? "").includes("image")) renderer.setShimmerNoise(await createImageBitmap(await r.blob())); } catch { /* procedural fallback */ }
  if (q.get("bloom") === "0") renderer.setStyle({ bloom: { strength: 0 } });
  { const m = q.get("occ"); if (m === "off") renderer.setStyle({ occlusion: { enabled: false } }); else if (m === "fade" || m === "dither") renderer.setStyle({ occlusion: { mode: m } }); }
  if (q.get("sil") === "0") renderer.setStyle({ occlusion: { silhouette: false } });
  if (q.get("lights") === "0") renderer.settings.lights = false;
  if (q.get("shadows") === "0") renderer.settings.shadows = false;
  const cam = renderer.camera;
  // ?ghost=valid|invalid: drive the build-placement ghost through BuildGhost (Survival's buildPreview shape)
  const ghostQ = q.get("ghost");
  if (ghostQ === "valid" || ghostQ === "invalid") {
    const gz = world.get(scene.player, Transform)!.z;
    new BuildGhost(world, BuildPiece as never, content.registry).sync({ pieceKey: "wall", x: scene.base.x + 7, y: scene.base.y + 3, rot: Number(q.get("ghostrot") ?? 0), valid: ghostQ === "valid" }, { z: gz });
  }
  const camQ = q.get("cam"); const pl = world.get(scene.player, Transform)!;
  if (camQ === "fire") cam.lookAt(scene.base.x + 3.5, scene.base.y + scene.base.h + 2, 1); else if (camQ === "burn") cam.lookAt(scene.base.x + 10, scene.base.y + 5.5, 1); else if (camQ === "chars" && chars?.entities.length) { const t0 = world.get(chars.entities[0]!, Transform)!, t1 = world.get(chars.entities[chars.entities.length - 1]!, Transform)!; cam.lookAt((t0.x + t1.x) / 2, (t0.y + t1.y) / 2, t0.z); } else if (camQ === "players") cam.lookAt(pl.x + 1, pl.y, 1); else cam.lookAt(scene.base.x + 4, scene.base.y + 4, 1);
  cam.zoom = num("zoom", 1.6);

  const input = new InputState();
  const ui = q.get("ui") === "0" ? null : new DebugUI(world, renderer, q.get("freeze") === "1" || timeParam !== null);
  const freezeTime = (): boolean => (ui ? ui.freeze : timeParam !== null || q.get("freeze") === "1");
  installDemoSystems(world, {
    map: scene.map, index: scene.index, input, player: scene.player, freezeTime,
    onHit: (x, y) => renderer.vfx.handle({ tick: world.tick, def: { name: "hit" }, payload: { x, y, z: 0 } }),
  });
  if (q.get("interp") === "0" && ui) ui.interpolate = false;
  if (ui) ui.onTheme = (t) => { void renderer.atlas.setTheme(t); };

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

  const frameTimes: number[] = [];
  let fpsAvg = 0, lastStatUpdate = 0, lastFrameMs = 0;
  const bench = { warmupMs: 1500, durationMs: num("bench", 0) * 1000, start: 0, frames: 0, sumMs: 0, maxMs: 0, sprites: 0, drawCalls: 0, done: false };
  const loop = createGameLoop(world, {
    render: (w, alpha) => {
      w.runPhase("renderPrep", 0);
      if (ui?.follow) {
        const tr = w.store(Transform), pv = w.store(PrevTransform); const i = entityIndex(scene.player);
        const s = tr.slot(i), p = pv.slot(i);
        if (s >= 0) { const a = p >= 0 ? alpha : 1; const l = (f: "x" | "y" | "z"): number => p >= 0 ? pv.data[f][p]! + (tr.data[f][s]! - pv.data[f][p]!) * a : tr.data[f][s]!; cam.lookAt(l("x"), l("y"), l("z")); }
      }
      renderer.render(w, ui && !ui.interpolate ? 1 : alpha);
    },
  });
  let last = performance.now();
  const startedAt = last;
  function frame(now: number): void {
    const dtMs = now - last; last = now;
    const pan = 700 * (dtMs / 1000);
    if (keys.has("KeyW")) cam.panScreen(0, pan); if (keys.has("KeyS")) cam.panScreen(0, -pan);
    if (keys.has("KeyA")) cam.panScreen(pan, 0); if (keys.has("KeyD")) cam.panScreen(-pan, 0);
    loop.advance(dtMs); lastFrameMs = dtMs;
    frameTimes.push(dtMs); if (frameTimes.length > 60) frameTimes.shift();
    const st = renderer.stats;
    if (now - lastStatUpdate > 250) {
      lastStatUpdate = now;
      const msAvg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length; fpsAvg = 1000 / msAvg;
      const as = renderer.atlas.stats; const ws = renderer.weatherState;
      ui?.update(
        `FPS ${fpsAvg.toFixed(1)}  frame ${msAvg.toFixed(2)} ms\nrender CPU ${st.cpuMs.toFixed(2)} ms\ndraw calls ${st.drawCalls}\n` +
        `sprites ${st.sprites} visible / ${scene.spriteCount} total\nstatic pieces ${st.staticInstances} in ${st.staticChunks} chunk(s)\n` +
        `lights ${st.lights}  particles ${st.particles}\nchunks ${st.chunks} (${st.tiles} tiles)\n` +
        `atlas ${as.atlases} atlases/${as.layers} layers/${as.frames} frames (${content.origin})\n` +
        `tick ${world.tick} @20Hz  alpha ${loop.alpha.toFixed(2)}\nweather ${WEATHER_NAMES[wKind] ?? wKind}  rain ${ws.rain.toFixed(2)} fog ${ws.fog.toFixed(2)}`,
      );
    }
    if (bench.durationMs > 0 && !bench.done && now - startedAt > bench.warmupMs) {
      if (bench.start === 0) bench.start = now;
      else { bench.frames++; bench.sumMs += dtMs; bench.maxMs = Math.max(bench.maxMs, dtMs); bench.sprites = st.sprites; bench.drawCalls = st.drawCalls; }
      if (now - bench.start >= bench.durationMs) bench.done = true;
    }
    window.__iso = { capabilities: renderer.capabilities, atlasStats: renderer.atlas.stats, vram: renderer.vram, held: renderer.heldStats, chars: renderer.characterStats,
      ready: world.tick > 2, frameMs: lastFrameMs, fps: fpsAvg, stats: { ...st }, totalSprites: scene.spriteCount, pieces: scene.pieceCount, origin: content.origin, look: lookInfo, surface: { ...renderer.surface },
      bench: bench.done ? { frames: bench.frames, avgFps: (bench.frames * 1000) / bench.sumMs, avgFrameMs: bench.sumMs / bench.frames, maxFrameMs: bench.maxMs, visibleSprites: bench.sprites, drawCalls: bench.drawCalls } : null,
    };
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main().catch((e: unknown) => { console.error(e); window.__iso = { ready: false, error: String((e as Error)?.stack ?? e) }; });
