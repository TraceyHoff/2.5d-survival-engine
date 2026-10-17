import { BitReader, BitWriter } from "./bits.js";

/**
 * Wire protocol. Every packet starts with a fixed header that must never change layout
 * across versions: u16 protocolVersion, u8 msgType (byte aligned). Body is bit-packed.
 */
export const PROTOCOL_VERSION = 2;
export const MsgType = { Hello: 1, Welcome: 2, Reject: 3, Input: 4, Snapshot: 5, Command: 6, Events: 7, Static: 8, StaticCtl: 9 } as const;
export type MsgType = (typeof MsgType)[keyof typeof MsgType];
export const RejectReason = { ProtocolMismatch: 1, SchemaMismatch: 2, BadToken: 3, ServerFull: 4, Malformed: 5, HashMismatch: 6 } as const;
export type RejectReason = (typeof RejectReason)[keyof typeof RejectReason];
export const TOKEN_BYTES = 16;
export const NONE_U32 = 0xffffffff;

export interface Header { version: number; type: number }
export function writeHeader(w: BitWriter, type: MsgType, version = PROTOCOL_VERSION): void { w.writeBits(version, 16); w.writeBits(type, 8); }
export function readHeader(r: BitReader): Header { return { version: r.readBits(16), type: r.readBits(8) }; }

/** Named compatibility hashes checked at handshake, e.g. schema (world schema), netdefs (commands/events), assets. */
export type NamedHashes = Readonly<Record<string, number>>;
export interface HelloMsg { hashes: NamedHashes; token: Uint8Array }
export interface WelcomeMsg { clientId: number; token: Uint8Array; tickHz: number; serverTick: number }
export interface InputCmd { seq: number; buttons: number; aimX: number; aimY: number }
/** Input packet: ack of newest decoded snapshot, the client's interpolation (view) tick for lag compensation, and the newest unacked inputs (consecutive seqs). */
export interface InputMsg { ackTick: number; viewTick?: number; cmds: InputCmd[] }

export function encodeHello(m: HelloMsg, version = PROTOCOL_VERSION): Uint8Array {
  const w = new BitWriter(); writeHeader(w, MsgType.Hello, version); w.writeBytes(m.token);
  const names = Object.keys(m.hashes).sort(); w.writeBits(names.length, 8);
  for (const n of names) { w.writeString(n); w.writeBits(m.hashes[n]!, 32); }
  return w.finish();
}
export function decodeHello(r: BitReader): HelloMsg {
  const token = r.readBytes(TOKEN_BYTES); const n = r.readBits(8); const hashes: Record<string, number> = {};
  for (let i = 0; i < n; i++) { const k = r.readString(); hashes[k] = r.readBits(32); }
  return { hashes, token };
}
export function encodeWelcome(m: WelcomeMsg): Uint8Array {
  const w = new BitWriter(); writeHeader(w, MsgType.Welcome);
  w.writeBits(m.clientId, 16); w.writeBytes(m.token); w.writeBits(m.tickHz, 8); w.writeBits(m.serverTick, 32); return w.finish();
}
export function decodeWelcome(r: BitReader): WelcomeMsg {
  return { clientId: r.readBits(16), token: r.readBytes(TOKEN_BYTES), tickHz: r.readBits(8), serverTick: r.readBits(32) };
}
/** Reject {reason, detail} - detail names the mismatching hash for HashMismatch/SchemaMismatch. */
export function encodeReject(reason: RejectReason, detail = ""): Uint8Array { const w = new BitWriter(); writeHeader(w, MsgType.Reject); w.writeBits(reason, 8); w.writeString(detail); return w.finish(); }
export function decodeReject(r: BitReader): { reason: RejectReason; detail: string } {
  const reason = r.readBits(8) as RejectReason; let detail = ""; try { detail = r.readString(); } catch { /* v1 reject */ } return { reason, detail };
}
export function encodeInput(m: InputMsg): Uint8Array {
  const w = new BitWriter(); writeHeader(w, MsgType.Input);
  w.writeBits(m.ackTick, 32); w.writeBits(m.viewTick ?? NONE_U32, 32); w.writeBits(m.cmds.length, 8);
  if (m.cmds.length) w.writeBits(m.cmds[0]!.seq, 32);
  for (const c of m.cmds) { w.writeBits(c.buttons, 16); w.writeF32(c.aimX); w.writeF32(c.aimY); }
  return w.finish();
}
export function decodeInput(r: BitReader): InputMsg {
  const ackTick = r.readBits(32); const viewTick = r.readBits(32); const n = r.readBits(8); const cmds: InputCmd[] = [];
  const first = n ? r.readBits(32) : 0;
  for (let i = 0; i < n; i++) cmds.push({ seq: (first + i) >>> 0, buttons: r.readBits(16), aimX: r.readF32(), aimY: r.readF32() });
  return viewTick === NONE_U32 ? { ackTick, cmds } : { ackTick, viewTick, cmds };
}
export const emptyToken = (): Uint8Array => new Uint8Array(TOKEN_BYTES);
export const tokenKey = (t: Uint8Array): string => Array.from(t, (b) => b.toString(16).padStart(2, "0")).join("");
