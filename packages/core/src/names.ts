import { BinaryReader, BinaryWriter } from "./serialize.js";
import { defineResource } from "./world.js";

/**
 * Persistent PlayerId -> display name registry (ADR-074). Items, ledgers and stalls carry only u32 PlayerIds;
 * UIs resolve names here at display time. Mirrors GroupRegistry: a monotonic seq + bounded change log so net
 * replicates each name once (changesSince / apply), plus a versioned binary encode/decode for persistence.
 */
export type NameChange = { op: "set"; seq: number; player: number; name: string | null }; // null = removed
export const MAX_PLAYER_NAME_BYTES = 64;
const enc = new TextEncoder(), dec = new TextDecoder();
const NAMES_VERSION = 1;

export class PlayerNameRegistry {
  private names = new Map<number, string>();
  seq = 0;
  private log: NameChange[] = [];
  constructor(readonly logCapacity = 4096) {}
  get(player: number): string | undefined { return this.names.get(player); }
  /** Display helper: name or a fallback like "#42" (0 = no player -> ""). */
  display(player: number, fallback = (p: number) => `#${p}`): string { return player === 0 ? "" : this.names.get(player) ?? fallback(player); }
  get size(): number { return this.names.size; }
  set(player: number, name: string | null): void {
    if (!Number.isInteger(player) || player <= 0 || player > 0xffffffff) throw new Error(`bad player id ${player}`);
    if (name !== null && enc.encode(name).length > MAX_PLAYER_NAME_BYTES) throw new Error("name too long");
    if (name === null ? !this.names.has(player) : this.names.get(player) === name) return;
    if (name === null) this.names.delete(player); else this.names.set(player, name);
    this.log.push({ op: "set", seq: ++this.seq, player, name });
    if (this.log.length > this.logCapacity) this.log.splice(0, this.log.length - this.logCapacity);
  }
  entries(): [number, string][] { return [...this.names].sort((a, b) => a[0] - b[0]); }
  /** Changes with seq > since; undefined if the log no longer covers it (send a full snapshot). */
  changesSince(since: number): NameChange[] | undefined {
    if (since >= this.seq) return [];
    const first = this.log[0]; if (!first || first.seq > since + 1) return undefined;
    return this.log.filter((c) => c.seq > since);
  }
  apply(c: NameChange): void { this.set(c.player, c.name); this.seq = c.seq; }
  /** v1: u8 ver, u32 seq, u32 n, n x (u32 player, u8 len, utf8 bytes). */
  encode(): Uint8Array {
    const w = new BinaryWriter(64); w.write("u8", NAMES_VERSION); w.write("u32", this.seq); const all = this.entries(); w.write("u32", all.length);
    for (const [p, n] of all) { const b = enc.encode(n); w.write("u32", p); w.write("u8", b.length); w.bytes(b); }
    return w.finish();
  }
  static decode(bytes: Uint8Array): PlayerNameRegistry {
    const r = new BinaryReader(bytes); const v = r.read("u8"); if (v !== NAMES_VERSION) throw new Error(`PlayerNameRegistry: unsupported version ${v}`);
    const reg = new PlayerNameRegistry(); const seq = r.read("u32"); const n = r.read("u32");
    for (let i = 0; i < n; i++) { const p = r.read("u32"); const len = r.read("u8"); reg.names.set(p, dec.decode(r.bytes(len))); }
    reg.seq = seq; return reg;
  }
}
export const PlayerNames = defineResource<PlayerNameRegistry>("PlayerNames");
