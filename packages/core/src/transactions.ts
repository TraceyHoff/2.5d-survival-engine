import type { ComponentDef } from "./component.js";
import type { Entity } from "./entity.js";
import { defineResource, type World } from "./world.js";

/**
 * Slot containers are owned by gameplay (e.g. its Inventory component). Core only defines the adapter interface
 * and builds atomic transfer + all-or-nothing transactions on top of it.
 */
/** durability (u16, 0/undefined = n/a) and createdTick (u32) are optional per-slot item state. */
export interface Slot { item: number; count: number; meta: number; durability?: number; createdTick?: number }
export type SlotExtras = { meta?: number; durability?: number; createdTick?: number };
/** Combine item state when `add` units of `b` merge into `a` (holding `aCount`). Returns the merged extras. */
export type MergeMetaFn = (a: Slot, aCount: number, b: SlotExtras, addCount: number) => SlotExtras;
/** Default merge: count-weighted average createdTick (rounded), min durability, keep a.meta. */
export const defaultMergeMeta: MergeMetaFn = (a, an, b, bn) => {
  const out: SlotExtras = { meta: a.meta };
  if (a.createdTick !== undefined || b.createdTick !== undefined) {
    const at = a.createdTick ?? b.createdTick!, bt = b.createdTick ?? a.createdTick!;
    out.createdTick = an + bn > 0 ? Math.round((at * an + bt * bn) / (an + bn)) : at;
  }
  const ds = [a.durability, b.durability].filter((d): d is number => d !== undefined && d > 0);
  if (ds.length) out.durability = Math.min(...ds); else if (a.durability !== undefined || b.durability !== undefined) out.durability = 0;
  return out;
};
const extrasOf = (s: Slot): SlotExtras => ({ meta: s.meta, ...(s.durability !== undefined ? { durability: s.durability } : {}), ...(s.createdTick !== undefined ? { createdTick: s.createdTick } : {}) });
export interface SlotContainer {
  capacity(world: World, e: Entity): number;
  getSlot(world: World, e: Entity, i: number): Slot;
  /** item 0 / count 0 = empty. */
  setSlot(world: World, e: Entity, i: number, s: Slot): void;
}
/** Max stack size; receives the slot/extras being stacked so durability items can be non-stackable. */
export type MaxStackFn = (item: number, state?: SlotExtras) => number;
/** Default: items carrying durability > 0 stack to 1, everything else to 65535. */
export const defaultMaxStack: MaxStackFn = (_item, st) => (st?.durability ? 1 : 0xffff);
/** Validates a transfer/op before it happens (permissions, weight...). Return a reason string to reject. */
export type TransferValidator = (world: World, op: TransferOp) => string | undefined;
export interface TransferOp { actor?: Entity; from: Entity; fromSlot: number; to: Entity; toSlot: number; count: number; item: number }

export class ContainerRegistry {
  private adapters: { def: ComponentDef; adapter: SlotContainer }[] = [];
  maxStack: MaxStackFn = defaultMaxStack;
  mergeMeta: MergeMetaFn = defaultMergeMeta;
  validators: TransferValidator[] = [];
  register(def: ComponentDef, adapter: SlotContainer): void { this.adapters.push({ def, adapter }); }
  /** First registered adapter whose component the entity has. */
  adapterFor(world: World, e: Entity): SlotContainer | undefined { for (const a of this.adapters) if (world.has(e, a.def)) return a.adapter; return undefined; }
}
export const Containers = defineResource<ContainerRegistry>("Containers");
/** Custom maxStack hooks still get durability items forced to 1 unless `durabilityStacks` is set. */
export function installContainers(world: World, maxStack?: MaxStackFn, opts: { mergeMeta?: MergeMetaFn; durabilityStacks?: boolean } = {}): ContainerRegistry {
  let r = world.getResource(Containers); if (!r) world.setResource(Containers, (r = new ContainerRegistry()));
  if (maxStack) r.maxStack = opts.durabilityStacks ? maxStack : (item, st) => (st?.durability ? 1 : maxStack(item, st));
  if (opts.mergeMeta) r.mergeMeta = opts.mergeMeta; return r;
}
const pick = (x: SlotExtras): { durability?: number; createdTick?: number } => ({ ...(x.durability !== undefined ? { durability: x.durability } : {}), ...(x.createdTick !== undefined ? { createdTick: x.createdTick } : {}) });
export type TxResult = { ok: true } | { ok: false; reason: string };
const EMPTY: Slot = { item: 0, count: 0, meta: 0 };

/**
 * All-or-nothing multi-container operation. Records every slot's original value on first write; commit()
 * keeps the writes, rollback() restores them. Use for trades, crafting (consume inputs + add outputs), looting.
 */
export class Transaction {
  private undo = new Map<string, { e: Entity; i: number; a: SlotContainer; s: Slot }>();
  private done = false;
  constructor(readonly world: World, readonly reg: ContainerRegistry, readonly actor?: Entity) {}
  private ad(e: Entity): SlotContainer { const a = this.reg.adapterFor(this.world, e); if (!a) throw new Error(`entity ${e} has no registered container`); return a; }
  get(e: Entity, i: number): Slot { return this.ad(e).getSlot(this.world, e, i); }
  set(e: Entity, i: number, s: Slot): void {
    if (this.done) throw new Error("transaction finished"); const a = this.ad(e); const k = `${e}:${i}`;
    if (!this.undo.has(k)) this.undo.set(k, { e, i, a, s: { ...a.getSlot(this.world, e, i) } });
    a.setSlot(this.world, e, i, s.count > 0 && s.item !== 0 ? s : EMPTY);
  }
  /** Move `count` from a slot to a slot (merging or into empty; swaps when target holds a different item and count = all). */
  transfer(from: Entity, slotA: number, to: Entity, slotB: number, count: number): TxResult {
    const w = this.world, a = this.ad(from), b = this.ad(to);
    if (slotA < 0 || slotA >= a.capacity(w, from) || slotB < 0 || slotB >= b.capacity(w, to)) return { ok: false, reason: "bad_slot" };
    const src = a.getSlot(w, from, slotA), dst = b.getSlot(w, to, slotB);
    if (src.item === 0 || src.count <= 0) return { ok: false, reason: "empty" };
    if (!(count > 0 && count <= src.count)) return { ok: false, reason: "bad_count" };
    if (from === to && slotA === slotB) return { ok: true };
    const op: TransferOp = { from, fromSlot: slotA, to, toSlot: slotB, count, item: src.item, ...(this.actor !== undefined ? { actor: this.actor } : {}) };
    for (const v of this.reg.validators) { const r = v(w, op); if (r) return { ok: false, reason: r }; }
    if (dst.item !== 0 && dst.item !== src.item) {
      if (count !== src.count) return { ok: false, reason: "occupied" };
      this.set(to, slotB, src); this.set(from, slotA, dst); return { ok: true }; // swap
    }
    const merging = dst.item === src.item; const have = merging ? dst.count : 0;
    const max = Math.min(this.reg.maxStack(src.item, extrasOf(src)), merging ? this.reg.maxStack(dst.item, extrasOf(dst)) : 0xffff);
    if (have + count > max) {
      if (merging && count === src.count) { this.set(to, slotB, src); this.set(from, slotA, dst); return { ok: true }; } // e.g. two durability tools: swap
      return { ok: false, reason: "stack_full" };
    }
    const ex = merging ? this.reg.mergeMeta(dst, have, extrasOf(src), count) : extrasOf(src);
    this.set(to, slotB, { item: src.item, count: have + count, meta: ex.meta ?? 0, ...pick(ex) });
    this.set(from, slotA, { ...src, count: src.count - count });
    return { ok: true };
  }
  /** Add items anywhere (stack first, then empty). Fails without partial writes when it doesn't fully fit. */
  add(e: Entity, item: number, count: number, extra: number | SlotExtras = 0): TxResult {
    const ex: SlotExtras = typeof extra === "number" ? { meta: extra } : extra;
    const a = this.ad(e), n = a.capacity(this.world, e), max = this.reg.maxStack(item, ex); let left = count;
    const plan: [number, Slot][] = [];
    for (let pass = 0; pass < 2 && left > 0; pass++) for (let i = 0; i < n && left > 0; i++) {
      const s = this.get(e, i); if (pass === 0 ? s.item !== item : s.item !== 0) continue;
      const cap = pass === 0 ? Math.min(max, this.reg.maxStack(item, extrasOf(s))) - s.count : max;
      const put = Math.min(left, cap); if (put <= 0) continue;
      if (pass === 0) { const m = this.reg.mergeMeta(s, s.count, ex, put); plan.push([i, { item, count: s.count + put, meta: m.meta ?? s.meta, ...pick(m) }]); }
      else plan.push([i, { item, count: put, meta: ex.meta ?? 0, ...pick(ex) }]);
      left -= put;
    }
    if (left > 0) return { ok: false, reason: "no_space" };
    for (const [i, s] of plan) this.set(e, i, s); return { ok: true };
  }
  /** Remove items (highest slot first). Fails without partial writes when not enough. */
  remove(e: Entity, item: number, count: number): TxResult {
    const n = this.ad(e).capacity(this.world, e); let have = 0;
    for (let i = 0; i < n; i++) { const s = this.get(e, i); if (s.item === item) have += s.count; }
    if (have < count) return { ok: false, reason: "missing_items" };
    let left = count;
    for (let i = n - 1; i >= 0 && left > 0; i--) { const s = this.get(e, i); if (s.item !== item) continue; const t = Math.min(left, s.count); this.set(e, i, { ...s, count: s.count - t }); left -= t; }
    return { ok: true };
  }
  get touched(): number { return this.undo.size; }
  commit(): void { this.done = true; this.undo.clear(); }
  rollback(): void { if (this.done) throw new Error("transaction finished"); for (const u of [...this.undo.values()].reverse()) u.a.setSlot(this.world, u.e, u.i, u.s); this.undo.clear(); this.done = true; }
}
/** Run fn inside a transaction: committed if it returns ok (and doesn't throw), otherwise rolled back. */
export function transaction(world: World, fn: (tx: Transaction) => TxResult, actor?: Entity): TxResult {
  const tx = new Transaction(world, world.resource(Containers), actor);
  let r: TxResult; try { r = fn(tx); } catch (e) { tx.rollback(); throw e; }
  if (r.ok) tx.commit(); else tx.rollback(); return r;
}
/** Atomic single transfer (validators run). */
export function transfer(world: World, from: Entity, slotA: number, to: Entity, slotB: number, count: number, actor?: Entity): TxResult {
  return transaction(world, (tx) => tx.transfer(from, slotA, to, slotB, count), actor);
}
/** Adapter for components with parallel array fields (e.g. gameplay Inventory {item u16[16], count u16[16]}); meta optional. */
export function arrayFieldsContainer(def: ComponentDef, fields: { item: string; count: string; meta?: string; durability?: string; createdTick?: string; capacity?: string }): SlotContainer {
  return {
    capacity: (w, e) => { const st = w.store(def); const n = st.lengths[fields.item]!; return fields.capacity ? Math.min(n, w.getField(e, def, fields.capacity) as number) : n; },
    getSlot: (w, e, i) => { const st = w.store(def); const x = entityIdx(e);
      const s: Slot = { item: st.readElement(x, fields.item, i) ?? 0, count: st.readElement(x, fields.count, i) ?? 0, meta: fields.meta ? st.readElement(x, fields.meta, i) ?? 0 : 0 };
      if (fields.durability) s.durability = st.readElement(x, fields.durability, i) ?? 0; if (fields.createdTick) s.createdTick = st.readElement(x, fields.createdTick, i) ?? 0; return s; },
    setSlot: (w, e, i, s) => { const st = w.store(def); const x = entityIdx(e); st.writeElement(x, fields.item, i, s.item); st.writeElement(x, fields.count, i, s.count); if (fields.meta) st.writeElement(x, fields.meta, i, s.meta);
      if (fields.durability) st.writeElement(x, fields.durability, i, s.durability ?? 0); if (fields.createdTick) st.writeElement(x, fields.createdTick, i, s.createdTick ?? 0); },
  };
}
import { entityIndex as entityIdx } from "./entity.js";
/** Adapter for components with one scalar field per slot (e.g. item0..item15 / count0..count15). */
export function scalarFieldsContainer(def: ComponentDef, fields: { items: readonly string[]; counts: readonly string[]; metas?: readonly string[]; durabilities?: readonly string[]; createdTicks?: readonly string[]; capacity?: string }): SlotContainer {
  return {
    capacity: (w, e) => fields.capacity ? Math.min(fields.items.length, w.getField(e, def, fields.capacity) as number) : fields.items.length,
    getSlot: (w, e, i) => { const st = w.store(def); const x = entityIdx(e);
      const s: Slot = { item: st.read(x, fields.items[i]!) ?? 0, count: st.read(x, fields.counts[i]!) ?? 0, meta: fields.metas ? st.read(x, fields.metas[i]!) ?? 0 : 0 };
      if (fields.durabilities) s.durability = st.read(x, fields.durabilities[i]!) ?? 0; if (fields.createdTicks) s.createdTick = st.read(x, fields.createdTicks[i]!) ?? 0; return s; },
    setSlot: (w, e, i, s) => { const st = w.store(def); const x = entityIdx(e); st.write(x, fields.items[i]!, s.item); st.write(x, fields.counts[i]!, s.count); if (fields.metas) st.write(x, fields.metas[i]!, s.meta);
      if (fields.durabilities) st.write(x, fields.durabilities[i]!, s.durability ?? 0); if (fields.createdTicks) st.write(x, fields.createdTicks[i]!, s.createdTick ?? 0); },
  };
}
