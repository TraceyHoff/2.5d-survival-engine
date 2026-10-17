import { defineComponent, type ComponentDef } from "./component.js";
import { entityIndex, type Entity } from "./entity.js";
import type { World } from "./world.js";

/** Modifier ops. Stat ids are gameplay-defined u8 (>= 1); stat 0 marks an empty slot. */
export const enum ModOp { Add = 0, Mul = 1 }
export type ModifierStackDef = ComponentDef<{
  stat: { type: "u8"; length: number }; op: { type: "u8"; length: number };
  value: { type: "f32"; length: number }; expiresAtTick: { type: "u32"; length: number };
}>;
/** Fixed-capacity modifier stack component (SoA arrays). `expiresAtTick` 0 = permanent. Local by default. */
export function defineModifierStack(name: string, capacity = 8, opts: { networked?: boolean } = {}): ModifierStackDef {
  return defineComponent(name, {
    stat: { type: "u8", length: capacity }, op: { type: "u8", length: capacity },
    value: { type: "f32", length: capacity }, expiresAtTick: { type: "u32", length: capacity },
  }, opts) as ModifierStackDef;
}
export interface ModifierSpec { stat: number; op: ModOp; value: number; expiresAtTick?: number; /** replace an existing modifier with the same stat+op (default true) */ replace?: boolean }

const live = (exp: number, tick: number): boolean => exp === 0 || tick < exp;

/** Adds (or refreshes) a modifier; adds the component if missing. Returns slot index or -1 if full. */
export function addModifier(world: World, e: Entity, def: ModifierStackDef, m: ModifierSpec): number {
  if (!(m.stat >= 1 && m.stat <= 255)) throw new Error("modifier stat ids are 1..255");
  if (!world.has(e, def)) world.add(e, def);
  const st = world.store(def); const i = entityIndex(e); const s = st.slot(i); const n = st.lengths["stat"]!;
  const stat = st.data.stat, op = st.data.op, val = st.data.value, exp = st.data.expiresAtTick;
  let slot = -1;
  for (let k = 0; k < n; k++) {
    const j = s * n + k;
    if ((m.replace ?? true) && stat[j] === m.stat && op[j] === m.op && live(exp[j]!, world.tick)) { slot = k; break; }
    if (slot < 0 && (stat[j] === 0 || !live(exp[j]!, world.tick))) slot = k;
  }
  if (slot < 0) return -1;
  const j = s * n + slot; stat[j] = m.stat; op[j] = m.op; val[j] = m.value; exp[j] = m.expiresAtTick ?? 0;
  st.markChanged(i); return slot;
}
/** Removes all modifiers for a stat (optionally only one op). Returns count removed. */
export function removeModifiers(world: World, e: Entity, def: ModifierStackDef, stat: number, op?: ModOp): number {
  if (!world.has(e, def)) return 0;
  const st = world.store(def); const i = entityIndex(e); const s = st.slot(i); const n = st.lengths["stat"]!; let c = 0;
  for (let k = 0; k < n; k++) { const j = s * n + k; if (st.data.stat[j] === stat && (op === undefined || st.data.op[j] === op)) { st.data.stat[j] = 0; c++; } }
  if (c) st.markChanged(i); return c;
}
/** (base + Σ add) × Π mul over live modifiers of `stat` at world.tick (or `tick`). */
export function evaluate(world: World, e: Entity, def: ModifierStackDef, stat: number, base = 0, tick = world.tick): number {
  if (!world.isAlive(e) || !world.has(e, def)) return base;
  const st = world.store(def); const s = st.slot(entityIndex(e)); const n = st.lengths["stat"]!;
  let add = 0, mul = 1;
  for (let k = 0; k < n; k++) {
    const j = s * n + k; if (st.data.stat[j] !== stat || !live(st.data.expiresAtTick[j]!, tick)) continue;
    if (st.data.op[j] === ModOp.Mul) mul *= st.data.value[j]!; else add += st.data.value[j]!;
  }
  return (base + add) * mul;
}
/** Clears expired slots for every entity with the stack (run as a slow system, e.g. every 20 ticks). */
export function pruneModifiers(world: World, def: ModifierStackDef): void {
  const st = world.store(def); const n = st.lengths["stat"]!;
  for (let k = 0; k < st.size; k++) {
    let changed = false;
    for (let m = 0; m < n; m++) { const j = k * n + m; const exp = st.data.expiresAtTick[j]!; if (st.data.stat[j] !== 0 && exp !== 0 && world.tick >= exp) { st.data.stat[j] = 0; changed = true; } }
    if (changed) st.markChanged(entityIndex(st.dense[k]!));
  }
}
