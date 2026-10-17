/**
 * Party/clan roster replication on top of core's GroupRegistry (batch 7), group scopes and member markers.
 *
 * Server: `new GroupReplicator(server, { groups: world GroupRegistry, playerIdOf })`.
 *  - Each tick, GroupRegistry.changesSince(lastSeq) is routed only to affected members (current members of the group
 *    plus a removed player). A player who joins a group gets the full roster of that group; a fresh session gets the
 *    full rosters of all its groups. Log overrun -> full resync of everyone.
 *  - Implements the server's GroupScopeResolver, enabling setScope(def, "party" | "clan") and emitEvent scopes
 *    { group } / { groupOf, kind }.
 *  - Member markers (position + health %) for group members outside the viewer's AOI at `markerHz` (default 2),
 *    capped at `markerBudgetBytes` per message (party first, then nearest), unreliable.
 * Client: `client.groups` (GroupClient) mirrors only the viewer's own groups; optional `into` (a core GroupRegistry)
 * gets every change via apply().
 */
import { PlayerId, Transform, type Entity } from "@engine/core";
import { BitWriter, type BitReader } from "./bits.js";
import { MsgType, writeHeader } from "./protocol.js";
import type { ClientSession, NetServer, GroupScopeResolver } from "./server.js";

export const GroupKind = { Party: 1, Clan: 2 } as const;
export const GroupRole = { Member: 1, Officer: 2, Leader: 3 } as const;
export type GroupChangeLike =
  | { op: "create"; seq: number; group: number; kind: number }
  | { op: "delete"; seq: number; group: number }
  | { op: "member"; seq: number; group: number; player: number; role: number }
  | { op: "banner"; seq: number; group: number; banner: BannerLike | null };
export interface BannerLike { shape: number; pattern: number; colors: [number, number]; emblemId: number }
export interface GroupLike { readonly id: number; readonly kind: number; members: ReadonlyMap<number, number>; banner?: BannerLike }
/** Structural subset of core's GroupRegistry (core GroupRegistry satisfies it). */
export interface GroupSource {
  readonly seq: number;
  get(id: number): GroupLike | undefined;
  groupsOf(player: number, kind?: number): GroupLike[];
  changesSince(since: number): GroupChangeLike[] | undefined;
}

const OP = { create: 0, delete: 1, member: 2, banner: 3 } as const;
export function writeGroupChange(w: BitWriter, c: GroupChangeLike): void {
  w.writeBits(OP[c.op], 2); w.writeVarUint(c.seq); w.writeVarUint(c.group);
  if (c.op === "create") w.writeBits(c.kind, 8);
  else if (c.op === "member") { w.writeVarUint(c.player); w.writeBits(c.role, 8); }
  else if (c.op === "banner") {
    w.writeBool(!!c.banner);
    if (c.banner) { w.writeBits(c.banner.shape, 8); w.writeBits(c.banner.pattern, 8); w.writeBits(c.banner.colors[0] >>> 0, 32); w.writeBits(c.banner.colors[1] >>> 0, 32); w.writeBits(c.banner.emblemId, 16); }
  }
}
export function readGroupChange(r: BitReader): GroupChangeLike {
  const op = r.readBits(2); const seq = r.readVarUint(); const group = r.readVarUint();
  if (op === OP.create) return { op: "create", seq, group, kind: r.readBits(8) };
  if (op === OP.delete) return { op: "delete", seq, group };
  if (op === OP.banner) return { op: "banner", seq, group, banner: r.readBool() ? { shape: r.readBits(8), pattern: r.readBits(8), colors: [r.readBits(32) >>> 0, r.readBits(32) >>> 0], emblemId: r.readBits(16) } : null };
  return { op: "member", seq, group, player: r.readVarUint(), role: r.readBits(8) };
}
const zz = (n: number): number => ((n << 1) ^ (n >> 31)) >>> 0;
const unzz = (n: number): number => (n >>> 1) ^ -(n & 1);

export interface GroupReplicatorOptions {
  groups: GroupSource;
  /** Persistent player id of a session. Default: core PlayerId on the owned entity, else clientId. */
  playerIdOf?: (session: ClientSession) => number;
  markerHz?: number;
  markerBudgetBytes?: number;
  /** Health percent 0..100 for a member marker (gameplay; e.g. Health.hp/max). Undefined = unknown (255 on the wire). */
  markerHealth?: (entity: Entity) => number | undefined;
}

export class GroupReplicator implements GroupScopeResolver {
  /** Per client: last group seq delivered (reliable channel = acked in order) and the groups it holds. */
  private clients = new Map<number, { seq: number; groups: Set<number> }>();
  private tickCount = 0;
  readonly stats = { rosterBytes: 0, markerBytes: 0, resyncs: 0 };
  constructor(readonly server: NetServer, readonly opts: GroupReplicatorOptions) {
    server.setGroupResolver(this);
    server.onTick(() => this.tick());
  }
  /** Persistent player id: opts.playerIdOf, else core PlayerId on the client's owned entity, else clientId. */
  private pidCache = new Map<number, number | undefined>(); private pidTick = -1;
  playerOf(clientId: number): number | undefined {
    const t = this.server.world.tick; if (t !== this.pidTick) { this.pidTick = t; this.pidCache.clear(); }
    if (this.pidCache.has(clientId)) return this.pidCache.get(clientId);
    const v = this.resolvePlayer(clientId); this.pidCache.set(clientId, v); return v;
  }
  private resolvePlayer(clientId: number): number | undefined {
    const s = this.server.sessions.get(clientId); if (!s) return undefined;
    if (this.opts.playerIdOf) return this.opts.playerIdOf(s);
    const w = this.server.world;
    if (!w.isRegistered(PlayerId)) return s.clientId;
    for (const e of this.server.ownedEntities(clientId)) if (w.isAlive(e) && w.has(e, PlayerId)) return w.getField(e, PlayerId, "id")!;
    return s.clientId;
  }
  private clientOfPlayer(): Map<number, number> {
    const m = new Map<number, number>();
    for (const s of this.server.connected()) { const p = this.playerOf(s.clientId); if (p !== undefined) m.set(p, s.clientId); }
    return m;
  }
  // ---- GroupScopeResolver ----
  share(a: number, b: number, kind: "party" | "clan"): boolean {
    const pa = this.playerOf(a), pb = this.playerOf(b); if (pa === undefined || pb === undefined) return false;
    const k = kind === "party" ? GroupKind.Party : GroupKind.Clan;
    for (const g of this.opts.groups.groupsOf(pa, k)) if (g.members.has(pb)) return true;
    return false;
  }
  groupOf(clientId: number, kind: "party" | "clan"): number | undefined {
    const p = this.playerOf(clientId); if (p === undefined) return undefined;
    return this.opts.groups.groupsOf(p, kind === "party" ? GroupKind.Party : GroupKind.Clan)[0]?.id;
  }
  clientsOfGroup(group: number): number[] {
    const g = this.opts.groups.get(group); if (!g) return [];
    const byP = this.clientOfPlayer(); const out: number[] = [];
    for (const p of g.members.keys()) { const c = byP.get(p); if (c !== undefined) out.push(c); }
    return out;
  }

  private full(g: GroupLike, seq: number): GroupChangeLike[] {
    const out: GroupChangeLike[] = [{ op: "create", seq, group: g.id, kind: g.kind }];
    for (const [player, role] of g.members) out.push({ op: "member", seq, group: g.id, player, role });
    if (g.banner) out.push({ op: "banner", seq, group: g.id, banner: g.banner });
    return out;
  }
  private tick(): void {
    const reg = this.opts.groups; const now = reg.seq;
    for (const c of [...this.clients.keys()]) if (!this.server.sessions.get(c)?.conn) this.clients.delete(c);
    const cache = new Map<number, GroupChangeLike[] | undefined>(); // changesSince per distinct client seq
    for (const s of this.server.connected()) {
      const me = this.playerOf(s.clientId); if (me === undefined) continue;
      let st = this.clients.get(s.clientId); const out: GroupChangeLike[] = [];
      let changes: GroupChangeLike[] | undefined;
      if (st) { if (!cache.has(st.seq)) cache.set(st.seq, reg.changesSince(st.seq)); changes = cache.get(st.seq); }
      if (!st || changes === undefined) {
        // first contact or log overrun: drop what the client holds, send full rosters of its groups
        if (st) { this.stats.resyncs++; for (const g of st.groups) out.push({ op: "delete", seq: now, group: g }); }
        st = { seq: now, groups: new Set() }; this.clients.set(s.clientId, st);
        for (const g of reg.groupsOf(me)) { out.push(...this.full(g, now)); st.groups.add(g.id); }
      } else {
        for (const c of changes) {
          const known = st.groups.has(c.group);
          if (c.op === "create") continue; // announced with the first member
          if (c.op === "delete") { if (known) { out.push(c); st.groups.delete(c.group); } continue; }
          if (c.op === "member" && c.player === me) {
            if (c.role > 0 && !known) { const g = reg.get(c.group); if (g) { out.push(...this.full(g, now)); st.groups.add(c.group); } continue; }
            if (c.role === 0 && known) { out.push({ op: "delete", seq: c.seq, group: c.group }); st.groups.delete(c.group); continue; }
          }
          if (known) out.push(c);
        }
        st.seq = now;
      }
      if (!out.length) continue;
      const w = new BitWriter(); writeHeader(w, MsgType.Groups); w.writeVarUint(out.length);
      for (const c of out) writeGroupChange(w, c);
      const b = w.finish(); this.stats.rosterBytes += b.length; this.server.sendRaw(s.clientId, b, "reliable");
    }
    const every = Math.max(1, Math.round(this.server.tickHz / (this.opts.markerHz ?? 2)));
    if (this.tickCount++ % every === 0) this.markers(this.clientOfPlayer());
  }

  private markers(byP: Map<number, number>): void {
    const w0 = this.server.world; const tf = w0.store(Transform); const budget = (this.opts.markerBudgetBytes ?? 512) * 8;
    const posOf = (clientId: number): { x: number; y: number; e: Entity } | undefined => {
      for (const e of this.server.ownedEntities(clientId)) if (w0.isAlive(e) && w0.has(e, Transform)) { const t = w0.get(e, Transform)!; return { x: t.x, y: t.y, e }; }
      return undefined;
    };
    for (const s of this.server.connected()) {
      const p = this.playerOf(s.clientId); if (p === undefined) continue;
      const me = posOf(s.clientId);
      const cands: { player: number; x: number; y: number; hp: number; pri: number }[] = [];
      const done = new Set<number>([p]);
      for (const g of this.opts.groups.groupsOf(p)) for (const m of g.members.keys()) {
        if (done.has(m)) continue; done.add(m);
        const c = byP.get(m); if (c === undefined) continue;
        const pos = posOf(c); if (!pos) continue;
        if (this.server.interest?.covers(s.clientId, pos.x, pos.y)) continue; // in AOI: replicated normally
        const hp = this.opts.markerHealth?.(pos.e);
        const d = me ? (pos.x - me.x) ** 2 + (pos.y - me.y) ** 2 : 0;
        cands.push({ player: m, x: pos.x, y: pos.y, hp: hp === undefined ? 255 : Math.max(0, Math.min(100, Math.round(hp))), pri: (g.kind === GroupKind.Party ? 0 : 1e12) + d });
      }
      if (!cands.length) continue;
      cands.sort((a, b) => a.pri - b.pri);
      const w = new BitWriter(); writeHeader(w, MsgType.Markers); w.writeBits(this.server.world.tick, 32);
      for (const c of cands) {
        if (w.bitLength + 100 > budget) break;
        w.writeBool(true); w.writeVarUint(c.player); w.writeVarUint(zz(Math.round(c.x * 4))); w.writeVarUint(zz(Math.round(c.y * 4))); w.writeBits(c.hp, 8);
      }
      w.writeBool(false);
      const b = w.finish(); this.stats.markerBytes += b.length; this.server.sendRaw(s.clientId, b, "unreliable");
    }
  }
}

export interface MemberMarker { player: number; x: number; y: number; /** 0..100, 255 = unknown */ hp: number; tick: number }
/** Client mirror of the viewer's own groups + member markers. */
export class GroupClient {
  readonly groups = new Map<number, { kind: number; members: Map<number, number>; banner?: BannerLike }>();
  readonly markers = new Map<number, MemberMarker>();
  private listeners: ((c: GroupChangeLike) => void)[] = [];
  /** Optional core GroupRegistry (or anything with apply) that also receives every change. */
  into: { apply(c: GroupChangeLike): void } | undefined;
  constructor(client: { onRawMessage(type: number, fn: (r: BitReader) => void): void }) {
    client.onRawMessage(MsgType.Groups, (r) => { const n = r.readVarUint(); for (let i = 0; i < n; i++) this.apply(readGroupChange(r)); });
    client.onRawMessage(MsgType.Markers, (r) => {
      const tick = r.readBits(32); const fresh = new Map<number, MemberMarker>();
      while (r.readBool()) { const player = r.readVarUint(); const x = unzz(r.readVarUint()) / 4, y = unzz(r.readVarUint()) / 4; fresh.set(player, { player, x, y, hp: r.readBits(8), tick }); }
      this.markers.clear(); for (const [k, v] of fresh) this.markers.set(k, v);
    });
  }
  on(fn: (c: GroupChangeLike) => void): () => void { this.listeners.push(fn); return () => { const i = this.listeners.indexOf(fn); if (i >= 0) this.listeners.splice(i, 1); }; }
  /** The viewer's group of a kind (party/clan). */
  ofKind(kind: number): { id: number; members: Map<number, number> } | undefined {
    for (const [id, g] of this.groups) if (g.kind === kind) return { id, members: g.members };
    return undefined;
  }
  private apply(c: GroupChangeLike): void {
    if (c.op === "create") { if (!this.groups.has(c.group)) this.groups.set(c.group, { kind: c.kind, members: new Map() }); }
    else if (c.op === "delete") this.groups.delete(c.group);
    else if (c.op === "banner") { const g = this.groups.get(c.group); if (g) { if (c.banner) g.banner = c.banner; else delete g.banner; } }
    else {
      const g = this.groups.get(c.group);
      if (g) { if (c.role > 0) g.members.set(c.player, c.role); else g.members.delete(c.player); }
    }
    this.into?.apply(c);
    for (const f of this.listeners) f(c);
  }
  /** Called when we were removed from a group: drop it locally. */
  forget(group: number): void { this.groups.delete(group); }
}
