import { defineComponent } from "./component.js";
import { BinaryReader, BinaryWriter } from "./serialize.js";

/**
 * Identity & groups. PlayerId is the stable account-level id (persistent), distinct from the transient
 * per-connection clientId carried by Owner. Groups (parties, clans) are server-authoritative world data kept
 * in a GroupRegistry resource — not per-entity components — with a binary save format and a change log for net.
 */
export const PlayerId = defineComponent("PlayerId", { id: "u32" }, { networked: true, persistent: true });
/** Current party/clan of a player entity (0 = none). Mirrors the GroupRegistry; networked. */
export const Membership = defineComponent("Membership", { partyId: "u32", clanId: "u32" }, { networked: true, persistent: true });
/** Owner of a structure/container/claim marker. playerId and/or groupId (0 = none). */
export const OwnedBy = defineComponent("OwnedBy", { playerId: "u32", groupId: "u32" }, { networked: true, persistent: true });

/** Group kinds; gameplay may add more (u8). */
export const enum GroupKind { Party = 1, Clan = 2 }
/** Conventional role ranks (higher = more rights); gameplay defines the meaning. */
export const enum GroupRole { Member = 1, Officer = 2, Leader = 3 }
export interface Group { readonly id: number; readonly kind: number; version: number; members: Map<number, number> /* playerId -> role */ }
export type GroupChange =
  | { op: "create"; seq: number; group: number; kind: number }
  | { op: "delete"; seq: number; group: number }
  | { op: "member"; seq: number; group: number; player: number; role: number } // role 0 = removed
;
const SAVE_VERSION = 1;

export class GroupRegistry {
  private groups = new Map<number, Group>();
  private byPlayer = new Map<number, Set<number>>();
  private nextId = 1;
  /** Monotonic sequence of the last change; net sends changes after a client's acked seq. */
  seq = 0;
  private log: GroupChange[] = [];
  constructor(readonly logCapacity = 4096) {}
  private push(c: GroupChange): void { this.log.push(c); if (this.log.length > this.logCapacity) this.log.splice(0, this.log.length - this.logCapacity); }
  create(kind: number, leader?: number, id?: number): Group {
    const gid = id ?? this.nextId; if (this.groups.has(gid)) throw new Error(`group ${gid} exists`);
    this.nextId = Math.max(this.nextId, gid + 1);
    const g: Group = { id: gid, kind, version: 1, members: new Map() }; this.groups.set(gid, g);
    this.push({ op: "create", seq: ++this.seq, group: gid, kind });
    if (leader !== undefined) this.setRole(gid, leader, GroupRole.Leader);
    return g;
  }
  delete(id: number): boolean {
    const g = this.groups.get(id); if (!g) return false;
    for (const p of g.members.keys()) this.byPlayer.get(p)?.delete(id);
    this.groups.delete(id); this.push({ op: "delete", seq: ++this.seq, group: id }); return true;
  }
  get(id: number): Group | undefined { return this.groups.get(id); }
  /** Add/update (role > 0) or remove (role 0) a member. */
  setRole(group: number, player: number, role: number): void {
    const g = this.groups.get(group); if (!g) throw new Error(`no group ${group}`);
    if (role === 0) { if (!g.members.delete(player)) return; this.byPlayer.get(player)?.delete(group); }
    else { if (g.members.get(player) === role) return; g.members.set(player, role); let s = this.byPlayer.get(player); if (!s) this.byPlayer.set(player, (s = new Set())); s.add(group); }
    g.version++; this.push({ op: "member", seq: ++this.seq, group, player, role });
  }
  addMember(group: number, player: number, role: number = GroupRole.Member): void { this.setRole(group, player, role); }
  removeMember(group: number, player: number): void { this.setRole(group, player, 0); }
  role(group: number, player: number): number { return this.groups.get(group)?.members.get(player) ?? 0; }
  isMember(group: number, player: number): boolean { return this.role(group, player) > 0; }
  groupsOf(player: number, kind?: number): Group[] {
    const out: Group[] = []; for (const id of this.byPlayer.get(player) ?? []) { const g = this.groups.get(id)!; if (kind === undefined || g.kind === kind) out.push(g); }
    return out.sort((a, b) => a.id - b.id);
  }
  /** True if both players share a group (optionally of a kind). */
  shareGroup(a: number, b: number, kind?: number): boolean { for (const g of this.groupsOf(a, kind)) if (g.members.has(b)) return true; return false; }
  all(): Group[] { return [...this.groups.values()].sort((a, b) => a.id - b.id); }
  /** Changes with seq > `since`; undefined if `since` predates the retained log (send a full snapshot instead). */
  changesSince(since: number): GroupChange[] | undefined {
    if (since >= this.seq) return [];
    const first = this.log[0]; if (!first || first.seq > since + 1) return undefined;
    return this.log.filter((c) => c.seq > since);
  }
  /** Apply a change received from the server (client mirror). */
  apply(c: GroupChange): void {
    if (c.op === "create") { if (!this.groups.has(c.group)) this.create(c.kind, undefined, c.group); }
    else if (c.op === "delete") this.delete(c.group);
    else if (this.groups.has(c.group)) this.setRole(c.group, c.player, c.role);
    this.seq = c.seq;
  }
  /** Persistence: v1 = u8 ver, u32 nextId, u32 count, per group (u32 id, u8 kind, u32 version, u16 n, n×(u32 player, u8 role)). */
  encode(): Uint8Array {
    const w = new BinaryWriter(64); w.write("u8", SAVE_VERSION); w.write("u32", this.nextId); const all = this.all(); w.write("u32", all.length);
    for (const g of all) {
      w.write("u32", g.id); w.write("u8", g.kind); w.write("u32", g.version); w.write("u16", g.members.size);
      for (const [p, r] of [...g.members].sort((a, b) => a[0] - b[0])) { w.write("u32", p); w.write("u8", r); }
    }
    return w.finish();
  }
  static decode(bytes: Uint8Array): GroupRegistry {
    const r = new BinaryReader(bytes); const v = r.read("u8"); if (v !== SAVE_VERSION) throw new Error(`GroupRegistry: unsupported version ${v}`);
    const reg = new GroupRegistry(); const next = r.read("u32"); const n = r.read("u32");
    for (let i = 0; i < n; i++) {
      const id = r.read("u32"), kind = r.read("u8"), version = r.read("u32"), m = r.read("u16");
      const g: Group = { id, kind, version, members: new Map() }; reg.groups.set(id, g);
      for (let k = 0; k < m; k++) { const p = r.read("u32"), role = r.read("u8"); g.members.set(p, role); let s = reg.byPlayer.get(p); if (!s) reg.byPlayer.set(p, (s = new Set())); s.add(id); }
    }
    reg.nextId = next; return reg;
  }
}
