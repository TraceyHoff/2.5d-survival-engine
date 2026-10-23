/**
 * Demo scene built from the @engine/assets SAMPLE manifest (debug placeholders, not art):
 * terrain, scattered resources, a small multi-level base (floors/walls/pillars/roof) on a world
 * BuildingGrid, items/equipment on the ground, players (tint variants) and zombies (native + TexturePacker-imported).
 */
import { Rng, Transform, defineComponent, type World, type Entity } from "@engine/core";
import { CHUNK_SIZE, TileMap, tileToChunk, tileToLocal, BuildingGrid, loadBuildPieces, ChunkedSpatialIndex } from "@engine/world";
import type { AssetRegistry } from "@engine/assets";
import { Sprite, LightSource, Shadow, Occluder, SpriteFlag, TileId, tileHeight } from "../src/index.js";
import { BuildPiece, AnimState, AnimStateId, Wetness, BodyTemp, Emitter, Fuel, EmitterKind, Burning, Equipment } from "./mockGameplay.js";

/** DEMO item ids for the Equipment mock -> held sprite keys (gameplay item ids are not used by the render demo). */
export const DEMO_ITEM = { iron_axe: 1, torch: 2, iron_sword: 3 } as const;
export const DEMO_HELD: Record<number, string> = { 1: "held_iron_axe", 2: "held_torch", 3: "held_iron_sword" };
export const Wander = defineComponent("Wander", { dx: "f32", dy: "f32", timer: "f32", speed: "f32" });
export const DEMO_COMPONENTS = [Wander, BuildPiece, AnimState, Wetness, BodyTemp, Emitter, Fuel, Burning, Equipment] as const;

function valueNoise(seed: number): (x: number, y: number) => number {
  const h = (x: number, y: number): number => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
    n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
const fbm = (n: (x: number, y: number) => number, x: number, y: number): number => {
  let s = 0, a = 0.5, f = 1; for (let i = 0; i < 5; i++) { s += a * n(x * f, y * f); f *= 2.03; a *= 0.5; } return s / 0.97;
};

export interface Scene { map: TileMap; grid: BuildingGrid; index: ChunkedSpatialIndex; player: Entity; players: Entity[]; zombies: Entity[]; base: { x: number; y: number; w: number; h: number }; spriteCount: number; burning: Entity[]; pieceCount: number; size: number }

export function buildScene(world: World, reg: AssetRegistry, opts: { size: number; seed: number; density: number; zombies: number; inside: boolean; occlusionTest?: boolean; burn?: boolean }): Scene {
  const burning: Entity[] = [];
  const { size, seed } = opts; const rng = new Rng(seed);
  const elev = valueNoise(seed);
  const map = new TileMap(); const index = new ChunkedSpatialIndex();
  const base = { x: Math.floor(size / 2) - 3, y: Math.floor(size / 2) - 3, w: 6, h: 6 };
  const cx = base.x + 3, cy = base.y + 3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let e = fbm(elev, x / 26, y / 26);
    const d = Math.hypot(x - cx, y - cy); if (d < 13) e = 0.5 + (e - 0.5) * (d / 13) * 0.25;
    let id: number, h: number;
    if (e < 0.37) { id = TileId.Water; h = 0; } else if (e < 0.42) { id = TileId.Sand; h = 1; }
    else if (e < 0.6) { id = TileId.Grass; h = 1; } else if (e < 0.68) { id = TileId.Grass; h = 2; }
    else if (e < 0.76) { id = TileId.Dirt; h = 3; } else { id = TileId.Stone; h = 4; }
    map.setTile(x, y, id);
    map.ensureChunk(tileToChunk(x), tileToChunk(y)).setHeight(tileToLocal(x), tileToLocal(y), h);
  }
  void CHUNK_SIZE;
  let spriteCount = 0;
  const sid = (k: string): number => reg.id(k);
  const spawn = (x: number, y: number, key: string, o: { flags?: number; scale?: number; shadow?: number; occl?: boolean; frame?: number; tint?: number } = {}): Entity => {
    const e = world.create(); const z = Math.max(0, tileHeight(map, Math.floor(x), Math.floor(y)));
    world.add(e, Transform, { x, y, z, facing: 0 });
    world.add(e, Sprite, { spriteId: sid(key), frameId: o.frame ?? 0, flags: o.flags ?? 0, scale: o.scale ?? 1, tint: o.tint ?? 0 });
    if (o.shadow) world.add(e, Shadow, { alpha: o.shadow, length: 1 });
    if (o.occl) world.add(e, Occluder, { fade: 0.35 });
    index.insert(e, x, y); spriteCount++; return e;
  };
  const light = (e: Entity, r: number, g: number, b: number, radius: number, intensity: number, flicker: number): void => { world.add(e, LightSource, { r, g, b, radius, intensity, flicker }); };

  // pack tree variants when present (fixture has only "tree")
  const trees = ["tree", "tree_pine", "tree_autumn", "tree_apple", "tree_twisty"].filter((k) => reg.ids.sprites.tryId(k) !== undefined);
  const treeKey = (r: number): string => trees[Math.floor(r * 997) % trees.length]!;
  // resources
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    if (Math.abs(x - cx) < 9 && Math.abs(y - cy) < 12) continue;
    const id = map.getTile(x, y); if (id === TileId.Water) continue;
    const tries = rng.next() < opts.density % 1 ? Math.ceil(opts.density) : Math.floor(opts.density);
    for (let k = 0; k < tries; k++) {
      const r = rng.next(); const px = x + rng.range(0.2, 0.8), py = y + rng.range(0.2, 0.8);
      const flip = rng.next() < 0.5 ? SpriteFlag.FlipX : 0;
      if (id === TileId.Grass) {
        if (r < 0.32) spawn(px, py, treeKey(r), { flags: flip | SpriteFlag.Sway, scale: rng.range(1.1, 1.6), shadow: 1 });
        else if (r < 0.42) spawn(px, py, "berry_bush", { flags: flip | SpriteFlag.Sway, scale: rng.range(0.9, 1.2), shadow: 0.8 });
        else if (r < 0.47) spawn(px, py, "boulder", { flags: flip, shadow: 0.9 });
      } else if (id === TileId.Dirt || id === TileId.Stone) {
        if (r < 0.2) spawn(px, py, "boulder", { flags: flip, scale: rng.range(1, 1.4), shadow: 0.9 });
        else if (r < 0.32) spawn(px, py, "iron_vein", { flags: flip, shadow: 0.9 });
        else if (r < 0.4) spawn(px, py, trees.includes("tree_pine") ? "tree_pine" : "tree", { flags: flip | SpriteFlag.Sway, scale: 1.2, shadow: 1 });
      } else if (id === TileId.Sand && r < 0.05) spawn(px, py, "boulder", { scale: 0.8, shadow: 0.8 });
    }
  }

  // base: BuildingGrid + BuildPiece entities. Footprints/layers come from the sprite's typed `building` block (pack wave 2:
  // 1-tile pieces; fixture: 2x2 floors / 2x1 walls). Layers follow gameplay/world: 0 deck (floors, foundations AND roofs,
  // placed on the level above the walls), 1 structure, 2 furniture, 3 decor.
  const has = (k: string): boolean => reg.ids.sprites.tryId(k) !== undefined;
  const pick = (...ks: string[]): string => ks.find(has) ?? ks[ks.length - 1]!;
  const fp = (k: string) => { try { return reg.byKey(k).building?.footprint ?? { w: 1, h: 1 }; } catch { return { w: 1, h: 1 }; } };
  const lay = (k: string, d: number) => { try { return reg.byKey(k).building?.layer ?? d; } catch { return d; } };
  const roofKey = pick("roof_flat", "roof", "floor");
  const fireKey = pick("bonfire", "campfire");
  const defs = [
    { key: "floor", sprite: "floor", layer: 0 }, { key: "wall", sprite: "wall", layer: 1 }, { key: "pillar", sprite: "pillar", layer: 1 },
    { key: "campfire", sprite: fireKey, layer: 2 }, { key: "roof", sprite: roofKey, layer: 0 },
    ...(has("rug") ? [{ key: "rug", sprite: "rug", layer: 3 }] : []),
  ];
  const { registry: pieces } = loadBuildPieces(defs.map((d) => ({ key: d.key, footprint: fp(d.sprite), layer: lay(d.sprite, d.layer), hp: 100, sprite: d.sprite })), { resolveSprite: (k) => reg.ids.sprites.tryId(k) });
  const grid = new BuildingGrid(pieces);
  let pieceCount = 0;
  const groundZ = Math.max(0, tileHeight(map, cx, cy));
  const piece = (key: string, tx: number, ty: number, rot = 0, level = 0, o: { damage?: number; ghost?: number; tint?: number; variant?: number } = {}): Entity => {
    const def = pieces.byKey(key);
    if (!o.ghost) grid.place(def.id, tx, ty, level, rot);
    const e = world.create();
    world.add(e, Transform, { x: tx, y: ty, z: groundZ, facing: 0 });
    world.add(e, BuildPiece, { visualId: def.sprite ?? 0, variant: o.variant ?? 0, tint: o.tint ?? 0, damageStage: o.damage ?? 0, rotation: rot, level, layer: def.layer, ghost: o.ghost ?? 0 });
    pieceCount++; return e;
  };
  const F = pieces.byKey("floor").footprint, W = pieces.byKey("wall").footprint.w;
  for (let y = 0; y < base.h; y += F.h) for (let x = 0; x < base.w; x += F.w) piece("floor", base.x + x, base.y + y);
  // back walls (along x at y = base.y) and left walls (along y at x = base.x); front/right walls with damage stages,
  // a tinted one, and BuildPiece.variant (wall looks / clan walls come from the `wall` variant group when present)
  for (let x = 0; x < base.w; x += W) piece("wall", base.x + x, base.y, 0, 0, { variant: x / W });
  for (let y = W; y < base.h; y += W) piece("wall", base.x, base.y + y, 1, 0, { variant: y / W });
  piece("wall", base.x + 1, base.y + base.h - 1, 0, 0, { damage: 1 });
  piece("wall", base.x + base.w - 2, base.y + base.h - 1, 0, 0, { damage: 3 });
  piece("wall", base.x + base.w - 1, base.y + 1, 1, 0, { damage: 2 });
  piece("wall", base.x + base.w - 1, base.y + base.h - 2, 1, 0, { tint: 0xb0d0ffff });
  for (const [px, py] of [[0, 0], [base.w - 1, 0], [0, base.h - 1], [base.w - 1, base.h - 1]] as const) piece("pillar", base.x + px, base.y + py);
  if (has("rug")) for (let v = 0; v < 4; v++) piece("rug", base.x + 1 + v, base.y + 2, 0, 0, { variant: v });
  const R = pieces.byKey("roof").footprint;
  for (let y = 0; y < base.h; y += R.h) for (let x = 0; x < base.w; x += R.w) piece("roof", base.x + x, base.y + y, 0, 1);
  // ghost previews: valid (green) and invalid (red, overlapping the base)
  piece("wall", base.x + 9, base.y + 2, 0, 0, { ghost: 1 });
  piece("pillar", base.x + 4, base.y + 3, 0, 0, { ghost: 2 });
  // burning pieces (gameplay Burning mock): a small low-intensity wall fire and a big hot one (?burn=0 disables)
  burning.push(piece("wall", base.x + 9, base.y + 5, 0, 0, { damage: 2 }));
  burning.push(piece("wall", base.x + 10, base.y + 5, 0, 0, { damage: 3 }));
  // campfire piece + its light (separate entity carrying LightSource)
  piece("campfire", base.x + 3, base.y + base.h + 2);
  // fire = core Emitter entities (light + heat) gated by Fuel.lit (gameplay attaches these to its fire entity)
  const fx = base.x + 3.5, fy = base.y + base.h + 2.5;
  for (const [kind, radius, strength] of [[EmitterKind.Light, 7, 1.1], [EmitterKind.Heat, 1.6, 1]] as const) {
    const f = world.create(); world.add(f, Transform, { x: fx, y: fy, z: groundZ, facing: 0 });
    world.add(f, Emitter, { kind, radius, strength, falloff: 1 }); world.add(f, Fuel, { burnUntilTick: 1e9, lit: 1 });
  }
  if (reg.ids.sprites.tryId("heat_campfire_small") !== undefined) spawn(fx + 0.6, fy + 0.6, "heat_campfire_small", { flags: SpriteFlag.Emissive });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2; const e = world.create();
    world.add(e, Transform, { x: cx + Math.cos(a) * 7, y: cy + Math.sin(a) * 7, z: groundZ, facing: 0 });
    light(e, 1, 0.7, 0.35, 4, 1, 0.3);
  }
  // items + equipment on the ground
  const loot = ["wood", "stone", "berries", "water_flask", "stone_axe", "stone_pickaxe", "sword", "shield"];
  loot.forEach((k, i) => spawn(base.x + base.w + 1.5 + (i % 4) * 0.8, base.y + 1 + Math.floor(i / 4) * 0.9, k, { scale: 0.8, shadow: 0.6 }));
  // players (tint variants from the sample tint set)
  const tints = (() => { try { return reg.tintSet("shirt_colors").tints; } catch { return [0xffffff]; } })();
  const players: Entity[] = [];
  for (let i = 0; i < 3; i++) {
    const t = tints[(i * 3) % tints.length]! >>> 0; const tint = ((t << 8) | 0xff) >>> 0;
    const pk = i > 0 && reg.ids.sprites.tryId(i === 1 ? "player_b" : "player_c") !== undefined ? (i === 1 ? "player_b" : "player_c") : "player";
    const e = spawn(base.x + base.w + 2 + i * 1.2, base.y + base.h + 1.5, pk, { scale: 1.4, shadow: 1, tint: i === 0 ? 0 : tint });
    world.add(e, AnimState, { state: AnimStateId.Idle, startTick: i * 7 });
    world.add(e, Wetness, { level: 0 }); world.add(e, BodyTemp, { cold: 0, heat: 0, shivering: 0 });
    world.add(e, Equipment, { mainHandSlot: 0, mainHandItem: [DEMO_ITEM.iron_axe, DEMO_ITEM.torch, DEMO_ITEM.iron_sword][i]! });
    world.get(e, Transform); players.push(e);
  }
  const player = players[0]!;
  if (opts.inside) { world.set(player, Transform, { x: base.x + 2.5, y: base.y + 2.5 }); index.insert(player, base.x + 2.5, base.y + 2.5); }
  light(player, 1, 0.86, 0.62, 4, 0.8, 0.08);
  if (opts.occlusionTest) { // a tall tree and a boulder right in front of the local player (occlusion fade / silhouette check)
    const t = world.get(player, Transform)!;
    spawn(t.x + 0.9, t.y + 1.0, trees.includes("tree_pine") ? "tree_pine" : "tree", { flags: SpriteFlag.Sway, scale: 1.5, shadow: 1 });
    spawn(t.x - 0.4, t.y + 2.2, treeKey(0.4), { flags: SpriteFlag.Sway, scale: 1.4, shadow: 1 });
  }
  // zombies: native sample sprite + TexturePacker-imported one (if loaded)
  const zombies: Entity[] = [];
  const hasTP = reg.ids.sprites.tryId("zombie_tp") !== undefined;
  const zkinds = ["zombie_walker", "zombie_mummy", "zombie_pumpkin", "zombie_runner"].filter(has);
  for (let n = 0, guard = 0; n < opts.zombies && guard < opts.zombies * 30; guard++) {
    const x = rng.range(cx - 22, cx + 22), y = rng.range(cy - 22, cy + 22);
    if (map.getTile(Math.floor(x), Math.floor(y)) === TileId.Water || (Math.abs(x - cx) < 5 && Math.abs(y - cy) < 5)) continue;
    const zk = hasTP && n % 2 ? "zombie_tp" : zkinds[n % zkinds.length]!;
    const e = spawn(x, y, zk, { scale: 1.4, shadow: 1 });
    const a = rng.range(0, Math.PI * 2);
    world.add(e, Wander, { dx: Math.cos(a), dy: Math.sin(a), timer: rng.range(0.5, 4), speed: rng.range(0.6, 1.4) });
    world.add(e, AnimState, { state: n % 7 === 5 ? AnimStateId.Crawl : n % 7 === 6 ? AnimStateId.Feed : n % 3 === 0 ? AnimStateId.Shamble : AnimStateId.Walk, startTick: rng.int(0, 40) });
    world.add(e, Wetness, { level: 0 }); world.add(e, BodyTemp, { cold: 0, heat: 0, shivering: 0 });
    zombies.push(e); n++;
  }
  if (opts.burn !== false) burning.forEach((e, n) => world.add(e, Burning, { lit: 1, intensity: n ? 230 : 90, startTick: 0 }));
  return { map, grid, index, player, players, zombies, base, spriteCount, pieceCount, size, burning };
}
