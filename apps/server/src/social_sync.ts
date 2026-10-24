/**
 * Owner-scoped social replication for the gameplay menu panels (no AOI dependency):
 *  - Clan roster: each claimed client in a clan gets ClanRoster (clan id + rank masks + member count) and one
 *    ClanRosterMember per member (account PlayerId, role, online). Afterwards only deltas go out: a changed member,
 *    a removed member (role 0), or a new header when the masks change. Leaving the clan (leave/kick/disband) sends
 *    ClanRoster { clan: 0 } once, then nothing more. At most CLAN_RULES.maxSize member rows per client per change.
 *  - Online directory: every claimed client gets OnlinePlayer { player, online } rows: the full list on claim, then
 *    one row per join/leave. Display names ride NameSync (client.names), pushed alongside.
 * Diffed once per net tick against per-client snapshots, so direct GroupRegistry edits are picked up too.
 */
import { GroupKind, PlayerId, type Entity, type GroupRegistry, type World } from "@engine/core";
import type { NameSync, NetServer } from "@engine/net";
import { rankMask } from "@engine/gameplay";
import { ClanRoster, ClanRosterMember, OnlinePlayer } from "./protocol.js";

interface View { clan: number; member: number; officer: number; rows: Map<number, number> /* player -> role | online<<8 */ }
export interface SocialSyncDeps { net: NetServer; world: World; groups: GroupRegistry; names: NameSync; claimed(): Iterable<[clientId: number, entity: Entity]> }

export class SocialSync {
  private views = new Map<number, View>();
  private dir = new Map<number, Set<number>>(); // clientId -> online player ids it has been told about
  readonly stats = { rosterRows: 0, dirRows: 0 };
  constructor(private readonly d: SocialSyncDeps) { d.net.onTick(() => this.tick()); }

  tick(): void {
    const { net, world, groups } = this.d;
    const clients = new Map<number, number>(); // clientId -> playerId
    for (const [c, e] of this.d.claimed()) { const id = world.isAlive(e) ? world.getField(e, PlayerId, "id") ?? 0 : 0; if (id && net.sessions.get(c)?.conn) clients.set(c, id); }
    const online = new Set(clients.values());
    for (const c of [...this.views.keys()]) if (!clients.has(c)) this.views.delete(c);
    for (const c of [...this.dir.keys()]) if (!clients.has(c)) this.dir.delete(c);

    for (const [c, me] of clients) {
      // ---- clan roster ----
      const g = groups.groupsOf(me, GroupKind.Clan)[0]; const clan = g?.id ?? 0;
      let v = this.views.get(c);
      if (!clan) { if (v && v.clan) net.emitEvent(ClanRoster, { clan: 0, memberMask: 0, officerMask: 0, size: 0 }, { scope: { owner: c } }); this.views.set(c, { clan: 0, member: 0, officer: 0, rows: new Map() }); }
      else {
        const member = rankMask(world, clan, 1), officer = rankMask(world, clan, 2);
        if (!v || v.clan !== clan || v.member !== member || v.officer !== officer) {
          const fresh = !v || v.clan !== clan; if (fresh) v = { clan, member, officer, rows: new Map() }; else { v!.member = member; v!.officer = officer; }
          this.views.set(c, v!);
          net.emitEvent(ClanRoster, { clan, memberMask: member, officerMask: officer, size: g!.members.size }, { scope: { owner: c } });
        }
        const view = v!; const ids: number[] = [];
        for (const [p, role] of g!.members) {
          const packed = role | (online.has(p) ? 0x100 : 0);
          if (view.rows.get(p) !== packed) { view.rows.set(p, packed); ids.push(p); this.stats.rosterRows++; net.emitEvent(ClanRosterMember, { clan, player: p, role, online: packed >> 8 }, { scope: { owner: c } }); }
        }
        for (const p of [...view.rows.keys()]) if (!g!.members.has(p)) { view.rows.delete(p); this.stats.rosterRows++; net.emitEvent(ClanRosterMember, { clan, player: p, role: 0, online: 0 }, { scope: { owner: c } }); }
        if (ids.length) this.d.names.push(c, ids);
      }
      // ---- online directory ----
      let k = this.dir.get(c); if (!k) this.dir.set(c, (k = new Set()));
      const add: number[] = [];
      for (const p of online) if (!k.has(p)) { k.add(p); add.push(p); this.stats.dirRows++; net.emitEvent(OnlinePlayer, { player: p, online: 1 }, { scope: { owner: c } }); }
      for (const p of [...k]) if (!online.has(p)) { k.delete(p); this.stats.dirRows++; net.emitEvent(OnlinePlayer, { player: p, online: 0 }, { scope: { owner: c } }); }
      if (add.length) this.d.names.push(c, add);
    }
  }
}
