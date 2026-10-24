/**
 * Bot relationship / party / clan memory, stored on the bot's AgentIdentity record (game.agents, the "agents" WorldStore
 * namespace) under `social`. Shape: relationships keyed by persistent player id -> { trust, affinity, lastSeen, notableEvents[] },
 * plus party and clan membership memory. Pure and browser-safe: observeSocialMemory (called from buildAgentView) updates it from
 * the replica; flushSocialMemory writes dirty bots through a put(id, partial) sink (game.agents.put), debounced per bot.
 * Loading needs nothing extra: addBot merges game.agents.get(id) into the identity, and socialMemoryOf validates it.
 */
import { Membership, PlayerId, Transform, type Agent, type Entity, type World } from "@engine/core";
import { ClanStatus } from "../components.js";

export interface NotableEvent { tick: number; kind: SocialEventKind }
export interface Relation { trust: number; affinity: number; lastSeen: number; notableEvents: NotableEvent[] }
export interface SocialMemory {
  relationships: Record<string, Relation>;
  party: { id: number; since: number } | null;
  clan: { id: number; role: number; since: number } | null;
}
/** trust / affinity deltas (clamped to -1..1) per event; data lives here because it tunes bot temperament, not rules. */
export const SOCIAL_EVENTS = {
  partied: { trust: 0.15, affinity: 0.2 }, clanmate: { trust: 0.2, affinity: 0.15 }, traded: { trust: 0.05, affinity: 0.05 },
  helped: { trust: 0.2, affinity: 0.2 }, attacked: { trust: -0.5, affinity: -0.4 }, kicked: { trust: -0.3, affinity: -0.3 },
  left: { trust: -0.05, affinity: -0.1 },
} as const;
export type SocialEventKind = keyof typeof SOCIAL_EVENTS;
export const SOCIAL_MEMORY = { maxEvents: 8, maxRelations: 64, seenEveryTicks: 20 * 10, writeDebounceTicks: 20 * 15 };

type SocialIdentity = Agent["identity"] & { social?: unknown };
const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Validates whatever the store returned (old records, hand edits) into a SocialMemory, attaching it to the identity. */
export function socialMemoryOf(agent: Agent): SocialMemory {
  const id = agent.identity as SocialIdentity; const raw = id.social as Partial<SocialMemory> | undefined;
  if (raw && (raw as { __ok?: true }).__ok) return raw as SocialMemory;
  const rel: Record<string, Relation> = {};
  if (raw && typeof raw.relationships === "object" && raw.relationships) {
    for (const [k, r] of Object.entries(raw.relationships)) {
      if (!/^\d+$/.test(k) || !r || typeof r !== "object") continue;
      const ev = Array.isArray(r.notableEvents) ? r.notableEvents.filter((e) => e && typeof e.kind === "string" && e.kind in SOCIAL_EVENTS).map((e) => ({ tick: num(e.tick), kind: e.kind })) : [];
      rel[k] = { trust: clamp(num(r.trust)), affinity: clamp(num(r.affinity)), lastSeen: num(r.lastSeen), notableEvents: ev.slice(-SOCIAL_MEMORY.maxEvents) };
    }
  }
  const p = raw?.party, c = raw?.clan;
  const mem: SocialMemory = { relationships: rel, party: p && num(p.id) ? { id: num(p.id), since: num(p.since) } : null, clan: c && num(c.id) ? { id: num(c.id), role: num(c.role), since: num(c.since) } : null };
  Object.defineProperty(mem, "__ok", { value: true, enumerable: false }); id.social = mem; return mem;
}

const dirty = new WeakMap<Agent, { since: number }>();
const markDirty = (a: Agent, tick: number): void => { if (!dirty.has(a)) dirty.set(a, { since: tick }); };
const relationOf = (m: SocialMemory, player: number, tick: number): Relation => {
  const k = String(player); let r = m.relationships[k];
  if (!r) {
    r = m.relationships[k] = { trust: 0, affinity: 0, lastSeen: tick, notableEvents: [] };
    const keys = Object.keys(m.relationships); if (keys.length > SOCIAL_MEMORY.maxRelations) { // forget the stalest
      const old = keys.filter((x) => x !== k).sort((a, b) => m.relationships[a]!.lastSeen - m.relationships[b]!.lastSeen)[0]; if (old) delete m.relationships[old];
    }
  }
  return r;
};

/** Records a notable event with a player (trust/affinity shift, capped event log). */
export function noteSocialEvent(agent: Agent, player: number, kind: SocialEventKind, tick: number): void {
  if (!player) return; const m = socialMemoryOf(agent); const r = relationOf(m, player, tick); const d = SOCIAL_EVENTS[kind];
  r.trust = clamp(r.trust + d.trust); r.affinity = clamp(r.affinity + d.affinity); r.lastSeen = tick;
  r.notableEvents.push({ tick, kind }); if (r.notableEvents.length > SOCIAL_MEMORY.maxEvents) r.notableEvents.splice(0, r.notableEvents.length - SOCIAL_MEMORY.maxEvents);
  markDirty(agent, tick);
}
/** Trust in a player (-1..1): remembered trust, else the identity's legacy scalar relationship. */
export function trustOf(agent: Agent, player: number): number {
  const r = player ? socialMemoryOf(agent).relationships[String(player)] : undefined;
  return r ? r.trust : clamp(num(agent.identity.relationship));
}

/**
 * Updates memory from the bot's replica: party / clan joins and leaves (with "partied" / "clanmate" / "left" events for the
 * others in the group) and lastSeen for visible players (throttled). Called from buildAgentView.
 */
export function observeSocialMemory(world: World, self: Entity, agent: Agent): void {
  const m = socialMemoryOf(agent); const tick = world.tick;
  const party = world.getField(self, Membership, "partyId") ?? 0;
  const clan = world.has(self, ClanStatus) ? world.getField(self, ClanStatus, "clan")! : world.getField(self, Membership, "clanId") ?? 0;
  const role = clan && world.has(self, ClanStatus) ? world.getField(self, ClanStatus, "role")! : 0;
  const t = world.get(self, Transform); const me = world.getField(self, PlayerId, "id") ?? 0;
  const others = (field: "partyId" | "clanId", id: number): number[] => {
    const out: number[] = []; if (!id) return out;
    for (const e of world.query([PlayerId, Membership])) { const p = world.getField(e, PlayerId, "id")!; if (e !== self && p !== me && world.getField(e, Membership, field) === id) out.push(p); }
    return out;
  };
  if ((m.party?.id ?? 0) !== party) {
    if (m.party) for (const p of others("partyId", m.party.id)) noteSocialEvent(agent, p, "left", tick);
    m.party = party ? { id: party, since: tick } : null; for (const p of others("partyId", party)) noteSocialEvent(agent, p, "partied", tick); markDirty(agent, tick);
  }
  if ((m.clan?.id ?? 0) !== clan || (clan && m.clan!.role !== role)) {
    const joined = (m.clan?.id ?? 0) !== clan;
    m.clan = clan ? { id: clan, role, since: joined ? tick : m.clan!.since } : null;
    if (joined) for (const p of others("clanId", clan)) noteSocialEvent(agent, p, "clanmate", tick);
    markDirty(agent, tick);
  }
  if (!t) return;
  for (const e of world.query([PlayerId, Transform])) {
    if (e === self) continue; const p = world.getField(e, PlayerId, "id")!; if (!p || p === me) continue;
    const r = m.relationships[String(p)]; if (!r) continue; // only refresh people the bot already knows
    if (tick - r.lastSeen >= SOCIAL_MEMORY.seenEveryTicks) { r.lastSeen = tick; markDirty(agent, tick); }
  }
}

export type AgentPut = (id: string, partial: { social: SocialMemory }) => unknown;
/**
 * Debounced write-through: a bot dirty for at least writeDebounceTicks is written once with put(id, { social }) (game.agents.put
 * persists immediately). force = write every dirty bot now (bot removal / shutdown). Returns the ids written.
 */
export function flushSocialMemory(agents: Iterable<Agent>, put: AgentPut, tick: number, force = false): string[] {
  const out: string[] = [];
  for (const a of agents) {
    const d = dirty.get(a); if (!d || (!force && tick - d.since < SOCIAL_MEMORY.writeDebounceTicks)) continue;
    dirty.delete(a); const m = socialMemoryOf(a); put(a.identity.id, { social: JSON.parse(JSON.stringify(m)) as SocialMemory }); out.push(a.identity.id);
  }
  return out;
}
export const socialMemoryDirty = (a: Agent): boolean => dirty.has(a);
