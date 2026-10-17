/**
 * Client ghost preview (the only predicted building state). The UI writes BuildGhost inputs (builder, piece,
 * pointer px/py, level, rot, tier, variant); this postSim system snaps + validates with the same code as the server
 * (client mode: "has support" instead of server-only stability values) and writes x/y/z/facing/valid/reason for render.
 */
import { entityIndex, type Entity, type World } from "@engine/core";
import { BuildGhost } from "../components.js";
import { BuildFail } from "../events.js";
import { snapPlacement, validatePlacement, type PlaceRequest } from "./place.js";

export interface Preview { valid: boolean; reason: BuildFail | 0; x: number; y: number; z: number; facing: number }
export function previewPlacement(world: World, builder: Entity, req: PlaceRequest): Preview {
  const sn = snapPlacement(world, req);
  if (typeof sn === "number") return { valid: false, reason: sn, x: req.x, y: req.y, z: 0, facing: 0 };
  const reason = validatePlacement(world, builder, sn);
  return { valid: reason === 0, reason, ...sn.pos };
}
export function ghostSystem(world: World): void {
  const st = world.store(BuildGhost);
  for (let k = 0; k < st.size; k++) {
    const d = st.data; const builder = d.builder[k]!;
    if (!world.isAlive(builder)) continue;
    const p = previewPlacement(world, builder, { piece: d.piece[k]!, x: d.px[k]!, y: d.py[k]!, level: d.level[k]!, rot: d.rot[k]!, tier: d.tier[k]!, variant: d.variant[k]! });
    d.x[k] = p.x; d.y[k] = p.y; d.z[k] = p.z; d.facing[k] = p.facing; d.valid[k] = p.valid ? 1 : 0; d.reason[k] = p.reason;
    st.markChanged(entityIndex(st.dense[k]!));
  }
}
