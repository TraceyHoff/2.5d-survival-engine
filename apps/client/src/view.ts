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
import { World, Transform, PrevTransform, TimeOfDay, Weather, Appearance, PlayerId, defineComponent, entityIndex, type Entity } from "@engine/core";
import { CHUNK_SIZE, tileToChunk, tileToLocal, type TileMap } from "@engine/world";
import { loadManifest, mergeManifests, buildPieceVisual, quarterTurn, type AssetRegistry, type ManifestFragment, type ManifestJson } from "@engine/assets";
import { BuildGhost, IsoRenderer, Sprite, Shadow, LightSource, Occluder, SpriteFlag, sourcesFromManifest, coreAppearanceBinding, CameraTargetGuard } from "@engine/render";
import { gameplayDefs, rotationSteps, animalDefs, Animal, Health, Survival, Zombie, ResourceNode, CraftingStation, Fuel, AnimState as GAnim, BuildPiece as GPiece, Dead, Wetness, BodyTemp, Emitter, PieceLink } from "@engine/gameplay";

/** Render-side schemas the renderer's bindings expect (view World only). */
const VAnim = defineComponent("ViewAnimState", { state: "u8", startTick: "u32" });
const VPiece = defineComponent("ViewBuildPiece", { visualId: "u16", variant: "u8", tint: "u32", damageStage: "u8", rotation: "u8", level: "u8", layer: "u8", ghost: "u8" });
const VWet = defineComponent("ViewWetness", { level: "u8" });
const VTemp = defineComponent("ViewBodyTemp", { cold: "u8", heat: "u8", shivering: "u8" });
const VFuel = defineComponent("ViewFuel", { burnUntilTick: "u32", lit: "u8" });
/** gameplay Anim (Idle Walk Run Attack Hurt Die Gather Build) -> render AnimStateId (Idle Walk Run Attack Hit Death ...). */
const ANIM_MAP = [0, 1, 2, 3, 4, 5, 3, 3];
import { LightTable, type LightSpec } from "./lights.js";
/** `?cam=animal`: debug camera that follows the first ambient animal instead of the player. */
const CAM_ANIMAL = typeof location !== "undefined" && new URLSearchParams(location.search).get("cam") === "animal";
/** Max bytes for the sprite texture array (mips included) before customization layers are dropped. */
/** ?gl=lowend: characters beyond the nearest N draw body-only. */
const DRESSED_LOWEND = 8;
let lowendDress = false;
/** Set when the paper-doll atlases were left out, so Appearance layers are not bound to missing sprites. */
let noCosmetics = false;
const PLAYER_KEYS = ["player", "player_b", "player_c"];

/** Camera fallback when no player is replicated for CAMERA_GRACE_FRAMES: the world spawn (server SPAWN, camp nearby). */
export const CAMERA_FALLBACK = { x: 16, y: 16, z: 0 };
const CAMERA_GRACE_FRAMES = 300;
export interface ViewStatus { localServer: string; snapshots: number; error?: string }
export interface ViewOverrides { hours?: number; weather?: number; intensity?: number }

export class IsoView {
  readonly view = new World({ seed: 1 });
  private map = new Map<Entity, Entity>();
  private lastMove = new Map<Entity, number>();
  private seen = new Set<Entity>();
  /** Light emitters (net entity -> table spec), re-evaluated every frame from replicated Fuel.lit / Emitter.strength. */
  private lightOf = new Map<Entity, { spec: LightSpec; fuel?: Entity }>();
  /** Piece view entity -> building state index (e.g. "unlit") for the renderer's pieceState binding. */
  private pieceStates = new Map<number, number>();
  private constructor(readonly renderer: IsoRenderer, readonly registry: AssetRegistry, private readonly ov: ViewOverrides, readonly lights: LightTable) {
    IsoRenderer.registerComponents(this.view);
    for (const c of [VAnim, VPiece, VWet, VTemp, VFuel]) this.view.register(c);
    const cat = noCosmetics ? undefined : registry.cosmetics;
    if (cat?.size) this.view.register(Appearance);
    renderer.bindGameplay({ animState: VAnim, buildPiece: VPiece, wetness: VWet, bodyTemp: VTemp, lit: VFuel, pieceState: (e) => this.pieceStates.get(e),
      ...(cat?.size ? { appearance: coreAppearanceBinding(cat) } : {}) });
  }
  get appearanceEnabled(): boolean { return this.view.isRegistered(Appearance); }

  static async create(canvas: HTMLCanvasElement, base: string, ov: ViewOverrides = {}, onProgress: (f: number, label: string) => void = () => {}): Promise<IsoView> {
    onProgress(0.05, "Loading art manifest");
    const q0 = new URLSearchParams(location.search);
    const renderer = new IsoRenderer(canvas, { preserveDrawingBuffer: q0.has("shot"),
      // ?safe=1 implies ?gl=lowend (mediump, no float targets, low texture memory)
      ...(q0.get("safe") === "1" && !q0.get("gl") ? { gl: ["lowend" as const] } : {}),
      onError: (e) => { if (e.kind !== "context-restored") showRenderError(`Renderer: ${e.kind}`, `${e.message}${e.detail ? `\n${e.detail.slice(0, 300)}` : ""}\nTry ?gl=lowend or ?safe=1 — please report this text.`); } });
    { const c = renderer.capabilities; console.info(`[view] gl ${c.renderer} mobile=${c.mobile} lowEnd=${c.lowEnd} flags=${c.flags.join(",")} fallbacks=${c.fallbacks.join("; ")}`); (globalThis as { __renderCaps?: unknown }).__renderCaps = c; }
    const packBase = `${base}art/pack/`;
    const { registry } = await loadMergedManifest(`${base}art/`);
    onProgress(0.3, "Loading sprite atlases");
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
    await renderer.atlas.setRegistry(registry, sources);
    onProgress(0.75, "Loading building variants");
    const pv = await fetch(packBase + "piece_variants.json").then((r) => (r.ok ? r.json() : null)).catch(() => null) as { pieces?: Record<string, string[]> } | null;
    if (pv?.pieces) renderer.atlas.setPieceVariants(pv.pieces);
    for (const a of ["characters", "characters_b", "characters_c"]) if (registry.atlases.has(a)) {
      const h = await fetch(`${packBase}atlases/${a}.hands.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (h?.hands) renderer.atlas.setHands(a, h);
    }
    onProgress(0.9, "Loading lighting");
    const tuningUrl = `${base}art/survival_fx/render_tuning.json`;
    const look = await renderer.loadLook(tuningUrl);
    const lights = new LightTable(); lights.load(await fetch(tuningUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    if (look.warnings.length) console.info("render tuning:", look.warnings);
    renderer.camera.zoom = 1.6; onProgress(1, "Ready");
    const view = new IsoView(renderer, registry, ov, lights); view.base = base; return view;
  }

  private ghost: BuildGhost | undefined;
  /** Build-placement ghost from the client's buildMode.preview (call every frame; undefined removes it). Free-rotation
   *  pieces (rotSteps 16) are shown at the nearest quarter turn; variant goes by name (defs variantNames). */
  syncGhost(p: import("@engine/gameplay").BuildPreview | undefined, net: World): void {
    if (!p && !this.ghost) return;
    this.ghost ??= new BuildGhost(this.view, VPiece as never, this.registry);
    if (!p) { this.ghost.sync(null); return; }
    const names = gameplayDefs(net).pieces.get(p.piece)?.variantNames ?? [];
    const rot = quarterTurn(p.rot, p.rotSteps);
    this.ghost.sync({ pieceKey: p.pieceKey, x: p.x, y: p.y, rot, valid: p.valid }, { z: p.z, level: p.level, tier: p.tier, ...(names[p.variant] ? { variant: names[p.variant]! } : { variant: p.variant }) });
  }
  resize(w: number, h: number, dpr: number): void {
    const safe = new URLSearchParams(location.search).get("safe") === "1";
    try { this.renderer.resize(w, h, safe ? 1 : Math.min(2, dpr)); } catch (e) { showRenderError("Resize failed", `${e instanceof Error ? e.message : String(e)}\n${glInfo(this.renderer.gl)}`); }
  }

  private sid(key: string | undefined): number | undefined { return key ? this.registry.ids.sprites.tryId(key) : undefined; }

  /** Mirror `net` into the view World and draw. */
  render(net: World, tiles: TileMap | undefined, player: Entity | undefined, alpha: number): void {
    const v = this.view, r = this.renderer;
    r.tilemap = tiles;
    v.tick = net.tick;
    const td = v.env(TimeOfDay), nt = net.env(TimeOfDay); td.dayLengthTicks = nt.dayLengthTicks || 24000; td.epochTick = nt.epochTick;
    if (this.ov.hours !== undefined) td.epochTick = Math.round(v.tick - (this.ov.hours / 24) * td.dayLengthTicks);
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
        else if (spec.sprite !== undefined) v.add(ve, Sprite, { spriteId: spec.sprite!, frameId: spec.frame ?? 0, flags: spec.flags ?? 0, scale: spec.scale ?? 1, tint: 0 });
        if (spec.shadow) v.add(ve, Shadow, { alpha: spec.shadow, length: 1 });
        if (spec.occluder) v.add(ve, Occluder, { fade: 0.35 });
        if (spec.light) { v.add(ve, LightSource, { ...spec.light, intensity: 0 }); this.lightOf.set(e, { spec: spec.light, ...(spec.fuelOf !== undefined ? { fuel: spec.fuelOf } : {}) }); }
        if (spec.animated) { v.add(ve, VAnim, { state: 0, startTick: 0 }); v.add(ve, VWet, { level: 0 }); v.add(ve, VTemp, { cold: 0, heat: 0, shivering: 0 }); }
        if (spec.fuel) v.add(ve, VFuel, { burnUntilTick: 0, lit: 1 });
        if (spec.onCreate) this.scales.set(ve, spec.onCreate);
        if (e === player) r.setFocusEntity(ve);
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
        let state = dead ? 5 : ga && ga.anim > 1 ? ANIM_MAP[ga.anim] ?? 0 : moving ? (net.has(e, Zombie) ? 6 : 1) : 0;
        const an = net.get(e, Animal);
        if (an) state = this.animalAnim(net, e, an, moving, dead, player);
        const a = v.get(ve, VAnim)!; if (a.state !== state) v.set(ve, VAnim, { state, startTick: v.tick });
        const wet = net.get(e, Wetness); if (wet) v.set(ve, VWet, { level: wet.level });
        const bt = net.get(e, BodyTemp); if (bt) v.set(ve, VTemp, { cold: bt.cold, heat: bt.heat, shivering: bt.shivering });
      }
      if (net.has(e, ResourceNode) && v.has(ve, Sprite)) { // depleted nodes fade out
        const empty = (net.get(e, ResourceNode)!.amount === 0);
        const sp = v.get(ve, Sprite)!; const want = empty ? 0.0001 : this.baseScale(ve); if (sp.scale !== want) v.set(ve, Sprite, { scale: want });
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
      if (v.has(ve, VPiece)) this.syncPieceState(net, e, ve, defs);
      if (v.has(ve, VFuel)) { const f = net.get(e, Fuel); if (f) v.set(ve, VFuel, { lit: f.lit, burnUntilTick: f.burnUntilTick }); }
    }
    for (const [ne, ve] of this.map) if (!seen.has(ne)) { v.destroy(ve); this.map.delete(ne); this.lightOf.delete(ne); this.pieceStates.delete(ve); this.lastMove.delete(ne); this.animalHp.delete(ne); this.animalSfxAt.delete(ne); this.animalPrev.delete(ne); this.scales.delete(ve); }

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
    if (this.checks < 90 && ++this.checks % 30 === 0 && r.lighting.daylight > 0.5) {
      if (frameIsBlack(r.gl)) { if (++this.blackFrames >= 2) showRenderError("World rendered black", glInfo(r.gl)); } else this.blackFrames = 0;
    }
  }
  private checks = 0; private blackFrames = 0;
  /** Set by the app each frame (local-server state, snapshots received, startup error) for diag + the camera fallback. */
  status: ViewStatus | undefined;
  readonly camGuard = new CameraTargetGuard(CAMERA_FALLBACK, CAMERA_GRACE_FRAMES);
  private animalHp = new Map<Entity, { hp: number; hitUntil: number }>();
  private animalSfxAt = new Map<Entity, number>(); private sfxBudgetAt = 0;
  /** Animal anim (render state ids: 0 idle, 1 walk, 2 run, 4 hit, 5 death) from Animal.state (0 idle, 1 wander, 2 flee), movement and Health. */
  private animalAnim(net: World, e: Entity, an: { kind: number; state: number }, moving: boolean, dead: boolean, player: Entity | undefined): number {
    const now = performance.now(); const hp = net.get(e, Health)?.hp; const rec = this.animalHp.get(e) ?? { hp: hp ?? 0, hitUntil: 0 };
    let hurt = false; if (hp !== undefined) { if (hp < rec.hp - 1e-3) { rec.hitUntil = now + 250; hurt = true; } rec.hp = hp; } this.animalHp.set(e, rec);
    const st = dead || (hp !== undefined && hp <= 0) ? 5 : now < rec.hitUntil ? 4 : an.state === 2 && moving ? 2 : moving ? 1 : 0;
    // species sound: when hurt/killed, starting to flee, or now and then when idle; only near the player, rate-limited
    const key = animalDefs()[an.kind]?.key; const pt = player !== undefined ? net.get(player, Transform) : undefined; const t = net.get(e, Transform);
    if (key && pt && t && Math.hypot(pt.x - t.x, pt.y - t.y) < 9) {
      const last = this.animalSfxAt.get(e) ?? 0; const prevState = this.animalPrev.get(e);
      const want = hurt || (st === 5 && prevState !== 5) || (an.state === 2 && prevState !== 2 && now - last > 3000) || (st === 0 && now - last > 12000 && Math.random() < 0.002);
      if (want && now > this.sfxBudgetAt) { this.animalSfxAt.set(e, now); this.sfxBudgetAt = now + 400; playAnimalSfx(this.base, key, Math.max(0.15, 1 - Math.hypot(pt.x - t.x, pt.y - t.y) / 9)); }
    }
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
    const vis = buildPieceVisual(this.registry, { type: p.type, rot: p.rot, rotSteps: rotationSteps(net, p.type), tint: p.tint, paint: p.paint, state: lit ? "idle" : "unlit" }, { pieceKey: (t) => defs?.pieces.get(t)?.key });
    this.pieceStates.set(ve, vis.stateIndex);
  }
  private baseScale(ve: Entity): number { return this.scales.get(ve) ?? 1; }

  private classify(net: World, e: Entity, defs: ReturnType<typeof gameplayDefs> | undefined, own: boolean): Spec | undefined {
    const h = (entityIndex(e) * 2654435761) >>> 0;
    // characters: own player (Survival is owner-only) + other players and human bots (PlayerId / Appearance / Health+AnimState)
    if (net.has(e, Animal)) {
      const k = animalDefs()[net.get(e, Animal)!.kind]; const s = this.sid(k?.spriteKey);
      if (s !== undefined) return { sprite: s, animated: true, shadow: 0.8 };
      const ph = this.sid(`animal_${k?.key ?? ""}`) ?? this.sid("player"); // species key fallback; base sprite only if the pack lacks animal art
      return ph === undefined ? undefined : { sprite: ph, animated: true, shadow: 0.6, ...(this.sid(`animal_${k?.key ?? ""}`) === undefined ? { scale: 0.55, onCreate: 0.55 } : {}) };
    }
    if (net.has(e, Survival) || (!net.has(e, Zombie) && (net.has(e, PlayerId) || net.has(e, Appearance) || (net.has(e, Health) && net.has(e, GAnim))))) {
      const s = this.sid(own ? "player" : PLAYER_KEYS[h % PLAYER_KEYS.length]) ?? this.sid("player");
      return s === undefined ? undefined : { sprite: s, animated: true, shadow: 1 };
    }
    if (net.has(e, Zombie)) {
      const z = net.get(e, Zombie)!; const key = defs?.zombies.get(z.kind)?.spriteKey;
      const s = this.sid(key) ?? this.sid("zombie_walker");
      return s === undefined ? undefined : { sprite: s, animated: true, shadow: 1, frame: z.variant };
    }
    if (net.has(e, ResourceNode)) {
      const n = net.get(e, ResourceNode)!; const key = defs?.resources.get(n.kind)?.spriteKey;
      const s = this.sid(key); if (s === undefined) return undefined;
      const tall = key === "tree" || key?.startsWith("tree_");
      const scale = tall ? 1.1 + (h % 50) / 100 : 1;
      return { sprite: s, flags: (h & 1 ? SpriteFlag.FlipX : 0) | (tall || key === "berry_bush" ? SpriteFlag.Sway : 0), scale, shadow: 0.9, occluder: !!tall, onCreate: scale };
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
    if (net.has(e, CraftingStation)) { // free-standing station (spawnStation): bonfire sprite + light following Fuel.lit
      const s = this.sid("bonfire") ?? this.sid("campfire_lit") ?? this.sid("fx_fire"); if (s === undefined) return undefined;
      const fired = net.has(e, Fuel); const spec = fired ? this.lights.get("bonfire") : undefined;
      return { sprite: s, shadow: 0.6, fuel: fired, ...(spec ? { light: spec } : {}) };
    }
    if (net.has(e, GPiece) && defs) {
      const p = net.get(e, GPiece)!; const def = defs.pieces.get(p.type);
      const vis = buildPieceVisual(this.registry, { type: p.type, rot: p.rot, rotSteps: rotationSteps(net, p.type), tint: p.tint, paint: p.paint, damageStage: p.damageStage }, { tier: p.tier, pieceKey: (t) => defs.pieces.get(t)?.key });
      if (!vis.visualId) return undefined;
      const lh = (defs as unknown as { building?: { levelHeight?: number } }).building?.levelHeight ?? 1;
      const z = net.get(e, Transform)!.z; const level = Math.max(0, Math.round(z / (lh || 1)));
      return { pieceVisual: vis.visualId, variant: p.variant, rot: vis.rotation, tint: 0, damage: vis.damageStage, level, layer: vis.layer, pieceKey: def?.key };
    }
    // emissive sprites (e.g. glow mushrooms) carry a light when the table knows their key
    return undefined;
  }
}

interface Spec {
  sprite?: number; frame?: number; flags?: number; scale?: number; shadow?: number; occluder?: boolean; animated?: boolean; fuel?: boolean;
  light?: { r: number; g: number; b: number; radius: number; intensity: number; flicker: number };
  pieceVisual?: number; variant?: number; rot?: number; onCreate?: number; tint?: number; damage?: number; level?: number; layer?: number; pieceKey?: string | undefined;
  /** light gated by this sibling's Fuel.lit (light attachment of a fired piece) */ fuelOf?: Entity | undefined;
}

/** Art's sfx_animal_<species> (2 variants, ogg); silently skipped if audio is unavailable or blocked before a user gesture. */
function playAnimalSfx(base: string, species: string, vol: number): void {
  try { const a = new Audio(`${base}art/pack/audio/sfx/animal_${species}_${1 + Math.floor(Math.random() * 2)}.ogg`); a.volume = 0.5 * vol; a.playbackRate = 0.9 + Math.random() * 0.2; void a.play().catch(() => undefined); } catch { /* no audio */ }
}

/**
 * Sub-manifests merged onto the pack manifest (ADR-081 mergeManifests, first definition wins). Overridable by an optional
 * `<art>/manifests.index.json` ({ fragments: [{ name, url, optional? }] }, urls relative to <art>/). Missing optional
 * fragments are skipped, so Art can split branding/customization out of pack/manifest.json without a client change.
 */
const MANIFEST_INDEX: { name: string; url: string; optional?: boolean }[] = [
  { name: "pack", url: "pack/manifest.json" },
  { name: "ui-kit", url: "ui/kit/manifest.ui.kit.json", optional: true },
  { name: "branding", url: "ui/branding/manifest.branding.json", optional: true },
  { name: "customization", url: "pack/customization/manifest.customization.json", optional: true },
  { name: "vehicles", url: "pack/vehicles/manifest.vehicles.json", optional: true },
  { name: "items", url: "pack/items/manifest.items.json", optional: true },
];
async function loadMergedManifest(art: string): Promise<ReturnType<typeof loadManifest>> {
  const get = async (u: string): Promise<unknown> => { try { const r = await fetch(u); return r.ok ? await r.json() : undefined; } catch { return undefined; } };
  const idx = (await get(art + "manifests.index.json")) as { fragments?: typeof MANIFEST_INDEX } | undefined;
  const list = idx?.fragments?.length ? idx.fragments : MANIFEST_INDEX;
  const frags: ManifestFragment[] = []; const dirOf = new Map<string, string>();
  for (const f of list) {
    const url = new URL(f.url, new URL(art, location.href)).href; const m = await get(url);
    if (m === undefined) { if (f.optional) continue; throw new Error(`manifest fetch failed: ${url}`); }
    frags.push({ name: f.name, manifest: m as ManifestJson }); dirOf.set(f.name, url.replace(/[^/]*$/, ""));
  }
  // atlas paths become absolute per fragment, so sourcesFromManifest (pack base) loads each PNG from its one source
  const { manifest, collisions, warnings } = mergeManifests(frags, { resolve: (p, frag) => (/^(\/|[a-z]+:)/i.test(p) ? p : new URL(p, dirOf.get(frag)).pathname) });
  if (collisions.length) console.info(`[view] manifest: ${collisions.length} duplicate keys kept from the first fragment (${collisions.slice(0, 5).map((c) => `${c.section}.${c.key}`).join(", ")}...)`);
  for (const w of warnings) if (!/ defined in /.test(w)) console.warn(`[view] manifest: ${w}`);
  const lock = await get(art + "pack/ids.lock.json") as Parameters<typeof loadManifest>[1] extends infer O ? O extends { lock?: infer L } ? L : never : never;
  return loadManifest(manifest, lock ? { lock } : {});
}
