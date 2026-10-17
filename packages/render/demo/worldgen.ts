/** Demo-only procedural world: heightmap terrain into @engine/world's TileMap + ECS entities. */
import { Rng, defineComponent, Transform, type World, type Entity } from "@engine/core";
import { CHUNK_SIZE, TileMap, tileToChunk, tileToLocal } from "@engine/world";
import { Sprite, LightSource, Shadow, Occluder, SpriteFlag, TileId, FrameId, tileHeight } from "../src/index.js";

/** Demo-local components (numeric only). */
export const Wander = defineComponent("Wander", { dx: "f32", dy: "f32", timer: "f32", speed: "f32", skin: "u8" });
export const Anim = defineComponent("Anim", { base: "u16", count: "u8", ticksPerFrame: "u8" });
export const DEMO_COMPONENTS = [Wander, Anim] as const;

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

function setTile(map: TileMap, x: number, y: number, id: number, h: number): void {
  map.setTile(x, y, id);
  const c = map.ensureChunk(tileToChunk(x), tileToChunk(y));
  c.height[tileToLocal(y) * CHUNK_SIZE + tileToLocal(x)] = h; // raw height write (no world API yet)
  c.version++;
}

export interface GenResult { map: TileMap; player: Entity; camp: { x: number; y: number }; size: number; spriteCount: number }

export function generateWorld(world: World, opts: { size: number; seed: number; density: number; survivors: number }): GenResult {
  const { size, seed } = opts;
  const rng = new Rng(seed);
  const elev = valueNoise(seed), moist = valueNoise(seed * 7 + 3);
  const map = new TileMap();
  const cx = Math.floor(size / 2), cy = Math.floor(size / 2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let e = fbm(elev, x / 30, y / 30);
    // river band + edge falloff to make water visible
    const river = Math.abs(Math.sin((x + y * 0.35) / 22) * 18 - (y - x * 0.4) % 40 + 20) / 40;
    if (river < 0.06) e -= 0.18 * (1 - river / 0.06);
    const d = Math.hypot(x - cx, y - cy);
    if (d < 9) e = 0.5 + (e - 0.5) * (d / 9) * 0.3; // flatten camp
    let id: number, h: number;
    if (e < 0.36) { id = TileId.Water; h = 0; }
    else if (e < 0.41) { id = TileId.Sand; h = 1; }
    else if (e < 0.58) { id = fbm(moist, x / 18, y / 18) < 0.38 ? TileId.Dirt : TileId.Grass; h = 1; }
    else if (e < 0.66) { id = TileId.Grass; h = 2; }
    else if (e < 0.73) { id = TileId.Grass; h = 3; }
    else if (e < 0.8) { id = TileId.Stone; h = 4; }
    else { id = e > 0.85 ? TileId.Snow : TileId.Stone; h = 5; }
    setTile(map, x, y, id, h);
  }

  let spriteCount = 0;
  const spawn = (x: number, y: number, frame: number, flags = 0, scale = 1, shadow = 0, occl = false): Entity => {
    const e = world.create();
    const z = Math.max(0, tileHeight(map, Math.floor(x), Math.floor(y)));
    world.add(e, Transform, { x, y, z, facing: 0 });
    world.add(e, Sprite, { atlasId: 0, frameId: frame, flags, scale });
    if (shadow > 0) world.add(e, Shadow, { alpha: shadow, length: 1 });
    if (occl) world.add(e, Occluder, { fade: 0.35 });
    spriteCount++;
    return e;
  };
  const light = (e: Entity, r: number, g: number, b: number, radius: number, intensity: number, flicker: number): void => {
    world.add(e, LightSource, { r, g, b, radius, intensity, flicker });
  };

  // vegetation & rocks
  const D = opts.density;
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    if (Math.hypot(x - cx, y - cy) < 7) continue;
    const id = map.getTile(x, y); const m = fbm(moist, x / 18, y / 18);
    const tries = rng.next() < (D % 1) ? Math.ceil(D) : Math.floor(D);
    for (let k = 0; k < tries; k++) {
      const px = x + rng.range(0.15, 0.85), py = y + rng.range(0.15, 0.85); const r = rng.next();
      const flip = rng.next() < 0.5 ? SpriteFlag.FlipX : 0;
      if (id === TileId.Grass) {
        if (r < 0.2 + m * 0.15) {
          const f = m > 0.5 ? rng.pick([FrameId.Pine0, FrameId.Pine1, FrameId.Pine2]) : rng.pick([FrameId.Oak0, FrameId.Oak1, FrameId.Pine1]);
          spawn(px, py, f, flip | SpriteFlag.Sway, rng.range(0.8, 1.15), 1, true);
        } else if (r < 0.45) spawn(px, py, FrameId.GrassTuft, flip | SpriteFlag.Sway, rng.range(0.8, 1.2));
        else if (r < 0.52) spawn(px, py, FrameId.Bush, flip | SpriteFlag.Sway, rng.range(0.8, 1.1), 0.7);
        else if (r < 0.57) spawn(px, py, FrameId.Flowers, flip | SpriteFlag.Sway);
        else if (r < 0.6) spawn(px, py, rng.pick([FrameId.Rock0, FrameId.Rock1]), flip, 1, 0.8);
      } else if (id === TileId.Dirt) {
        if (r < 0.12) spawn(px, py, FrameId.DeadTree, flip, rng.range(0.8, 1.1), 0.9, true);
        else if (r < 0.3) spawn(px, py, rng.pick([FrameId.Rock0, FrameId.Rock1]), flip, 1, 0.8);
        else if (r < 0.5) spawn(px, py, FrameId.GrassTuft, flip | SpriteFlag.Sway, 0.8);
      } else if (id === TileId.Stone || id === TileId.Snow) {
        if (r < 0.18) spawn(px, py, rng.pick([FrameId.Rock0, FrameId.Rock1]), flip, rng.range(0.9, 1.3), 0.8);
        else if (r < 0.26) spawn(px, py, FrameId.Boulder, flip, rng.range(0.8, 1.1), 0.9, true);
        else if (r < 0.32) spawn(px, py, FrameId.Pine2, flip | SpriteFlag.Sway, rng.range(0.7, 1), 1, true);
      } else if (id === TileId.Sand) {
        if (r < 0.05) spawn(px, py, FrameId.DeadTree, flip, 0.8, 0.9);
        else if (r < 0.12) spawn(px, py, FrameId.Rock1, flip, 0.8, 0.8);
      }
    }
  }

  // camp: campfire, tents, crates, ring of torches
  const fire = spawn(cx + 0.5, cy + 0.5, FrameId.Campfire0, SpriteFlag.Emissive, 1.1, 0);
  light(fire, 1.0, 0.6, 0.28, 7.5, 1.5, 0.5);
  world.add(fire, Anim, { base: FrameId.Campfire0, count: 3, ticksPerFrame: 2 });
  for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.4; spawn(cx + 0.5 + Math.cos(a) * 3.6, cy + 0.5 + Math.sin(a) * 3.6, FrameId.Tent, i === 1 ? SpriteFlag.FlipX : 0, 1, 1); }
  for (let i = 0; i < 4; i++) { const a = i * 1.3 + 1.2; spawn(cx + 0.5 + Math.cos(a) * 2.4, cy + 0.5 + Math.sin(a) * 2.2, FrameId.Crate, 0, 0.9, 1); }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const t = spawn(cx + 0.5 + Math.cos(a) * 6, cy + 0.5 + Math.sin(a) * 6, FrameId.Torch0, SpriteFlag.Emissive, 1, 0.8);
    light(t, 1.0, 0.68, 0.32, 4, 1.05, 0.3);
    world.add(t, Anim, { base: FrameId.Torch0, count: 2, ticksPerFrame: 3 + (i % 3) });
  }
  // scattered torches (outposts)
  let placed = 0;
  for (let guard = 0; guard < 2000 && placed < 40; guard++) {
    const x = rng.int(4, size - 4), y = rng.int(4, size - 4); const id = map.getTile(x, y);
    if (id === TileId.Water || id === TileId.Snow) continue;
    const t = spawn(x + 0.5, y + 0.5, FrameId.Torch0, SpriteFlag.Emissive, 1, 0.8);
    light(t, 1.0, 0.66 + rng.range(-0.05, 0.05), 0.3, rng.range(3.5, 5), 1.0, 0.3);
    world.add(t, Anim, { base: FrameId.Torch0, count: 2, ticksPerFrame: rng.int(2, 5) });
    placed++;
  }

  // wandering survivors (dynamic, interpolated)
  for (let n = 0, guard = 0; n < opts.survivors && guard < opts.survivors * 20; guard++) {
    const x = rng.range(2, size - 2), y = rng.range(2, size - 2);
    if (map.getTile(Math.floor(x), Math.floor(y)) === TileId.Water) continue;
    const skin = rng.int(0, 2);
    const e = spawn(x, y, skin ? FrameId.Survivor1S : FrameId.Survivor0S, 0, 1, 1);
    const a = rng.range(0, Math.PI * 2);
    world.add(e, Wander, { dx: Math.cos(a), dy: Math.sin(a), timer: rng.range(1, 4), speed: rng.range(1.2, 2.4), skin });
    if (n % 6 === 0) light(e, 1.0, 0.7, 0.35, 3.2, 0.9, 0.3);
    n++;
  }

  const player = spawn(cx + 2.5, cy + 3.5, FrameId.PlayerS, 0, 1, 1);
  light(player, 1.0, 0.86, 0.62, 4, 0.8, 0.08);
  return { map, player, camp: { x: cx + 0.5, y: cy + 0.5 }, size, spriteCount };
}
