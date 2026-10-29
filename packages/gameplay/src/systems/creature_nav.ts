/**
 * ADR-214 creature navigation: animals and pets collide with building pieces and path around them.
 *
 * Authority only (animal AI and pets never run in client prediction; their Transforms replicate). The body is the
 * walker body of ADR-212/214 (bodyAxisMove with bodyRadius: edge walls / closed doors, solid cell pieces such as
 * stations, vertex corner posts), so creatures obey exactly the rules players and zombies do. Open ground keeps the
 * legacy straight-line step bit for bit: creatureStep() returns undefined when no piece is anchored near the move
 * (StructureIndex.anyPieceNear, a coarse 8x8 block count) and the caller runs its old code.
 *
 * Near structures: a body-sized line check (centre + 4 body corners through the tile DDA, plus the exact corner post
 * boxes) decides whether the goal is in straight sight; if not, a bounded passable-only A* (4-neighbour, doorways
 * and open doors pass, closed doors / walls / solid cells / angled-corner tiles / unwalkable terrain do not) finds a
 * tile route, cached per entity and re-planned when the goal tile or StructureIndex.version changes or it expires.
 * The creature steers to the farthest of the next few route tiles in straight sight (string pulling). An unreachable
 * goal routes to the closest reachable tile; a step that makes no progress returns false (callers idle).
 */
import { defineResource, Transform, type Entity, type World } from "@engine/core";
import { EdgeSide } from "../components.js";
import { gameplayDefs } from "../config.js";
import { isLCorner, structures, StructureIndexRes, type StructureIndex } from "../building/structure.js";
import { bodyAxisMove, cornerPostBoxes, settleStandZ, solidCell } from "./movement.js";

/** Per-tile terrain veto of the caller (animals / pets: unwalkable population tiles). */
export type TileBlocked = (tx: number, ty: number) => boolean;
interface NavState { gtx: number; gty: number; ver: number; until: number; clear: boolean; path: number[]; i: number; reached: boolean; stall: number; strict: number }
const NavRes = defineResource<Map<Entity, NavState>>("gameplay.CreatureNav");
const nav = (w: World): Map<Entity, NavState> => { let m = w.getResource(NavRes); if (!m) w.setResource(NavRes, (m = new Map())); return m; };

/** Route search bounds: radius (tiles) around the start and node budget; straight-sight cache lifetime (ticks). */
export const NAV = { radius: 24, maxNodes: 1200, repathTicks: 40, sightTicks: 6, lookahead: 4, strictTicks: 40 } as const;

/** True when the structure index has pieces anchored near the segment (else callers keep the legacy straight step). */
export function navNeeded(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const idx = world.getResource(StructureIndexRes); return !!idx && idx.count > 0 && idx.anyPieceNear(x0, y0, x1, y1);
}

/**
 * One movement step of creature e toward (gx, gy) by up to `sp` tiles, stopping `stopAt` short of the goal. Writes the
 * Transform (x, y, facing; z settles onto decks). Returns undefined when no structure is near (caller: legacy step),
 * else whether it moved.
 */
export function creatureStep(world: World, e: Entity, gx: number, gy: number, sp: number, stopAt: number, blocked: TileBlocked, dt: number): boolean | undefined {
  const t = world.get(e, Transform); if (!t) return false;
  if (!navNeeded(world, t.x, t.y, gx, gy)) { nav(world).delete(e); return undefined; }
  const idx = structures(world); const defs = gameplayDefs(world); const r = defs.movement.bodyRadius;
  const level = Math.max(0, Math.round((t.z ?? 0) / defs.building.levelHeight));
  const gd = Math.hypot(gx - t.x, gy - t.y); if (gd <= stopAt + 1e-6) return false;
  const tgt = waypoint(world, idx, e, t.x, t.y, gx, gy, level, r, blocked);
  if (!tgt) return false;
  let dx = tgt.x - t.x, dy = tgt.y - t.y; let d = Math.hypot(dx, dy);
  if (d < 1e-6) return false;
  const k = Math.min(sp, tgt.final ? gd - stopAt : d) / d; dx *= k; dy *= k;
  let x = bodyAxisMove(world, t.x, t.y, t.x + dx, 0, level, true, r); if (blocked(Math.floor(x), Math.floor(t.y))) x = t.x;
  let y = bodyAxisMove(world, x, t.y, t.y + dy, 1, level, true, r); if (blocked(Math.floor(x), Math.floor(y))) y = t.y;
  d = Math.hypot(x - t.x, y - t.y);
  const st = nav(world).get(e);
  if (d < Math.min(sp, 0.05) * 0.2) { if (st) { st.stall++; if (st.stall > 2) { st.clear = false; st.until = 0; st.strict = world.tick + NAV.strictTicks; } } return false; } // stalled: re-plan, tile lanes only for a while
  if (st) st.stall = 0;
  world.set(e, Transform, { x, y, facing: Math.atan2(y - t.y, x - t.x) }); settleStandZ(world, e, dt);
  return true;
}

/** True when structures stand between (x0, y0) and (x1, y1) on level z's deck: no body-sized straight sight (ADR-214;
 *  e.g. a pet "close" to its owner through a wall). False on open ground. */
export function walledOff(world: World, x0: number, y0: number, x1: number, y1: number, z: number, blocked: TileBlocked): boolean {
  if (!navNeeded(world, x0, y0, x1, y1)) return false;
  const defs = gameplayDefs(world); const level = Math.max(0, Math.round(z / defs.building.levelHeight));
  return !sight(structures(world), x0, y0, x1, y1, level, defs.movement.bodyRadius, blocked);
}

/** Spot near the owner (pet teleport) that is in body-sized straight sight of (ox, oy); legacy offset first, else (ox, oy). */
export function reachableSpotNear(world: World, ox: number, oy: number, z: number, blocked: TileBlocked, prefer: readonly [number, number][]): { x: number; y: number } {
  const idx = structures(world); const defs = gameplayDefs(world); const r = defs.movement.bodyRadius; const level = Math.max(0, Math.round(z / defs.building.levelHeight));
  for (const [ax, ay] of prefer) { const x = ox + ax, y = oy + ay; if (!blocked(Math.floor(x), Math.floor(y)) && !solidCell(idx, Math.floor(x), Math.floor(y), level) && sight(idx, ox, oy, x, y, level, r, blocked)) return { x, y }; }
  return { x: ox, y: oy };
}

// ---- internals -------------------------------------------------------------------------------------------------
function waypoint(world: World, idx: StructureIndex, e: Entity, x: number, y: number, gx: number, gy: number, level: number, r: number, blocked: TileBlocked): { x: number; y: number; final: boolean } | undefined {
  const m = nav(world); const gtx = Math.floor(gx), gty = Math.floor(gy); const now = world.tick;
  let st = m.get(e);
  if (!st || st.gtx !== gtx || st.gty !== gty || st.ver !== idx.version || now >= st.until) {
    const strict = st && now < st.strict ? st.strict : 0; const clear = !strict && sight(idx, x, y, gx, gy, level, r, blocked);
    st = { gtx, gty, ver: idx.version, until: now + (clear ? NAV.sightTicks : NAV.repathTicks), clear, path: [], i: 0, reached: true, stall: st?.stall ?? 0, strict };
    if (!clear) { const p = route(idx, Math.floor(x), Math.floor(y), gtx, gty, level, blocked); st.path = p.path; st.reached = p.reached; }
    m.set(e, st);
    if (m.size > 64 && (now & 63) === 0) for (const k of [...m.keys()]) if (!world.isAlive(k)) m.delete(k);
  }
  if (st.clear) return { x: gx, y: gy, final: true };
  const p = st.path; const n = p.length >> 1;
  // advance past route tiles the body centre has reached
  const ctx = Math.floor(x), cty = Math.floor(y);
  for (let j = Math.min(n - 1, st.i + NAV.lookahead); j >= st.i; j--) if (p[j * 2] === ctx && p[j * 2 + 1] === cty) { st.i = j + 1; break; }
  if (st.i >= n) return st.reached ? { x: gx, y: gy, final: true } : undefined; // at the closest reachable tile
  // string pulling: farthest of the next few route tiles in straight sight (the goal itself when it is)
  const pull = now >= st.strict; // after a stall: no string pulling (thin sight rays can miss a wall end the square body catches)
  if (pull && st.reached && n - st.i <= NAV.lookahead && sight(idx, x, y, gx, gy, level, r, blocked)) return { x: gx, y: gy, final: true };
  if (pull) for (let j = Math.min(n - 1, st.i + NAV.lookahead - 1); j > st.i; j--) {
    const cx = p[j * 2]! + 0.5, cy = p[j * 2 + 1]! + 0.5; if (sight(idx, x, y, cx, cy, level, r, blocked)) return { x: cx, y: cy, final: false };
  }
  // next route tile only: cross into it along the current tile's centre line (clears corner posts and the ADR-212
  // lateral samples), so first slide back onto that lane when the body is off it
  const nx = p[st.i * 2]!, ny = p[st.i * 2 + 1]!;
  if (Math.abs(nx - ctx) + Math.abs(ny - cty) === 1) {
    if (nx !== ctx && Math.abs(y - (cty + 0.5)) > LANE) return { x, y: cty + 0.5, final: false };
    if (ny !== cty && Math.abs(x - (ctx + 0.5)) > LANE) return { x: ctx + 0.5, y, final: false };
  }
  return { x: nx + 0.5, y: ny + 0.5, final: false };
}
const LANE = 0.04;

/** Passable 4-neighbour step (tx, ty) -> (nx, ny) at level (no breaking through). */
function stepOk(idx: StructureIndex, tx: number, ty: number, nx: number, ny: number, level: number, blocked: TileBlocked): boolean {
  if (blocked(nx, ny)) return false;
  if (nx !== tx ? idx.edgeBlocker(Math.max(tx, nx), ty, level, EdgeSide.West) : idx.edgeBlocker(tx, Math.max(ty, ny), level, EdgeSide.North)) return false;
  if (solidCell(idx, nx, ny, level)) return false;
  return !(idx.vertexPosts > 0 && angledTile(idx, nx, ny, level));
}
const scratch: number[] = [];
/** Tile containing the 45 deg run of a wall_corner_angled at one of its four corners (the run splits it diagonally). */
function angledTile(idx: StructureIndex, tx: number, ty: number, level: number): boolean {
  for (let c = 0; c < 4; c++) {
    const vx = tx + (c & 1), vy = ty + (c >> 1); const e = idx.cell(vx, vy, level, 3); if (!e) continue; const d = idx.def(e);
    if (!d || d.snap !== "vertex" || !d.solid || isLCorner(d) || d.rotSteps !== 8) continue;
    const b = cornerPostBoxes(d, idx.info.get(e)?.slot.rot ?? 0, vx, vy, scratch); // last run box sits inside the split tile
    if (Math.floor(b[b.length - 4]!) === tx && Math.floor(b[b.length - 3]!) === ty) return true;
  }
  return false;
}

/** Body-sized straight sight from (x0, y0) to (x1, y1): centre ray (terrain + structures) and the 4 body-corner rays (structures), plus corner posts. */
function sight(idx: StructureIndex, x0: number, y0: number, x1: number, y1: number, level: number, r: number, blocked: TileBlocked): boolean {
  const k = r * 0.98;
  if (!ray(idx, x0, y0, x1, y1, level, blocked)) return false;
  for (let c = 0; c < 4; c++) { const ox = c & 1 ? k : -k, oy = c & 2 ? k : -k; if (!ray(idx, x0 + ox, y0 + oy, x1 + ox, y1 + oy, level, undefined)) return false; }
  return !(idx.vertexPosts > 0 && postsHit(idx, x0, y0, x1, y1, level, r));
}
/** Tile DDA: every tile boundary crossed must be a passable step (corner crossings must pass both ways round). */
function ray(idx: StructureIndex, x0: number, y0: number, x1: number, y1: number, level: number, blocked: TileBlocked | undefined): boolean {
  let tx = Math.floor(x0), ty = Math.floor(y0); const ex = Math.floor(x1), ey = Math.floor(y1);
  const dx = x1 - x0, dy = y1 - y0; const sx = Math.sign(dx), sy = Math.sign(dy);
  const tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity;
  let tmx = sx > 0 ? (tx + 1 - x0) * tdx : sx < 0 ? (x0 - tx) * tdx : Infinity;
  let tmy = sy > 0 ? (ty + 1 - y0) * tdy : sy < 0 ? (y0 - ty) * tdy : Infinity;
  const ok = (ax: number, ay: number, bx: number, by: number): boolean => {
    if (blocked && blocked(bx, by)) return false;
    if (bx !== ax ? idx.edgeBlocker(Math.max(ax, bx), ay, level, EdgeSide.West) : idx.edgeBlocker(ax, Math.max(ay, by), level, EdgeSide.North)) return false;
    return !solidCell(idx, bx, by, level);
  };
  for (let guard = 0; guard < 256 && (tx !== ex || ty !== ey); guard++) {
    if (Math.abs(tmx - tmy) < 1e-9) { // through a vertex: both orders
      if (tmx > 1) break;
      if (!(ok(tx, ty, tx + sx, ty) && ok(tx + sx, ty, tx + sx, ty + sy) && ok(tx, ty, tx, ty + sy) && ok(tx, ty + sy, tx + sx, ty + sy))) return false;
      tx += sx; ty += sy; tmx += tdx; tmy += tdy;
    } else if (tmx < tmy) { if (tmx > 1) break; if (!ok(tx, ty, tx + sx, ty)) return false; tx += sx; tmx += tdx; }
    else { if (tmy > 1) break; if (!ok(tx, ty, tx, ty + sy)) return false; ty += sy; tmy += tdy; }
  }
  return true;
}
/** Segment vs vertex post boxes inflated by the body half-size (slab test). */
function postsHit(idx: StructureIndex, x0: number, y0: number, x1: number, y1: number, level: number, r: number): boolean {
  const pad = r + 0.6;
  for (let vy = Math.ceil(Math.min(y0, y1) - pad); vy <= Math.floor(Math.max(y0, y1) + pad); vy++) for (let vx = Math.ceil(Math.min(x0, x1) - pad); vx <= Math.floor(Math.max(x0, x1) + pad); vx++) {
    const e = idx.cell(vx, vy, level, 3); if (!e) continue; const d = idx.def(e);
    if (!d || d.snap !== "vertex" || !d.solid || isLCorner(d)) continue;
    const b = cornerPostBoxes(d, idx.info.get(e)?.slot.rot ?? 0, vx, vy, scratch);
    for (let i = 0; i < b.length; i += 4) if (segBox(x0, y0, x1, y1, b[i]!, b[i + 1]!, b[i + 2]! + r, b[i + 3]! + r)) return true;
  }
  return false;
}
function segBox(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, hx: number, hy: number): boolean {
  let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
  for (const [p, d, lo, hi] of [[x0, dx, cx - hx, cx + hx], [y0, dy, cy - hy, cy + hy]] as const) {
    if (Math.abs(d) < 1e-12) { if (p <= lo || p >= hi) return false; continue; }
    let a = (lo - p) / d, b = (hi - p) / d; if (a > b) { const s = a; a = b; b = s; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 >= t1) return false;
  }
  return true;
}

// A* scratch (single-threaded sim): a (2R+1)^2 window around the start
const W = NAV.radius * 2 + 1; const G = new Float64Array(W * W); const PARENT = new Int32Array(W * W); const SEEN = new Uint32Array(W * W); const CLOSED = new Uint32Array(W * W); let stamp = 0;
const HEAP: number[] = []; const HF: number[] = [];
/** Bounded A* over passable steps; falls back to the closest reached tile (by heuristic) when the goal is not reachable. */
function route(idx: StructureIndex, sx: number, sy: number, gx: number, gy: number, level: number, blocked: TileBlocked): { path: number[]; reached: boolean } {
  stamp = (stamp + 1) >>> 0; if (stamp === 0) { SEEN.fill(0); CLOSED.fill(0); stamp = 1; }
  const ox = sx - NAV.radius, oy = sy - NAV.radius;
  const inWin = (x: number, y: number): boolean => x >= ox && y >= oy && x < ox + W && y < oy + W;
  const h = (x: number, y: number): number => Math.abs(x - gx) + Math.abs(y - gy);
  const id0 = (sy - oy) * W + (sx - ox); SEEN[id0] = stamp; G[id0] = 0; PARENT[id0] = -1;
  HEAP.length = 0; HF.length = 0; push(id0, h(sx, sy));
  let best = id0, bestH = h(sx, sy), expanded = 0, goal = -1;
  while (HEAP.length && expanded < NAV.maxNodes) {
    const cur = pop(); if (CLOSED[cur] === stamp) continue; CLOSED[cur] = stamp; expanded++;
    const cx = (cur % W) + ox, cy = Math.floor(cur / W) + oy;
    if (cx === gx && cy === gy) { goal = cur; break; }
    const hc = h(cx, cy); if (hc < bestH) { bestH = hc; best = cur; }
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (!inWin(nx, ny)) continue; const nid = (ny - oy) * W + (nx - ox); if (CLOSED[nid] === stamp) continue;
      if (!stepOk(idx, cx, cy, nx, ny, level, blocked)) continue;
      const g = G[cur]! + 1;
      if (SEEN[nid] === stamp && G[nid]! <= g) continue;
      SEEN[nid] = stamp; G[nid] = g; PARENT[nid] = cur; push(nid, g + h(nx, ny) * 1.001);
    }
  }
  const end = goal >= 0 ? goal : best; const out: number[] = [];
  for (let c = end; c !== -1 && c !== id0; c = PARENT[c]!) out.push((c % W) + ox, Math.floor(c / W) + oy);
  // reverse pairs (start side first)
  const path: number[] = []; for (let i = out.length - 2; i >= 0; i -= 2) path.push(out[i]!, out[i + 1]!);
  return { path, reached: goal >= 0 };
}
function push(id: number, f: number): void {
  HEAP.push(id); HF.push(f); let i = HEAP.length - 1;
  while (i > 0) { const p = (i - 1) >> 1; if (HF[p]! < f || (HF[p] === f && HEAP[p]! <= id)) break; HEAP[i] = HEAP[p]!; HF[i] = HF[p]!; i = p; }
  HEAP[i] = id; HF[i] = f;
}
function pop(): number {
  const top = HEAP[0]!; const lid = HEAP.pop()!, lf = HF.pop()!; const n = HEAP.length;
  if (n) {
    let i = 0;
    for (;;) { const l = 2 * i + 1, r = l + 1; let m = i, mf = lf, mid = lid;
      if (l < n && (HF[l]! < mf || (HF[l] === mf && HEAP[l]! < mid))) { m = l; mf = HF[l]!; mid = HEAP[l]!; }
      if (r < n && (HF[r]! < mf || (HF[r] === mf && HEAP[r]! < mid))) { m = r; }
      if (m === i) break; HEAP[i] = HEAP[m]!; HF[i] = HF[m]!; i = m; }
    HEAP[i] = lid; HF[i] = lf;
  }
  return top;
}
