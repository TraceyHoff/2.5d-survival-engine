/**
 * ADR-141: which roster actions a clan member may use on another (context-only buttons; the panel used to show
 * Promote / Demote / Kick to everyone, merely disabled). Mirrors clanRankReject / clanKickReject:
 * rank changes are leader-only within Member..Officer+1; kick needs the "kick" permission and a strictly higher rank.
 */
export const CLAN_MEMBER = 1, CLAN_OFFICER = 2, CLAN_LEADER = 3;
export interface ClanMemberActions { promote: boolean; demote: boolean; kick: boolean }
export function clanMemberActions(myRole: number, targetRole: number, kickPerm: boolean): ClanMemberActions {
  const lead = myRole === CLAN_LEADER;
  return { promote: lead && targetRole < CLAN_OFFICER + 1, demote: lead && targetRole > CLAN_MEMBER, kick: (lead || kickPerm) && myRole > targetRole };
}
