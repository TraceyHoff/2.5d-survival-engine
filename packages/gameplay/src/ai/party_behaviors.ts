/**
 * Bot party behaviors (pure: read the bot's replica sensors, write AgentOutput action strings that emitAgentCommands turns
 * into gameplay.party* commands). Gated by traits: sociability drives inviting and accepting; trust (identity.relationship,
 * -1..1, the bot's memory of the player), bravery and need weigh the accept roll; every decision has a cooldown.
 */
import { Membership, PlayerId, Transform, type Entity, type Traits, type World } from "@engine/core";
import type { AgentWorldView, GameBehavior } from "../agents.js";
import { Health, PartyInvitePending } from "../components.js";
import en from "../../data/locale/en.json";

export interface PartySensors {
  /** Own party id (0 = none). */
  partyId?: number;
  partyInvite?: { party: number; from: number; expiresTick: number };
  /** Visible players / bots with a PlayerId and no party (invite candidates). */
  partyless?: { id: number; x: number; y: number }[];
}
export const PARTY_AI = { inviteCooldown: 20 * 45, decideDelay: 20 * 2, decideCooldown: 20 * 30, leaveAfterAlone: 20 * 120, inviteRange: 10, minInviteSociability: 0.55 };

export function fillPartySensors(world: World, self: Entity, view: AgentWorldView): void {
  const t = world.get(self, Transform); if (!t) return;
  view.partyId = world.getField(self, Membership, "partyId") ?? 0;
  const inv = world.has(self, PartyInvitePending) ? world.get(self, PartyInvitePending) : undefined;
  if (inv && inv.party && inv.expiresTick > world.tick) view.partyInvite = { party: inv.party, from: inv.from, expiresTick: inv.expiresTick };
  if (view.partyId) return;
  const out: { id: number; x: number; y: number }[] = [];
  for (const e of world.query([PlayerId, Transform, Health])) {
    if (e === self || (world.getField(e, Membership, "partyId") ?? 0) !== 0) continue;
    const p = world.get(e, Transform)!; if (Math.hypot(p.x - t.x, p.y - t.y) <= PARTY_AI.inviteRange) out.push({ id: e, x: p.x, y: p.y });
  }
  if (out.length) view.partyless = out.sort((a, b) => a.id - b.id);
}

/**
 * Chance (0..1) a bot accepts a party invite: sociability, trust in the inviter (relationship, -1..1), need (low health /
 * hunger: safety in numbers) and bravery (brave loners need groups less). Pure and clamped.
 */
export function partyAcceptChance(traits: Traits, relationship: number, need: number): number {
  const trust = Math.max(-1, Math.min(1, relationship));
  const p = 0.15 + 0.45 * traits.sociability + 0.25 * trust + 0.25 * need - 0.15 * traits.bravery;
  return Math.max(0, Math.min(1, p));
}

/** A cute local chat line for a party situation (en.json social.party.<situation>.N), picked with the agent rng. */
export function partyLine(situation: "invite" | "accept" | "decline" | "leave", pick: () => number): { channel: string; text: string } | undefined {
  const keys = Object.keys(en).filter((k) => k.startsWith(`social.party.${situation}.`)).sort();
  const k = keys[Math.floor(pick() * keys.length)]; return k ? { channel: "local", text: (en as Record<string, string>)[k]! } : undefined;
}

export function partyBehaviors(): GameBehavior[] {
  return [
    { name: "party_decide", inertia: 0, considerations: [
        { name: "invite", curve: { type: "step", at: 0.5 }, input: (c) => (c.world.partyInvite && !c.world.partyId && c.self.tick - c.bb.num("partyDecidedAt", -1e9) >= PARTY_AI.decideDelay ? 1 : 0) }],
      run: (c, o) => {
        const inv = c.world.partyInvite; if (!inv || c.world.partyId) return false;
        const need = Math.max(0, Math.min(1, Math.max(1 - c.self.hp, 1 - c.self.hunger)));
        const yes = c.rng.next() < partyAcceptChance(c.traits, c.agent.identity.relationship, need);
        o.actions.push(`${yes ? "paccept" : "pdecline"}:${inv.party}`); c.bb.set("partyDecidedAt", c.self.tick);
        const line = partyLine(yes ? "accept" : "decline", () => c.rng.next()); if (line) o.chat = line; if (yes) o.emote = "wave";
        return false;
      } },
    { name: "party_invite", traits: { sociability: 1 }, inertia: 0, considerations: [
        { name: "candidate", curve: { type: "step", at: 0.5 }, input: (c) => (c.world.partyless?.length && c.traits.sociability >= PARTY_AI.minInviteSociability && c.self.tick - c.bb.num("partyInvitedAt", -1e9) >= PARTY_AI.inviteCooldown ? 1 : 0) }],
      run: (c, o) => {
        const l = c.world.partyless; if (!l?.length) return false;
        const t = l[Math.floor(c.rng.next() * l.length)]!; o.actions.push(`pinvite:${t.id}`); c.bb.set("partyInvitedAt", c.self.tick);
        const line = partyLine("invite", () => c.rng.next()); if (line) o.chat = line; return false;
      } },
    { name: "party_leave", inertia: 0, considerations: [
        { name: "alone", curve: { type: "step", at: 0.5 }, input: (c) => {
          if (!c.world.partyId) { c.bb.set("partyAloneSince", -1); return 0; }
          if (c.world.partyMates?.length) { c.bb.set("partyAloneSince", c.self.tick); return 0; }
          const since = c.bb.num("partyAloneSince", -1); if (since < 0) { c.bb.set("partyAloneSince", c.self.tick); return 0; }
          return c.self.tick - since >= PARTY_AI.leaveAfterAlone * (0.5 + c.traits.sociability) ? 1 : 0;
        } }],
      run: (c, o) => { o.actions.push("pleave"); c.bb.set("partyAloneSince", -1); const line = partyLine("leave", () => c.rng.next()); if (line) o.chat = line; return false; } },
  ];
}
