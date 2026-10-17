import { defineResource, entityIndex, Transform, type Entity, type World } from "@engine/core";
import { SpatialHash } from "./spatial.js";

/** Shared per-world spatial index over Transform (x,y), maintained by the postSim system "spatialIndex". */
export class SpatialIndex {
  readonly hash: SpatialHash;
  constructor(private world: World, cellSize = 4) { this.hash = new SpatialHash(cellSize); }
  /** Entities whose Transform is within radius r of (x,y) (exact distance test). */
  queryRadius(x: number, y: number, r: number, out: Entity[] = []): Entity[] {
    const st = this.world.store(Transform); const r2 = r * r;
    for (const e of this.hash.queryRadius(x, y, r)) {
      const s = st.slot(entityIndex(e)); if (s < 0) continue;
      const dx = st.data.x[s]! - x, dy = st.data.y[s]! - y; if (dx * dx + dy * dy <= r2) out.push(e);
    }
    return out;
  }
  /** Entities inside the axis-aligned rect (inclusive). */
  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: Entity[] = []): Entity[] {
    const st = this.world.store(Transform);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, r = Math.max(maxX - minX, maxY - minY) / 2;
    for (const e of this.hash.queryRadius(cx, cy, r)) {
      const s = st.slot(entityIndex(e)); if (s < 0) continue;
      const x = st.data.x[s]!, y = st.data.y[s]!; if (x >= minX && x <= maxX && y >= minY && y <= maxY) out.push(e);
    }
    return out;
  }
  /** Incremental update from Transform change/removal records (called by the system). */
  update(): void {
    const w = this.world; const st = w.store(Transform);
    for (const e of w.removed(Transform)) this.hash.remove(e);
    for (const i of st.changedIndices()) { const s = st.slot(i); this.hash.insert(st.dense[s]!, st.data.x[s]!, st.data.y[s]!); }
  }
  /** Full rebuild (e.g. after snapshot load). */
  rebuild(): void {
    this.hash.clear(); const st = this.world.store(Transform);
    for (let k = 0; k < st.size; k++) this.hash.insert(st.dense[k]!, st.data.x[k]!, st.data.y[k]!);
  }
}
export const SpatialIndexRes = defineResource<SpatialIndex>("SpatialIndex");

/** Installs the shared index resource + postSim system "spatialIndex". Idempotent. Returns the index. */
export function installSpatialIndex(world: World, opts: { cellSize?: number } = {}): SpatialIndex {
  const ex = world.getResource(SpatialIndexRes); if (ex) return ex;
  const idx = new SpatialIndex(world, opts.cellSize); idx.rebuild();
  world.setResource(SpatialIndexRes, idx);
  world.addSystem("postSim", "spatialIndex", () => idx.update());
  return idx;
}
