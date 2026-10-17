/**
 * Chat transport + delivery. Net owns framing and routing; the channel model, validation (mutes, membership,
 * rate limit, byte cap), recipients and block lists are core's ChannelRegistry, and the message payload is core's
 * encodeChatMessage. Net adds: text normalization/filter hooks, a UTF-16 maxLength, mentions, emote, playerId->client mapping.
 *
 * Wire (reliable, MsgType.Chat):
 *  client -> server: u8 kind (ChannelKind), varuint toPlayerId (whisper target; else 0), utf8 text, u8 nMentions,
 *                    nMentions x varuint playerId (client-resolved from @name), u16 emote (0 = none)
 *  server -> client: bit kind
 *    0 message: varuint n, n bytes core encodeChatMessage {u8 kind, u32 channel, u32 from, u32 tick, string text},
 *               varuint fromClient, u8 nMentions, varuint playerId..., u16 emote
 *      (channel = group id for party/clan, target playerId for whisper, else 0; from 0 = system)
 *    1 reject:  u8 kind, u8 reason (ChatReject)
 *  Mentions are capped at 8, filtered to valid online players, and never used for delivery (whispers use toPlayerId).
 */
import { BinaryReader, type ChannelRegistry, Transform, decodeChatMessage, encodeChatMessage, type ChatMessage, type ChatPlayer, type Entity } from "@engine/core";
import { BitWriter, type BitReader } from "./bits.js";
import { MsgType, writeHeader } from "./protocol.js";
import type { ClientSession, NetServer } from "./server.js";
import { readUtf8, writeUtf8 } from "./utf8.js";

/** Numeric mirror of core's ChannelKind (core's is a const enum). */
export const ChatChannel = { Global: 0, Local: 1, Party: 2, Clan: 3, Trade: 4, Whisper: 5, System: 6 } as const;
export type ChatChannel = (typeof ChatChannel)[keyof typeof ChatChannel];
export const ChatReject = { RateLimited: 1, TooLong: 2, Muted: 3, NotMember: 4, NoTarget: 5, Filtered: 6, Empty: 7, Policy: 8, BadChannel: 9 } as const;
export type ChatReject = (typeof ChatReject)[keyof typeof ChatReject];
const CORE_REJECT: Record<string, ChatReject> = { muted: ChatReject.Muted, rate_limited: ChatReject.RateLimited, too_long: ChatReject.TooLong, not_member: ChatReject.NotMember, no_target: ChatReject.NoTarget, system_only: ChatReject.BadChannel };

export interface ChatServerOptions {
  /** Core channel model (validate / recipients / mutes / blocks / rate). Required. */
  channels: ChannelRegistry;
  /** Local channel radius in tiles; sets channels.localRadius (default 48). */
  localRadius?: number;
  /** Max text length in UTF-16 code units after normalization (default 256); core also caps at CHAT_MAX_BYTES. */
  maxLength?: number;
  /** Text normalization (default: NFC + trim). */
  normalize?: (text: string) => string;
  /** Profanity/filter hook: return replacement text, or null to refuse (Filtered). */
  filter?: (session: ClientSession, channel: ChatChannel, text: string) => string | null;
  /** Persistent player id. Default: the group resolver's playerOf (core PlayerId), else clientId. */
  playerIdOf?: (session: ClientSession) => number;
}
export interface ChatDelivered { channel: ChatChannel; /** group id (party/clan) / whisper target / 0 */ channelId: number; fromPlayer: number; fromClient: number; tick: number; text: string; mentions: number[]; emote: number }
export const MAX_MENTIONS = 8;

export class ChatServer {
  readonly stats = { delivered: 0, rejected: 0 };
  /** Server-side observers (logging/moderation). */
  readonly log: ((m: ChatDelivered & { recipients: number[] }) => void)[] = [];
  readonly channels: ChannelRegistry;
  constructor(readonly server: NetServer, readonly opts: ChatServerOptions) {
    this.channels = opts.channels;
    this.channels.localRadius = opts.localRadius ?? 48;
    server.onRawMessage(MsgType.Chat, (s, r) => this.onMessage(s, r));
  }
  playerOf(s: ClientSession): number {
    if (this.opts.playerIdOf) return this.opts.playerIdOf(s);
    const g = this.server.groups as { playerOf?(c: number): number | undefined } | undefined;
    return g?.playerOf?.(s.clientId) ?? s.clientId;
  }
  private reject(s: ClientSession, channel: number, reason: ChatReject): void {
    this.stats.rejected++;
    const w = new BitWriter(); writeHeader(w, MsgType.Chat); w.writeBool(true); w.writeBits(channel & 0xff, 8); w.writeBits(reason, 8);
    this.server.sendRaw(s.clientId, w.finish(), "reliable");
  }
  private pos(clientId: number): { x: number; y: number } | undefined {
    const w = this.server.world;
    for (const e of this.server.ownedEntities(clientId) as Entity[]) if (w.isAlive(e) && w.has(e, Transform)) { const t = w.get(e, Transform)!; return { x: t.x, y: t.y }; }
    return undefined;
  }
  /** Online players for core recipients(); players without a position sit at +inf (never local). */
  private online(): { list: ChatPlayer[]; client: Map<number, number> } {
    const list: ChatPlayer[] = []; const client = new Map<number, number>();
    for (const s of this.server.connected()) {
      const id = this.playerOf(s); const p = this.pos(s.clientId);
      list.push({ playerId: id, x: p?.x ?? Infinity, y: p?.y ?? Infinity }); client.set(id, s.clientId);
    }
    return { list, client };
  }
  private onMessage(s: ClientSession, r: BitReader): void {
    const kind = r.readBits(8) as ChatChannel; const target = r.readVarUint(); let text = readUtf8(r, 2048);
    const nm = r.readBits(8); const rawMentions: number[] = []; for (let i = 0; i < nm; i++) rawMentions.push(r.readVarUint());
    const emote = r.readBits(16);
    if (kind > ChatChannel.System) return this.reject(s, kind, ChatReject.BadChannel);
    const from = this.playerOf(s); const tick = this.server.world.tick;
    text = (this.opts.normalize ?? ((t: string) => t.normalize("NFC").trim()))(text);
    if (!text) return this.reject(s, kind, ChatReject.Empty);
    let channel = 0;
    if (kind === ChatChannel.Party || kind === ChatChannel.Clan) channel = this.server.groups?.groupOf(s.clientId, kind === ChatChannel.Party ? "party" : "clan") ?? 0;
    else if (kind === ChatChannel.Whisper) channel = target;
    const m: ChatMessage = { kind: kind as number as ChatMessage["kind"], channel, from, tick, text };
    const core = this.channels.validate(m);
    if (core) { if (core === "rate_limited") this.server.anomaly(s, "chatRateLimited"); return this.reject(s, kind, CORE_REJECT[core] ?? ChatReject.Policy); }
    if (text.length > (this.opts.maxLength ?? 256)) return this.reject(s, kind, ChatReject.TooLong);
    if (this.opts.filter) { const f = this.opts.filter(s, kind, text); if (f === null) return this.reject(s, kind, ChatReject.Filtered); m.text = f; }
    const { list, client } = this.online();
    const me = list.find((p) => p.playerId === from);
    const ids = this.channels.recipients(m, list, me);
    if (kind === ChatChannel.Whisper && !ids.length) return this.reject(s, kind, ChatReject.NoTarget);
    const to = ids.map((id) => client.get(id)).filter((c): c is number => c !== undefined);
    if (!to.includes(s.clientId)) to.push(s.clientId); // sender always sees its own line
    const mentions = [...new Set(rawMentions)].filter((p) => p !== 0 && client.has(p)).slice(0, MAX_MENTIONS);
    this.deliver(m, s.clientId, to, mentions, emote);
  }
  private deliver(m: ChatMessage, fromClient: number, to: readonly number[], mentions: readonly number[] = [], emote = 0): void {
    const payload = encodeChatMessage(m).finish();
    const w = new BitWriter(); writeHeader(w, MsgType.Chat); w.writeBool(false);
    w.writeVarUint(payload.length); w.writeBytes(payload); w.writeVarUint(fromClient);
    w.writeBits(mentions.length, 8); for (const x of mentions) w.writeVarUint(x); w.writeBits(emote, 16);
    const bytes = w.finish(); const sent: number[] = [];
    for (const c of to) if (this.server.sendRaw(c, bytes, "reliable")) sent.push(c);
    this.stats.delivered += sent.length;
    for (const f of this.log) f({ channel: m.kind as number as ChatChannel, channelId: m.channel, fromPlayer: m.from, fromClient, tick: m.tick, text: m.text, mentions: [...mentions], emote, recipients: sent });
  }
  /** Server/system message to everyone, or to the given clients (bypasses validation and blocks). */
  system(text: string, to?: readonly number[]): void {
    this.deliver({ kind: ChatChannel.System as number as ChatMessage["kind"], channel: 0, from: 0, tick: this.server.world.tick, text }, 0, to ?? [...this.server.connected()].map((s) => s.clientId));
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
      const core = decodeChatMessage(new BinaryReader(r.readBytes(r.readVarUint()))); const fromClient = r.readVarUint();
      const mentions: number[] = []; const nm = r.readBits(8); for (let i = 0; i < nm; i++) mentions.push(r.readVarUint());
      const m: ChatDelivered = { channel: core.kind as number as ChatChannel, channelId: core.channel, fromPlayer: core.from, fromClient, tick: core.tick, text: core.text, mentions, emote: r.readBits(16) };
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
