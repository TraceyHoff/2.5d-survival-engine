/**
 * Clan commands on core social (GroupRegistry, GroupKind.Clan, GroupRole), keyed by account PlayerId. They serve humans and
 * bots alike. Server-authoritative and deterministic: invites expire by tick, and leadership passes to the highest role,
 * then the lowest PlayerId. Rank permissions are per-clan masks (clan_state.ts) read by stall permissions (stallRule)
 * and by base access: members whose rank has "base" carry Tribe = clan id, so the existing PrivilegeZone and door
 * lockTribe checks treat a clan base as theirs.
 *
 * Disband rule (also applied when the last member leaves):
 * - Clan-owned stalls and tills go to the leader (StallOwnerKind.Player), and every such stall closes (open = 0).
 * - OwnedBy.groupId = clan becomes OwnedBy.playerId = leader.
 * - Claims owned by the clan are removed.
 * - Base pieces keep tribe = clan id. The leader keeps Tribe = clan id as a personal tribe, so the base stays theirs;
 *   everyone else loses that Tribe.
 * - Clan state and invites are dropped.
 */
import { ClanInvitePending, ClanStatus, PartyRank, StallHeader, StallOwnerKind, Tribe } from "./components.js";
import { clanData, clanState, hasClanPerm, touchClans, CLAN_PERM_ALL, CLAN_GOAL_COUNT } from "./clan_state.js";
import { bumpStall, setStallOwnership, tillOf } from "./economy/stall.js";
import { defineCommand, defineResource, GroupKind, GroupRole, Membership, OwnedBy, Permissions, PlayerId, playerOf, type CommandHandlers, type Entity, type GroupRegistry, type World } from "@engine/core";

export const ClanCreateCmd = defineCommand("gameplay.clanCreate", {});
export const ClanInviteCmd = defineCommand("gameplay.clanInvite", { target: "u32" });
export const ClanAcceptCmd = defineCommand("gameplay.clanAccept", { clan: "u32" });
export const ClanLeaveCmd = defineCommand("gameplay.clanLeave", {});
export const ClanPromoteCmd = defineCommand("gameplay.clanPromote", { target: "u32" });
export const ClanDemoteCmd = defineCommand("gameplay.clanDemote", { target: "u32" });
export const ClanKickCmd = defineCommand("gameplay.clanKick", { target: "u32" });
export const ClanSetRankPermsCmd = defineCommand("gameplay.clanSetRankPerms", { role: "u8", mask: "u32" });
export const ClanDisbandCmd = defineCommand("gameplay.clanDisband", {});
/** Leaders / officers with the "goal" permission point the clan at a goal (ClanGoal) and a spot. */
export const ClanSetGoalCmd = defineCommand("gameplay.clanSetGoal", { goal: "u8", x: "f32", y: "f32" });
/** Registration order = wire order. Append only. */
export const CLAN_COMMANDS = [ClanCreateCmd, ClanInviteCmd, ClanAcceptCmd, ClanLeaveCmd, ClanPromoteCmd, ClanDemoteCmd, ClanKickCmd, ClanSetRankPermsCmd, ClanDisbandCmd, ClanSetGoalCmd] as const;
/** Decline a pending clan invite (like PartyDeclineCmd). Kept out of CLAN_COMMANDS (wire order is fixed); registered right after it. */
export const ClanDeclineCmd = defineCommand("gameplay.clanDecline", { clan: "u32" });
export const CLAN_ENTITY_FIELDS: Readonly<Record<string, readonly string[]>> = { [ClanInviteCmd.name]: ["target"], [ClanPromoteCmd.name]: ["target"], [ClanDemoteCmd.name]: ["target"], [ClanKickCmd.name]: ["target"] };
/** Appended to the server reason list after PARTY_REJECT_REASONS (shared ones like no_player/self/outranked reuse those codes). */
export const CLAN_REJECT_REASONS = ["in_clan", "not_in_clan", "no_permission", "clan_full", "not_leader", "bad_role", "max_rank", "min_rank", "bad_goal"] as const;
export const CLAN_RULES = { maxSize: 20, inviteTicks: 20 * 120 };
const F32_MAX = 3.4028234663852886e38;
/** Goal coordinates: any finite f32 (the wire type); NaN / Infinity are rejected. */
export const clanGoalCoordOk = (v: number): boolean => Number.isFinite(v) && Math.abs(v) <= F32_MAX;

export interface ClanInvite { clan: number; from: number; expiresTick: number }
export const ClanInvites = defineResource<Map<number, ClanInvite[]>>("gameplay.ClanInvites");
const invites = (w: World): Map<number, ClanInvite[]> => { let m = w.getResource(ClanInvites); if (!m) w.setResource(ClanInvites, (m = new Map())); return m; };
const groups = (w: World): GroupRegistry => w.resource(Permissions).groups;
export const clanOf = (w: World, player: number): number => (player ? groups(w).groupsOf(player, GroupKind.Clan)[0]?.id ?? 0 : 0);
export const clanLeaderOf = (w: World, clan: number): number => { const g = groups(w).get(clan); if (!g) return 0; for (const [p, r] of g.members) if (r === GroupRole.Leader) return p; return 0; };
function entityOfPlayer(w: World, player: number): Entity | undefined { for (const e of w.query([PlayerId])) if (w.getField(e, PlayerId, "id") === player) return e; return undefined; }
const alive = (w: World, e: number): boolean => w.isAlive(e as Entity);

/**
 * Mirrors the registry onto a player's entity: Membership (party + clan), ClanStatus, and Tribe = clan id for ranks with
 * "base". A Tribe is only removed when it was this player's previous clan, so tribes set by other systems are left alone.
 * The server calls this when a player claims an account; clan handlers call it for every affected player.
 */
export function syncSocialMembership(w: World, e: Entity): void {
  const player = playerOf(w, e); if (!player) return; const R = groups(w);
  const party = R.groupsOf(player, GroupKind.Party)[0]?.id ?? 0, clan = clanOf(w, player);
  if (w.has(e, Membership)) { w.setField(e, Membership, "partyId", party); w.setField(e, Membership, "clanId", clan); } else w.add(e, Membership, { partyId: party, clanId: clan });
  const prole = party ? R.role(party, player) : 0;
  if (!prole) { if (w.has(e, PartyRank)) w.remove(e, PartyRank); } else if (w.has(e, PartyRank)) w.setField(e, PartyRank, "role", prole); else w.add(e, PartyRank, { role: prole });
  const prev = w.getField(e, ClanStatus, "clan") ?? 0;
  if (clan) {
    const d = clanData(w, clan); const role = R.role(clan, player);
    const st = { clan, role, goal: d.goal, goalX: d.goalX, goalY: d.goalY, contrib: d.contrib.get(player) ?? 0 };
    if (w.has(e, ClanStatus)) w.set(e, ClanStatus, st); else w.add(e, ClanStatus, st);
  } else if (w.has(e, ClanStatus)) w.remove(e, ClanStatus);
  const tribe = w.getField(e, Tribe, "id") ?? 0; const wantBase = clan && clan <= 0xffff && hasClanPerm(w, clan, R.role(clan, player), "base");
  if (wantBase) { if (tribe !== clan) { if (w.has(e, Tribe)) w.setField(e, Tribe, "id", clan); else w.add(e, Tribe, { id: clan }); } }
  else if (tribe && tribe === prev && w.has(e, Tribe)) w.remove(e, Tribe);
}
const syncPlayer = (w: World, player: number): void => { const e = entityOfPlayer(w, player); if (e !== undefined) syncSocialMembership(w, e); };
const syncClan = (w: World, clan: number): void => { const g = groups(w).get(clan); if (g) for (const p of [...g.members.keys()].sort((a, b) => a - b)) syncPlayer(w, p); };
function syncInvite(w: World, player: number): void {
  const e = entityOfPlayer(w, player); if (e === undefined) return;
  const l = (invites(w).get(player) ?? []).filter((x) => x.expiresTick > w.tick); const top = l[l.length - 1];
  if (!top) { if (w.has(e, ClanInvitePending)) w.remove(e, ClanInvitePending); return; }
  if (w.has(e, ClanInvitePending)) w.set(e, ClanInvitePending, { ...top }); else w.add(e, ClanInvitePending, { ...top });
}
export function pendingClanInvite(w: World, player: number, clan: number): ClanInvite | undefined | "expired" {
  const l = invites(w).get(player); const i = l?.findIndex((x) => x.clan === clan) ?? -1; if (!l || i < 0) return undefined;
  if (l[i]!.expiresTick <= w.tick) { l.splice(i, 1); syncInvite(w, player); return "expired"; } return l[i];
}

// ---- validation (reason string or undefined) ------------------------------------------------------
type Ctx = { me: number; clan: number; role: number };
function actorCtx(w: World, actor: Entity): Ctx | string { const me = playerOf(w, actor); if (!me) return "no_player"; const clan = clanOf(w, me); return { me, clan, role: clan ? groups(w).role(clan, me) : 0 }; }
function targetIn(w: World, c: Ctx, target: number): number | string {
  if (!alive(w, target)) return "no_target"; const them = playerOf(w, target as Entity); if (!them) return "no_target";
  if (them === c.me) return "self"; if (!c.clan || clanOf(w, them) !== c.clan) return "not_in_clan"; return them;
}
export function clanCreateReject(w: World, actor: Entity): string | undefined { const c = actorCtx(w, actor); if (typeof c === "string") return c; return c.clan ? "in_clan" : undefined; }
export function clanInviteReject(w: World, actor: Entity, target: number): string | undefined {
  const c = actorCtx(w, actor); if (typeof c === "string") return c; if (!c.clan) return "not_in_clan";
  if (!hasClanPerm(w, c.clan, c.role, "invite")) return "no_permission";
  if (!alive(w, target)) return "no_target"; const them = playerOf(w, target as Entity); if (!them) return "no_target";
  if (them === c.me) return "self"; if (clanOf(w, them)) return "in_clan";
  if (groups(w).get(c.clan)!.members.size >= CLAN_RULES.maxSize) return "clan_full"; return undefined;
}
export function clanAcceptReject(w: World, actor: Entity, clan: number): string | undefined {
  const me = playerOf(w, actor); if (!me) return "no_player"; if (clanOf(w, me)) return "in_clan";
  const inv = pendingClanInvite(w, me, clan); if (inv === "expired") return "invite_expired"; if (!inv) return "no_invite";
  const g = groups(w).get(clan); if (!g || g.kind !== GroupKind.Clan) return "no_invite";
  return g.members.size >= CLAN_RULES.maxSize ? "clan_full" : undefined;
}
export function clanRankReject(w: World, actor: Entity, target: number, dir: 1 | -1): string | undefined {
  const c = actorCtx(w, actor); if (typeof c === "string") return c; const them = targetIn(w, c, target); if (typeof them === "string") return them;
  if (c.role !== GroupRole.Leader) return "not_leader"; const r = groups(w).role(c.clan, them);
  if (dir > 0 && r >= GroupRole.Officer + 1) return "max_rank"; if (dir < 0 && r <= GroupRole.Member) return "min_rank"; return undefined;
}
export function clanKickReject(w: World, actor: Entity, target: number): string | undefined {
  const c = actorCtx(w, actor); if (typeof c === "string") return c; const them = targetIn(w, c, target); if (typeof them === "string") return them;
  if (!hasClanPerm(w, c.clan, c.role, "kick")) return "no_permission"; return c.role <= groups(w).role(c.clan, them) ? "outranked" : undefined;
}
export function clanPermsReject(w: World, actor: Entity, role: number, mask: number): string | undefined {
  const c = actorCtx(w, actor); if (typeof c === "string") return c; if (!c.clan) return "not_in_clan"; if (c.role !== GroupRole.Leader) return "not_leader";
  return (role === GroupRole.Member || role === GroupRole.Officer) && (mask & ~CLAN_PERM_ALL) === 0 ? undefined : "bad_role";
}
export function clanGoalReject(w: World, actor: Entity, goal: number, x = 0, y = 0): string | undefined {
  const c = actorCtx(w, actor); if (typeof c === "string") return c; if (!c.clan) return "not_in_clan";
  if (!hasClanPerm(w, c.clan, c.role, "goal")) return "no_permission"; return goal < CLAN_GOAL_COUNT && clanGoalCoordOk(x) && clanGoalCoordOk(y) ? undefined : "bad_goal";
}
const simple = (w: World, actor: Entity, leader: boolean): string | undefined => { const c = actorCtx(w, actor); if (typeof c === "string") return c; if (!c.clan) return "not_in_clan"; return leader && c.role !== GroupRole.Leader ? "not_leader" : undefined; };

// ---- apply ----------------------------------------------------------------------------------------
export function clanCreate(w: World, actor: Entity): string | undefined {
  const r = clanCreateReject(w, actor); if (r) return r; const me = playerOf(w, actor);
  const id = groups(w).create(GroupKind.Clan, me).id; clanData(w, id); invites(w).delete(me); syncInvite(w, me); syncPlayer(w, me); touchClans(w); return undefined;
}
export function clanInvite(w: World, actor: Entity, target: number): string | undefined {
  const r = clanInviteReject(w, actor, target); if (r) return r;
  const me = playerOf(w, actor), them = playerOf(w, target as Entity), clan = clanOf(w, me);
  const l = invites(w).get(them) ?? []; invites(w).set(them, l); const ex = l.findIndex((x) => x.clan === clan); if (ex >= 0) l.splice(ex, 1);
  l.push({ clan, from: me, expiresTick: w.tick + CLAN_RULES.inviteTicks }); syncInvite(w, them); return undefined;
}
export function clanAccept(w: World, actor: Entity, clan: number): string | undefined {
  const r = clanAcceptReject(w, actor, clan); if (r) return r; const me = playerOf(w, actor);
  groups(w).addMember(clan, me, GroupRole.Member); invites(w).delete(me); syncInvite(w, me); syncPlayer(w, me); touchClans(w); return undefined;
}
export function clanDecline(w: World, player: number, clan: number): void { const l = invites(w).get(player); const i = l?.findIndex((x) => x.clan === clan) ?? -1; if (l && i >= 0) { l.splice(i, 1); syncInvite(w, player); } }
/** Applies the disband rule (see file header). */
export function disbandClan(w: World, clan: number): void {
  const R = groups(w); const g = R.get(clan); if (!g || g.kind !== GroupKind.Clan) return;
  const leader = clanLeaderOf(w, clan) || [...g.members].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 0;
  for (const e of w.query([StallHeader])) {
    const h = w.get(e, StallHeader)!; if (h.ownerKind !== StallOwnerKind.Clan || h.ownerId !== clan) continue;
    setStallOwnership(w, e, tillOf(w, e), leader ? StallOwnerKind.Player : StallOwnerKind.None, leader);
    w.setField(e, StallHeader, "open", 0); bumpStall(w, e);
  }
  for (const e of w.query([OwnedBy])) if (w.getField(e, OwnedBy, "groupId") === clan) w.set(e, OwnedBy, { playerId: leader, groupId: 0 });
  const C = w.resource(Permissions).claims; for (const c of C.all()) if (c.ownerGroup === clan) C.remove(c.id);
  const members = [...g.members.keys()].sort((a, b) => a - b); R.delete(clan); clanState(w).clans.delete(clan);
  for (const l of invites(w).values()) for (let i = l.length - 1; i >= 0; i--) if (l[i]!.clan === clan) l.splice(i, 1);
  for (const p of members) { const e = entityOfPlayer(w, p); if (e === undefined) continue; syncSocialMembership(w, e); syncInvite(w, p);
    if (p === leader && clan <= 0xffff) { if (w.has(e, Tribe)) w.setField(e, Tribe, "id", clan); else w.add(e, Tribe, { id: clan }); } }
  touchClans(w);
}
/** Removes `player` from their clan if any — leaving rules: leadership passes to the highest rank, a sole member disbands (ADR-099). */
export function clanRemovePlayer(w: World, player: number): boolean { const c = clanOf(w, player); if (!c) return false; removeFromClan(w, c, player); return true; }
function removeFromClan(w: World, clan: number, player: number): void {
  const R = groups(w); const g = R.get(clan)!; if (g.members.size <= 1) { disbandClan(w, clan); return; }
  const wasLeader = R.role(clan, player) === GroupRole.Leader; R.removeMember(clan, player); clanData(w, clan).contrib.delete(player);
  if (wasLeader) { const next = [...g.members].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!; R.setRole(clan, next[0], GroupRole.Leader); }
  syncPlayer(w, player); syncClan(w, clan); touchClans(w);
}
export function clanLeave(w: World, actor: Entity): string | undefined { const r = simple(w, actor, false); if (r) return r; const me = playerOf(w, actor); removeFromClan(w, clanOf(w, me), me); return undefined; }
export function clanKick(w: World, actor: Entity, target: number): string | undefined {
  const r = clanKickReject(w, actor, target); if (r) return r; removeFromClan(w, clanOf(w, playerOf(w, actor)), playerOf(w, target as Entity)); return undefined;
}
/** Promote: Member -> Officer; Officer -> Leader hands over leadership (the old leader becomes Officer). Demote: Officer -> Member. */
export function clanPromote(w: World, actor: Entity, target: number): string | undefined {
  const r = clanRankReject(w, actor, target, 1); if (r) return r; const me = playerOf(w, actor), them = playerOf(w, target as Entity), clan = clanOf(w, me), R = groups(w);
  if (R.role(clan, them) === GroupRole.Officer) { R.setRole(clan, them, GroupRole.Leader); R.setRole(clan, me, GroupRole.Officer); } else R.setRole(clan, them, GroupRole.Officer);
  syncClan(w, clan); touchClans(w); return undefined;
}
export function clanDemote(w: World, actor: Entity, target: number): string | undefined {
  const r = clanRankReject(w, actor, target, -1); if (r) return r; const clan = clanOf(w, playerOf(w, actor));
  groups(w).setRole(clan, playerOf(w, target as Entity), GroupRole.Member); syncClan(w, clan); touchClans(w); return undefined;
}
export function clanSetRankPerms(w: World, actor: Entity, role: number, mask: number): string | undefined {
  const r = clanPermsReject(w, actor, role, mask); if (r) return r; const clan = clanOf(w, playerOf(w, actor)); const d = clanData(w, clan);
  if (role === GroupRole.Member) d.member = mask >>> 0; else d.officer = mask >>> 0; syncClan(w, clan); touchClans(w); return undefined;
}
export function clanSetGoal(w: World, actor: Entity, goal: number, x: number, y: number): string | undefined {
  const r = clanGoalReject(w, actor, goal, x, y); if (r) return r; const clan = clanOf(w, playerOf(w, actor)); const d = clanData(w, clan);
  d.goal = goal; d.goalX = x; d.goalY = y; syncClan(w, clan); touchClans(w); return undefined;
}
export function clanDisband(w: World, actor: Entity): string | undefined { const r = simple(w, actor, true); if (r) return r; disbandClan(w, clanOf(w, playerOf(w, actor))); return undefined; }
/** Stall hook: a member stocked a stall owned by their clan (counts toward contribution; leaders promote active members). */
export function noteClanContribution(w: World, actor: Entity, clan: number, count: number): void {
  const me = playerOf(w, actor); if (!me || !clan || clanOf(w, me) !== clan || count <= 0) return;
  const d = clanData(w, clan); d.contrib.set(me, (d.contrib.get(me) ?? 0) + count); syncPlayer(w, me); touchClans(w);
}

export function installClanCommands(world: World, handlers: CommandHandlers): void {
  const h = <V>(validate: (v: V, a: Entity) => string | undefined, apply: (v: V, a: Entity) => unknown) => ({ validate: (v: V, c: { actor: Entity }) => validate(v, c.actor), handle: (v: V, c: { actor: Entity }) => { apply(v, c.actor); } });
  handlers.on(ClanCreateCmd, h((_v, a) => clanCreateReject(world, a), (_v, a) => clanCreate(world, a)));
  handlers.on(ClanInviteCmd, h((v, a) => clanInviteReject(world, a, v.target), (v, a) => clanInvite(world, a, v.target)));
  handlers.on(ClanAcceptCmd, h((v, a) => clanAcceptReject(world, a, v.clan), (v, a) => clanAccept(world, a, v.clan)));
  handlers.on(ClanLeaveCmd, h((_v, a) => simple(world, a, false), (_v, a) => clanLeave(world, a)));
  handlers.on(ClanPromoteCmd, h((v, a) => clanRankReject(world, a, v.target, 1), (v, a) => clanPromote(world, a, v.target)));
  handlers.on(ClanDemoteCmd, h((v, a) => clanRankReject(world, a, v.target, -1), (v, a) => clanDemote(world, a, v.target)));
  handlers.on(ClanKickCmd, h((v, a) => clanKickReject(world, a, v.target), (v, a) => clanKick(world, a, v.target)));
  handlers.on(ClanSetRankPermsCmd, h((v, a) => clanPermsReject(world, a, v.role, v.mask), (v, a) => clanSetRankPerms(world, a, v.role, v.mask)));
  handlers.on(ClanDisbandCmd, h((_v, a) => simple(world, a, true), (_v, a) => clanDisband(world, a)));
  handlers.on(ClanDeclineCmd, { validate: (v, c) => { const me = playerOf(world, c.actor); if (!me) return "no_player"; const i = pendingClanInvite(world, me, v.clan); return i === "expired" ? "invite_expired" : i ? undefined : "no_invite"; }, handle: (v, c) => { clanDecline(world, playerOf(world, c.actor), v.clan); } });
  handlers.on(ClanSetGoalCmd, h((v, a) => clanGoalReject(world, a, v.goal, v.x, v.y), (v, a) => clanSetGoal(world, a, v.goal, v.x, v.y)));
}
