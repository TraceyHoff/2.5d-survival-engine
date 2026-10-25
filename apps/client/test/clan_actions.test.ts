// ADR-141: clan roster shows only the actions the viewer may take (members saw Promote/Demote/Kick on the leader).
import { describe, expect, it } from "vitest";
import { clanMemberActions, CLAN_LEADER as L, CLAN_OFFICER as O, CLAN_MEMBER as M } from "../src/clan-actions.js";

describe("clan member actions", () => {
  it("a plain member gets no actions on the leader or another member", () => {
    expect(clanMemberActions(M, L, false)).toEqual({ promote: false, demote: false, kick: false });
    expect(clanMemberActions(M, M, false)).toEqual({ promote: false, demote: false, kick: false });
  });
  it("the leader can promote/kick a member and demote an officer", () => {
    expect(clanMemberActions(L, M, false)).toEqual({ promote: true, demote: false, kick: true });
    expect(clanMemberActions(L, O, false)).toEqual({ promote: true, demote: true, kick: true });
  });
  it("an officer with the kick permission can kick members but never the leader or a peer", () => {
    expect(clanMemberActions(O, M, true).kick).toBe(true);
    expect(clanMemberActions(O, O, true).kick).toBe(false);
    expect(clanMemberActions(O, L, true).kick).toBe(false);
    expect(clanMemberActions(O, M, false).kick).toBe(false);
  });
});
