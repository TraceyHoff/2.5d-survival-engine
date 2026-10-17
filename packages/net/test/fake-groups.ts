import type { GroupChangeLike, GroupLike, GroupSource } from "../src/index.js";
/** Minimal stand-in for core's GroupRegistry (same surface net uses). */
export class FakeGroups implements GroupSource {
  seq = 0; private g = new Map<number, { id: number; kind: number; members: Map<number, number> }>(); private log: GroupChangeLike[] = []; private next = 1;
  constructor(private readonly cap = 4096) {}
  private rec(c: GroupChangeLike): void { this.log.push(c); if (this.log.length > this.cap) this.log.shift(); }
  create(kind: number): number { const id = this.next++; this.g.set(id, { id, kind, members: new Map() }); this.rec({ op: "create", seq: ++this.seq, group: id, kind }); return id; }
  delete(id: number): void { this.g.delete(id); this.rec({ op: "delete", seq: ++this.seq, group: id }); }
  setRole(group: number, player: number, role: number): void {
    const g = this.g.get(group)!; if (role) g.members.set(player, role); else g.members.delete(player);
    this.rec({ op: "member", seq: ++this.seq, group, player, role });
  }
  get(id: number): GroupLike | undefined { return this.g.get(id); }
  groupsOf(player: number, kind?: number): GroupLike[] { return [...this.g.values()].filter((x) => x.members.has(player) && (kind === undefined || x.kind === kind)); }
  changesSince(since: number): GroupChangeLike[] | undefined {
    if (since >= this.seq) return []; const f = this.log[0]; if (!f || f.seq > since + 1) return undefined; return this.log.filter((c) => c.seq > since);
  }
}
