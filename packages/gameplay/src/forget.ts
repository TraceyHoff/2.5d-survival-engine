/**
 * Delete-my-progress (ADR-099): strip a player's account PlayerId from world state so nothing stays tied to it.
 * Party/clan: leave with the normal rules (clan leadership passes to the highest rank, a sole member disbands — which
 * hands clan stalls/buildings back the usual way). Personal stalls: closed and unowned. Personal buildings (OwnedBy
 * playerId): playerId cleared (groupId kept), so they are abandoned — no one gets the owner's rights, and they decay /
 * get cleared like any other unowned structure. Runs again for entities that stream in later (`sweepForgottenPlayers`).
 */
import { OwnedBy, type World } from "@engine/core";
import { StallHeader, StallOwnerKind } from "./components.js";
import { bumpStall, setStallOwnership, tillOf } from "./economy/stall.js";
import { clanRemovePlayer } from "./clan.js";
import { partyRemovePlayer } from "./party.js";

export interface ForgetResult { party: boolean; clan: boolean; stalls: number; structures: number }

/** Unowns stalls + OwnedBy structures of any of `players` (account PlayerIds) currently in the world. */
export function sweepForgottenPlayers(w: World, players: ReadonlySet<number>): { stalls: number; structures: number } {
  let stalls = 0, structures = 0; if (!players.size) return { stalls, structures };
  for (const e of w.query([StallHeader])) {
    const h = w.get(e, StallHeader)!; if (h.ownerKind !== StallOwnerKind.Player || !players.has(h.ownerId)) continue;
    setStallOwnership(w, e, tillOf(w, e), StallOwnerKind.None, 0); w.setField(e, StallHeader, "open", 0); bumpStall(w, e); stalls++;
  }
  for (const e of w.query([OwnedBy])) { const o = w.get(e, OwnedBy)!; if (o.playerId && players.has(o.playerId)) { w.set(e, OwnedBy, { playerId: 0, groupId: o.groupId }); structures++; } }
  return { stalls, structures };
}

/** Removes `player` from party + clan and unowns their loaded stalls/buildings. Never touches other players' data. */
export function forgetPlayer(w: World, player: number): ForgetResult {
  if (!player) return { party: false, clan: false, stalls: 0, structures: 0 };
  const party = partyRemovePlayer(w, player), clan = clanRemovePlayer(w, player);
  return { party, clan, ...sweepForgottenPlayers(w, new Set([player])) };
}
