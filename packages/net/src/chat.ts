/**
 * Chat transport + delivery. Net owns framing and routing; the channel model, rate limits, mutes and blocks are
 * core's (batch 7) and plug in through ChatPolicy (TODO(core batch 7): adapter over core's chat model; until then
 * net's own token bucket / mute / block hooks below apply).
 *
 * Wire (reliable, MsgType.Chat):
 *  client -> server: u8 channel, varuint toPlayerId (whisper target; else 0), utf8 text, u8 nMentions, nMentions x varuint
 *                    playerId (client-resolved from @name), u16 emote (0 = none)
 *  server -> client: bit kind
 *    0 message: u8 channel, varuint fromPlayer (0 = system), varuint fromClient, u32 tick, utf8 text,
 *               u8 nMentions, varuint playerId..., u16 emote
 *  Mentions are capped at 8, filtered to valid online players, and never used for delivery (whispers use toPlayerId).
 *    1 reject:  u8 channel, u8 reason (ChatReject)
 */
import { Transform, type Entity } from "@engine/core";
import { BitWriter, type BitReader } from "./bits.js";
import { TokenBucket, type RateLimit } from "./messages.js";
import { MsgType, writeHeader } from "./protocol.js";
import type { ClientSession, NetServer } from "./server.js";
import { readUtf8, writeUtf8 } from "./utf8.js";

export const ChatChannel = { Global: 0, Local: 1, Party: 2, Clan: 3, Trade: 4, Whisper: 5, System: 6 } as const;
export type ChatChannel = (typeof ChatChannel)[keyof typeof ChatChannel];
export const ChatReject = { RateLimited: 1, TooLong: 2, Muted: 3, NotMember: 4, NoTarget: 5, Filtered: 6, Empty: 7, Policy: 8, BadChannel: 9 } as const;
export type ChatReject = (typeof ChatReject)[keyof typeof ChatReject];

/** Core chat model adapter. Every method optional. */
export interface ChatPolicy {
  /** Channel permission / mute / rate decision for a sender. Return a ChatReject code to refuse. */
  check?(fromPlayer: number, channel: ChatChannel, text: string, tick: number): ChatReject | undefined;
  /** Recipient has blocked sender: message is not delivered to that recipient. */
  isBlocked?(recipientPlayer: number, senderPlayer: number): boolean;
}
export interface ChatServerOptions {
  /** Local channel radius in tiles (default 48), from owned-entity positions. */
  localRadius?: number;
  /** Max text length in UTF-16 code units after normalization (default 256). */
  maxLength?: number;
  /** Per-session send rate (default 2/s, burst 5). Applies on top of the policy. */
  rate?: RateLimit;
  /** Text normalization (trim, collapse whitespace, NFC... default: NFC + trim). */
  normalize?: (text: string) => string;
  /** Mute/filter hook: return replacement text, or null to refuse (Filtered). */
  filter?: (session: ClientSession, channel: ChatChannel, text: string) => string | null;
  /** Muted senders (Muted). */
  isMuted?: (session: ClientSession, channel: ChatChannel) => boolean;
  policy?: ChatPolicy;
  /** Persistent player id (TODO(core batch 7): core PlayerId). Default clientId. */
  playerIdOf?: (session: ClientSession) => number;
}
export interface ChatDelivered { channel: ChatChannel; fromPlayer: number; fromClient: number; tick: number; text: string; mentions: number[]; emote: number }
export const MAX_MENTIONS = 8;

export class ChatServer {
  private buckets = new Map<number, TokenBucket>();
  readonly stats = { delivered: 0, rejected: 0 };
  /** Server-side observers (logging/moderation). */
  readonly log: ((m: ChatDelivered & { recipients: number[] }) => void)[] = [];
  constructor(readonly server: NetServer, readonly opts: ChatServerOptions = {}) {
    server.onRawMessage(MsgType.Chat, (s, r) => this.onMessage(s, r));
    server.onTick(() => { const dt = 1 / server.tickHz; for (const b of this.buckets.values()) b.refill(dt); });
  }
  playerOf(s: ClientSession): number { return this.opts.playerIdOf ? this.opts.playerIdOf(s) : s.clientId; }
  private reject(s: ClientSession, channel: number, reason: ChatReject): void {
    this.stats.rejected++;
    const w = new BitWriter(); writeHeader(w, MsgType.Chat); w.writeBool(true); w.writeBits(channel, 8); w.writeBits(reason, 8);
    this.server.sendRaw(s.clientId, w.finish(), "reliable");
  }
  private pos(clientId: number): { x: number; y: number } | undefined {
    const w = this.server.world;
    for (const e of this.server.ownedEntities(clientId) as Entity[]) if (w.isAlive(e) && w.has(e, Transform)) { const t = w.get(e, Transform)!; return { x: t.x, y: t.y }; }
    return undefined;
  }
  private onMessage(s: ClientSession, r: BitReader): void {
    const channel = r.readBits(8) as ChatChannel; const target = r.readVarUint(); let text = readUtf8(r, 2048);
    const nm = r.readBits(8); const rawMentions: number[] = []; for (let i = 0; i < nm; i++) rawMentions.push(r.readVarUint());
    const emote = r.readBits(16);
    const online = new Set([...this.server.connected()].map((x) => this.playerOf(x)));
    const mentions = [...new Set(rawMentions)].filter((p) => p !== 0 && online.has(p)).slice(0, MAX_MENTIONS);
    if (channel === ChatChannel.System || channel > ChatChannel.System) return this.reject(s, channel, ChatReject.BadChannel);
    let b = this.buckets.get(s.clientId); if (!b) { b = new TokenBucket(this.opts.rate ?? { perSec: 2, burst: 5 }); this.buckets.set(s.clientId, b); }
    if (!b.take()) { this.server.anomaly(s, "chatRateLimited"); return this.reject(s, channel, ChatReject.RateLimited); }
    text = (this.opts.normalize ?? ((t: string) => t.normalize("NFC").trim()))(text);
    if (!text) return this.reject(s, channel, ChatReject.Empty);
    if (text.length > (this.opts.maxLength ?? 256)) return this.reject(s, channel, ChatReject.TooLong);
    if (this.opts.isMuted?.(s, channel)) return this.reject(s, channel, ChatReject.Muted);
    const from = this.playerOf(s);
    const pr = this.opts.policy?.check?.(from, channel, text, this.server.world.tick); if (pr) return this.reject(s, channel, pr);
    if (this.opts.filter) { const f = this.opts.filter(s, channel, text); if (f === null) return this.reject(s, channel, ChatReject.Filtered); text = f; }
    const rec = this.recipients(s, channel, target);
    if (rec === "notMember") return this.reject(s, channel, ChatReject.NotMember);
    if (rec === "noTarget") return this.reject(s, channel, ChatReject.NoTarget);
    this.deliver(channel, from, s.clientId, text, rec, mentions, emote);
  }
  private recipients(s: ClientSession, channel: ChatChannel, target: number): number[] | "notMember" | "noTarget" {
    const all = [...this.server.connected()];
    switch (channel) {
      case ChatChannel.Global: case ChatChannel.Trade: return all.map((x) => x.clientId);
      case ChatChannel.Local: {
        const me = this.pos(s.clientId); if (!me) return [s.clientId];
        const r2 = (this.opts.localRadius ?? 48) ** 2;
        return all.filter((x) => { const p = x.clientId === s.clientId ? me : this.pos(x.clientId); return !!p && (p.x - me.x) ** 2 + (p.y - me.y) ** 2 <= r2; }).map((x) => x.clientId);
      }
      case ChatChannel.Party: case ChatChannel.Clan: {
        const g = this.server.groups; const kind = channel === ChatChannel.Party ? "party" : "clan";
        const gid = g?.groupOf(s.clientId, kind); if (gid === undefined) return "notMember";
        return g!.clientsOfGroup(gid);
      }
      case ChatChannel.Whisper: {
        const t = all.find((x) => this.playerOf(x) === target); if (!t) return "noTarget";
        return t.clientId === s.clientId ? [s.clientId] : [t.clientId, s.clientId];
      }
      default: return [];
    }
  }
  private deliver(channel: ChatChannel, fromPlayer: number, fromClient: number, text: string, to: readonly number[], mentions: readonly number[] = [], emote = 0): void {
    const tick = this.server.world.tick;
    const w = new BitWriter(); writeHeader(w, MsgType.Chat); w.writeBool(false); w.writeBits(channel, 8);
    w.writeVarUint(fromPlayer); w.writeVarUint(fromClient); w.writeBits(tick, 32); writeUtf8(w, text);
    w.writeBits(mentions.length, 8); for (const m of mentions) w.writeVarUint(m); w.writeBits(emote, 16);
    const bytes = w.finish(); const sent: number[] = [];
    for (const c of to) {
      const rs = this.server.sessions.get(c);
      if (fromPlayer && rs && c !== fromClient && this.opts.policy?.isBlocked?.(this.playerOf(rs), fromPlayer)) continue;
      if (this.server.sendRaw(c, bytes, "reliable")) sent.push(c);
    }
    this.stats.delivered += sent.length;
    for (const f of this.log) f({ channel, fromPlayer, fromClient, tick, text, mentions: [...mentions], emote, recipients: sent });
  }
  /** Server/system message to everyone, or to the given clients. */
  system(text: string, to?: readonly number[]): void {
    this.deliver(ChatChannel.System, 0, 0, text, to ?? [...this.server.connected()].map((s) => s.clientId));
  }
}

/** Client side: `client.chat`. */
export class ChatClient {
  readonly history: ChatDelivered[] = [];
  private handlers: ((m: ChatDelivered) => void)[] = [];
  private rejectHandlers: ((channel: ChatChannel, reason: ChatReject) => void)[] = [];
  constructor(private readonly client: { sendRaw(b: Uint8Array, ch: "reliable" | "unreliable"): boolean; onRawMessage(type: number, fn: (r: BitReader) => void): void }, readonly historySize = 100) {
    client.onRawMessage(MsgType.Chat, (r) => {
      if (r.readBool()) { const ch = r.readBits(8) as ChatChannel; const reason = r.readBits(8) as ChatReject; for (const f of this.rejectHandlers) f(ch, reason); return; }
      const channel = r.readBits(8) as ChatChannel; const fromPlayer = r.readVarUint(); const fromClient = r.readVarUint(); const tick = r.readBits(32); const text = readUtf8(r);
      const mentions: number[] = []; const nm = r.readBits(8); for (let i = 0; i < nm; i++) mentions.push(r.readVarUint());
      const m: ChatDelivered = { channel, fromPlayer, fromClient, tick, text, mentions, emote: r.readBits(16) };
      this.history.push(m); if (this.history.length > this.historySize) this.history.shift();
      for (const f of this.handlers) f(m);
    });
  }
  /**
   * Send on a channel; whisper needs `to` (target player id). `mentions` = player ids the UI resolved from @name
   * (max 8 sent); `emote` = emote id (u16, 0 = none). Returns false if not connected.
   */
  send(channel: ChatChannel, text: string, opts: { to?: number; mentions?: readonly number[]; emote?: number } = {}): boolean {
    const w = new BitWriter(); writeHeader(w, MsgType.Chat); w.writeBits(channel, 8); w.writeVarUint(opts.to ?? 0); writeUtf8(w, text, 2048);
    const m = (opts.mentions ?? []).slice(0, MAX_MENTIONS); w.writeBits(m.length, 8); for (const x of m) w.writeVarUint(x); w.writeBits(opts.emote ?? 0, 16);
    return this.client.sendRaw(w.finish(), "reliable");
  }
  on(fn: (m: ChatDelivered) => void): () => void { this.handlers.push(fn); return () => { const i = this.handlers.indexOf(fn); if (i >= 0) this.handlers.splice(i, 1); }; }
  onReject(fn: (channel: ChatChannel, reason: ChatReject) => void): () => void { this.rejectHandlers.push(fn); return () => { const i = this.rejectHandlers.indexOf(fn); if (i >= 0) this.rejectHandlers.splice(i, 1); }; }
}
