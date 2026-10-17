import { fnv1a } from "./schema.js";

/**
 * Stable string-key -> numeric id assignment. Existing ids come from a lock table (persisted next to the data);
 * new keys are appended in sorted order after the current max, so adding content never renumbers old ids.
 * `hash` covers every (key,id) pair and is mixed into the world schema hash for handshakes.
 */
export class StableIdRegistry {
  private byKey = new Map<string, number>();
  private byId = new Map<number, string>();
  constructor(readonly name: string, readonly maxId = 0xffff) {}
  /** Assign ids for `keys`, honoring `lock`; returns the updated lock (existing + new entries). */
  assign(keys: readonly string[], lock: Readonly<Record<string, number>> = {}): Record<string, number> {
    const out: Record<string, number> = {};
    let max = 0;
    for (const [k, id] of Object.entries(lock)) {
      if (!Number.isInteger(id) || id < 1 || id > this.maxId) throw new Error(`${this.name}: bad locked id ${k}=${id}`);
      if (this.byId.has(id) && this.byId.get(id) !== k) throw new Error(`${this.name}: duplicate id ${id}`);
      out[k] = id; max = Math.max(max, id);
    }
    for (const k of [...new Set(keys)].sort()) if (out[k] === undefined) {
      if (++max > this.maxId) throw new Error(`${this.name}: id space exhausted`);
      out[k] = max;
    }
    for (const k of keys) { const id = out[k]!; this.byKey.set(k, id); this.byId.set(id, k); }
    return out;
  }
  id(key: string): number { const v = this.byKey.get(key); if (v === undefined) throw new Error(`${this.name}: unknown key "${key}"`); return v; }
  tryId(key: string): number | undefined { return this.byKey.get(key); }
  key(id: number): string | undefined { return this.byId.get(id); }
  get size(): number { return this.byKey.size; }
  entries(): [string, number][] { return [...this.byKey].sort((a, b) => a[1] - b[1]); }
  get hash(): number { let h = fnv1a(this.name); for (const [k, v] of this.entries()) h = fnv1a(`${k}=${v};`, h); return h; }
}
