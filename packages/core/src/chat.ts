import { BinaryReader, BinaryWriter, readString, writeString } from "./serialize.js";
import { GroupKind, type GroupRegistry } from "./social.js";

/** Chat data model only; Netcode owns sending/receiving. */
export const enum ChannelKind { Global = 0, Local = 1, Party = 2, Clan = 3, Trade = 4, Whisper = 5, System = 6 }
export const CHAT_MAX_BYTES = 512;
export interface ChatMessage { kind: ChannelKind; /** channel id: group id for party/clan, target playerId for whisper, else 0 */ channel: number; from: number; tick: number; text: string }
/** Wire: u8 kind, u32 channel, u32 from, u32 tick, varint-UTF-8 text (<= CHAT_MAX_BYTES). */
export function encodeChatMessage(m: ChatMessage, w = new BinaryWriter(32)): BinaryWriter {
  w.write("u8", m.kind); w.write("u32", m.channel); w.write("u32", m.from); w.write("u32", m.tick); writeString(w, m.text, CHAT_MAX_BYTES); return w;
}
export function decodeChatMessage(r: BinaryReader): ChatMessage {
  return { kind: r.read("u8") as ChannelKind, channel: r.read("u32"), from: r.read("u32"), tick: r.read("u32"), text: readString(r, CHAT_MAX_BYTES) };
}

/** Token bucket on ticks (deterministic, no wall clock). */
export class TokenBucket {
  private tokens: number; private last: number;
  constructor(readonly capacity: number, readonly refillPerTick: number, tick = 0) { this.tokens = capacity; this.last = tick; }
  take(tick: number, n = 1): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + (tick - this.last) * this.refillPerTick); this.last = tick;
    if (this.tokens < n) return false; this.tokens -= n; return true;
  }
}
/** Per-player block lists (player-side) and server mutes (until tick, 0 = forever). Serializable. */
export class MuteList {
  private blocks = new Map<number, Set<number>>(); private mutes = new Map<number, number>();
  block(player: number, other: number): void { let s = this.blocks.get(player); if (!s) this.blocks.set(player, (s = new Set())); s.add(other); }
  unblock(player: number, other: number): void { this.blocks.get(player)?.delete(other); }
  isBlocked(player: number, other: number): boolean { return this.blocks.get(player)?.has(other) ?? false; }
  mute(player: number, untilTick = 0): void { this.mutes.set(player, untilTick); }
  unmute(player: number): void { this.mutes.delete(player); }
  isMuted(player: number, tick: number): boolean { const u = this.mutes.get(player); return u !== undefined && (u === 0 || tick < u); }
  toJSON(): { blocks: [number, number[]][]; mutes: [number, number][] } { return { blocks: [...this.blocks].map(([k, v]) => [k, [...v].sort((a, b) => a - b)]), mutes: [...this.mutes] }; }
  static fromJSON(j: ReturnType<MuteList["toJSON"]>): MuteList { const m = new MuteList(); for (const [k, v] of j.blocks) for (const o of v) m.block(k, o); for (const [k, u] of j.mutes) m.mute(k, u); return m; }
}
export interface ChatPlayer { playerId: number; x: number; y: number }
export type ChatReject = "muted" | "rate_limited" | "too_long" | "not_member" | "no_target" | "system_only";
/**
 * Resolves recipients for a message. Membership is derived, not stored: party/clan from the GroupRegistry,
 * local from proximity (radius, or a caller-provided interest set), whisper from the target id.
 */
export class ChannelRegistry {
  localRadius = 24;
  buckets = new Map<number, TokenBucket>();
  constructor(readonly groups: GroupRegistry, readonly mutes = new MuteList(), readonly rate = { capacity: 5, refillPerTick: 0.05 }) {}
  bucket(player: number, tick: number): TokenBucket { let b = this.buckets.get(player); if (!b) this.buckets.set(player, (b = new TokenBucket(this.rate.capacity, this.rate.refillPerTick, tick))); return b; }
  /** Validate a player-sent message (server). */
  validate(m: ChatMessage): ChatReject | undefined {
    if (m.kind === ChannelKind.System) return "system_only";
    if (new TextEncoder().encode(m.text).length > CHAT_MAX_BYTES) return "too_long";
    if (this.mutes.isMuted(m.from, m.tick)) return "muted";
    if ((m.kind === ChannelKind.Party || m.kind === ChannelKind.Clan) && !this.groups.isMember(m.channel, m.from)) return "not_member";
    if (m.kind === ChannelKind.Party && this.groups.get(m.channel)?.kind !== GroupKind.Party) return "not_member";
    if (m.kind === ChannelKind.Clan && this.groups.get(m.channel)?.kind !== GroupKind.Clan) return "not_member";
    if (m.kind === ChannelKind.Whisper && !m.channel) return "no_target";
    if (!this.bucket(m.from, m.tick).take(m.tick)) return "rate_limited";
    return undefined;
  }
  /** Recipients (playerIds, sorted) among `online`; block lists filter per recipient. */
  recipients(m: ChatMessage, online: readonly ChatPlayer[], sender?: ChatPlayer): number[] {
    let ids: number[];
    switch (m.kind) {
      case ChannelKind.Party: case ChannelKind.Clan: { const g = this.groups.get(m.channel); ids = online.filter((p) => g?.members.has(p.playerId)).map((p) => p.playerId); break; }
      case ChannelKind.Whisper: ids = online.some((p) => p.playerId === m.channel) ? [m.channel, m.from] : []; break;
      case ChannelKind.Local: { const s = sender ?? online.find((p) => p.playerId === m.from); const r2 = this.localRadius ** 2;
        ids = s ? online.filter((p) => (p.x - s.x) ** 2 + (p.y - s.y) ** 2 <= r2).map((p) => p.playerId) : []; break; }
      default: ids = online.map((p) => p.playerId);
    }
    return [...new Set(ids)].filter((id) => m.kind === ChannelKind.System || !this.mutes.isBlocked(id, m.from)).sort((a, b) => a - b);
  }
}
