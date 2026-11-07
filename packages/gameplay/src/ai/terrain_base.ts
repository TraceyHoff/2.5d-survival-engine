/** ADR-266: finite, persisted earthworks for a NEW 2x2 shelter. No edits beneath an existing building. */
import { Transform, type Entity, type World } from "@engine/core";
import { isWaterId } from "@engine/world";
import { AttachKind, BuildPiece, EdgeSide, Fuel } from "../components.js";
import { hasPrivilege, snapPlacement, validatePlacement } from "../building/place.js";
import { structures } from "../building/structure.js";
import { resolveAttachment } from "../building/links.js";
import { gameplayDefs } from "../config.js";
import { countItem } from "../inventory.js";
import { editTerrain, hasShovel, TerrainFail, terrainDigAt } from "../terrain.js";
import { BuildFail } from "../events.js";
import { TerrainRes } from "../world.js";

export interface TerrainBasePlan {
  x: number; y: number; kind: "pad" | "pit"; height: number;
  quarry: { x: number; y: number; bottom: number }[];
  done?: boolean; abandoned?: boolean;
  /** Owner work anchor that selected this adjacent shelter (hired workers only). */
  anchor?: { x: number; y: number };
}
export type TerrainWork = { k: "terrain"; x: number; y: number; dir: number; stand: { x: number; y: number } }
  | { k: "ladder"; x: number; y: number }
  | { k: "light"; x: number; y: number }
  | { k: "fuel"; piece: Entity };

/** Select once, before foundations. Refuse water, occupied footprints, foreign claims and extreme existing slopes. */
export function planTerrainBase(world: World, self: Entity, b: { x: number; y: number }, kind: "pad" | "pit"): TerrainBasePlan | undefined {
  const t = world.getResource(TerrainRes); if (!t?.setRawHeight || !t.setTile) return undefined;
  const x = Math.floor(b.x), y = Math.floor(b.y), idx = structures(world);
  for (const [e] of idx.info) { const p = world.get(e, Transform); if (p && p.x >= x && p.x <= x + 2 && p.y >= y && p.y <= y + 2) return undefined; }
  const hs: number[] = [];
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const tx = x + dx, ty = y + dy;
    if (!t.tileAt(tx, ty) || isWaterId(t.tileAt(tx, ty)) || t.loaded?.(tx, ty) === false || !hasPrivilege(world, self, tx + .5, ty + .5)) return undefined;
    hs.push(t.heightAt(tx, ty));
  }
  if (Math.max(...hs) - Math.min(...hs) > 1) return undefined;
  const height = kind === "pad" ? Math.max(...hs) + 2 : Math.min(...hs) - 3;
  if (height < -27 || height > 44) return undefined;
  const quarry: TerrainBasePlan["quarry"] = [];
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const tx = x - 4 + dx, ty = y + 2 + dy; quarry.push({ x: tx, y: ty, bottom: t.heightAt(tx, ty) - 3 }); }
  return { x, y, kind, height, quarry };
}

/** One command-sized step. A quarry is bounded too (max 12 Soil); exhausted/blocked plans stop, never move to a new hill. */
export function nextTerrainWork(world: World, self: Entity, p: TerrainBasePlan): TerrainWork | undefined {
  if (p.done || p.abandoned || !hasShovel(world, self)) return undefined;
  const t = world.getResource(TerrainRes); if (!t) return undefined;
  const idx = structures(world), stand = { x: p.x + .5, y: p.y + 2.5 };
  const ladder = idx.ladder(p.x, p.y + 2, EdgeSide.North);
  // Fit the entrance as soon as a face exists; nobody gets stranded while subsequent cells are dug.
  if (!ladder && t.heightAt(p.x, p.y + 1) !== t.heightAt(p.x, p.y + 2)) {
    const sn = snapPlacement(world, { piece: gameplayDefs(world).pieceId("ladder"), x: p.x + .5, y: p.y + 2, level: 0, rot: 0, tier: 0, variant: 0 });
    const fail = typeof sn === "number" ? sn : validatePlacement(world, self, sn, { ignoreRange: true, ignoreCost: true });
    if (fail && fail !== BuildFail.SkillLocked) { p.abandoned = true; return undefined; }
    return { k: "ladder", x: p.x + .5, y: p.y + 2 };
  }
  const soil = [...gameplayDefs(world).items.values()].find((d) => d.key === "soil")?.id;
  // South row first, so the entrance ladder is always on completed terrain.
  for (const dy of [1, 0]) for (const dx of [0, 1]) {
    const x = p.x + dx, y = p.y + dy, h = t.heightAt(x, y); if (h === p.height) continue;
    if (!hasPrivilege(world, self, x + .5, y + .5)) { p.abandoned = true; return undefined; }
    const dir = h < p.height ? 1 : -1;
    if (dir > 0 && (soil === undefined || countItem(world, self, soil) < 1)) {
      for (const q of p.quarry) if (t.heightAt(q.x, q.y) > q.bottom && terrainDigAt(world, q.x, q.y) > -3) {
        const why = editTerrain(world, self, q.x, q.y, -1, true);
        if (why === TerrainFail.None || why === TerrainFail.TooFar) return { k: "terrain", x: q.x, y: q.y, dir: -1, stand: { x: p.x - .5, y: p.y + 2.5 } };
      }
      p.abandoned = true; return undefined;
    }
    const why = editTerrain(world, self, x, y, dir, true);
    if (why !== TerrainFail.None && why !== TerrainFail.TooFar) { p.abandoned = true; return undefined; }
    return { k: "terrain", x, y, dir, stand };
  }
  if (!ladder) { p.abandoned = true; return undefined; } // the outside landing was changed: do not silently pick another entrance
  if (p.kind === "pit") {
    let fire: Entity | undefined;
    for (const [e, info] of idx.info) if (info.def.key === "campfire") { const pos = world.get(e, Transform); if (pos && Math.abs(pos.x - p.x - 1.5) < .3 && Math.abs(pos.y - p.y - .5) < .3) fire = e; }
    if (!fire) return { k: "light", x: p.x + 1.5, y: p.y + .5 };
    const a = resolveAttachment(world, fire, AttachKind.Fire); if (a && !world.getField(a, Fuel, "lit")) return { k: "fuel", piece: a };
  }
  p.done = true; return undefined;
}
