/**
 * Party commands on core social (GroupRegistry, GroupKind.Party, GroupRole) keyed by account PlayerId. Server-authoritative
 * and deterministic: invites expire by world tick, promotion order is fixed (highest role, then lowest PlayerId), and the
 * registry is only changed in command handlers. Netcode handles rate limiting and group replication.
 * Membership.partyId on each online member entity mirrors the registry.
 */
import { PartyInvitePending } from "./components.js";
import { defineCommand, defineResource, GroupKind, GroupRole, Membership, Permissions, PlayerId, playerOf, type CommandHandlers, type Entity, type GroupRegistry, type World } from "@engine/core";

export const PartyInviteCmd = defineCommand("gameplay.partyInvite", { target: "u32" });
export const PartyAcceptCmd = defineCommand("gameplay.partyAccept", { party: "u32" });
export const PartyDeclineCmd = defineCommand("gameplay.partyDecline", { party: "u32" });
export const PartyLeaveCmd = defineCommand("gameplay.partyLeave", {});
export const PartyKickCmd = defineCommand("gameplay.partyKick", { target: "u32" });
/** Registration order = wire order. Append only. */
export const PARTY_COMMANDS = [PartyInviteCmd, PartyAcceptCmd, PartyDeclineCmd, PartyLeaveCmd, PartyKickCmd] as const;
/** Entity fields (NetId on the wire) per command. */
export const PARTY_ENTITY_FIELDS: Readonly<Record<string, readonly string[]>> = { [PartyInviteCmd.name]: ["target"], [PartyKickCmd.name]: ["target"] };
/** Reject reasons (append to the server reason list in this order). */
export const PARTY_REJECT_REASONS = ["no_player", "self", "in_party", "not_in_party", "not_officer", "party_full", "no_invite", "invite_expired", "outranked"] as const;
export const PARTY_RULES = { maxSize: 6, inviteTicks: 20 * 60, minInviteRole: GroupRole.Officer as number, minKickRole: GroupRole.Officer as number };

export interface PartyInvite { party: number; from: number; expiresTick: number }
/** invitee PlayerId -> pending invites (one per party). */
export const PartyInvites = defineResource<Map<number, PartyInvite[]>>("gameplay.PartyInvites");
const invites = (w: World): Map<number, PartyInvite[]> => { let m = w.getResource(PartyInvites); if (!m) w.setResource(PartyInvites, (m = new Map())); return m; };
const groups = (w: World): GroupRegistry => w.resource(Permissions).groups;
/** The party of a player (by PlayerId), or 0. */
export const partyOf = (w: World, player: number): number => (player ? groups(w).groupsOf(player, GroupKind.Party)[0]?.id ?? 0 : 0);
const alive = (w: World, e: number): boolean => w.isAlive(e as Entity);
function entityOfPlayer(w: World, player: number): Entity | undefined { for (const e of w.query([PlayerId])) if (w.getField(e, PlayerId, "id") === player) return e; return undefined; }
function syncMembership(w: World, player: number): void {
  const e = entityOfPlayer(w, player); if (e === undefined) return;
  const p = partyOf(w, player);
  if (w.has(e, Membership)) w.setField(e, Membership, "partyId", p); else w.add(e, Membership, { partyId: p, clanId: 0 });
}
/** Mirrors the newest unexpired invite onto the invitee entity (PartyInvitePending), or removes it. */
function syncInvite(w: World, player: number): void {
  const e = entityOfPlayer(w, player); if (e === undefined) return;
  const l = (invites(w).get(player) ?? []).filter((x) => x.expiresTick > w.tick); const top = l[l.length - 1];
  if (!top) { if (w.has(e, PartyInvitePending)) w.remove(e, PartyInvitePending); return; }
  if (w.has(e, PartyInvitePending)) w.set(e, PartyInvitePending, { ...top }); else w.add(e, PartyInvitePending, { ...top });
}
/** Pending, unexpired invite for a player to a party. Expired ones are pruned here. */
export function pendingInvite(w: World, player: number, party: number): PartyInvite | undefined | "expired" {
  const l = invites(w).get(player); const i = l?.findIndex((x) => x.party === party) ?? -1; if (!l || i < 0) return undefined;
  if (l[i]!.expiresTick <= w.tick) { l.splice(i, 1); syncInvite(w, player); return "expired"; } return l[i];
}

export function inviteReject(w: World, actor: Entity, target: number): string | undefined {
  const me = playerOf(w, actor); if (!me) return "no_player";
  if (!alive(w, target)) return "no_target"; const them = playerOf(w, target as Entity); if (!them) return "no_target";
  if (them === me) return "self"; if (partyOf(w, them)) return "in_party";
  const p = partyOf(w, me); if (!p) return undefined; // first invite creates the party with the inviter as leader
  if (groups(w).role(p, me) < PARTY_RULES.minInviteRole) return "not_officer";
  if (groups(w).get(p)!.members.size >= PARTY_RULES.maxSize) return "party_full";
  return undefined;
}
export function acceptReject(w: World, actor: Entity, party: number): string | undefined {
  const me = playerOf(w, actor); if (!me) return "no_player"; if (partyOf(w, me)) return "in_party";
  const inv = pendingInvite(w, me, party); if (inv === "expired") return "invite_expired"; if (!inv) return "no_invite";
  const g = groups(w).get(party); if (!g || g.kind !== GroupKind.Party) return "no_invite";
  if (g.members.size >= PARTY_RULES.maxSize) return "party_full";
  return undefined;
}
export function kickReject(w: World, actor: Entity, target: number): string | undefined {
  const me = playerOf(w, actor); if (!me) return "no_player";
  if (!alive(w, target)) return "no_target"; const them = playerOf(w, target as Entity); if (!them) return "no_target";
  if (them === me) return "self";
  const p = partyOf(w, me); if (!p || partyOf(w, them) !== p) return "not_in_party";
  const R = groups(w); if (R.role(p, me) < PARTY_RULES.minKickRole) return "not_officer";
  if (R.role(p, me) <= R.role(p, them)) return "outranked";
  return undefined;
}

export function partyInvite(w: World, actor: Entity, target: number): string | undefined {
  const r = inviteReject(w, actor, target); if (r) return r;
  const me = playerOf(w, actor), them = playerOf(w, target as Entity);
  let p = partyOf(w, me); if (!p) { p = groups(w).create(GroupKind.Party, me).id; syncMembership(w, me); }
  const l = invites(w).get(them) ?? []; invites(w).set(them, l);
  const expiresTick = w.tick + PARTY_RULES.inviteTicks; const ex = l.find((x) => x.party === p);
  if (ex) { l.splice(l.indexOf(ex), 1); } l.push({ party: p, from: me, expiresTick }); // newest last
  syncInvite(w, them); return undefined;
}
export function partyAccept(w: World, actor: Entity, party: number): string | undefined {
  const r = acceptReject(w, actor, party); if (r) return r;
  const me = playerOf(w, actor); groups(w).addMember(party, me, GroupRole.Member); invites(w).delete(me); syncMembership(w, me); syncInvite(w, me);
  return undefined;
}
/** Removes a player; the leader hands over to the highest role, then lowest PlayerId; an empty party is deleted. */
/** Removes `player` (account PlayerId) from their party if any — same path as leaving (delete progress, ADR-099). */
export function partyRemovePlayer(w: World, player: number): boolean { const p = partyOf(w, player); if (!p) return false; removeFromParty(w, p, player); return true; }
function removeFromParty(w: World, p: number, player: number): void {
  const R = groups(w); const wasLeader = R.role(p, player) === GroupRole.Leader; R.removeMember(p, player);
  const g = R.get(p);
  if (!g || g.members.size === 0) { R.delete(p); for (const l of invites(w).values()) for (let i = l.length - 1; i >= 0; i--) if (l[i]!.party === p) l.splice(i, 1); }
  else if (wasLeader) { const next = [...g.members].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!; R.setRole(p, next[0], GroupRole.Leader); }
  syncMembership(w, player);
}
/** Declines (drops) a pending invite; an expired one reports invite_expired. */
export function partyDecline(w: World, actor: Entity, party: number): string | undefined {
  const me = playerOf(w, actor); if (!me) return "no_player";
  const inv = pendingInvite(w, me, party); if (inv === "expired") return "invite_expired"; if (!inv) return "no_invite";
  const l = invites(w).get(me)!; l.splice(l.indexOf(inv), 1); syncInvite(w, me); return undefined;
}
export function partyLeave(w: World, actor: Entity): string | undefined {
  const me = playerOf(w, actor); if (!me) return "no_player"; const p = partyOf(w, me); if (!p) return "not_in_party";
  removeFromParty(w, p, me); return undefined;
}
export function partyKick(w: World, actor: Entity, target: number): string | undefined {
  const r = kickReject(w, actor, target); if (r) return r;
  removeFromParty(w, partyOf(w, playerOf(w, actor)), playerOf(w, target as Entity)); return undefined;
}

/** Server: party command handlers (validate gives the reject reason; handle applies). */
export function installPartyCommands(world: World, handlers: CommandHandlers): void {
  handlers.on(PartyInviteCmd, { validate: (v, c) => inviteReject(world, c.actor, v.target), handle: (v, c) => { partyInvite(world, c.actor, v.target); } });
  handlers.on(PartyAcceptCmd, { validate: (v, c) => acceptReject(world, c.actor, v.party), handle: (v, c) => { partyAccept(world, c.actor, v.party); } });
  handlers.on(PartyDeclineCmd, { validate: (v, c) => { const me = playerOf(world, c.actor); if (!me) return "no_player"; const i = pendingInvite(world, me, v.party); return i === "expired" ? "invite_expired" : i ? undefined : "no_invite"; }, handle: (v, c) => { partyDecline(world, c.actor, v.party); } });
  handlers.on(PartyLeaveCmd, { validate: (_v, c) => { const me = playerOf(world, c.actor); return !me ? "no_player" : partyOf(world, me) ? undefined : "not_in_party"; }, handle: (_v, c) => { partyLeave(world, c.actor); } });
  handlers.on(PartyKickCmd, { validate: (v, c) => kickReject(world, c.actor, v.target), handle: (v, c) => { partyKick(world, c.actor, v.target); } });
}
