/**
 * ADR-212: rehydrate derived components on build pieces that come back from storage.
 *
 * The server saves pieces through core persistence (persistent components only: Transform, BuildPiece, Tribe, PieceLink,
 * Container, Fuel, DoorState, ...). Components placePiece derives from the piece def are not persistent, so after a
 * restart / "log back in" a loaded piece had no PieceStability (every wall/floor on a reloaded foundation failed
 * server validation with NoSupport while the client preview, which assumes ground stability, showed green) and no
 * CraftingStation (workbenches / forges could not be used, no Interact prompt). structureIndexSystem queues every piece
 * it indexes without PieceStability and every attachment it links; on the authority this pass restores them.
 * Idempotent; clients skip it (CraftingStation / Emitter replicate from the server).
 */
import { type Entity, type World } from "@engine/core";
import { Falloff } from "@engine/world";
import { AttachKind, BuildPiece, Container, ContainerViewers, CraftingStation, Emitter, Fuel, PieceLink, PieceStability, StallHeader, StallSign } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { StationKind } from "../defs.js";
import { emitterSpecs } from "../realism.js";
import { setEmittersLit } from "../systems/fuel.js";
import { recomputeRegion } from "./integrity.js";
import { pieceOf } from "./links.js";
import { LoadedQueueRes, structures } from "./structure.js";

export function rehydrateLoadedStructures(world: World): void {
  const q = world.getResource(LoadedQueueRes); if (!q || (!q.pieces.length && !q.atts.length)) return;
  const pieces = q.pieces.splice(0), atts = q.atts.splice(0);
  if (!isAuthority(world)) return;
  const defs = gameplayDefs(world); const idx = structures(world); const loaded = new Set<Entity>();
  for (const e of pieces) {
    if (!world.isAlive(e) || world.has(e, PieceStability)) continue;
    const def = defs.pieces.get(world.getField(e, BuildPiece, "type") ?? 0); if (!def) continue;
    world.add(e, PieceStability, { value: 0, placedTick: world.tick });
    if (def.station !== StationKind.None && !def.fired && !world.has(e, CraftingStation)) world.add(e, CraftingStation, { kind: def.station });
    loaded.add(e);
  }
  if (loaded.size) { recomputeRegion(world, idx, loaded); for (const e of loaded) idx.dirty.add(e); } // dirty: raise anything resting on them (propagateUp)
  for (const a of atts) {
    if (!world.isAlive(a)) continue; const p = pieceOf(world, a); if (p === undefined) continue;
    const def = defs.pieces.get(world.getField(p, BuildPiece, "type") ?? 0); if (!def) continue;
    const kind = world.getField(a, PieceLink, "kind") ?? 0; const specs = emitterSpecs(def);
    if (world.has(a, Container) && !world.has(a, ContainerViewers)) world.add(a, ContainerViewers);
    if (kind === AttachKind.Fire) {
      const heat = specs.find((s) => s.kind === 1);
      if (heat && !world.has(a, Emitter)) world.add(a, Emitter, { kind: heat.kind, radius: heat.radius, strength: 0, falloff: Falloff.Linear });
      if (def.station !== StationKind.None && !world.has(a, CraftingStation)) world.add(a, CraftingStation, { kind: def.station });
    } else if (kind === AttachKind.Light) {
      const light = specs.find((s) => s.kind === 2);
      if (light && !world.has(a, Emitter)) world.add(a, Emitter, { kind: light.kind, radius: light.radius, strength: def.fired ? 0 : light.strength, falloff: Falloff.Quadratic });
      else if (light && world.getField(a, Emitter, "radius") !== light.radius) world.setField(a, Emitter, "radius", light.radius); // ADR-215: saves keep the old radius
    } else if (kind === AttachKind.Storage && world.has(a, StallHeader) && !world.has(a, StallSign)) world.add(a, StallSign, { soldOut: 1 });
  }
  for (const a of atts) if (world.isAlive(a) && world.getField(a, Fuel, "lit")) setEmittersLit(world, a, 1);
}
