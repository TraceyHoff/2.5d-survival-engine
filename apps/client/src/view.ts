/**
 * WebGL2 game view: @engine/render IsoRenderer + Art's pack (packages/assets/pack, served at `<base>art/pack/`).
 *
 * The net World cannot carry render components (World.getSchemaHash covers every registered store and must match
 * the server), so the renderer draws a separate *view World*: each frame `sync()` mirrors the replicated entities
 * (Transform/PrevTransform, env TimeOfDay + Weather, tick) into it and attaches Sprite/AnimState/LightSource/Shadow
 * from the gameplay components (Survival = character, Zombie, ResourceNode, CraftingStation, BuildPiece) using the
 * gameplay defs' sprite keys. Terrain is the net TileClient's TileMap, drawn directly.
 */
import { World, Transform, PrevTransform, TimeOfDay, Weather, Appearance, defineComponent, entityIndex, type Entity } from "@engine/core";
import { CHUNK_SIZE, tileToChunk, tileToLocal, type TileMap } from "@engine/world";
import { fetchDefaultManifest, buildPieceVisual, type AssetRegistry } from "@engine/assets";
import { IsoRenderer, Sprite, Shadow, LightSource, Occluder, SpriteFlag, sourcesFromManifest, coreAppearanceBinding } from "@engine/render";
import { gameplayDefs, Survival, Zombie, ResourceNode, CraftingStation, Fuel, AnimState as GAnim, BuildPiece as GPiece, Dead, Wetness, BodyTemp, Emitter, PieceLink } from "@engine/gameplay";

/** Render-side schemas the renderer's bindings expect (view World only). */
const VAnim = defineComponent("ViewAnimState", { state: "u8", startTick: "u32" });
const VPiece = defineComponent("ViewBuildPiece", { visualId: "u16", variant: "u8", tint: "u32", damageStage: "u8", rotation: "u8", level: "u8", layer: "u8", ghost: "u8" });
const VWet = defineComponent("ViewWetness", { level: "u8" });
const VTemp = defineComponent("ViewBodyTemp", { cold: "u8", heat: "u8", shivering: "u8" });
const VFuel = defineComponent("ViewFuel", { burnUntilTick: "u32", lit: "u8" });
/** gameplay Anim (Idle Walk Run Attack Hurt Die Gather Build) -> render AnimStateId (Idle Walk Run Attack Hit Death ...). */
const ANIM_MAP = [0, 1, 2, 3, 4, 5, 3, 3];
import { LightTable, type LightSpec } from "./lights.js";
const PLAYER_KEYS = ["player", "player_b", "player_c"];

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
    const cat = registry.cosmetics;
    if (cat?.size) this.view.register(Appearance);
    renderer.bindGameplay({ animState: VAnim, buildPiece: VPiece, wetness: VWet, bodyTemp: VTemp, lit: VFuel, pieceState: (e) => this.pieceStates.get(e),
      ...(cat?.size ? { appearance: coreAppearanceBinding(cat) } : {}) });
  }
  get appearanceEnabled(): boolean { return this.view.isRegistered(Appearance); }

  static async create(canvas: HTMLCanvasElement, base: string, ov: ViewOverrides = {}): Promise<IsoView> {
    const renderer = new IsoRenderer(canvas, { preserveDrawingBuffer: new URLSearchParams(location.search).has("shot") });
    const packBase = `${base}art/pack/`;
    const { registry } = await fetchDefaultManifest(`${base}art/`);
    const sources = sourcesFromManifest(registry, packBase + "manifest.json", {}, { probeSiblings: false });
    await renderer.atlas.setRegistry(registry, sources);
    const pv = await fetch(packBase + "piece_variants.json").then((r) => (r.ok ? r.json() : null)).catch(() => null) as { pieces?: Record<string, string[]> } | null;
    if (pv?.pieces) renderer.atlas.setPieceVariants(pv.pieces);
    for (const a of ["characters", "characters_b", "characters_c"]) if (registry.atlases.has(a)) {
      const h = await fetch(`${packBase}atlases/${a}.hands.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (h?.hands) renderer.atlas.setHands(a, h);
    }
    const tuningUrl = `${base}art/survival_fx/render_tuning.json`;
    const look = await renderer.loadLook(tuningUrl);
    const lights = new LightTable(); lights.load(await fetch(tuningUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    if (look.warnings.length) console.info("render tuning:", look.warnings);
    renderer.camera.zoom = 1.6;
    return new IsoView(renderer, registry, ov, lights);
  }

  resize(w: number, h: number, dpr: number): void { this.renderer.resize(w, h, Math.min(2, dpr)); }

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
        const state = dead ? 5 : ga && ga.anim > 1 ? ANIM_MAP[ga.anim] ?? 0 : moving ? (net.has(e, Zombie) ? 6 : 1) : 0;
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
        const a = net.get(e, Appearance); const va = a ? v.get(ve, Appearance) : undefined;
        if (a && (!va || va.version !== a.version)) { const init = { bodyType: a.bodyType, skinTone: a.skinTone, version: a.version, parts: [...a.parts], primary: [...a.primary], secondary: [...a.secondary] }; if (va) v.set(ve, Appearance, init); else v.add(ve, Appearance, init); }
      }
      if (v.has(ve, VPiece)) this.syncPieceState(net, e, ve, defs);
      if (v.has(ve, VFuel)) { const f = net.get(e, Fuel); if (f) v.set(ve, VFuel, { lit: f.lit, burnUntilTick: f.burnUntilTick }); }
    }
    for (const [ne, ve] of this.map) if (!seen.has(ne)) { v.destroy(ve); this.map.delete(ne); this.lightOf.delete(ne); this.pieceStates.delete(ve); this.lastMove.delete(ne); this.scales.delete(ve); }

    const pv = player !== undefined ? this.map.get(player) : undefined;
    if (pv !== undefined) {
      const t = v.get(pv, Transform)!, p = v.get(pv, PrevTransform) ?? t;
      r.camera.lookAt(p.x + (t.x - p.x) * alpha, p.y + (t.y - p.y) * alpha, p.z + (t.z - p.z) * alpha);
    } else r.camera.lookAt(16, 16, 1);
    v.runPhase("renderPrep", 0);
    r.render(v, alpha);
  }

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
    const vis = buildPieceVisual(this.registry, { type: p.type, rot: p.rot, tint: p.tint, paint: p.paint, state: lit ? "idle" : "unlit" }, { pieceKey: (t) => defs?.pieces.get(t)?.key });
    this.pieceStates.set(ve, vis.stateIndex);
  }
  private baseScale(ve: Entity): number { return this.scales.get(ve) ?? 1; }

  private classify(net: World, e: Entity, defs: ReturnType<typeof gameplayDefs> | undefined, own: boolean): Spec | undefined {
    const h = (entityIndex(e) * 2654435761) >>> 0;
    if (net.has(e, Survival)) {
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
      const vis = buildPieceVisual(this.registry, { type: p.type, rot: p.rot, tint: p.tint, paint: p.paint, damageStage: p.damageStage }, { pieceKey: (t) => defs.pieces.get(t)?.key });
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
