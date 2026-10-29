/**
 * ADR-108 light grid (authority; cheap): every lightAvoid.rebuildTicks the active lights are collected into a uniform
 * grid (cell = lightAvoid.gridCell tiles), each light bucketed into every cell its radius (+ edge margin) touches, so a
 * point query reads one cell. Active lights:
 *  - light Emitters (EmitterKind.Light) with strength > 0 (lit campfire / torch stand / lantern / furnace, any lamp);
 *  - free-standing lit fired stations (spawnStation campfire/furnace: heat Emitter + Fuel.lit), radius STATION_LIGHT_RADIUS (ADR-215);
 *  - vehicles with headlights on (radius lightAvoid.headlightRadius).
 * Normal zombies use `lightAt` to stay out of lit radii at night (combat/zombies.ts); Snuffers use `nearestLight`.
 */
import { Transform, type Entity, type World } from "@engine/core";
import { BuildPiece, CraftingStation, Emitter, Fuel, PieceLink, Vehicle } from "../components.js";
import { gameplayDefs } from "../config.js";
import { EmitterKind, STATION_LIGHT_RADIUS } from "../realism.js";
import { headlightsOn } from "../vehicles.js";

export interface ActiveLight { readonly e: Entity; readonly x: number; readonly y: number; readonly r: number; readonly vehicle: boolean }
export interface LightGrid { readonly builtTick: number; readonly cell: number; readonly margin: number; readonly lights: readonly ActiveLight[]; readonly cells: Map<number, ActiveLight[]> }

const grids = new WeakMap<World, LightGrid>();
const key = (cx: number, cy: number): number => ((cx + 32768) & 0xffff) * 65536 + ((cy + 32768) & 0xffff);

/** Active lights, sorted by entity for determinism. */
export function activeLights(world: World): ActiveLight[] {
  const la = gameplayDefs(world).lightAvoid; const out: ActiveLight[] = [];
  for (const e of world.query([Emitter, Transform])) {
    if (world.getField(e, Emitter, "kind") !== EmitterKind.Light) continue;
    const s = world.getField(e, Emitter, "strength") ?? 0; if (!(s > 0)) continue;
    const t = world.get(e, Transform)!; out.push({ e, x: t.x, y: t.y, r: Math.max(la.minRadius, world.getField(e, Emitter, "radius") ?? 0), vehicle: false });
  }
  // ADR-215: a free-standing lit campfire/furnace (no piece, no light attachment) lights its surroundings too
  if (world.isRegistered(CraftingStation) && world.isRegistered(Fuel)) for (const e of world.query([CraftingStation, Fuel, Transform], [BuildPiece, PieceLink])) {
    const r = STATION_LIGHT_RADIUS[world.getField(e, CraftingStation, "kind") ?? 0]; if (!r || !world.getField(e, Fuel, "lit")) continue;
    const t = world.get(e, Transform)!; out.push({ e, x: t.x, y: t.y, r: Math.max(la.minRadius, r), vehicle: false });
  }
  if (world.isRegistered(Vehicle)) for (const v of world.query([Vehicle, Transform])) {
    if (!headlightsOn(world, v)) continue; const t = world.get(v, Transform)!;
    out.push({ e: v, x: t.x, y: t.y, r: la.headlightRadius, vehicle: true });
  }
  return out.sort((a, b) => a.e - b.e);
}

/** The world's light grid, rebuilt at most every rebuildTicks (or when `force`). */
export function lightGrid(world: World, force = false): LightGrid {
  const la = gameplayDefs(world).lightAvoid; const g = grids.get(world);
  if (g && !force && world.tick >= g.builtTick && world.tick - g.builtTick < la.rebuildTicks) return g;
  const cell = Math.max(1, la.gridCell); const margin = la.edgeMargin; const lights = activeLights(world); const cells = new Map<number, ActiveLight[]>();
  for (const l of lights) {
    const R = l.r + margin;
    for (let cx = Math.floor((l.x - R) / cell); cx <= Math.floor((l.x + R) / cell); cx++)
      for (let cy = Math.floor((l.y - R) / cell); cy <= Math.floor((l.y + R) / cell); cy++) { const k = key(cx, cy); let b = cells.get(k); if (!b) cells.set(k, (b = [])); b.push(l); }
  }
  const ng: LightGrid = { builtTick: world.tick, cell, margin, lights, cells }; grids.set(world, ng); return ng;
}
/** Forget the cached grid (tests / after a mass light change). */
export function invalidateLightGrid(world: World): void { grids.delete(world); }

/** The light whose radius (+ margin) covers (x,y), nearest centre first; undefined = dark. */
export function lightAt(world: World, x: number, y: number, margin = gameplayDefs(world).lightAvoid.edgeMargin): ActiveLight | undefined {
  const g = lightGrid(world); const b = g.cells.get(key(Math.floor(x / g.cell), Math.floor(y / g.cell))); if (!b) return undefined;
  let best: ActiveLight | undefined; let bd = Infinity;
  for (const l of b) { const d = Math.hypot(x - l.x, y - l.y); if (d <= l.r + margin && d < bd) { bd = d; best = l; } }
  return best;
}
/** Nearest active light centre within `range` of (x,y). */
export function nearestLight(world: World, x: number, y: number, range: number): ActiveLight | undefined {
  let best: ActiveLight | undefined; let bd = range;
  for (const l of lightGrid(world).lights) { const d = Math.hypot(x - l.x, y - l.y); if (d <= bd) { bd = d; best = l; } }
  return best;
}
