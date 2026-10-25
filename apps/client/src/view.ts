import { effectiveLevel, levelFlags } from "./gl-recovery.js";
import { isFreeStandingStation, stationFireFrame } from "./station-view.js";
import { DESKTOP_ZOOM } from "./camera-zoom.js";
import { showRenderError, glInfo, frameIsBlack } from "./glcheck.js";
/**
 * WebGL2 game view: @engine/render IsoRenderer + Art's pack (packages/assets/pack, served at `<base>art/pack/`).
 *
 * The net World cannot carry render components (World.getSchemaHash covers every registered store and must match
 * the server), so the renderer draws a separate *view World*: each frame `sync()` mirrors the replicated entities
 * (Transform/PrevTransform, env TimeOfDay + Weather, tick) into it and attaches Sprite/AnimState/LightSource/Shadow
 * from the gameplay components (Survival = character, Zombie, ResourceNode, CraftingStation, BuildPiece) using the
 * gameplay defs' sprite keys. Terrain is the net TileClient's TileMap, drawn directly.
 */
import { World, Transform, PrevTransform, TimeOfDay, Weather, Appearance, PlayerId, defineComponent, slotIndex, type WearableSlot, entityIndex, type Entity } from "@engine/core";
import { CHUNK_SIZE, tileToChunk, tileToLocal, type TileMap } from "@engine/world";
import { setDayFraction, resolveOffHandSprite } from "@engine/render";
import { pieceVariantOpts } from "./piece-variant.js";
import { loadManifest, mergeManifests, resolveManifestShards, buildPieceVisual, type AssetRegistry, type ManifestFragment, type ManifestJson } from "@engine/assets";
import { BuildGhost, pieceArtRow, ROT_EXACT_PIVOT, IsoRenderer, Canvas2DRenderer, chooseRenderer, Sprite, Shadow, LightSource, Occluder, SpriteFlag, sourcesFromManifest, coreAppearanceBinding, CameraTargetGuard } from "@engine/render";
import { countFraction } from "./load-progress.js";
import { roadSpriteKeys, ROAD_FLAGS, signFrameId } from "./road-sign-view.js";
import { Road, Sign, surfaceDef, signDef, walkAnimRate } from "@engine/gameplay";
import { HitReact, NodeRegrow, hitDirRad, Equipment, Worn, wornCosmetics } from "@engine/gameplay";
import { gameplayDefs, rotationSteps, animalDefs, Animal, Health, Survival, Zombie, ResourceNode, CraftingStation, Fuel, AnimState as GAnim, BuildPiece as GPiece, Dead, Wetness, BodyTemp, Emitter, PieceLink, Crop, cropSpriteKey, clutterForChunk, resolveSprite, type ResolvedSprite } from "@engine/gameplay";

/** Render-side schemas the renderer's bindings expect (view World only). */
const VAnim = defineComponent("ViewAnimState", { state: "u8", startTick: "u32" });
const VPiece = defineComponent("ViewBuildPiece", { visualId: "u16", variant: "u8", tint: "u32", damageStage: "u8", rotation: "u8", level: "u8", layer: "u8", ghost: "u8" });
const VWet = defineComponent("ViewWetness", { level: "u8" });
const VTemp = defineComponent("ViewBodyTemp", { cold: "u8", heat: "u8", shivering: "u8" });
const VFuel = defineComponent("ViewFuel", { burnUntilTick: "u32", lit: "u8" });
/** ADR-135: replicated main-hand item (held sprite at the hand anchor). */
const VEquip = defineComponent("ViewEquipment", { mainHandItem: "u16" });
/** ADR-135: replicated off-hand worn slot (Worn.item[WearSlot.OffHand]) -> offhand_<key> / held_<key> at handL. */
const VOffHand = defineComponent("ViewOffHand", { offHandItem: "u16" });
const OFFHAND_SLOT = 6; /* WearSlot.OffHand */
/** gameplay Anim (Idle Walk Run Attack Hurt Die Gather Build) -> render AnimStateId (Idle Walk Run Attack Hit Death ...). */
const ANIM_MAP: readonly number[] = [0, 1, 2, 3, 4, 5, 3, 3];
/** ADR-107: Swim (14) / Punch (15) pass straight through (atlas fallbacks: swim->walk, punch->attack). */
/** ADR-128: node hit wiggle offset (tiles) `ms` after a hit: damped sine away from the player, undefined when done. */
export function nodeWiggle(ms: number): number | undefined { if (ms < 0 || ms > 360) return undefined; const k = ms / 360; return 0.09 * Math.sin(k * Math.PI * 4) * (1 - k); }
/**
 * ADR-134 flinch pose `ms` after a HitReact (dir = radians, away from the attacker): knockback nudge (tiles, out fast
 * then back), uniform squash pulse, tilt (rad, Canvas2D) and white flash 0..1. undefined once the 320 ms flinch is over.
 */
export const HIT_REACT_MS = 320;
export function hitPose(ms: number, dir: number): { dx: number; dy: number; scale: number; tilt: number; flash: number } | undefined {
  if (!(ms >= 0) || ms > HIT_REACT_MS) return undefined;
  const k = ms / HIT_REACT_MS, f = 1 - k;
  const push = 0.16 * Math.sin(Math.min(1, ms / 70) * Math.PI / 2) * f * f;
  const side = Math.sign(Math.cos(dir) - Math.sin(dir)) || 1; // iso screen x ~ (x - y): lean away from the hit
  return { dx: Math.cos(dir) * push, dy: Math.sin(dir) * push, scale: 1 - 0.07 * Math.sin(k * Math.PI * 2) * f, tilt: 0.2 * side * Math.sin(k * Math.PI) * f, flash: ms < 120 ? 1 - ms / 120 : 0 };
}
const animMap = (a: number): number => (a >= 14 && a <= 19 ? a : a === 8 ? 8 : ANIM_MAP[a] ?? 0); // 16..19 ADR-128 harvest/chop/mine/drink, 8 eat
import { LightTable, type LightSpec } from "./lights.js";
import { MANIFEST_INDEX, type ManifestFragmentRef } from "./manifest-index.js";
import { stumpKeys } from "./stumps.js";
/** `?cam=animal`: debug camera that follows the first ambient animal instead of the player. */
const CAM_ANIMAL = typeof location !== "undefined" && new URLSearchParams(location.search).get("cam") === "animal";
/** Max bytes for the sprite texture array (mips included) before customization layers are dropped. */
/** ADR-110 clutter quality: lowend / safe = 0.35 density, radius 1 chunk, 400 sprites; else 1, 2 chunks, 1600. */
const CLUTTER = (() => { const q = new URLSearchParams(globalThis.location?.search ?? ""); const low = q.get("gl") === "lowend" || q.get("safe") === "1" || ["lowend", "safe", "debug"].includes(effectiveLevel(globalThis.location?.search ?? ""));
  return q.get("clutter") === "0" ? { density: 0, radius: 0, cap: 0 } : low ? { density: 0.35, radius: 1, cap: 400 } : { density: 1, radius: 2, cap: 1600 }; })();
/** ?gl=lowend: characters beyond the nearest N draw body-only. */
const DRESSED_LOWEND = 8;
let lowendDress = false;
/** Set when the paper-doll atlases were left out, so Appearance layers are not bound to missing sprites. */
let noCosmetics = false;
const PLAYER_KEYS = ["player", "player_b", "player_c"];

/** Camera fallback when no player is replicated for CAMERA_GRACE_FRAMES: the legacy origin spawn (server SPAWN). */
export const CAMERA_FALLBACK = { x: 16, y: 16, z: 0 };
const CAMERA_GRACE_FRAMES = 300;
export interface ViewStatus { localServer: string; snapshots: number; error?: string }
export interface ViewOverrides { hours?: number; weather?: number; intensity?: number }

/** Resource Timing watcher (ADR-118): calls back with the count and transfer bytes of matching responses since start. */
function watchResources(match: RegExp, cb: (count: number, bytes: number) => void): () => void {
  if (typeof PerformanceObserver !== "function") return () => {};
  let n = 0, bytes = 0;
  try {
    const po = new PerformanceObserver((list) => { let hit = false; for (const e of list.getEntries()) if (match.test(e.name)) { n++; bytes += (e as PerformanceResourceTiming).transferSize || (e as PerformanceResourceTiming).encodedBodySize || 0; hit = true; } if (hit) cb(n, bytes); });
    po.observe({ type: "resource", buffered: false }); return () => po.disconnect();
  } catch { return () => {}; }
}
export class IsoView {
  readonly view = new World({ seed: 1 });
  private map = new Map<Entity, Entity>();
  private lastMove = new Map<Entity, number>();
  private nodeAmt = new Map<Entity, number>(); private nodeHit = new Map<Entity, { at: number; dx: number; dy: number }>(); // ADR-128 wiggle
  private seen = new Set<Entity>();
  /** ADR-134: net entity -> last seen HitReact.startTick + local receive time; view entity -> current flinch pose. */
  private hitSeen = new Map<Entity, { tick: number; at: number; dir: number }>(); private hitPoseOf = new Map<Entity, { scale: number; tilt: number; flash: number; base: number }>();
  /** Light emitters (net entity -> table spec), re-evaluated every frame from replicated Fuel.lit / Emitter.strength. */
  private lightOf = new Map<Entity, { spec: LightSpec; fuel?: Entity }>();
  /** Piece view entity -> building state index (e.g. "unlit") for the renderer's pieceState binding. */
  private pieceStates = new Map<number, number>();
  /** ADR-125: character view entities (players/human bots); their Walk plays at walkAnimRate so feet match ground speed. */
  private characters = new Set<number>(); private walkRate = 1;
  private constructor(readonly renderer: IsoRenderer, readonly registry: AssetRegistry, private readonly ov: ViewOverrides, readonly lights: LightTable) {
    IsoRenderer.registerComponents(this.view);
    for (const c of [VAnim, VPiece, VWet, VTemp, VFuel, VEquip, VOffHand]) this.view.register(c);
    const cat = noCosmetics ? undefined : registry.cosmetics;
    if (cat?.size) this.view.register(Appearance);
    renderer.bindGameplay({ animState: VAnim, buildPiece: VPiece, wetness: VWet, bodyTemp: VTemp, lit: VFuel, pieceState: (e) => this.pieceStates.get(e),
      hitFlash: (e) => this.hitPoseOf.get(e)?.flash ?? 0, hitTilt: (e) => this.hitPoseOf.get(e)?.tilt ?? 0,
      animRate: (e, st) => (st === 1 && this.characters.has(e) ? this.walkRate : undefined),
      equipment: VEquip, heldSprite: (item) => this.heldSpriteOf(item), offHand: VOffHand, offHandSprite: (item) => this.offHandSpriteOf(item),
      ...(cat?.size ? { appearance: { ...coreAppearanceBinding(cat), override: (_w: unknown, ve: number) => this.gearOf.get(ve) ?? null } } : {}) });
  }
  /** ADR-135: view entity -> worn-gear paper-doll overrides (salt = hash of the worn items). */
  private gearOf = new Map<number, { salt: number; parts: Array<[number, number]> }>();
  private heldCache = new Map<number, number | undefined>();
  private heldSpriteOf(item: number): number | undefined {
    if (this.heldCache.has(item)) return this.heldCache.get(item);
    const key = this.netRef ? gameplayDefs(this.netRef).items.get(item)?.key : undefined; if (!key) return undefined;
    const id = this.registry.ids.sprites.tryId(`held_${key}`); this.heldCache.set(item, id); return id;
  }
  private offCache = new Map<number, number | undefined>();
  private offHandSpriteOf(item: number): number | undefined {
    if (this.offCache.has(item)) return this.offCache.get(item);
    const key = this.netRef ? gameplayDefs(this.netRef).items.get(item)?.key : undefined; if (!key) return undefined;
    const id = resolveOffHandSprite(key, (k) => this.registry.ids.sprites.tryId(k)); this.offCache.set(item, id); return id;
  }
  private netRef: World | null = null;
  get appearanceEnabled(): boolean { return this.view.isRegistered(Appearance); }

  static async create(canvas: HTMLCanvasElement, base: string, ov: ViewOverrides = {}, onStage: (stage: string, f: number, label?: string) => void = () => {}): Promise<IsoView> {
    onStage("renderer", 0);
    const q0 = new URLSearchParams(location.search);
    // WebGL2 -> Canvas2D sprites -> (main.ts) debug. Probe a FRESH canvas: a lost/blocked context on #game must not decide.
    const probe = (k: "webgl2" | "2d"): unknown => document.createElement("canvas").getContext(k, k === "webgl2" ? { powerPreference: "default" } : undefined);
    const kind = chooseRenderer(probe, { forceCanvas: q0.get("renderer") === "canvas" });
    const make2d = (): IsoRenderer => { console.warn("[view] WebGL2 unavailable: Canvas2D sprite renderer"); return new Canvas2DRenderer(canvas) as unknown as IsoRenderer; };
    let renderer: IsoRenderer;
    if (kind === "canvas2d") renderer = make2d();
    else if (kind === "debug") throw new Error("no WebGL2 and no Canvas2D");
    else try { renderer = new IsoRenderer(canvas, { preserveDrawingBuffer: q0.has("shot"),
      // ?safe=1 implies ?gl=lowend (mediump, no float targets, low texture memory)
      // after a context loss gl-recovery.ts steps the level down (sessionStorage) so a reload starts lower and never loops
      ...(levelFlags(effectiveLevel(location.search)) ? { gl: levelFlags(effectiveLevel(location.search))! } : q0.get("safe") === "1" && !q0.get("gl") ? { gl: ["lowend" as const] } : {}),
      onError: (e) => { if (e.kind !== "context-restored") showRenderError(`Renderer: ${e.kind}`, `${e.message}${e.detail ? `\n${e.detail.slice(0, 300)}` : ""}\nTry ?gl=lowend or ?safe=1 — please report this text.`); } });
    } catch (e) { console.warn("[view] IsoRenderer failed", e); renderer = make2d(); }
    { const c = renderer.capabilities; console.info(`[view] gl ${c.renderer} mobile=${c.mobile} lowEnd=${c.lowEnd} flags=${c.flags.join(",")} fallbacks=${c.fallbacks.join("; ")}`); (globalThis as { __renderCaps?: unknown }).__renderCaps = c; }
    onStage("manifest", 0);
    const packBase = `${base}art/pack/`;
    const { registry } = await loadMergedManifest(`${base}art/`);
    onStage("atlases", 0);
    const sources = sourcesFromManifest(registry, packBase + "manifest.json", {}, { probeSiblings: false });
    // Art's customization pack (~220 paper-doll atlases, 1008x960): the renderer packs every atlas into one 2048² texture
    // array, so these alone need ~1.7 GiB of VRAM ("Texture total allocation size is too large" -> every sprite black).
    // Until Render loads outfit layers on demand, keep them out unless the array fits (?cz=1 forces them in).
    // Paper-doll layers are ON by default: Render streams wearable pages through a refcounted pool within the VRAM budget
    // (renderer.vram). ?cz=0 turns them off; under ?gl=lowend only the nearest DRESSED_LOWEND characters are dressed.
    const custom = [...registry.atlases.values()].filter((a) => /(^|\/)customization\//.test(a.image)).map((a) => a.key);
    for (const k of custom) { const src = sources.get(k); if (src) delete src.pages; } // 1x only for paper-doll layers
    lowendDress = renderer.capabilities.lowEnd || renderer.capabilities.flags.includes("lowend");
    if (q0.get("cz") === "1") lowendDress = false;
    if (custom.length && q0.get("cz") === "0") {
      for (const k of custom) { (registry.atlases as Map<string, unknown>).delete(k); sources.delete(k); }
      noCosmetics = true;
    }
    // ADR-118: count atlas/KTX2 image responses as they land (Resource Timing works for fetch and <img>); expected =
    // the eager atlases (paper-doll/streamed ones load on demand later), so the fraction stays honest and capped < 1.
    const expected = [...registry.atlases.keys()].filter((k) => !custom.includes(k)).length;
    const stopWatch = watchResources(/\.(png|webp|ktx2|avif|jpe?g)(\?|$)/i, (n, bytes) => onStage("atlases", countFraction(n, expected), `Loading sprite atlases (${n}/${expected}${bytes ? `, ${(bytes / 1048576).toFixed(1)} MB` : ""})`));
    try { await renderer.atlas.setRegistry(registry, sources); } finally { stopWatch(); }
    onStage("atlases", 1); onStage("variants", 0);
    const pv = await fetch(packBase + "piece_variants.json").then((r) => (r.ok ? r.json() : null)).catch(() => null) as { pieces?: Record<string, string[]> } | null;
    if (pv?.pieces) renderer.atlas.setPieceVariants(pv.pieces);
    for (const a of ["characters", "characters_b", "characters_c"]) if (registry.atlases.has(a)) {
      const h = await fetch(`${packBase}atlases/${a}.hands.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (h?.hands) renderer.atlas.setHands(a, h);
    }
    onStage("lighting", 0);
    const tuningUrl = `${base}art/survival_fx/render_tuning.json`;
    const look = await renderer.loadLook(tuningUrl);
    const lights = new LightTable(); lights.load(await fetch(tuningUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    if (look.warnings.length) console.info("render tuning:", look.warnings);
    renderer.camera.zoom = DESKTOP_ZOOM; // main.ts attachZoom then sizes it per viewport (ADR-100)
    onStage("ready", 0);
    const view = new IsoView(renderer, registry, ov, lights); view.base = base; return view;
  }

  private ghost: BuildGhost | undefined;
  /** Build-placement ghost from the client's buildMode.preview (call every frame; undefined removes it). Free-rotation
   *  pieces (rotSteps 16) are shown at the nearest quarter turn, triangles (12) on their exact art row (pieceArtRow); Tri/Free
   *  pieces pivot at the exact snapped x/y; variant goes by name (defs variantNames). */
  syncGhost(p: import("@engine/gameplay").BuildPreview | undefined, net: World): void {
    if (!p && !this.ghost) return;
    this.ghost ??= new BuildGhost(this.view, VPiece as never, this.registry);
    if (!p) { this.ghost.sync(null); return; }
    const names = gameplayDefs(net).pieces.get(p.piece)?.variantNames ?? [];
    const def = gameplayDefs(net).pieces.get(p.piece);
    this.ghost.sync({ pieceKey: this.pk(p.pieceKey) ?? p.pieceKey, x: p.x, y: p.y, rot: p.rot, valid: p.valid }, { z: p.z, level: p.level, tier: p.tier, rotSteps: p.rotSteps, exactPivot: exactPivot(def), ...(names[p.variant] ? { variant: names[p.variant]! } : { variant: p.variant }) });
  }
  resize(w: number, h: number, dpr: number): void {
    const safe = new URLSearchParams(location.search).get("safe") === "1" || this.renderer.capabilities.safe || this.renderer.capabilities.lowEnd;
    try { this.renderer.resize(w, h, safe ? 1 : dpr); } catch (e) { showRenderError("Resize failed", `${e instanceof Error ? e.message : String(e)}\n${glInfo(this.renderer.gl)}`); }
  }

  private sid(key: string | undefined): number | undefined { return key ? this.registry.ids.sprites.tryId(key) : undefined; }
  /** ADR-110: sprite with data-driven fallback (sprite_fallbacks.json); real art wins whenever the pack has the key. */
  private rsCache = new Map<string, (ResolvedSprite & { id: number }) | null>();
  private rs(key: string | undefined): (ResolvedSprite & { id: number }) | undefined {
    if (!key) return undefined; let r = this.rsCache.get(key);
    if (r === undefined) { const x = resolveSprite(key, (k) => this.sid(k) !== undefined); r = x ? { ...x, id: this.sid(x.key)! } : null; this.rsCache.set(key, r); }
    return r ?? undefined;
  }

  /** ADR-112: build-piece art fallback (sprite_fallbacks.json `to` chain over piece keys the pack has). */
  private pkCache = new Map<string, string>();
  private pk(key: string | undefined): string | undefined {
    if (!key) return key; let r = this.pkCache.get(key);
    if (r === undefined) { r = resolveSprite(key, (k) => this.registry.spriteForPiece(k) !== undefined)?.key ?? key; this.pkCache.set(key, r); }
    return r;
  }
  /** Mirror `net` into the view World and draw. */
  /** `dayFrac`: the shared smoothed day clock (day-clock.ts, server-tick driven); falls back to net's tick-derived time. */
  render(net: World, tiles: TileMap | undefined, player: Entity | undefined, alpha: number, dayFrac?: number): void {
    const v = this.view, r = this.renderer;
    r.tilemap = tiles;
    v.tick = net.tick;
    const td = v.env(TimeOfDay), nt = net.env(TimeOfDay); td.dayLengthTicks = nt.dayLengthTicks || 72000; // fallback = 3600 s day @ 20 Hz (ADR-106)
    // ADR-115: never re-derive time from the view's own tick (that desynced peers); draw the shared server-tick clock.
    const frac = this.ov.hours !== undefined ? this.ov.hours / 24 : dayFrac;
    td.epochTick = frac !== undefined ? Math.round(v.tick - frac * td.dayLengthTicks) : nt.epochTick;
    setDayFraction(v, frac);
    const w = v.env(Weather), nw = net.env(Weather) as unknown as Record<string, number>;
    for (const k of Object.keys(w)) (w as unknown as Record<string, number>)[k] = nw[k] ?? 0;
    if (this.ov.weather !== undefined) { w.kind = this.ov.weather; w.intensity = this.ov.intensity ?? 1; }

    let defs: ReturnType<typeof gameplayDefs> | undefined; try { defs = gameplayDefs(net); } catch { defs = undefined; }
    const seen = this.seen; seen.clear();
    // the sim moves on the z=0 plane; lift entities onto the terrain step they stand on (tile height = world z)
    const ground = (x: number, y: number, z: number): number => {
      if (!tiles) return z; const tx = Math.floor(x), ty = Math.floor(y); const c = tiles.getChunk(tileToChunk(tx), tileToChunk(ty));
      return c ? Math.max(z, c.height[tileToLocal(ty) * CHUNK_SIZE + tileToLocal(tx)] ?? 0) : z;
    };
    let dressed: Set<Entity> | undefined;
    if (lowendDress && this.appearanceEnabled && net.isRegistered(Appearance)) { // nearest N to the camera keep their layers
      const cx = this.renderer.camera.x, cy = this.renderer.camera.y;
      const d = [...net.query([Appearance, Transform])].map((e) => { const t = net.get(e, Transform)!; return { e, d: (t.x - cx) ** 2 + (t.y - cy) ** 2 }; });
      dressed = new Set(d.sort((a, b) => a.d - b.d).slice(0, DRESSED_LOWEND).map((x) => x.e));
    }
    for (const e of net.query([Transform])) {
      if (e === net.environment) continue;
      const cur = net.get(e, Transform)!; const prev = net.get(e, PrevTransform) ?? cur;
      let ve = this.map.get(e);
      if (ve === undefined) {
        const spec = this.classify(net, e, defs, e === player);
        if (!spec) continue;
        ve = v.create(); this.map.set(e, ve);
        v.add(ve, Transform, { x: cur.x, y: cur.y, z: ground(cur.x, cur.y, cur.z), facing: cur.facing }).add(ve, PrevTransform, { x: prev.x, y: prev.y, z: ground(prev.x, prev.y, prev.z), facing: prev.facing });
        if (spec.pieceVisual !== undefined) v.add(ve, VPiece, { visualId: spec.pieceVisual, variant: spec.variant ?? 0, tint: spec.tint ?? 0, damageStage: spec.damage ?? 0, rotation: spec.rot ?? 0, level: spec.level ?? 0, layer: spec.layer ?? 1, ghost: 0 });
        else if (spec.sprite !== undefined) v.add(ve, Sprite, { spriteId: spec.sprite!, frameId: spec.frame ?? 0, flags: spec.flags ?? 0, scale: spec.scale ?? 1, tint: spec.tint ?? 0 });
        if (spec.shadow) v.add(ve, Shadow, { alpha: spec.shadow, length: 1 });
        if (spec.occluder) v.add(ve, Occluder, { fade: 0.35 });
        if (spec.light) { v.add(ve, LightSource, { ...spec.light, intensity: 0 }); this.lightOf.set(e, { spec: spec.light, ...(spec.fuelOf !== undefined ? { fuel: spec.fuelOf } : {}) }); }
        if (spec.character) { this.characters.add(ve); if (defs) this.walkRate = walkAnimRate(net); }
        if (spec.animated) { v.add(ve, VAnim, { state: 0, startTick: 0 }); v.add(ve, VWet, { level: 0 }); v.add(ve, VTemp, { cold: 0, heat: 0, shivering: 0 }); }
        if (spec.fuel) v.add(ve, VFuel, { burnUntilTick: 0, lit: 1 });
        if (spec.onCreate) this.scales.set(ve, spec.onCreate);
        if (e === player) { r.setFocusEntity(ve); this.focusVe = ve; }
        if (CAM_ANIMAL && net.has(e, Animal) && (this.camAnimal === undefined || !this.map.has(this.camAnimal))) this.camAnimal = e;
      }
      seen.add(e);
      // facing from movement when the sim leaves it at 0
      const dx = cur.x - prev.x, dy = cur.y - prev.y, moving = dx * dx + dy * dy > 1e-6;
      let facing = cur.facing;
      if (!facing) { if (moving) this.lastMove.set(e, Math.atan2(dy, dx)); facing = this.lastMove.get(e) ?? 0; }
      v.set(ve, PrevTransform, { x: prev.x, y: prev.y, z: ground(prev.x, prev.y, prev.z), facing: v.get(ve, Transform)!.facing });
      v.set(ve, Transform, { x: cur.x, y: cur.y, z: ground(cur.x, cur.y, cur.z), facing });
      if (v.has(ve, VAnim)) {
        const ga = net.get(e, GAnim); const dead = net.has(e, Dead);
        let state = dead ? 5 : ga && ga.anim > 1 ? animMap(ga.anim) : moving ? (net.has(e, Zombie) ? 6 : 1) : 0;
        const an = net.get(e, Animal);
        if (an) state = this.animalAnim(net, e, an, moving, dead, player);
        // ADR-107: anything on a swim tile at ground level swims (players have no replicated AnimState; locomotion only)
        if (!dead && (state <= 2 || state === 6 || state === 14) && cur.z < 0.5 && defs && tiles && defs.movement.swimTiles.has(tiles.getTile(Math.floor(cur.x), Math.floor(cur.y)))) state = 14;
        const a = v.get(ve, VAnim)!; if (a.state !== state) v.set(ve, VAnim, { state, startTick: v.tick });
        const wet = net.get(e, Wetness); if (wet) v.set(ve, VWet, { level: wet.level });
        const bt = net.get(e, BodyTemp); if (bt) v.set(ve, VTemp, { cold: bt.cold, heat: bt.heat, shivering: bt.shivering });
      }
      if (net.has(e, ResourceNode) && v.has(ve, Sprite)) { // depleted nodes fade out
        const amt = net.get(e, ResourceNode)!.amount; const empty = amt === 0;
        // ADR-128: replicated node hp dropped -> short damped wiggle away from the local player (every client sees it)
        const was = this.nodeAmt.get(e); this.nodeAmt.set(e, amt);
        if (was !== undefined && amt < was) { const pt = player !== undefined ? net.get(player, Transform) : undefined; const ang = pt ? Math.atan2(cur.y - pt.y, cur.x - pt.x) : 0; this.nodeHit.set(e, { at: performance.now(), dx: Math.cos(ang), dy: Math.sin(ang) }); }
        const hit = this.nodeHit.get(e);
        if (hit) { const o = nodeWiggle(performance.now() - hit.at); if (o === undefined) this.nodeHit.delete(e); else v.set(ve, Transform, { x: cur.x + hit.dx * o, y: cur.y + hit.dy * o }); }
        const sp = v.get(ve, Sprite)!; const want = empty ? 0.0001 : this.baseScale(ve); if (sp.scale !== want) v.set(ve, Sprite, { scale: want });
      }
      this.syncHitReact(net, e, ve, cur);
      if (v.has(ve, Sprite) && net.has(e, NodeRegrow)) { // ADR-134: stump while it lasts, then invisible until regrown elsewhere
        const g = net.get(e, NodeRegrow)!; const want = g.stumpUntilTick > net.tick ? this.baseScale(ve) : 0.0001;
        if (v.get(ve, Sprite)!.scale !== want) v.set(ve, Sprite, { scale: want });
      }
      const lo = this.lightOf.get(e);
      if (lo) { // light follows the replicated lit state every frame (fires go out / get relit)
        const em = net.get(e, Emitter); const fu = net.get(lo.fuel ?? e, Fuel);
        const on = fu ? fu.lit === 1 : em ? em.strength > 0 : true;
        const want = on ? lo.spec.intensity : 0; if (v.get(ve, LightSource)!.intensity !== want) v.set(ve, LightSource, { intensity: want });
      }
      if (this.appearanceEnabled && net.isRegistered(Appearance)) { // paper-doll look (server-assigned, replicated)
        const a = dressed && !dressed.has(e) ? undefined : net.get(e, Appearance);
        if (!a && v.has(ve, Appearance)) v.remove(ve, Appearance); const va = a ? v.get(ve, Appearance) : undefined;
        if (a && (!va || va.version !== a.version)) { const init = { bodyType: a.bodyType, skinTone: a.skinTone, version: a.version, parts: [...a.parts], primary: [...a.primary], secondary: [...a.secondary] }; if (va) v.set(ve, Appearance, init); else v.add(ve, Appearance, init); }
      }
      if (net.isRegistered(Equipment) && net.has(e, Equipment)) { // ADR-135 held item + worn gear
        this.netRef = net; const eq = net.get(e, Equipment); const mh = eq?.mainHandItem ?? 0;
        if (eq && !v.has(ve, VEquip)) v.add(ve, VEquip, { mainHandItem: mh }); else if (v.has(ve, VEquip) && v.getField(ve, VEquip, "mainHandItem") !== mh) v.set(ve, VEquip, { mainHandItem: mh });
        const cat = this.registry.cosmetics; const gear = cat ? wornCosmetics(net, e, (k) => cat.byKey(k) !== undefined) : [];
        if (gear.length && cat) { let salt = 7; const parts: Array<[number, number]> = []; for (const [s, k] of gear) { const id = cat.byKey(k)?.id; if (id === undefined) continue; parts.push([slotIndex(s as WearableSlot), id]); salt = (salt * 31 + id * 8 + slotIndex(s as WearableSlot)) % 32749; }
          if (parts.length) this.gearOf.set(ve, { salt: salt + 1, parts }); else this.gearOf.delete(ve); }
        else this.gearOf.delete(ve);
      }
      if (net.isRegistered(Worn)) { // ADR-135 off-hand worn slot
        const oh = net.has(e, Worn) ? (net.get(e, Worn)?.item[OFFHAND_SLOT] ?? 0) : 0;
        if (oh) { this.netRef = net; if (!v.has(ve, VOffHand)) v.add(ve, VOffHand, { offHandItem: oh }); else if (v.getField(ve, VOffHand, "offHandItem") !== oh) v.set(ve, VOffHand, { offHandItem: oh }); }
        else if (v.has(ve, VOffHand)) v.remove(ve, VOffHand);
      }
      if (v.has(ve, Sprite) && net.has(e, Crop)) { const c = net.get(e, Crop)!; const r = this.rs(cropSpriteKey(c.kind, c.stage)); if (r && (v.get(ve, Sprite)!.spriteId !== r.id || v.get(ve, Sprite)!.scale !== r.scale)) { v.set(ve, Sprite, { spriteId: r.id, scale: r.scale, tint: r.tint }); this.scales.set(ve, r.scale); } }
      if (v.has(ve, Sprite) && net.has(e, Road)) { const r0 = net.get(e, Road)!; const r = this.roadSprite(r0.surface, r0.mask); if (r && v.get(ve, Sprite)!.spriteId !== r.id) v.set(ve, Sprite, { spriteId: r.id }); } // neighbours placed / removed
      if (v.has(ve, Sprite) && net.has(e, Sign)) { const sp = v.get(ve, Sprite)!; const fid = this.signFrame(sp.spriteId, net.get(e, Sign)!.rot); if (sp.frameId !== fid) v.set(ve, Sprite, { frameId: fid }); } // rotated
      if (v.has(ve, VPiece)) this.syncPieceState(net, e, ve, defs);
      if (v.has(ve, VFuel)) { const f = net.get(e, Fuel); if (f) { v.set(ve, VFuel, { lit: f.lit, burnUntilTick: f.burnUntilTick }); if (v.has(ve, Sprite)) { const sp = v.get(ve, Sprite)!; const fid = this.fireFrame(sp.spriteId, f.lit !== 0); if (sp.frameId !== fid) v.set(ve, Sprite, { frameId: fid }); } } }
    }
    for (const [ne, ve] of this.map) if (!seen.has(ne)) { if (ve === this.focusVe) { r.setFocusEntity(-1); this.focusVe = -1; } v.destroy(ve); this.map.delete(ne); this.characters.delete(ve); this.lightOf.delete(ne); this.pieceStates.delete(ve); this.lastMove.delete(ne); this.nodeAmt.delete(ne); this.nodeHit.delete(ne); this.animalHp.delete(ne); this.animalPrev.delete(ne); this.scales.delete(ve); this.hitSeen.delete(ne); this.hitPoseOf.delete(ve); this.gearOf.delete(ve); }

    this.syncClutter(tiles, ground);
    const camE = CAM_ANIMAL && this.camAnimal !== undefined ? this.camAnimal : player;
    const pv = camE !== undefined ? this.map.get(camE) : undefined;
    let want: { x: number; y: number; z: number } | undefined;
    if (pv !== undefined) { const t = v.get(pv, Transform)!, p = v.get(pv, PrevTransform) ?? t; want = { x: p.x + (t.x - p.x) * alpha, y: p.y + (t.y - p.y) * alpha, z: p.z + (t.z - p.z) * alpha }; }
    const st = this.status;
    const why = player === undefined ? `no player entity (entities ${this.map.size}, local server ${st?.localServer ?? "?"}, snapshots ${st?.snapshots ?? 0}${st?.error ? `: ${st.error}` : ""})` : "player not mirrored into the view";
    const hadErr = this.camGuard.error; const tgt = this.camGuard.resolve(want, camE !== player ? "follow" : "player", why);
    if (this.camGuard.error && !hadErr) console.warn(`[render] ${this.camGuard.error}`);
    r.camera.lookAt(tgt.x, tgt.y, tgt.z);
    r.sceneDiag = { entities: this.map.size, playerEid: player, cameraTarget: tgt, localServer: st?.localServer, snapshots: st?.snapshots, lastError: st?.error ?? this.camGuard.error };
    v.runPhase("renderPrep", 0);
    try { r.render(v, alpha); } catch (e) { showRenderError("Renderer exception", `${e instanceof Error ? e.stack ?? e.message : String(e)}\n${glInfo(r.gl)}`); return; }
    // all-black self-check over the first frames (daytime only, where black means a broken pass)
    if (this.checks < 90 && ++this.checks % 30 === 0 && daylightOf(r) > 0.5) {
      if (frameIsBlack(r.gl)) { if (++this.blackFrames >= 2) showRenderError("World rendered black", glInfo(r.gl)); } else this.blackFrames = 0;
    }
  }
  private checks = 0; private blackFrames = 0;
  /** View entity currently given to setFocusEntity; cleared when destroyed so a recycled id (a remote player) never inherits the focus silhouette. */
  private focusVe = -1;
  /** ADR-110 render-only ground clutter: view-World sprites for chunks around the camera (never networked). Density 1,
   *  ~0.35 under ?gl=lowend / ?safe=1; hard cap on live sprites; ?clutter=0 disables. Missing clutter_* art = nothing. */
  private clutter = new Map<string, Entity[]>(); private clutterFrame = 0; private clutterCount = 0;
  private syncClutter(tiles: TileMap | undefined, ground: (x: number, y: number, z: number) => number): void {
    if (!tiles || CLUTTER.density <= 0 || ++this.clutterFrame % 15 !== 1) return;
    const v = this.view; const ccx = tileToChunk(Math.floor(this.renderer.camera.x)), ccy = tileToChunk(Math.floor(this.renderer.camera.y)); const R = CLUTTER.radius;
    for (const [k, list] of this.clutter) { const [x, y] = k.split(",").map(Number) as [number, number];
      if (Math.abs(x - ccx) > R + 1 || Math.abs(y - ccy) > R + 1) { for (const ve of list) v.destroy(ve); this.clutterCount -= list.length; this.clutter.delete(k); } }
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const cx = ccx + dx, cy = ccy + dy, k = `${cx},${cy}`; if (this.clutter.has(k) || !tiles.getChunk(cx, cy)) continue;
      const list: Entity[] = [];
      for (const it of clutterForChunk(0x5eed, cx, cy, CHUNK_SIZE, (tx, ty) => tiles.getTile(tx, ty), CLUTTER.density)) {
        if (this.clutterCount + list.length >= CLUTTER.cap) break;
        const r = this.rs(it.key); if (!r) continue; // no art and no fallback: skipped
        const ve = v.create(); const z = ground(it.x, it.y, 0);
        v.add(ve, Transform, { x: it.x, y: it.y, z, facing: 0 }).add(ve, PrevTransform, { x: it.x, y: it.y, z, facing: 0 }).add(ve, Sprite, { spriteId: r.id, frameId: 0, flags: it.flip ? SpriteFlag.FlipX : 0, scale: it.scale * r.scale, tint: r.tint });
        list.push(ve);
      }
      this.clutter.set(k, list); this.clutterCount += list.length;
    }
  }
  /** ADR-134: replicated HitReact -> flinch (knockback nudge on the view Transform, squash on Sprite.scale, flash/tilt bindings). */
  private syncHitReact(net: World, e: Entity, ve: Entity, cur: { x: number; y: number }): void {
    const h = net.get(e, HitReact); const v = this.view; const now = performance.now();
    if (h) { const s = this.hitSeen.get(e);
      if (!s) this.hitSeen.set(e, { tick: h.startTick, at: net.tick - h.startTick <= 6 ? now : -1e9, dir: hitDirRad(h.dir) }); // late joiners skip stale hits
      else if (s.tick !== h.startTick) { s.tick = h.startTick; s.at = now; s.dir = hitDirRad(h.dir); } }
    const s = this.hitSeen.get(e); const pose = s ? hitPose(now - s.at, s.dir) : undefined;
    const had = this.hitPoseOf.get(ve);
    if (!pose) { if (had) { this.hitPoseOf.delete(ve); if (v.has(ve, Sprite)) v.set(ve, Sprite, { scale: had.base }); } return; }
    const base = had?.base ?? v.get(ve, Sprite)?.scale ?? 1;
    this.hitPoseOf.set(ve, { ...pose, base });
    const t = v.get(ve, Transform)!; v.set(ve, Transform, { x: cur.x + pose.dx, y: cur.y + pose.dy, z: t.z, facing: t.facing });
    if (v.has(ve, Sprite)) v.set(ve, Sprite, { scale: base * pose.scale });
  }
  /** ADR-134 test/diag hook: current flinch pose of a net entity's view, if any. */
  hitPoseFor(netEntity: Entity): { scale: number; tilt: number; flash: number } | undefined { const ve = this.map.get(netEntity); return ve === undefined ? undefined : this.hitPoseOf.get(ve); }
  /** Set by the app each frame (local-server state, snapshots received, startup error) for diag + the camera fallback. */
  status: ViewStatus | undefined;
  readonly camGuard = new CameraTargetGuard(CAMERA_FALLBACK, CAMERA_GRACE_FRAMES);
  private animalHp = new Map<Entity, { hp: number; hitUntil: number }>();
  /** Animal anim (render state ids: 0 idle, 1 walk, 2 run, 4 hit, 5 death) from Animal.state (0 idle, 1 wander, 2 flee), movement and Health. */
  private animalAnim(net: World, e: Entity, an: { kind: number; state: number }, moving: boolean, dead: boolean, _player: Entity | undefined): number {
    const now = performance.now(); const hp = net.get(e, Health)?.hp; const rec = this.animalHp.get(e) ?? { hp: hp ?? 0, hitUntil: 0 };
    if (hp !== undefined) { if (hp < rec.hp - 1e-3) rec.hitUntil = now + 250; rec.hp = hp; } this.animalHp.set(e, rec); // ADR-117: animal sounds come from the audio director
    const st = dead || (hp !== undefined && hp <= 0) ? 5 : now < rec.hitUntil ? 4 : an.state === 2 && moving ? 2 : moving ? 1 : 0;
    this.animalPrev.set(e, st === 5 ? 5 : an.state);
    return st;
  }
  private animalPrev = new Map<Entity, number>();
  base = "/"; private camAnimal: Entity | undefined;

  private scales = new Map<Entity, number>();

  /** Owning piece of an attachment: the BuildPiece standing at the same position (attachments copy its Transform). */
  private pieceAt(net: World, e: Entity): Entity | undefined {
    const t = net.get(e, Transform); if (!t) return undefined;
    for (const p of net.query([GPiece, Transform])) { const pt = net.get(p, Transform)!; if (Math.abs(pt.x - t.x) < 1e-3 && Math.abs(pt.y - t.y) < 1e-3 && Math.abs(pt.z - t.z) < 1e-3) return p; }
    return undefined;
  }
  private pieceKeyAt(net: World, e: Entity, defs: ReturnType<typeof gameplayDefs> | undefined): string | undefined {
    const p = this.pieceAt(net, e); return p !== undefined ? defs?.pieces.get(net.get(p, GPiece)!.type)?.key : undefined;
  }
  private siblings(net: World, e: Entity): Entity[] {
    const t = net.get(e, Transform)!; const out: Entity[] = [];
    for (const o of net.query([PieceLink, Transform])) { if (o === e) continue; const ot = net.get(o, Transform)!; if (Math.abs(ot.x - t.x) < 1e-3 && Math.abs(ot.y - t.y) < 1e-3 && Math.abs(ot.z - t.z) < 1e-3) out.push(o); }
    return out;
  }
  private hasLightSibling(net: World, e: Entity): boolean { return this.siblings(net, e).some((o) => net.get(o, Emitter)?.kind === 2); }
  private fuelSibling(net: World, e: Entity): Entity | undefined { return this.siblings(net, e).find((o) => net.has(o, Fuel)); }
  /** Fired pieces show their "unlit" building state while their fire attachment is out. */
  private syncPieceState(net: World, e: Entity, ve: Entity, defs: ReturnType<typeof gameplayDefs> | undefined): void {
    const def = defs?.pieces.get(net.get(e, GPiece)?.type ?? -1) as { fired?: boolean } | undefined; if (!def?.fired) return;
    if ((net.tick + entityIndex(e)) % 15 !== 0 && this.pieceStates.has(ve)) return; // cheap: lit flips are rare
    const fire = this.siblings(net, e).find((o) => net.has(o, Fuel)); const lit = fire !== undefined && net.get(fire, Fuel)!.lit === 1;
    const p = net.get(e, GPiece)!;
    const vis = buildPieceVisual(this.registry, { type: p.type, ...artRot(p.rot, rotationSteps(net, p.type)), tint: p.tint, paint: p.paint, state: lit ? "idle" : "unlit" }, { pieceKey: (t) => this.pk(defs?.pieces.get(t)?.key), ...pieceVariantOpts(defs?.pieces.get(p.type)?.variantNames, p.variant) });
    this.pieceStates.set(ve, vis.stateIndex);
  }
  /** ADR-119: autotile variant for the replicated mask, else the plain surface tile (with sprite_fallbacks). */
  private roadSprite(surface: number, mask: number): (ResolvedSprite & { id: number }) | undefined {
    const [m, base] = roadSpriteKeys(surfaceDef(surface)?.key, mask); const exact = this.sid(m);
    return exact !== undefined ? { key: m, id: exact, scale: 1, tint: 0 } as ResolvedSprite & { id: number } : this.rs(base);
  }
  private fireFrame(sid: number, lit: boolean): number {
    let names: string[] = []; try { names = this.registry.sprite(sid).animList.map((a) => a.name ?? ""); } catch { /* unknown sprite */ }
    return stationFireFrame(names, lit);
  }
  private signFrame(sid: number, rot: number): number {
    let names: string[] = []; try { names = this.registry.sprite(sid).animList.map((a) => a.name ?? ""); } catch { /* unknown sprite */ }
    return signFrameId(names, rot);
  }
  private baseScale(ve: Entity): number { return this.scales.get(ve) ?? 1; }

  private classify(net: World, e: Entity, defs: ReturnType<typeof gameplayDefs> | undefined, own: boolean): Spec | undefined {
    const h = (entityIndex(e) * 2654435761) >>> 0;
    // characters: own player (Survival is owner-only) + other players and human bots (PlayerId / Appearance / Health+AnimState)
    if (net.has(e, Animal)) {
      const k = animalDefs()[net.get(e, Animal)!.kind]; const r = this.rs(k?.spriteKey);
      if (r) return { sprite: r.id, animated: true, shadow: 0.8, ...(r.tint ? { tint: r.tint } : {}), ...(r.scale !== 1 ? { scale: r.scale, onCreate: r.scale } : {}) };
      const ph = this.sid(`animal_${k?.key ?? ""}`) ?? this.sid("player"); // species key fallback; base sprite only if the pack lacks animal art
      return ph === undefined ? undefined : { sprite: ph, animated: true, shadow: 0.6, ...(this.sid(`animal_${k?.key ?? ""}`) === undefined ? { scale: 0.55, onCreate: 0.55 } : {}) };
    }
    if (net.has(e, Survival) || (!net.has(e, Zombie) && (net.has(e, PlayerId) || net.has(e, Appearance) || (net.has(e, Health) && net.has(e, GAnim))))) {
      const s = this.sid(own ? "player" : PLAYER_KEYS[h % PLAYER_KEYS.length]) ?? this.sid("player");
      return s === undefined ? undefined : { sprite: s, animated: true, shadow: 1, character: true };
    }
    if (net.has(e, Zombie)) {
      const z = net.get(e, Zombie)!; const key = defs?.zombies.get(z.kind)?.spriteKey;
      const s = this.sid(key) ?? this.sid("zombie_walker");
      return s === undefined ? undefined : { sprite: s, animated: true, shadow: 1, frame: z.variant };
    }
    if (net.has(e, NodeRegrow)) { // ADR-134: depleted tree -> stump (<species>_tree_stump, else tree_stump) until stumpUntilTick; other kinds draw nothing
      const g = net.get(e, NodeRegrow)!; if (g.stumpUntilTick <= net.tick) return undefined;
      const sk = stumpKeys(defs?.resources.get(g.kind)?.spriteKey); const r = this.rs(sk[0]) ?? this.rs(sk[1]); if (!r) return undefined;
      return { sprite: r.id, flags: h & 1 ? SpriteFlag.FlipX : 0, scale: r.scale, shadow: 0.6, onCreate: r.scale, ...(r.tint ? { tint: r.tint } : {}) };
    }
    if (net.has(e, ResourceNode)) {
      const n = net.get(e, ResourceNode)!; const key = defs?.resources.get(n.kind)?.spriteKey;
      const r = this.rs(key); if (!r) return undefined; const s = r.id;
      const tall = key === "tree" || !!key?.startsWith("tree_") || !!key?.endsWith("_tree"); // ADR-110 species: <x>_tree
      const scale = (tall ? 1.1 + (h % 50) / 100 : 1) * r.scale;
      return { sprite: s, ...(r.tint ? { tint: r.tint } : {}), flags: (h & 1 ? SpriteFlag.FlipX : 0) | (tall || !!key?.endsWith("_bush") ? SpriteFlag.Sway : 0), scale, shadow: 0.9, occluder: !!tall, onCreate: scale };
    }
    if (net.has(e, Road)) { // ADR-119: flat road_<surface>_m<mask> autotile -> road_<surface> -> sprite_fallbacks chain
      const r0 = net.get(e, Road)!; const r = this.roadSprite(r0.surface, r0.mask); if (!r) return undefined;
      return { sprite: r.id, flags: ROAD_FLAGS, ...(r.tint ? { tint: r.tint } : {}), ...(r.scale !== 1 ? { scale: r.scale, onCreate: r.scale } : {}) };
    }
    if (net.has(e, Sign)) { // ADR-120: the sign post art at its facing (idle / idle_r1..r3); its text is a DOM world label (world-labels.ts)
      const s0 = net.get(e, Sign)!; const r = this.rs(signDef(s0.kind)?.key ?? "sign_wooden_post");
      return r ? { sprite: r.id, frame: this.signFrame(r.id, s0.rot), shadow: 0.6, ...(r.tint ? { tint: r.tint } : {}), ...(r.scale !== 1 ? { scale: r.scale, onCreate: r.scale } : {}) } : undefined;
    }
    if (net.has(e, Crop)) { // ADR-110: farm_soil / crop_<plant>_<stage> / sapling_<tree|bush>_<stage> (stage synced per frame)
      const c = net.get(e, Crop)!; const r = this.rs(cropSpriteKey(c.kind, c.stage)); if (!r) return undefined;
      return { sprite: r.id, scale: r.scale, onCreate: r.scale, ...(r.tint ? { tint: r.tint } : {}), flags: (h & 1 ? SpriteFlag.FlipX : 0) | (c.kind > 0 ? SpriteFlag.Sway : 0), shadow: c.kind > 0 ? 0.5 : 0 };
    }
    // Piece attachments (fire/fuel, light, door, storage) share the piece's position: no sprite of their own, but a
    // light Emitter (kind 2) or a fired attachment becomes a renderer light keyed by the owning piece.
    if (net.has(e, PieceLink)) {
      const key = this.pieceKeyAt(net, e, defs);
      const em = net.get(e, Emitter);
      const isLight = em?.kind === 2 || (net.has(e, Fuel) && !this.hasLightSibling(net, e));
      const spec = isLight ? this.lights.get(key) ?? this.lights.get("campfire") : undefined;
      return spec ? { light: spec, ...(em?.kind === 2 ? { fuelOf: this.fuelSibling(net, e) } : {}) } : undefined;
    }
    if (isFreeStandingStation(net.has(e, CraftingStation), net.has(e, GPiece))) { // free-standing station (spawnStation): bonfire sprite + light following Fuel.lit
      const s = this.sid("bonfire") ?? this.sid("campfire_lit") ?? this.sid("fx_fire"); if (s === undefined) return undefined;
      const fired = net.has(e, Fuel); const spec = fired ? this.lights.get("bonfire") : undefined;
      return { sprite: s, frame: fired ? this.fireFrame(s, (net.getField(e, Fuel, "lit") ?? 0) !== 0) : 0, shadow: 0.6, fuel: fired, ...(spec ? { light: spec } : {}) };
    }
    if (net.has(e, GPiece) && defs) {
      const p = net.get(e, GPiece)!; const def = defs.pieces.get(p.type);
      const vis = buildPieceVisual(this.registry, { type: p.type, ...artRot(p.rot, rotationSteps(net, p.type)), tint: p.tint, paint: p.paint, damageStage: p.damageStage }, { tier: p.tier, pieceKey: (t) => this.pk(defs.pieces.get(t)?.key), ...pieceVariantOpts(def?.variantNames, p.variant) });
      if (!vis.visualId) return undefined;
      const lh = (defs as unknown as { building?: { levelHeight?: number } }).building?.levelHeight ?? 1;
      const z = net.get(e, Transform)!.z; const level = Math.max(0, Math.round(z / (lh || 1)));
      return { pieceVisual: vis.visualId, variant: p.variant, rot: vis.rotation | (exactPivot(def) ? ROT_EXACT_PIVOT : 0), tint: 0, damage: vis.damageStage, level, layer: vis.layer, pieceKey: def?.key };
    }
    // emissive sprites (e.g. glow mushrooms) carry a light when the table knows their key
    return undefined;
  }
}

/** gameplay Placement.Tri (4) and the vertex-snapped Free (3) corner walls (ADR-104): drawn at the exact Transform x/y
 *  (centroid / vertex), not the floored tile. Other Free pieces keep the tile-centre pivot. */
const exactPivot = (def: { placement?: number; key?: string } | undefined): boolean => def?.placement === 4 || (def?.placement === 3 && !!def.key?.startsWith("wall_corner"));
/** rot/rotSteps for buildPieceVisual: triangles (12 steps of 30°) map exactly onto an art row (pieceArtRow), no quarter-turn snap. */
const artRot = (rot: number, steps: number): { rot: number; rotSteps: number } => (steps === 12 ? { rot: pieceArtRow(rot, 12), rotSteps: 4 } : { rot, rotSteps: steps });

interface Spec {
  sprite?: number; frame?: number; flags?: number; scale?: number; shadow?: number; occluder?: boolean; animated?: boolean; character?: boolean; fuel?: boolean;
  light?: { r: number; g: number; b: number; radius: number; intensity: number; flicker: number };
  pieceVisual?: number; variant?: number; rot?: number; onCreate?: number; tint?: number; damage?: number; level?: number; layer?: number; pieceKey?: string | undefined;
  /** light gated by this sibling's Fuel.lit (light attachment of a fired piece) */ fuelOf?: Entity | undefined;
}

/** Art's sfx_animal_<species> (2 variants, ogg); silently skipped if audio is unavailable or blocked before a user gesture. */

/** `<art>/manifests.index.json` (written by vite.config.ts with only the served fragments) or MANIFEST_INDEX (manifest-index.ts). */
async function loadMergedManifest(art: string): Promise<ReturnType<typeof loadManifest>> {
  const get = async (u: string): Promise<unknown> => { try { const r = await fetch(u); return r.ok ? await r.json() : undefined; } catch { return undefined; } };
  const idx = (await get(art + "manifests.index.json")) as { fragments?: ManifestFragmentRef[] } | undefined;
  const list = idx?.fragments?.length ? idx.fragments : MANIFEST_INDEX;
  const frags: ManifestFragment[] = []; const dirOf = new Map<string, string>();
  for (const f of list) {
    const url = new URL(f.url, new URL(art, location.href)).href; let m = await get(url);
    if (m === undefined) { if (f.optional) continue; throw new Error(`manifest fetch failed: ${url}`); }
    // ADR-138: a v2 shard index fetches its shards in parallel and merges them (duplicate keys across shards throw)
    m = await resolveManifestShards(m, async (file) => get(new URL(file, url).href));
    frags.push({ name: f.name, manifest: m as ManifestJson }); dirOf.set(f.name, url.replace(/[^/]*$/, ""));
  }
  // atlas paths become absolute per fragment, so sourcesFromManifest (pack base) loads each PNG from its one source
  const { manifest, collisions, warnings } = mergeManifests(frags, { resolve: (p, frag) => (/^(\/|[a-z]+:)/i.test(p) ? p : new URL(p, dirOf.get(frag)).pathname) });
  if (collisions.length) console.info(`[view] manifest: ${collisions.length} duplicate keys kept from the first fragment (${collisions.slice(0, 5).map((c) => `${c.section}.${c.key}`).join(", ")}...)`);
  for (const w of warnings) if (!/ defined in /.test(w)) console.warn(`[view] manifest: ${w}`);
  const lock = await get(art + "pack/ids.lock.json") as Parameters<typeof loadManifest>[1] extends infer O ? O extends { lock?: infer L } ? L : never : never;
  return loadManifest(manifest, lock ? { lock } : {});
}

/** Daylight for the black-frame self-check; renderers without a `lighting` state (Canvas2D) count as night (check skipped). */
export function daylightOf(r: { lighting?: { daylight?: number } | undefined }): number { return r.lighting?.daylight ?? 0; }
