/**
 * WebGL2 game view: @engine/render IsoRenderer + Art's pack (packages/assets/pack, served at `<base>art/pack/`).
 *
 * The net World cannot carry render components (World.getSchemaHash covers every registered store and must match
 * the server), so the renderer draws a separate *view World*: each frame `sync()` mirrors the replicated entities
 * (Transform/PrevTransform, env TimeOfDay + Weather, tick) into it and attaches Sprite/AnimState/LightSource/Shadow
 * from the gameplay components (Survival = character, Zombie, ResourceNode, CraftingStation, BuildPiece) using the
 * gameplay defs' sprite keys. Terrain is the net TileClient's TileMap, drawn directly.
 */
import { World, Transform, PrevTransform, TimeOfDay, Weather, defineComponent, entityIndex, type Entity } from "@engine/core";
import { CHUNK_SIZE, tileToChunk, tileToLocal, type TileMap } from "@engine/world";
import { fetchDefaultManifest, type AssetRegistry } from "@engine/assets";
import { IsoRenderer, Sprite, Shadow, LightSource, Occluder, SpriteFlag, sourcesFromManifest } from "@engine/render";
import { gameplayDefs, Survival, Zombie, ResourceNode, CraftingStation, Fuel, AnimState as GAnim, BuildPiece as GPiece, Dead, Wetness, BodyTemp } from "@engine/gameplay";

/** Render-side schemas the renderer's bindings expect (view World only). */
const VAnim = defineComponent("ViewAnimState", { state: "u8", startTick: "u32" });
const VPiece = defineComponent("ViewBuildPiece", { visualId: "u16", variant: "u8", tint: "u32", damageStage: "u8", rotation: "u8", level: "u8", layer: "u8", ghost: "u8" });
const VWet = defineComponent("ViewWetness", { level: "u8" });
const VTemp = defineComponent("ViewBodyTemp", { cold: "u8", heat: "u8", shivering: "u8" });
const VFuel = defineComponent("ViewFuel", { burnUntilTick: "u32", lit: "u8" });
/** gameplay Anim (Idle Walk Run Attack Hurt Die Gather Build) -> render AnimStateId (Idle Walk Run Attack Hit Death ...). */
const ANIM_MAP = [0, 1, 2, 3, 4, 5, 3, 3];
const PLAYER_KEYS = ["player", "player_b", "player_c"];

export interface ViewOverrides { hours?: number; weather?: number; intensity?: number }

export class IsoView {
  readonly view = new World({ seed: 1 });
  private map = new Map<Entity, Entity>();
  private lastMove = new Map<Entity, number>();
  private seen = new Set<Entity>();
  private constructor(readonly renderer: IsoRenderer, readonly registry: AssetRegistry, private readonly ov: ViewOverrides) {
    IsoRenderer.registerComponents(this.view);
    for (const c of [VAnim, VPiece, VWet, VTemp, VFuel]) this.view.register(c);
    renderer.bindGameplay({ animState: VAnim, buildPiece: VPiece, wetness: VWet, bodyTemp: VTemp, lit: VFuel });
  }

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
    const look = await renderer.loadLook(`${base}art/survival_fx/render_tuning.json`);
    if (look.warnings.length) console.info("render tuning:", look.warnings);
    renderer.camera.zoom = 1.6;
    return new IsoView(renderer, registry, ov);
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
        if (spec.pieceVisual !== undefined) v.add(ve, VPiece, { visualId: spec.pieceVisual, variant: spec.variant ?? 0, tint: 0, damageStage: 0, rotation: spec.rot ?? 0, level: 0, layer: 1, ghost: 0 });
        else v.add(ve, Sprite, { spriteId: spec.sprite!, frameId: spec.frame ?? 0, flags: spec.flags ?? 0, scale: spec.scale ?? 1, tint: 0 });
        if (spec.shadow) v.add(ve, Shadow, { alpha: spec.shadow, length: 1 });
        if (spec.occluder) v.add(ve, Occluder, { fade: 0.35 });
        if (spec.light) v.add(ve, LightSource, spec.light);
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
      if (v.has(ve, VFuel)) { const f = net.get(e, Fuel); if (f) v.set(ve, VFuel, { lit: f.lit, burnUntilTick: f.burnUntilTick }); }
    }
    for (const [ne, ve] of this.map) if (!seen.has(ne)) { v.destroy(ve); this.map.delete(ne); this.lastMove.delete(ne); this.scales.delete(ve); }

    const pv = player !== undefined ? this.map.get(player) : undefined;
    if (pv !== undefined) {
      const t = v.get(pv, Transform)!, p = v.get(pv, PrevTransform) ?? t;
      r.camera.lookAt(p.x + (t.x - p.x) * alpha, p.y + (t.y - p.y) * alpha, p.z + (t.z - p.z) * alpha);
    } else r.camera.lookAt(16, 16, 1);
    v.runPhase("renderPrep", 0);
    r.render(v, alpha);
  }

  private scales = new Map<Entity, number>();
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
    if (net.has(e, CraftingStation)) {
      const s = this.sid("bonfire") ?? this.sid("campfire_lit") ?? this.sid("fx_fire"); if (s === undefined) return undefined;
      const lit = net.has(e, Fuel);
      return { sprite: s, shadow: 0.6, fuel: lit, ...(lit ? { light: { r: 1, g: 0.62, b: 0.3, radius: 6, intensity: 1.2, flicker: 0.5 } } : {}) };
    }
    if (net.has(e, GPiece) && defs) {
      const p = net.get(e, GPiece)!; const def = defs.pieces.get(p.type) as { spriteKey?: string } | undefined;
      const s = this.sid(def?.spriteKey); return s === undefined ? undefined : { pieceVisual: s, variant: p.variant, rot: p.rot };
    }
    return undefined;
  }
}

interface Spec {
  sprite?: number; frame?: number; flags?: number; scale?: number; shadow?: number; occluder?: boolean; animated?: boolean; fuel?: boolean;
  light?: { r: number; g: number; b: number; radius: number; intensity: number; flicker: number };
  pieceVisual?: number; variant?: number; rot?: number; onCreate?: number;
}
