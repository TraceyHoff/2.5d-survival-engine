import { StableIdRegistry } from "@engine/core";

/**
 * Recipe data format, modelled on gameplay's data/recipes.json so it can migrate as-is:
 *   { id?, key, station, seconds, ingredients: [{item, count}], output: {item, count} }
 * plus optional `outputs` (extra/byproducts), `unlocks` (recipe keys), `skill` {key, level}, `tags`.
 * Ids are stable via StableIdRegistry (explicit `id` acts as a lock entry). Item/station names are resolved by
 * caller-supplied lookups so the registry stays agnostic of gameplay's item tables. Rules (station range,
 * consumption, cancellation) stay in gameplay.
 */
export interface RawRecipeEntry {
  id?: number; key: string; station?: string; seconds: number;
  ingredients: { item: string; count: number }[];
  output?: { item: string; count: number }; outputs?: { item: string; count: number }[];
  unlocks?: string[]; skill?: { key: string; level: number }; tags?: string[];
}
export interface RecipeEntry {
  id: number; key: string; station: number; seconds: number;
  inputs: { item: number; count: number }[]; outputs: { item: number; count: number }[];
  unlocks: number[]; skill: { key: string; level: number } | undefined; tags: string[];
}
/** station: map station keys to gameplay ids. Omit it to auto-assign stable ids ("none" = 0) via `registry.stationIds` (optionally seeded by `stationLock`). */
export interface RecipeLookups { item(key: string): number | undefined; station?(key: string): number | undefined; stationLock?: Record<string, number> }
export class RecipeRegistry {
  readonly ids = new StableIdRegistry("recipes");
  readonly stationIds = new StableIdRegistry("stations", 0xff);
  stationLock: Record<string, number> = {};
  private byId = new Map<number, RecipeEntry>();
  lock: Record<string, number> = {};
  get(id: number): RecipeEntry | undefined { return this.byId.get(id); }
  byKey(key: string): RecipeEntry | undefined { const id = this.ids.tryId(key); return id === undefined ? undefined : this.byId.get(id); }
  all(): RecipeEntry[] { return [...this.byId.values()].sort((a, b) => a.id - b.id); }
  /** Recipes craftable at a station kind (0 = hand). */
  forStation(station: number): RecipeEntry[] { return this.all().filter((r) => r.station === station); }
  /** Ticks for a recipe at a tick rate (rounded up, >= 1). */
  ticks(id: number, tickHz: number): number { return Math.max(1, Math.ceil((this.byId.get(id)?.seconds ?? 0) * tickHz)); }
}
export function loadRecipes(raw: { recipes: RawRecipeEntry[] } | RawRecipeEntry[], look: RecipeLookups, lock: Record<string, number> = {}): { registry: RecipeRegistry; errors: string[] } {
  const list = Array.isArray(raw) ? raw : raw.recipes; const errors: string[] = []; const reg = new RecipeRegistry();
  const lk: Record<string, number> = { ...lock }; const seen = new Set<string>();
  for (const r of list) {
    if (!r.key || seen.has(r.key)) errors.push(`recipe ${r.key}: missing or duplicate key`); seen.add(r.key);
    if (r.id !== undefined) { if (lk[r.key] !== undefined && lk[r.key] !== r.id) errors.push(`recipe ${r.key}: id ${r.id} conflicts with lock ${lk[r.key]}`); lk[r.key] = r.id; }
  }
  try { reg.lock = reg.ids.assign(list.map((r) => r.key), lk); } catch (e) { errors.push((e as Error).message); return { registry: reg, errors }; }
  if (!look.station) {
    const keys = [...new Set(list.map((r) => r.station).filter((k): k is string => !!k && k !== "none"))];
    try { reg.stationLock = reg.stationIds.assign(keys, look.stationLock ?? {}); } catch (e) { errors.push((e as Error).message); }
  }
  const stationOf = (k: string): number | undefined => look.station ? look.station(k) : reg.stationIds.tryId(k);
  const item = (rk: string, k: string, c: number) => { const id = look.item(k); if (id === undefined) errors.push(`recipe ${rk}: unknown item ${k}`); if (!(Number.isInteger(c) && c > 0)) errors.push(`recipe ${rk}: bad count for ${k}`); return { item: id ?? 0, count: c }; };
  for (const r of list) {
    if (!(r.seconds >= 0)) errors.push(`recipe ${r.key}: bad seconds`);
    const st = !r.station || r.station === "none" ? 0 : stationOf(r.station);
    if (st === undefined) errors.push(`recipe ${r.key}: unknown station ${r.station}`);
    const outs = [...(r.output ? [r.output] : []), ...(r.outputs ?? [])]; if (!outs.length) errors.push(`recipe ${r.key}: no outputs`);
    if (!r.ingredients?.length) errors.push(`recipe ${r.key}: no ingredients`);
    reg["byId"].set(reg.ids.id(r.key), {
      id: reg.ids.id(r.key), key: r.key, station: st ?? 0, seconds: r.seconds,
      inputs: (r.ingredients ?? []).map((i) => item(r.key, i.item, i.count)), outputs: outs.map((o) => item(r.key, o.item, o.count)),
      unlocks: [], skill: r.skill, tags: r.tags ?? [],
    });
  }
  for (const r of list) for (const u of r.unlocks ?? []) { const id = reg.ids.tryId(u); if (id === undefined) errors.push(`recipe ${r.key}: unlocks unknown ${u}`); else reg.get(reg.ids.id(r.key))!.unlocks.push(id); }
  return { registry: reg, errors };
}
