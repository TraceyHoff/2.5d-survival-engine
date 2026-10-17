/**
 * IsoRenderer: WebGL2 2.5D isometric renderer. Read-only consumer of the ECS World.
 *
 * Per frame, render(world, alpha):
 *   0. prep (CPU)  sync terrain meshes, interpolate+cull+sort sprites, gather lights
 *   1. scene pass  -> sceneFBO [color, emissive] + depth
 *        a. terrain chunks (opaque, depth write)
 *        b. sun shadows (instanced, blended, depth test only)
 *        c. sprites (instanced, sorted back-to-front, alpha-tested, per-vertex depth)
 *   2. light pass  -> half-res lightmap: clear to ambient(time of day) + additive point lights
 *   3. composite   -> canvas: scene * lightmap (emissive bypass), fog/haze, grading, vignette
 *   4. weather     -> canvas: instanced rain streaks, splashes, snow
 */
import { TimeOfDay, Weather, type World } from "@engine/core";
import { DEFAULT_ISO, type IsoConfig, type TileMap } from "@engine/world";
import { IsoCamera, type Rect } from "./camera.js";
import { buildProceduralAtlas, GpuAtlas, type Atlas } from "./atlas.js";
import { TilemapRenderer } from "./tilemap.js";
import { SpriteBatch } from "./sprites.js";
import { LightPass } from "./lighting.js";
import { CompositePass } from "./composite.js";
import { WeatherPass, WeatherState, weatherTargets } from "./weather.js";
import { computeDayLighting, type DayLighting } from "./timeOfDay.js";
import { isoZDepthFactor } from "./depth.js";
import { createTexture, newStats, type FrameStats } from "./gl/util.js";
import { RENDER_COMPONENTS } from "./components.js";
import type { Renderer } from "./types.js";

export interface IsoRendererOptions {
  iso?: IsoConfig;
  /** Terrain to draw (the world package has no TileMap resource yet). */
  tilemap?: TileMap;
  atlas?: Atlas;
  /** Keep the drawing buffer (needed for toDataURL/readPixels screenshots). */
  preserveDrawingBuffer?: boolean;
}

export interface RenderSettings { lights: boolean; shadows: boolean; weather: boolean; fog: boolean }

export class IsoRenderer implements Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly camera: IsoCamera;
  readonly iso: IsoConfig;
  readonly zFactor: number;
  readonly atlas: GpuAtlas;
  readonly settings: RenderSettings = { lights: true, shadows: true, weather: true, fog: true };
  readonly weatherState = new WeatherState();
  stats: FrameStats = newStats();
  lighting: DayLighting = computeDayLighting(0.5);
  tilemap: TileMap | undefined;

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
    this.atlas = new GpuAtlas(gl, opts.atlas ?? buildProceduralAtlas());
    this.terrain = new TilemapRenderer(gl, this.iso, this.zFactor);
    this.sprites = new SpriteBatch(gl, this.iso, this.zFactor);
    this.lights = new LightPass(gl, this.iso);
    this.composite = new CompositePass(gl);
    this.weather = new WeatherPass(gl);
  }

  /** Make sure the render components exist on this world (idempotent). */
  static registerComponents(world: World): void { for (const c of RENDER_COMPONENTS) world.register(c); }

  /** Entity (e.g. the local player) that makes covering Occluder sprites fade. */
  setFocusEntity(e: number): void { this.sprites.focusEntity = e; }

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
  }

  /** Read-only: draws the world at interpolation factor alpha in [0,1). */
  render(world: World, alpha: number): void {
    const t0 = performance.now();
    const dt = this.lastNow < 0 ? 0 : Math.min(0.1, (t0 - this.lastNow) / 1000);
    this.lastNow = t0; this.time += dt;
    const stats = (this.stats = newStats());
    const gl = this.gl;
    if (this.w === 0) this.resize(this.canvas.clientWidth || 800, this.canvas.clientHeight || 600, 1);

    // --- 0. prep ---------------------------------------------------------------------------
    // Environment singletons (core ADR-028). Missing env (registerBuiltins:false) falls back to noon/clear.
    const hasEnv = world.isAlive(world.environment);
    const tod = hasEnv && world.has(world.environment, TimeOfDay) ? world.env(TimeOfDay) : undefined;
    const wr = hasEnv && world.has(world.environment, Weather) ? world.env(Weather) : undefined;
    const day = (this.lighting = computeDayLighting(tod ? tod.t : 0.5));
    const target = weatherTargets(wr ? wr.kind : 0, wr ? wr.intensity : 0);
    if (this.firstFrame) { this.weatherState.snap(target); this.firstFrame = false; } else this.weatherState.update(target, dt);
    const ws = this.weatherState;

    let minKey = -4, maxKey = 260;
    if (this.tilemap) { const b = this.terrain.sync(this.tilemap); if (b.minKey < b.maxKey) { minKey = b.minKey; maxKey = b.maxKey; } }
    maxKey += 12; // headroom for tall billboards
    this.depthU[0] = minKey; this.depthU[1] = 1 / (maxKey - minKey);
    this.camera.viewUniform(this.viewU);
    const rect = this.camera.visibleRect(0, this.rect);
    this.sprites.prepare(world, alpha, rect, this.atlas, minKey, maxKey - minKey);
    this.sprites.upload();
    this.lights.prepare(world, alpha, rect, this.settings.lights);

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
    if (this.tilemap) this.terrain.draw(this.viewU, this.depthU, rect, this.time, stats);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (this.settings.shadows) {
      gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
      const sa = day.shadowAlpha * (1 - 0.7 * Math.max(ws.fog, ws.rain));
      this.sprites.draw("shadow", this.viewU, this.depthU, this.atlas, this.time, ws.wind, day.shadowDir, sa, stats);
      gl.depthMask(true); gl.depthFunc(gl.LESS);
    }
    this.sprites.draw("sprite", this.viewU, this.depthU, this.atlas, this.time, ws.wind + 0.15, day.shadowDir, 1, stats);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);

    // --- 2. light pass ---------------------------------------------------------------------
    const amb: [number, number, number] = [day.ambient[0] * (1 - 0.3 * ws.storm), day.ambient[1] * (1 - 0.3 * ws.storm), day.ambient[2] * (1 - 0.25 * ws.storm)];
    this.lights.draw(this.viewU, amb, 1 - 0.8 * day.daylight, this.time, stats);

    // --- 3. composite ----------------------------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    const night = Math.max(0, Math.min(1, 1 - (amb[0] + amb[1] + amb[2]) / 1.6));
    this.composite.draw(this.sceneTex!, this.emisTex!, this.lights.tex!, {
      ambient: amb, fogColor: [0.72, 0.76, 0.8], fog: this.settings.fog ? ws.fog : 0, haze: day.haze,
      storm: ws.storm, night, wind: ws.wind, time: this.time,
      origin: [rect.x0, rect.y1], size: [rect.x1 - rect.x0, rect.y0 - rect.y1],
    });
    stats.drawCalls++;

    // --- 4. weather particles --------------------------------------------------------------
    if (this.settings.weather) this.weather.draw(this.w, this.h, this.camera.x * this.camera.scale, this.camera.y * this.camera.scale, this.camera.dpr, ws, this.time, amb, stats);

    stats.cpuMs = performance.now() - t0;
  }

  dispose(): void {
    const ext = this.gl.getExtension("WEBGL_lose_context"); ext?.loseContext();
  }
}
