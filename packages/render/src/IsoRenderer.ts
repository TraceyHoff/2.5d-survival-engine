/**
 * IsoRenderer: WebGL2 2.5D isometric renderer. Read-only consumer of the ECS World.
 *
 * Per frame, render(world, alpha):
 *   0. prep (CPU)  sync terrain chunk meshes; gather/interpolate/resolve/cull/sort sprites; rebuild
 *                  dirty static build-piece chunks; gather lights
 *   1. scene pass  -> sceneFBO [color, emissive] + depth24
 *        a. terrain chunks              (opaque, depth write; 1 draw / visible chunk)
 *        b. static build-piece chunks   (cached instances, alpha-tested, depth write; 1 draw / visible chunk)
 *        c. shadows                     (blob or projected; instanced, blended, depth test only; 1 draw)
 *        d. dynamic sprites             (sorted back-to-front, alpha-tested, per-vertex depth; 1 draw)
 *   2. light pass  -> half-res lightmap: clear to ambient(time of day) + additive point lights (1 draw)
 *   3. composite   -> canvas: scene x light (emissive bypass), banding/night floor, fog, grading (1 draw)
 *   4. weather     -> canvas: instanced rain streaks, splashes, snow (<= 3 draws)
 */
import { AssetManager, type World } from "@engine/core";
import { DEFAULT_ISO, type BuildingGrid, type ChunkedSpatialIndex, type IsoConfig, type TileMap } from "@engine/world";
import { IsoCamera, type Rect } from "./camera.js";
import { BloomPass } from "./bloom.js";
import { TileTerrain } from "./terrainTiles.js";
import { tileHeight } from "./tilemap.js";
import { parseGradingKeyframes, sampleKeyframes, lutSizeFromImage, type GradingKeyframe } from "./grading.js";
import { DEFAULT_EMITTER_KINDS, type EmitterVisual } from "./lighting.js";
import { loadRenderTuning } from "./style.js";
import type { SurfaceProvider } from "./tilemap.js";
import type { LutBinding } from "./composite.js";
import { AtlasManager } from "./assets/atlasManager.js";
import { TilemapRenderer } from "./tilemap.js";
import { SpriteBatch, type GameplayBindings } from "./sprites.js";
import { LightPass } from "./lighting.js";
import { CompositePass } from "./composite.js";
import { WeatherPass, WeatherState, weatherTargets } from "./weather.js";
import { computeDayLighting, type DayLighting } from "./timeOfDay.js";
import { isoZDepthFactor } from "./depth.js";
import { createTexture, newStats, type FrameStats } from "./gl/util.js";
import { RENDER_COMPONENTS } from "./components.js";
import { DEFAULT_STYLE, mergeStyle, type StyleConfig, type StylePatch } from "./style.js";
import { readDayFraction, readWeather, readWind } from "./env.js";
import type { TransformSource } from "./transformSource.js";
import { VfxLayer } from "./vfx.js";
import type { Renderer } from "./types.js";

export interface IsoRendererOptions {
  iso?: IsoConfig;
  /** Terrain to draw (TileMap or a streaming ChunkManager). */
  tilemap?: TileMap;
  /** Shared ref-counted asset cache (core). A private one is created if omitted. */
  assets?: AssetManager;
  /** Texture-array layer size for atlases (2048 default, 4096 on desktop). */
  atlasLayerSize?: number;
  /** Sim tick rate, for AnimState timing (default 20). */
  tickHz?: number;
  /** Keep the drawing buffer (needed for toDataURL/readPixels screenshots). */
  preserveDrawingBuffer?: boolean;
  style?: StylePatch;
  /** Building sprite pivot convention: footprint centre (default; art guide + @engine/assets sample) or front-most corner. */
  pieceAnchor?: "center" | "front";
}

export interface RenderSettings { lights: boolean; shadows: boolean; weather: boolean; fog: boolean }

export class IsoRenderer implements Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly camera: IsoCamera;
  readonly iso: IsoConfig;
  readonly zFactor: number;
  readonly atlas: AtlasManager;
  readonly settings: RenderSettings = { lights: true, shadows: true, weather: true, fog: true };
  readonly weatherState = new WeatherState();
  readonly vfx = new VfxLayer();
  style: StyleConfig;
  stats: FrameStats = newStats();
  lighting: DayLighting = computeDayLighting(0.5);
  tilemap: TileMap | undefined;
  tickHz: number;
  pieceAnchor: "center" | "front";
  bindings: GameplayBindings = {};
  grid: BuildingGrid | undefined;
  spatial: { index: ChunkedSpatialIndex; activeKeys?: ReadonlySet<string> } | undefined;
  /** Chunks to draw (e.g. ChunkManager.activeKeys); undefined = all resident. */
  activeKeys: ReadonlySet<string> | undefined;
  transformSource: TransformSource | undefined;
  /** Emitter kind id -> visual (gameplay-defined ids; unknown kinds ignored). */
  emitterKinds: Record<number, EmitterVisual> = { ...DEFAULT_EMITTER_KINDS };
  /** Surface wetness/snow: derived from Weather over time unless a per-chunk provider is set. */
  readonly surface = { wet: 0, snow: 0 };
  /** Grading keyframes (time-of-day sun/ambient/fog/shadow tint + optional LUT per keyframe). */
  gradingKeyframes: GradingKeyframe[] = [];
  private luts = new Map<string, LutBinding>();
  private styleLut: LutBinding | null = null;
  private shimmerTex: WebGLTexture | null = null;
  private bloom: BloomPass;
  private tiles: TileTerrain;
  /** Use the textured tile atlas for terrain when the registry has tile sprites (else vertex colours only). */
  texturedTerrain = true;
  private flash = 0; private nextBolt = 3; private cloudOff = [0, 0];
  /** Fires when lightning strikes (screen-space x/y of a random visible point, world tile coords). */
  onLightning: ((x: number, y: number) => void) | null = null;
  /** Status particle sprites by key (Art's survival_fx status atlas); missing keys disable that particle. rate = spawns/s per entity at level 1. */
  statusFx = { wet: { sprite: "fx_drip", rate: 1.2, lifetime: 0.6 }, cold: { sprite: "fx_breath_puff", rate: 0.8, lifetime: 1.0 }, heat: { sprite: "fx_sweat_drop", rate: 0.6, lifetime: 0.7 } };
  private statusDt = 0;
  private statusHook = (kind: "wet" | "cold" | "heat", x: number, y: number, z: number, level: number): void => {
    const c = this.statusFx[kind]; if (Math.random() > c.rate * level * this.statusDt) return;
    const id = this.atlas.registry?.ids.sprites.tryId(c.sprite); if (id === undefined) return;
    const up = kind === "wet" ? 1.2 + Math.random() * 0.8 : 2.4; // height above the feet in z units
    this.vfx.spawn({ spriteId: id, x: x - 0.15 + Math.random() * 0.3, y: y - 0.15 + Math.random() * 0.3, z: z + up, lifetime: c.lifetime, scale: 1, emissive: false });
  };

  private terrain: TilemapRenderer;
  private sprites: SpriteBatch;
  private lights: LightPass;
  private composite: CompositePass;
  private weather: WeatherPass;
  private sceneFbo: WebGLFramebuffer | null = null;
  private sceneTex: WebGLTexture | null = null;
  private emisTex: WebGLTexture | null = null;
  private depthRb: WebGLRenderbuffer | null = null;
  private w = 0; private h = 0;
  private viewU = new Float32Array(4);
  private depthU = new Float32Array(2);
  private rect: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private lastNow = -1;
  private firstFrame = true;
  private firstFrame2 = true;
  /** Seconds of renderer time (animation clock for water, flicker, particles). */
  time = 0;

  constructor(readonly canvas: HTMLCanvasElement, opts: IsoRendererOptions = {}) {
    const gl = canvas.getContext("webgl2", {
      antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance",
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl;
    this.iso = opts.iso ?? DEFAULT_ISO;
    this.zFactor = isoZDepthFactor(this.iso);
    this.camera = new IsoCamera(this.iso);
    this.tilemap = opts.tilemap;
    this.tickHz = opts.tickHz ?? 20;
    this.pieceAnchor = opts.pieceAnchor ?? "center";
    this.style = mergeStyle(DEFAULT_STYLE, opts.style ?? {});
    this.atlas = new AtlasManager(gl, opts.assets ?? new AssetManager(), opts.atlasLayerSize !== undefined ? { layerSize: opts.atlasLayerSize } : {});
    this.atlas.setStatusTints(this.style.statusTints);
    this.terrain = new TilemapRenderer(gl, this.iso, this.zFactor);
    this.sprites = new SpriteBatch(gl, this.iso, this.zFactor);
    this.lights = new LightPass(gl, this.iso);
    this.composite = new CompositePass(gl);
    this.weather = new WeatherPass(gl);
    this.bloom = new BloomPass(gl);
    this.tiles = new TileTerrain(gl, this.iso, this.zFactor);
  }

  /** Make sure the render components exist on this world (idempotent). */
  static registerComponents(world: World): void { for (const c of RENDER_COMPONENTS) world.register(c); }

  /** Entity (the local player) used for Occluder fading and roof/upper-floor cutaways. */
  setFocusEntity(e: number): void { this.sprites.focusEntity = e; }
  /** Gameplay components the renderer reads (BuildPiece, AnimState). */
  bindGameplay(b: GameplayBindings): void { this.bindings = { ...this.bindings, ...b }; }
  /** BuildingGrid used for cutaway detection (multi-level). */
  setBuildingGrid(g: BuildingGrid | undefined): void { this.grid = g; }
  /** Use a ChunkedSpatialIndex for sprite culling (iterate only visible, active chunks). */
  setSpatialIndex(index: ChunkedSpatialIndex | undefined, activeKeys?: ReadonlySet<string>): void { this.spatial = index ? { index, ...(activeKeys ? { activeKeys } : {}) } : undefined; }
  setActiveChunks(keys: ReadonlySet<string> | undefined): void { this.activeKeys = keys; }
  setTransformSource(s: TransformSource | undefined): void { this.transformSource = s; }
  setStyle(patch: StylePatch): void { this.style = mergeStyle(this.style, patch); this.atlas.setStatusTints(this.style.statusTints); }
  /** Gameplay's per-chunk surface value (wet/snow 0..1); undefined -> derive from Weather. */
  setSurfaceProvider(p: SurfaceProvider | undefined): void { this.terrain.perChunk = p; }

  /** Tileable RG offset noise for heat shimmer (e.g. survival_fx/textures/heat_shimmer_rg_128.png). */
  setShimmerNoise(img: TexImageSource): void {
    const gl = this.gl; if (!this.shimmerTex) this.shimmerTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shimmerTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }
  /** Upload a grading LUT strip (16³ 256x16 or 32³ 1024x32; size auto-detected). */
  addLut(key: string, img: TexImageSource & { width: number; height: number }): LutBinding {
    const size = lutSizeFromImage(img.width, img.height);
    if (!size) throw new Error(`LUT ${key}: ${img.width}x${img.height} is not an N²xN strip`);
    const gl = this.gl; const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const b = { tex, size }; const old = this.luts.get(key); if (old) gl.deleteTexture(old.tex); this.luts.set(key, b); return b;
  }

  /**
   * Load Art & Assets' look layer: render_tuning.json (validated; unknown keys warn) merged over the neutral
   * defaults, plus the grading LUT / keyframes it references (relative URLs). Missing files keep procedural fallbacks.
   */
  async loadLook(tuningUrl: string, fetcher: typeof fetch = fetch): Promise<{ warnings: string[]; loaded: string[] }> {
    const warnings: string[] = []; const loaded: string[] = [];
    const base = tuningUrl.replace(/[^/]*$/, ""); const abs = (u: string): string => /^(\/|[a-z]+:)/i.test(u) ? u : base + u;
    const res = await fetcher(tuningUrl).catch(() => null);
    if (!res || !res.ok) return { warnings: [`render tuning not found: ${tuningUrl} (using defaults)`], loaded };
    const t = loadRenderTuning(await res.json(), this.style); warnings.push(...t.warnings); this.style = t.style; this.atlas.setStatusTints(this.style.statusTints); loaded.push(tuningUrl);
    const img = async (u: string): Promise<ImageBitmap | null> => { try { const r = await fetcher(u); if (!r.ok) return null; return await createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" }); } catch { return null; } };
    const g = this.style.gradingLut;
    if (g.url) { const b = await img(abs(g.url)); if (b) { try { this.styleLut = this.addLut(g.url, b); loaded.push(abs(g.url)); } catch (e) { warnings.push(String(e)); } } else warnings.push(`LUT not found: ${abs(g.url)}`); }
    if (g.keyframes) {
      const r = await fetcher(abs(g.keyframes)).catch(() => null);
      if (r && r.ok) {
        const k = parseGradingKeyframes(await r.json()); warnings.push(...k.issues.map((i) => `keyframes ${i}`)); this.gradingKeyframes = k.keyframes; loaded.push(abs(g.keyframes));
        for (const kf of k.keyframes) if (kf.lut && !this.luts.has(kf.lut)) { const b = await img(abs(kf.lut)); if (b) { try { this.addLut(kf.lut, b); } catch (e) { warnings.push(String(e)); } } else warnings.push(`keyframe LUT not found: ${abs(kf.lut)}`); }
      } else warnings.push(`keyframes not found: ${abs(g.keyframes)}`);
    }
    return { warnings, loaded };
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    this.canvas.width = w; this.canvas.height = h;
    this.camera.setViewport(w, h, dpr);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    const gl = this.gl;
    if (this.sceneTex) gl.deleteTexture(this.sceneTex); if (this.emisTex) gl.deleteTexture(this.emisTex);
    if (this.depthRb) gl.deleteRenderbuffer(this.depthRb); if (this.sceneFbo) gl.deleteFramebuffer(this.sceneFbo);
    this.sceneTex = createTexture(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.emisTex = createTexture(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    this.sceneFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.emisTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`scene FBO incomplete: 0x${st.toString(16)}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.lights.resize(w, h);
    this.bloom.resize(w, h);
  }

  /** Read-only: draws the world at interpolation factor alpha in [0,1). */
  render(world: World, alpha: number): void {
    const t0 = performance.now();
    const dt = this.lastNow < 0 ? 0 : Math.min(0.1, (t0 - this.lastNow) / 1000);
    this.lastNow = t0; this.time += dt;
    const stats = (this.stats = newStats());
    const gl = this.gl; const style = this.style;
    if (this.w === 0) this.resize(this.canvas.clientWidth || 800, this.canvas.clientHeight || 600, 1);
    this.vfx.update(this.time); this.statusDt = dt;

    // --- 0. prep ---------------------------------------------------------------------------
    const dayFrac = readDayFraction(world);
    const day = (this.lighting = computeDayLighting(dayFrac));
    const kf = sampleKeyframes(this.gradingKeyframes, dayFrac * 24);
    if (kf) day.ambient = [kf.ambient[0] + kf.sun[0], kf.ambient[1] + kf.sun[1], kf.ambient[2] + kf.sun[2]];
    this.sprites.shadowColor.set(kf ? kf.shadowTint : style.shadowTint);
    const wr = readWeather(world);
    const target = weatherTargets(wr.kind, wr.intensity);
    if (this.firstFrame) { this.weatherState.snap(target); this.firstFrame = false; } else this.weatherState.update(target, dt);
    const ws = this.weatherState;
    // wind: Weather.windDir/windSpeed when set, else the configured default (scaled by weather wind level)
    const wenv = readWind(world);
    const wDir = wenv.speed > 0 ? wenv.dir : style.wind.defaultDir;
    const wSpeed = wenv.speed > 0 ? wenv.speed : style.wind.defaultSpeed * (1 + 3 * ws.wind);
    const wsx = Math.cos(wDir) - Math.sin(wDir); // tile-axis direction -> screen x
    this.sprites.windVec[0] = Math.sign(wsx) * Math.min(1, Math.abs(wsx)); this.sprites.windVec[1] = Math.min(1.5, wSpeed / Math.max(0.1, style.wind.refSpeed));
    this.cloudOff[0]! -= wsx * wSpeed * 8 * dt; this.cloudOff[1]! -= (Math.cos(wDir) + Math.sin(wDir)) * 0.5 * wSpeed * 8 * dt;
    // surface wetness / snow cover accumulate from weather (gameplay's per-chunk value overrides via setSurfaceProvider)
    const sf = this.surface, su = style.surface;
    sf.wet = Math.max(0, Math.min(1, sf.wet + (ws.rain > 0.05 ? ws.rain * su.wetRate : -su.dryRate * (0.5 + day.daylight)) * dt));
    sf.snow = Math.max(0, Math.min(1, sf.snow + (ws.snow > 0.05 ? ws.snow * su.snowRate : -su.meltRate * day.daylight) * dt));
    if (this.firstFrame2) { sf.wet = Math.min(1, ws.rain * 0.85); sf.snow = Math.min(1, ws.snow * 0.8); this.firstFrame2 = false; }
    this.terrain.surface = sf;
    this.terrain.surfaceStyle = { puddles: su.puddles, wetDarken: su.wetDarken, skyRefl: su.skyReflection };
    // lightning during storms
    this.flash = Math.max(0, this.flash - dt * 4);
    if (style.lightning.enabled && ws.storm > 0.2) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.flash = 1; this.nextBolt = style.lightning.meanIntervalSec * (0.3 + Math.random() * 1.4);
        const r = this.rect; const sx = r.x0 + Math.random() * (r.x1 - r.x0), sy = r.y0 + Math.random() * (r.y1 - r.y0) * 0.6;
        const hw0 = this.iso.tileW / 2, hh0 = this.iso.tileH / 2; const tx = (sx / hw0 + sy / hh0) / 2, ty = (sy / hh0 - sx / hw0) / 2;
        const bolt = this.atlas.registry?.ids.sprites.tryId("fx_lightning");
        if (bolt !== undefined) this.vfx.spawn({ spriteId: bolt, x: tx, y: ty, lifetime: 0.25, scale: 2 });
        this.onLightning?.(tx, ty);
      }
    }

    if (this.tilemap) this.terrain.sync(this.tilemap);
    this.camera.viewUniform(this.viewU);
    const rect = this.camera.visibleRect(0, this.rect);
    // Camera-relative depth range: precision independent of world size / streaming.
    const hh = this.iso.tileH / 2;
    const minKey = rect.y0 / hh - 64, maxKey = (rect.y1 + 2048) / hh + 64;
    this.depthU[0] = minKey; this.depthU[1] = 1 / (maxKey - minKey);
    this.sprites.prepare({
      world, alpha, rect, atlas: this.atlas, depthMin: minKey, depthRange: maxKey - minKey, tickHz: this.tickHz, style,
      bindings: this.bindings, spatial: this.spatial, activeKeys: this.activeKeys, grid: this.grid, groundZAt: this.tilemap ? (x: number, y: number) => tileHeight(this.tilemap!, x, y) : undefined, pieceAnchor: this.pieceAnchor,
      transformSource: this.transformSource, vfx: this.vfx, now: this.time, statusFx: this.statusHook,
    });
    this.sprites.upload();
    this.lights.prepare(world, alpha, rect, this.settings.lights, this.transformSource, { emitter: this.bindings.emitter, lit: this.bindings.lit, kinds: this.emitterKinds });

    // --- 1. scene pass ---------------------------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, this.w, this.h);
    gl.depthMask(true);
    gl.clearBufferfv(gl.COLOR, 0, [day.sky[0], day.sky[1], day.sky[2], 1]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearBufferfi(gl.DEPTH_STENCIL, 0, 1, 0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
    if (this.tilemap) {
      this.terrain.draw(this.viewU, this.depthU, rect, this.time, stats, this.activeKeys);
      if (this.texturedTerrain && TileTerrain.available(this.atlas)) {
        gl.depthFunc(gl.LEQUAL);
        this.tiles.draw(this.tilemap, this.atlas, this.viewU, this.depthU, rect, this.time, stats, this.terrain.surface, this.terrain.perChunk, this.terrain.surfaceStyle, this.activeKeys);
        gl.depthFunc(gl.LESS);
      }
    }
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.sprites.drawStatic(this.viewU, this.depthU, this.atlas, this.time, this.time, rect, this.activeKeys, style, stats);
    if (this.settings.shadows && style.shadowMode !== "none") {
      gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
      const base = style.shadowMode === "blob" ? style.blobShadow.alpha * (0.45 + 0.55 * day.daylight) : day.shadowAlpha;
      const sa = base * (1 - 0.6 * Math.max(ws.fog, ws.rain));
      this.sprites.draw("shadow", this.viewU, this.depthU, this.atlas, this.time, ws.wind, day.shadowDir, sa, style, stats);
      gl.depthMask(true); gl.depthFunc(gl.LESS);
    }
    this.sprites.draw("sprite", this.viewU, this.depthU, this.atlas, this.time, ws.wind + 0.15, day.shadowDir, 1, style, stats);
    this.sprites.drawSilhouette(this.viewU, this.depthU, this.atlas, this.time, ws.wind + 0.15, style, stats);
    this.sprites.drawLate(this.viewU, this.depthU, this.atlas, this.time, ws.wind + 0.15, style, stats);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);

    // --- 2. light pass ---------------------------------------------------------------------
    const amb: [number, number, number] = [day.ambient[0] * (1 - 0.3 * ws.storm), day.ambient[1] * (1 - 0.3 * ws.storm), day.ambient[2] * (1 - 0.25 * ws.storm)];
    this.lights.draw(this.viewU, amb, 1 - (1 - style.daylightLightScale) * day.daylight, this.time, stats);

    // --- 3. composite ----------------------------------------------------------------------
    const bloomOn = style.bloom.strength > 0;
    if (bloomOn) this.bloom.draw(this.sceneTex!, this.emisTex!, style.bloom.radiusPx, stats);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    let lutA = this.styleLut, lutB: LutBinding | null = null, lutMix = 0;
    if (kf) { const a = this.gradingKeyframes[kf.a]!.lut, b = this.gradingKeyframes[kf.b]!.lut; const la = a ? this.luts.get(a) : undefined, lb = b ? this.luts.get(b) : undefined;
      if (la && lb) { lutA = la; lutB = lb; lutMix = kf.t; } else if (la || lb) { lutA = (la ?? lb)!; } }
    const night = Math.max(0, Math.min(1, 1 - (amb[0] + amb[1] + amb[2]) / 1.6));
    this.composite.draw(this.sceneTex!, this.emisTex!, this.lights.tex!, {
      ambient: amb, fog: this.settings.fog ? ws.fog : 0, haze: day.haze, storm: ws.storm, night, wind: ws.wind, time: this.time,
      origin: [rect.x0, rect.y1], size: [rect.x1 - rect.x0, rect.y0 - rect.y1], style,
      ...(kf ? { fogColor: kf.fog } : {}),
      bloom: bloomOn ? this.bloom.output : null, bloomStrength: style.bloom.strength * (1 + (style.bloom.nightBoost - 1) * night),
      lutA, lutB, lutMix, flash: this.flash * style.lightning.flash,
      cloudOffset: [this.cloudOff[0]!, this.cloudOff[1]!], cloudAlpha: style.clouds.alpha * day.daylight * (1 + style.clouds.overcastBoost * Math.max(ws.rain, ws.storm)),
      heat: this.lights.heat, heatCount: this.lights.heatCount, shimmerTex: this.shimmerTex,
    });
    stats.drawCalls++;

    // --- 4. weather particles --------------------------------------------------------------
    if (this.settings.weather) this.weather.draw(this.w, this.h, this.camera.x * this.camera.scale, this.camera.y * this.camera.scale, this.camera.dpr, ws, this.time, amb, stats);

    stats.staticChunks = this.sprites.staticChunksDrawn; stats.staticInstances = this.sprites.staticInstances;
    stats.cpuMs = performance.now() - t0;
  }

  dispose(): void {
    this.atlas.dispose();
    const ext = this.gl.getExtension("WEBGL_lose_context"); ext?.loseContext();
  }
}
