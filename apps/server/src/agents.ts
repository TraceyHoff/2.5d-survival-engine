/**
 * Persistent bot identities (core AgentIdentity: name, traits, archetype, goals, relationship, plus free-form memory such as
 * party / clan ties). Records live in the WorldStore namespace "agents" (SQLite on the dedicated server, IndexedDB in offline
 * Pages), one JSON row per agent id. put() writes through immediately; flush() awaits pending writes (shutdown calls it).
 */
import type { AgentIdentity } from "@engine/core";
import type { WorldStore } from "@engine/persist";

export const AGENT_NS = "agents";
/** Identity plus any extra gameplay memory (relationships per player, party / clan memory...). Must be JSON-serialisable. */
export type StoredAgentIdentity = AgentIdentity & Record<string, unknown>;
export type AgentChangeListener = (id: string, identity: StoredAgentIdentity) => void;

export interface AgentIdentityStore {
  get(id: string): StoredAgentIdentity | undefined;
  /** Upsert (shallow-merges into an existing identity) and persist. Returns the stored value. */
  put(id: string, identity: Partial<StoredAgentIdentity>): StoredAgentIdentity;
  /** Subscribe to changes; returns an unsubscribe function. */
  onChange(fn: AgentChangeListener): () => void;
  ids(): string[];
  flush(): Promise<void>;
}

export function createAgentStore(store: WorldStore | undefined, opts: { tick?: () => number; log?: (m: string) => void } = {}): AgentIdentityStore {
  const cache = new Map<string, StoredAgentIdentity>(); const listeners = new Set<AgentChangeListener>(); const pending = new Set<Promise<void>>();
  const enc = new TextEncoder(), dec = new TextDecoder();
  const load = (id: string): StoredAgentIdentity | undefined => {
    if (cache.has(id)) return cache.get(id);
    const r = store?.readRecord(AGENT_NS, id); if (!r) return undefined;
    try { const v = { id, ...JSON.parse(dec.decode(r.bytes)) } as StoredAgentIdentity; cache.set(id, v); return v; } catch { opts.log?.(`agents: record ${id} unreadable`); return undefined; }
  };
  return {
    get: load,
    put(id, identity) {
      const v = { ...(load(id) ?? {}), ...identity, id } as StoredAgentIdentity; cache.set(id, v);
      if (store) { const p = store.write({ records: [{ ns: AGENT_NS, id, format: 1, bytes: enc.encode(JSON.stringify(v)), tick: opts.tick?.() ?? 0, ownerKind: 0, ownerId: 0, chunk: "" }] }).catch((e: unknown) => opts.log?.(`agents: save ${id} failed: ${String(e)}`)); pending.add(p); void p.finally(() => pending.delete(p)); }
      for (const fn of listeners) { try { fn(id, v); } catch (e) { opts.log?.(`agents: onChange threw: ${String(e)}`); } }
      return v;
    },
    onChange(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    ids: () => [...cache.keys()],
    async flush() { await Promise.allSettled([...pending]); },
  };
}
