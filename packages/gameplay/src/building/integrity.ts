/**
 * Structural integrity (server only; PieceStability is never replicated).
 *
 * Stability is a value 0..100 on a directed support graph: ground pieces (foundations, ground furniture) are roots
 * at groundStability; every other piece takes max over its supports of (support value - loss), where loss is the
 * piece tier's vertLoss (stacked) or horizLoss (cantilevered decks), 0 for openings/furniture. Pieces below
 * minStability collapse. Plugged into BuildingGrid as stabilityRule.
 *  - additions/upgrades: incremental increase propagation (bucket queue, highest first) from the dirty pieces;
 *  - removals: the connected region around removed pieces is recomputed from its roots with a bucket-queue
 *    max-Dijkstra (values are integers 0..100, so 101 buckets), then everything under minStability collapses.
 * HP damage is batched per tick (one BuildPiece write per piece per tick) and drives damageStage.
 */
import { spillStall } from "../economy/stall.js";
import { type Entity, type World } from "@engine/core";
import { AttachKind, BuildPiece, ContainerViewers, PieceStability, Viewing } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { DestroyCause, emit, PieceDamaged, PieceDestroyed } from "../events.js";
import { unlinkPiece } from "./links.js";
import { structures, unmarkLinked, type StructureIndex } from "./structure.js";

const value = (w: World, e: Entity): number => w.getField(e, PieceStability, "value") ?? 0;
function lossOf(world: World, idx: StructureIndex, e: Entity, kind: number): number {
  if (kind === 0) return 0;
  const defs = gameplayDefs(world); const t = defs.tiers[world.getField(e, BuildPiece, "tier") ?? 1] ?? defs.tiers[1]!;
  void idx; return kind === 1 ? t.vertLoss : t.horizLoss;
}
/** Value implied by current support values. */
export function computeStability(world: World, idx: StructureIndex, e: Entity, scratch: [Entity, number][] = []): number {
  const { root, list } = idx.supports(e, scratch);
  if (root) return gameplayDefs(world).building.groundStability;
  let best = 0;
  for (const [s, k] of list) best = Math.max(best, value(world, s) - lossOf(world, idx, e, k));
  return Math.max(0, best);
}

/** Increase propagation from `seeds` (their values recomputed first). */
function propagateUp(world: World, idx: StructureIndex, seeds: Iterable<Entity>): void {
  const buckets: Entity[][] = Array.from({ length: 256 }, () => []); let top = 0; const sc: [Entity, number][] = []; const dep: Entity[] = [];
  const set = (e: Entity, v: number): void => { world.setField(e, PieceStability, "value", v); buckets[v]!.push(e); top = Math.max(top, v); };
  for (const e of seeds) if (world.isAlive(e) && world.has(e, PieceStability)) set(e, computeStability(world, idx, e, sc));
  for (let b = top; b >= 0; b--) {
    const q = buckets[b]!;
    while (q.length) {
      const u = q.pop()!; if (value(world, u) !== b) continue;
      for (const n of idx.dependents(u, dep).slice()) {
        if (!world.has(n, PieceStability)) continue;
        const nv = computeStability(world, idx, n, sc);
        if (nv > value(world, n)) { world.setField(n, PieceStability, "value", nv); buckets[nv]!.push(n); }
      }
    }
  }
}

/** Connected region (support + dependent edges) around `starts`, bounded by maxNodes. */
function region(idx: StructureIndex, starts: Iterable<Entity>, maxNodes = 1 << 20): Set<Entity> {
  const seen = new Set<Entity>(); const stack: Entity[] = []; const sc: [Entity, number][] = []; const dep: Entity[] = [];
  for (const s of starts) if (idx.info.has(s) && !seen.has(s)) { seen.add(s); stack.push(s); }
  while (stack.length && seen.size < maxNodes) {
    const u = stack.pop()!;
    for (const [n] of idx.supports(u, sc).list) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    for (const n of idx.dependents(u, dep)) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  }
  return seen;
}

/** Full recompute of a region: zero, seed roots, bucket max-Dijkstra. Returns region members below minStability. */
export function recomputeRegion(world: World, idx: StructureIndex, nodes: Set<Entity>): Entity[] {
  const defs = gameplayDefs(world); const ground = defs.building.groundStability;
  const buckets: Entity[][] = Array.from({ length: 256 }, () => []); const sc: [Entity, number][] = []; const dep: Entity[] = [];
  for (const e of nodes) {
    if (!world.has(e, PieceStability)) continue;
    const { root } = idx.supports(e, sc);
    world.setField(e, PieceStability, "value", root ? ground : 0);
    if (root) buckets[ground]!.push(e);
  }
  for (let b = 255; b > 0; b--) {
    const q = buckets[b]!;
    while (q.length) {
      const u = q.pop()!; if (value(world, u) !== b) continue;
      for (const n of idx.dependents(u, dep).slice()) {
        if (!nodes.has(n) || !world.has(n, PieceStability)) continue;
        const nv = computeStability(world, idx, n, sc);
        if (nv > value(world, n)) { world.setField(n, PieceStability, "value", nv); buckets[nv]!.push(n); }
      }
    }
  }
  const min = defs.building.minStability; const out: Entity[] = [];
  for (const e of nodes) if (world.has(e, PieceStability) && value(world, e) < min) out.push(e);
  return out.sort((a, b) => a - b);
}

/** Destroy a piece (server): removes attachments and the hosted opening, records neighbors for recompute. */
export function destroyPiece(world: World, e: Entity, cause: DestroyCause): void {
  const idx = structures(world); if (!idx.info.has(e)) return;
  const type = world.getField(e, BuildPiece, "type") ?? 0;
  const op = idx.opening(e); if (op) destroyPiece(world, op, cause);
  const sc: [Entity, number][] = [];
  for (const [n] of idx.supports(e, sc).list) idx.removedNeighbors.add(n);
  for (const n of idx.dependents(e)) idx.removedNeighbors.add(n);
  for (const a of unlinkPiece(world, e)) {
    if (!world.isAlive(a)) continue;
    // close the container for viewers before it vanishes
    const vs = world.get(a, ContainerViewers);
    if (vs) for (const v of world.query([Viewing])) if (world.getField(v, Viewing, "container") === a) world.remove(v, Viewing);
    if (cause !== DestroyCause.Demolish) spillStall(world, a);
    unmarkLinked(world, a); world.destroy(a);
  }
  idx.removePiece(e); idx.removedNeighbors.delete(e);
  emit(world, PieceDestroyed, { piece: e, type, cause });
  world.destroy(e);
}

/** Queue hp damage on a piece; applied once per tick by structureDamageSystem. */
export function damagePiece(world: World, e: Entity, amount: number): void {
  if (!isAuthority(world) || world.isReplaying || amount <= 0 || !world.has(e, BuildPiece)) return;
  const idx = structures(world); idx.pendingDamage.set(e, (idx.pendingDamage.get(e) ?? 0) + amount);
}
export function damageStageFor(world: World, hp: number, max: number): number {
  const st = gameplayDefs(world).building.damageStages; const f = max > 0 ? hp / max : 0;
  let s = 0; for (const t of st) if (f <= t) s++; return s;
}

export function structureDamageSystem(world: World): void {
  if (!isAuthority(world)) return;
  const idx = structures(world); if (idx.pendingDamage.size === 0) return;
  const pending = [...idx.pendingDamage].sort((a, b) => a[0] - b[0]); idx.pendingDamage.clear();
  for (const [e, amount] of pending) {
    if (!world.isAlive(e)) continue;
    const bp = world.get(e, BuildPiece)!; const def = idx.def(e); if (!def) continue;
    const max = maxHpOf(world, e); const hp = Math.max(0, Math.round(bp.hp - amount));
    world.setField(e, PieceStability, "lastDamagedTick", world.tick);
    if (hp <= 0) { destroyPiece(world, e, DestroyCause.Damage); continue; }
    world.set(e, BuildPiece, { hp, damageStage: damageStageFor(world, hp, max) });
    emit(world, PieceDamaged, { piece: e, hp, amount });
  }
}
export function maxHpOf(world: World, e: Entity): number {
  const defs = gameplayDefs(world); const bp = world.get(e, BuildPiece); const def = bp && defs.pieces.get(bp.type); if (!bp || !def) return 0;
  return def.tiered ? Math.min(0xffff, Math.round(def.hp * (defs.tiers[bp.tier]?.hpMul ?? 1))) : Math.min(0xffff, def.hp);
}

/** Server: increases from dirty pieces; region recompute + collapse around removals (repeat until stable). */
export function stabilitySystem(world: World): void {
  if (!isAuthority(world)) return;
  const idx = structures(world);
  if (idx.dirty.size) { const d = [...idx.dirty].sort((a, b) => a - b); idx.dirty.clear(); propagateUp(world, idx, d); }
  for (let guard = 0; idx.removedNeighbors.size && guard < 64; guard++) {
    const starts = [...idx.removedNeighbors].filter((e) => world.isAlive(e)); idx.removedNeighbors.clear();
    const nodes = region(idx, starts);
    for (const e of recomputeRegion(world, idx, nodes)) destroyPiece(world, e, DestroyCause.Collapse);
  }
}

/** BuildingGrid.stabilityRule: a grid instance is stable when its piece entity meets minStability. */
export function installStabilityRule(world: World, idx: StructureIndex): void {
  const min = gameplayDefs(world).building.minStability;
  idx.grid.stabilityRule = (_g, inst) => { const e = idx.byGrid.get(inst.id); return e === undefined || !world.has(e, PieceStability) || value(world, e) >= min; };
}

