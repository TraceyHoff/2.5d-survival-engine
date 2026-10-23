/**
 * Clan state that core GroupRegistry does not hold: per-rank permission masks, the current clan goal and per-member
 * contribution counters. Server-authoritative; changed only in clan command handlers (and the clan-stall stock hook).
 * Persisted by the server as the world blob "gameplay.clans" (encodeClanState / decodeClanState, format 1).
 * Split from clan.ts so stall permissions can read rank masks without an import cycle.
 */
import { BinaryReader, BinaryWriter, defineResource, GroupRole, type World } from "@engine/core";
import { ECONOMY } from "./economy/config.js";

/** Bit per clan permission (rank masks). Stall bits match StallAction names. Append only. */
export const CLAN_PERMS = ["list", "price", "collect", "stock", "remove", "base", "invite", "kick", "goal"] as const;
export type ClanPerm = typeof CLAN_PERMS[number];
export const clanPermBit = (p: ClanPerm): number => 1 << CLAN_PERMS.indexOf(p);
export const CLAN_PERM_ALL = (1 << CLAN_PERMS.length) - 1;
/** Clan goals (ClanStatus.goal). Append only. */
export const enum ClanGoal { None = 0, BuildBase = 1, StockStalls = 2, Defend = 3, Raid = 4 }
export const CLAN_GOAL_COUNT = 5;

const maskOf = (ps: readonly string[]): number => ps.reduce((m, p) => m | (CLAN_PERMS.includes(p as ClanPerm) ? clanPermBit(p as ClanPerm) : 0), 0);
/** Defaults: stall bits from economy.json rankPolicy; every member may use the base; officers also invite / kick / set goals. */
export function defaultRankMasks(): [number, number] {
  return [maskOf(ECONOMY.rankPolicy[GroupRole.Member] ?? []) | clanPermBit("base"),
    maskOf(ECONOMY.rankPolicy[GroupRole.Officer] ?? []) | clanPermBit("base") | clanPermBit("invite") | clanPermBit("kick") | clanPermBit("goal")];
}

export interface ClanData { member: number; officer: number; goal: number; goalX: number; goalY: number; contrib: Map<number, number> }
export interface ClanStateRes { clans: Map<number, ClanData>; version: number; onChange?: () => void }
export const ClanState = defineResource<ClanStateRes>("gameplay.ClanState");
export function clanState(w: World): ClanStateRes { let s = w.getResource(ClanState); if (!s) w.setResource(ClanState, (s = { clans: new Map(), version: 0 })); return s; }
export function clanData(w: World, clan: number): ClanData {
  const s = clanState(w); let d = s.clans.get(clan);
  if (!d) { const [member, officer] = defaultRankMasks(); s.clans.set(clan, (d = { member, officer, goal: 0, goalX: 0, goalY: 0, contrib: new Map() })); }
  return d;
}
export function touchClans(w: World): void { const s = clanState(w); s.version++; s.onChange?.(); }
/** Rank mask: leader = all; member / officer from the clan's masks; non-members = 0. */
export function rankMask(w: World, clan: number, role: number): number {
  if (role >= GroupRole.Leader) return CLAN_PERM_ALL; if (role <= 0) return 0;
  const d = clanState(w).clans.get(clan); const [m, o] = d ? [d.member, d.officer] : defaultRankMasks();
  return role >= GroupRole.Officer ? o : m;
}
export const hasClanPerm = (w: World, clan: number, role: number, p: ClanPerm): boolean => (rankMask(w, clan, role) & clanPermBit(p)) !== 0;

/** Format 1: u8 ver, u32 n, n × (u32 clan, u32 member, u32 officer, u8 goal, f32 gx, f32 gy, u16 k, k × (u32 player, u32 count)). */
export function encodeClanState(s: ClanStateRes): Uint8Array {
  const w = new BinaryWriter(64); w.write("u8", 1); const ids = [...s.clans.keys()].sort((a, b) => a - b); w.write("u32", ids.length);
  for (const id of ids) {
    const d = s.clans.get(id)!; w.write("u32", id); w.write("u32", d.member); w.write("u32", d.officer); w.write("u8", d.goal); w.write("f32", d.goalX); w.write("f32", d.goalY);
    const c = [...d.contrib].sort((a, b) => a[0] - b[0]); w.write("u16", c.length); for (const [p, n] of c) { w.write("u32", p); w.write("u32", n); }
  }
  return w.finish();
}
export function decodeClanState(bytes: Uint8Array): ClanStateRes {
  const r = new BinaryReader(bytes); const v = r.read("u8"); if (v !== 1) throw new Error(`ClanState: unsupported version ${v}`);
  const clans = new Map<number, ClanData>(); const n = r.read("u32");
  for (let i = 0; i < n; i++) {
    const id = r.read("u32"); const d: ClanData = { member: r.read("u32"), officer: r.read("u32"), goal: r.read("u8"), goalX: r.read("f32"), goalY: r.read("f32"), contrib: new Map() };
    const k = r.read("u16"); for (let j = 0; j < k; j++) d.contrib.set(r.read("u32"), r.read("u32")); clans.set(id, d);
  }
  return { clans, version: 0 };
}
/** Install a decoded state (server boot), keeping any onChange hook. */
export function loadClanState(w: World, s: ClanStateRes): void { const cur = clanState(w); cur.clans = s.clans; }
