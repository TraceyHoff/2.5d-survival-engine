/**
 * Player movement (moved from apps/server protocol.ts). Same function on the server and in client prediction:
 * screen-aligned iso directions from action bits (GameplayActions MoveUp/Down/Left/Right/Sprint occupy bits 0..4,
 * identical to the demo protocol), speed = walkSpeed x sprintMul (sprinting with stamina) x encumbrance x wetness x
 * MoveSpeed buffs. Sprint stamina drain happens in vitalsSystem from PlayerIntent.moving/sprint. Movement is blocked
 * by edge walls/closed doors, solid cell pieces at the player's level and unwalkable terrain (per-axis slide).
 */
import { roadSpeedMul } from "../roads.js";
import { entityIndex, evaluate, Transform, type Entity, type World } from "@engine/core";
import { Anim, AnimState, LootBag, Buffs, Dead, Driver, EdgeSide, Inventory, PlayerIntent, Stat, Survival, Wetness } from "../components.js";
import { gameplayDefs } from "../config.js";
import { skillMul } from "../skills/tree.js";
import { GameplayActions as A } from "../input.js";
import { StructureIndexRes, type StructureIndex } from "../building/structure.js";
import { TerrainRes } from "../world.js";
import { WaterDepth, waterDepthAt, installSpatialIndex } from "@engine/world";
import { INPUT } from "../input_hooks.js";

/**
 * World-space (tile) move vector from screen-space input, |v| <= 1 (ADR-127). Screen axes sx (right +) / sy (down +)
 * come from the analog stick (moveX/moveY, clamped to magnitude 1, proportional below that) when it is past the
 * deadzone, else from the 4 digital bits (normalized, so diagonals are not faster). The screen->iso mapping is a pure
 * 45 deg rotation (dx = (sx + sy) / sqrt2, dy = (sy - sx) / sqrt2), so it preserves length: every one of the 8 key
 * directions is exactly 1 and a stick at magnitude m is exactly m. W = up-screen = -x -y.
 */
export function moveVector(actions: number, analog?: { x?: number | undefined; y?: number | undefined }): { dx: number; dy: number } {
  let sx: number, sy: number;
  const ax = analog?.x ?? 0, ay = analog?.y ?? 0;
  if (analog && (analog.x !== undefined || analog.y !== undefined) && Math.hypot(ax, ay) > INPUT.moveDeadzone) { sx = ax; sy = ay; }
  else { sx = (actions & A.MoveRight ? 1 : 0) - (actions & A.MoveLeft ? 1 : 0); sy = (actions & A.MoveDown ? 1 : 0) - (actions & A.MoveUp ? 1 : 0); }
  const l = Math.hypot(sx, sy); if (l > 1) { sx /= l; sy /= l; }
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return { dx: 0, dy: 0 };
  const k = Math.SQRT1_2; const dx = (sx + sy) * k, dy = (sy - sx) * k;
  return { dx: Math.abs(dx) < 1e-12 ? 0 : dx, dy: Math.abs(dy) < 1e-12 ? 0 : dy };
}
/** Unit iso direction from the 4 digital move bits (|v| = 1 in all 8 directions, 0 when idle / opposing). */
export function moveDirection(actions: number): { dx: number; dy: number } { return moveVector(actions); }

/** Current speed multiplier from sprint/encumbrance/wetness/buffs (tiles/s = walkSpeed x this). */
export function speedMultiplier(world: World, e: Entity, sprint: boolean): number {
  const mv = gameplayDefs(world).movement; let m = 1;
  if (sprint && (world.getField(e, Survival, "stamina") ?? 0) > 0) m *= mv.sprintMul;
  const max = (world.getField(e, Inventory, "maxWeight") ?? 0) * skillMul(world, e, "carry"); const w = world.getField(e, Inventory, "weight") ?? 0;
  if (max > 0) { const f = w / max; if (f > mv.encumberedFrom) m *= 1 - (1 - mv.encumberedMinMul) * Math.min(1, (f - mv.encumberedFrom) / (1 - mv.encumberedFrom)); }
  m *= 1 - mv.wetSlowMul * ((world.getField(e, Wetness, "level") ?? 0) / 255);
  const t = world.get(e, Transform); if (t) m *= roadSpeedMul(world, t.x, t.y); // ADR-119 road surface bonus
  return evaluate(world, e, Buffs, Stat.MoveSpeed, m, world.simTick(e)); // ADR-191: server-frame expiry while predicting
}

/** Movement collision query (terrain, edge walls/doors, solid cells); vehicles reuse it per footprint corner. */
export function movementBlocked(world: World, x0: number, y0: number, x1: number, y1: number, level: number, swim = false): boolean {
  const defs = gameplayDefs(world); const terrain = world.getResource(TerrainRes);
  const tx0 = Math.floor(x0), ty0 = Math.floor(y0), tx1 = Math.floor(x1), ty1 = Math.floor(y1);
  if (terrain) { const tile = terrain.tileAt(tx1, ty1); if (defs.worldgen.unwalkableTiles.has(tile) && !(swim && defs.movement.swimTiles.has(tile)) && waterDepthAt(terrain.tileAt, tx1, ty1, defs.movement.shallowRadius) !== WaterDepth.Shallow) return true; }
  const idx = world.getResource(StructureIndexRes); if (!idx || idx.count === 0) return false;
  if (tx1 !== tx0 && idx.edgeBlocker(Math.max(tx0, tx1), ty0, level, EdgeSide.West)) return true;
  if (ty1 !== ty0 && idx.edgeBlocker(tx1, Math.max(ty0, ty1), level, EdgeSide.North)) return true;
  // ADR-210: vertex-snapped corner posts sit on the tile corner, so they do not block the whole tile
  if (tx1 !== tx0 || ty1 !== ty0) return solidCell(idx, tx1, ty1, level);
  return false;
}
const solidCell = (idx: StructureIndex, tx: number, ty: number, level: number): boolean => {
  for (let la = 1; la < 4; la++) { const c = idx.cell(tx, ty, level, la); const d = c ? idx.def(c) : undefined; if (d?.solid && d.snap !== "vertex") return true; }
  return false;
};

/**
 * ADR-212 body collision for walkers (players, AI humans: same function on the server and in client prediction).
 * The body is a square of half-size bodyRadius: one axis moves at a time; the leading face is tested against edge
 * walls / closed doors (at the centre and both sides, so a body cannot clip half-way into a wall end or squeeze
 * past a doorway jamb) and against solid cell pieces (stations, furniture, pillars...) it would newly overlap.
 * Terrain keeps the centre-point test (shorelines). Returns the allowed coordinate along the axis.
 */
export function bodyAxisMove(world: World, x: number, y: number, n: number, axis: 0 | 1, level: number, swim: boolean): number {
  const nx = axis === 0 ? n : x, ny = axis === 0 ? y : n;
  if (movementBlocked(world, x, y, nx, ny, level, swim)) return axis === 0 ? x : y; // centre point (terrain + legacy rules)
  const idx = world.getResource(StructureIndexRes); if (!idx || idx.count === 0) return n;
  const r = gameplayDefs(world).movement.bodyRadius; if (!(r > 0)) return n;
  const cur = axis === 0 ? x : y, lat = axis === 0 ? y : x; const s = Math.sign(n - cur); if (!s) return n;
  const lead0 = cur + s * r, lead1 = n + s * r; const b0 = Math.floor(lead0), b1 = Math.floor(lead1);
  if (b0 === b1) return n;
  const k = r * 0.8; const side = axis === 0 ? EdgeSide.West : EdgeSide.North; const edgeT = Math.max(b0, b1);
  const inSolid = solidCell(idx, Math.floor(x), Math.floor(y), level); // escape hatch: never trap a body already inside a solid
  // a wall end perpendicular to the move inside the newly entered row/column (T-junction, doorway jamb) also blocks
  let perp = false; const pside = axis === 0 ? EdgeSide.North : EdgeSide.West;
  for (let bl = Math.floor(lat - r) + 1; bl <= Math.floor(lat + r) && !perp; bl++) perp = !!(axis === 0 ? idx.edgeBlocker(b1, bl, level, pside) : idx.edgeBlocker(bl, b1, level, pside));
  for (const l of perp ? [lat] : [lat - k, lat, lat + k]) {
    if (perp) { const stop = s > 0 ? edgeT - r - 1e-4 : edgeT + r + 1e-4; return s > 0 ? Math.max(cur, Math.min(n, stop)) : Math.min(cur, Math.max(n, stop)); }
    const lt = Math.floor(l);
    const blocked = (axis === 0 ? idx.edgeBlocker(edgeT, lt, level, side) : idx.edgeBlocker(lt, edgeT, level, side))
      || (!inSolid && (axis === 0 ? solidCell(idx, b1, lt, level) : solidCell(idx, lt, b1, level)));
    if (blocked) { const stop = s > 0 ? edgeT - r - 1e-4 : edgeT + r + 1e-4; return s > 0 ? Math.max(cur, Math.min(n, stop)) : Math.min(cur, Math.max(n, stop)); }
  }
  return n;
}

/** ADR-212: stand height above the level floor on (x, y): foundation decks (art top 12 px / zStep 16), ramps/steps half. */
export function standHeightAt(world: World, x: number, y: number, level: number): number {
  const idx = world.getResource(StructureIndexRes); const mv = gameplayDefs(world).movement;
  const base = level * gameplayDefs(world).building.levelHeight; if (!idx || idx.count === 0) return base;
  const tx = Math.floor(x), ty = Math.floor(y);
  const d = idx.deck(tx, ty, level); const dd = d ? idx.def(d) : undefined;
  if (dd && !dd.roof) return base + (dd.family === "foundation" ? mv.deckStandHeight : mv.floorStandHeight);
  for (const t of idx.trisInTile(tx, ty, level)) { const td = idx.def(t); if (td?.roof) continue; const tt = world.get(t, Transform); if (tt && Math.hypot(tt.x - x, tt.y - y) < 0.5) return base + (td?.family === "foundation" ? mv.deckStandHeight : mv.floorStandHeight); }
  const ramp = idx.cell(tx, ty, level, 1); const rd = ramp ? idx.def(ramp) : undefined;
  if (rd && rd.family === "foundation") return base + mv.deckStandHeight * 0.5;
  return base;
}
/** ADR-212: ease Transform.z toward the stand height (smooth step-up / step-down, stepRate z units per second). */
export function settleStandZ(world: World, e: Entity, dt: number): void {
  const t = world.get(e, Transform); if (!t) return;
  const lh = gameplayDefs(world).building.levelHeight; const level = Math.max(0, Math.round(t.z / lh));
  const target = standHeightAt(world, t.x, t.y, level); const z = t.z ?? 0; if (Math.abs(target - z) < 1e-4) return;
  const step = gameplayDefs(world).movement.stepRate * dt;
  world.set(e, Transform, { z: Math.abs(target - z) <= step ? target : z + Math.sign(target - z) * step });
}

/** Applies one tick of movement input (server authority + client prediction). Writes PlayerIntent.moving/sprint. */
export function applyMovementInput(world: World, e: Entity, actions: number, dt: number, analog?: { x?: number | undefined; y?: number | undefined }): void {
  const t = world.get(e, Transform); if (!t) return;
  if (world.has(e, Driver)) return; // riders move with their vehicle (gameplay.vehicles)
  const dead = world.has(e, Dead);
  const { dx, dy } = dead ? { dx: 0, dy: 0 } : moveVector(actions, analog);
  const moving = dx || dy ? 1 : 0; const sprint = moving && actions & A.Sprint && !(t.z < 0.5 && inDeepWater(world, t.x, t.y)) ? 1 : 0; // ADR-181: no sprint while swimming
  // ADR-147: PlayerIntent is not networked, so a client replica has none and its predicted vitals never drained sprint
  // stamina (the replica's stamina lagged the server by the snapshot delay, sprint ended a tick apart: a rubber-band).
  // The predicting client keeps a local PlayerIntent on its own entity so movement + vitals replay like the server.
  if (!world.has(e, PlayerIntent) && world.predicted.has(e)) world.add(e, PlayerIntent);
  if (world.has(e, PlayerIntent)) {
    const st = world.store(PlayerIntent); const i = entityIndex(e); const s = st.slot(i);
    if (st.data.moving[s] !== moving || st.data.sprint[s] !== sprint) { st.data.moving[s] = moving; st.data.sprint[s] = sprint; st.markChanged(i); }
  }
  if (moving) {
    const level = Math.max(0, Math.round(t.z / gameplayDefs(world).building.levelHeight));
    const swim = level === 0; // ground level only: no swimming off a deck
    const sp = gameplayDefs(world).movement.walkSpeed * speedMultiplier(world, e, sprint === 1) * (swim ? swimSpeedMulAt(world, t.x, t.y) : 1) * dt;
    let x = t.x, y = t.y;
    x = bodyAxisMove(world, x, y, x + dx * sp, 0, level, swim);
    y = bodyAxisMove(world, x, y, y + dy * sp, 1, level, swim);
    // ADR-212 doorway assist: pushing straight into a wall beside an opening slides the body toward the opening's centre
    if (x === t.x && dx && !dy) y = doorAssist(world, x, y, dx, 0, sp, level, swim);
    else if (y === t.y && dy && !dx) x = doorAssist(world, x, y, dy, 1, sp, level, swim);
    if (x !== t.x || y !== t.y) world.set(e, Transform, { x, y, facing: Math.atan2(dy, dx) });
  }
  settleStandZ(world, e, dt); // ADR-212: decks are walked on at deck-top height
}
/** Lateral nudge (up to `sp`) toward the centre of the neighbouring row whose centre line is free along `axis`. */
function doorAssist(world: World, x: number, y: number, d: number, axis: 0 | 1, sp: number, level: number, swim: boolean): number {
  const lat = axis === 0 ? y : x; const c = Math.floor(lat) + 0.5; if (Math.abs(c - lat) < 1e-6) return lat;
  const probe = Math.sign(d) * (gameplayDefs(world).movement.bodyRadius + sp + 0.05);
  const free = axis === 0 ? bodyAxisMove(world, x, c, x + probe, 0, level, swim) !== x : bodyAxisMove(world, c, y, y + probe, 1, level, swim) !== y;
  if (!free) return lat;
  const nl = lat + Math.sign(c - lat) * Math.min(sp, Math.abs(c - lat));
  return bodyAxisMove(world, axis === 0 ? x : lat, axis === 0 ? lat : y, nl, axis === 0 ? 1 : 0, level, swim);
}

/** ADR-125: character walk-cycle playback rate (walkSpeed / walkAnimRefSpeed) so feet match ground speed; shared by both renderers. */
export function walkAnimRate(world: World): number { const mv = gameplayDefs(world).movement; return mv.walkAnimRefSpeed > 0 ? mv.walkSpeed / mv.walkAnimRefSpeed : 1; }

// ---- swimming (ADR-107) -------------------------------------------------------------------------------------
/** True when (x, y) is on a swim tile (movement.json swimTiles). */
export function inWater(world: World, x: number, y: number): boolean {
  const terrain = world.getResource(TerrainRes); if (!terrain) return false;
  return gameplayDefs(world).movement.swimTiles.has(terrain.tileAt(Math.floor(x), Math.floor(y)));
}
/** ADR-181: 0 land, 1 shallow (wade), 2 deep (swim) at (x, y). Same function the renderers use. */
export function waterDepth(world: World, x: number, y: number): WaterDepth {
  const terrain = world.getResource(TerrainRes); if (!terrain) return WaterDepth.None;
  return waterDepthAt(terrain.tileAt, Math.floor(x), Math.floor(y), gameplayDefs(world).movement.shallowRadius);
}
export function inDeepWater(world: World, x: number, y: number): boolean { return waterDepth(world, x, y) === WaterDepth.Deep; }
/** Speed multiplier at (x, y): swimSpeedMul in deep water, wadeSpeedMul in shallow, else 1 (players, zombies, animals). */
export function swimSpeedMulAt(world: World, x: number, y: number): number {
  const d = waterDepth(world, x, y); const mv = gameplayDefs(world).movement;
  return d === WaterDepth.Deep ? mv.swimSpeedMul : d === WaterDepth.Shallow ? mv.wadeSpeedMul : 1;
}
/** ADR-181: terrain blocks non-swimmers (AI pathing, zombies, hordes) at tile (tx, ty): unwalkable tiles except shallow water. */
export function terrainBlocksWalker(world: World, tx: number, ty: number): boolean {
  const terrain = world.getResource(TerrainRes); if (!terrain) return false; const defs = gameplayDefs(world);
  return defs.worldgen.unwalkableTiles.has(terrain.tileAt(tx, ty)) && waterDepthAt(terrain.tileAt, tx, ty, defs.movement.shallowRadius) !== WaterDepth.Shallow;
}

const SWIM_OVER: ReadonlySet<number> = new Set([Anim.Idle, Anim.Walk, Anim.Run, Anim.Shamble, Anim.Crawl, Anim.Graze, Anim.Sit]);
/** One-shot anims on players (Punch/Attack/Hurt/Gather/Build) settle back to Idle after this many ticks (players have no AI to reset them). */
export const PLAYER_ONE_SHOT_TICKS = 8;
/** ADR-151: Punch/Attack settle sooner so the swing fits the fastest melee cooldown (0.3 s = 6 ticks). */
export const PLAYER_SWING_TICKS = 6;
const ONE_SHOT: ReadonlySet<number> = new Set([Anim.Attack, Anim.Punch, Anim.Hurt, Anim.Gather, Anim.Build, Anim.Eat, Anim.Harvest, Anim.Chop, Anim.Mine, Anim.Drink]);
/**
 * gameplay.animSettle (authority, ADR-107): locomotion anims become Swim on a swim tile at ground level and Swim reverts
 * to Idle on land; players' one-shot anims revert to Idle after PLAYER_ONE_SHOT_TICKS.
 */
export function animSettleSystem(world: World): void {
  const terrain = world.getResource(TerrainRes);
  for (const e of world.query([AnimState, Transform], [Dead])) {
    const t = world.get(e, Transform)!; const a = world.get(e, AnimState)!; let cur = a.anim;
    if (world.has(e, Survival) && ONE_SHOT.has(cur) && world.tick - a.startTick >= (cur === Anim.Attack || cur === Anim.Punch ? PLAYER_SWING_TICKS : PLAYER_ONE_SHOT_TICKS)) { world.set(e, AnimState, { anim: Anim.Idle, startTick: world.tick }); cur = Anim.Idle; }
    if (!terrain) continue;
    const wet = (t.z ?? 0) < 0.5 && inDeepWater(world, t.x, t.y); // ADR-181: wading keeps walk anims
    if (wet && SWIM_OVER.has(cur)) world.set(e, AnimState, { anim: Anim.Swim, startTick: world.tick });
    else if (!wet && cur === Anim.Swim) world.set(e, AnimState, { anim: Anim.Idle, startTick: world.tick });
  }
  floatLootAshore(world);
}

/** ADR-181: dropped loot bags float: in deep water they drift (1 tile/s) to the nearest wadeable/land tile within
 * FLOAT_SEARCH tiles so items stay reachable without swimming; with no shore in range they stay afloat where they fell. */
const FLOAT_SEARCH = 8;
export function floatLootAshore(world: World): void {
  if (world.tick % 10 !== 0 || !world.getResource(TerrainRes) || !world.isRegistered(LootBag)) return;
  for (const e of world.query([LootBag, Transform])) {
    const t = world.get(e, Transform)!; if ((t.z ?? 0) >= 0.5 || !inDeepWater(world, t.x, t.y)) continue;
    const tx = Math.floor(t.x), ty = Math.floor(t.y); let best: [number, number] | undefined; let bd = Infinity;
    for (let r = 1; r <= FLOAT_SEARCH && !best; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const x = tx + dx + 0.5, y = ty + dy + 0.5;
      if (!inDeepWater(world, x, y)) { const d = Math.hypot(x - t.x, y - t.y); if (d < bd) { bd = d; best = [x, y]; } }
    }
    if (!best) continue; const k = Math.min(1, 0.5 / bd);
    const x = t.x + (best[0] - t.x) * k, y = t.y + (best[1] - t.y) * k;
    world.set(e, Transform, { x, y }); installSpatialIndex(world).hash.insert(e, x, y);
  }
}
