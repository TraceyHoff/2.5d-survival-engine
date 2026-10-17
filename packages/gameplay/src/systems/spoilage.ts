/**
 * Spoilage (authority, slow system every 20 ticks): food freshness is lazy (core decayAt from each slot's effective
 * created tick), so nothing ticks per item. This system only
 *  1. re-bases created ticks when a holder's spoil multiplier changes (temperature x container), preserving freshness;
 *  2. converts fully spoiled stacks to the spoiled item (data: environment.spoilage.spoiledItem).
 * Multiplier = container spoilMul (piece data) x clamp(1 + mulPerDegree x (temp - tempRefC), minMul, maxMul).
 */
import { entityIndex, Transform, type Entity, type World } from "@engine/core";
import { BuildPiece, Container, Exposure, Inventory, type InvSchema } from "../components.js";
import { pieceOf } from "../building/links.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { freshness, mapSlots, rebaseCreated, slotsAdd } from "../inventory.js";
import { ambientTemperature } from "./environment.js";
import type { ComponentDef } from "@engine/core";

export const SPOILAGE_EVERY = 20;
/** Container multiplier from the owning piece's data (1 for players / free-standing holders). */
function baseMul(world: World, e: Entity): number {
  const p = pieceOf(world, e); if (p === undefined) return 1;
  const t = world.getField(p, BuildPiece, "type"); return (t !== undefined && gameplayDefs(world).pieces.get(t)?.spoilMul) || 1;
}

export function spoilageSystem(world: World, dt: number): void {
  if (!isAuthority(world)) return;
  const defs = gameplayDefs(world); const sp = defs.environment.spoilage; const tickDt = dt / SPOILAGE_EVERY;
  const run = (def: ComponentDef<InvSchema>): void => {
    const st = world.store(def);
    for (let k = st.size - 1; k >= 0; k--) {
      const e = st.dense[k]!; const idx = entityIndex(e);
      const temp = world.has(e, Exposure) ? world.getField(e, Exposure, "feltTemp")! : world.has(e, Transform) ? ambientTemperature(world, world.getField(e, Transform, "x")!, world.getField(e, Transform, "y")!) : sp.tempRefC;
      const tempMul = Math.min(sp.maxMul, Math.max(sp.minMul, 1 + sp.mulPerDegree * (temp - sp.tempRefC)));
      const want = baseMul(world, e) * tempMul; const cur = st.data.spoilMul[k]!;
      const rebase = Math.abs(want - cur) > sp.rebaseThreshold * cur;
      mapSlots(world, e, (v) => {
        let changed = false;
        for (let i = 0; i < v.slotCount; i++) {
          const item = v.item(i); if (!item || !(defs.items.get(item)?.spoilSeconds)) continue;
          if (rebase) { v.put(i, item, v.count(i), rebaseCreated(v.created(i), world.tick, cur, want)); changed = true; }
          if (freshness(defs, item, v.created(i), rebase ? want : cur, world.tick, tickDt) <= 0 && defs.spoiledItem) {
            const n = v.count(i); v.put(i, 0, 0); slotsAdd(v, defs.spoiledItem, n, defs, world.tick); changed = true;
          }
        }
        return changed;
      });
      if (rebase) { st.data.spoilMul[st.slot(idx)] = want; st.markChanged(idx); }
    }
  };
  run(Inventory); run(Container);
}
