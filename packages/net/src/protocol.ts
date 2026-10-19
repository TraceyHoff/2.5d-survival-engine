import { BitReader, BitWriter } from "./bits.js";

/**
 * Wire protocol. Every packet starts with a fixed header that must never change layout
 * across versions: u16 protocolVersion, u8 msgType (byte aligned). Body is bit-packed.
 */
export const PROTOCOL_VERSION = 5;
export const MsgType = { Hello: 1, Welcome: 2, Reject: 3, Input: 4, Snapshot: 5, Command: 6, Events: 7, Static: 8, StaticCtl: 9, Groups: 10, Chat: 11, Markers: 12, CommandRejected: 13, Trade: 14, Ping: 15, Pong: 16, Report: 17, Tiles: 18, TilesCtl: 19 } as const;
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
/** Core AimMode values (core's is a const enum). */
export const AimModeWire = { Direction: 0, WorldPoint: 1 } as const;
/**
 * One input tick (core InputFrame v2 minus tick/commands). buttons = InputFrame.actions (u32). Optional v2 fields:
 * moveX/moveY and ghostNudgeX/Y are analog [-1,1], q8 on the wire exactly like core (round(clamp(v)*127)/127, i8);
 * aimMode 0 Direction / 1 WorldPoint; edges = edge pulses that fire on THIS seq only (applied exactly once by the server).
 */
export interface InputCmd {
  seq: number; buttons: number; aimX: number; aimY: number;
  moveX?: number; moveY?: number; aimMode?: number; ghostNudgeX?: number; ghostNudgeY?: number; edges?: number;
}
/**
 * Input packet: ack of newest decoded snapshot, the client's interpolation (view) tick for lag compensation, the newest unacked
 * inputs (consecutive seqs, redundancy window), and edge records for EVERY unacked seq that has edges (even ones that have
 * slid out of the window), so a pulse survives any loss burst shorter than the client's pending queue.
 */
export interface InputMsg { ackTick: number; viewTick?: number; cmds: InputCmd[]; edges?: { seq: number; edges: number }[] }
/** Core's q8 (packages/core input.ts): clamp to [-1,1], round(v*127), clamp to [-127,127]. */
export const q8 = (v: number): number => Math.max(-127, Math.min(127, Math.round(Math.max(-1, Math.min(1, v)) * 127)));
/** Quantize a command's analog fields the way the wire will (client predicts with exactly what the server applies). */
export function quantizeInput<T extends Omit<InputCmd, "seq">>(c: T): T {
  const o = { ...c };
  if (o.moveX !== undefined || o.moveY !== undefined) { o.moveX = q8(o.moveX ?? 0) / 127 + 0; o.moveY = q8(o.moveY ?? 0) / 127 + 0; }
  if (o.ghostNudgeX !== undefined || o.ghostNudgeY !== undefined) { o.ghostNudgeX = q8(o.ghostNudgeX ?? 0) / 127 + 0; o.ghostNudgeY = q8(o.ghostNudgeY ?? 0) / 127 + 0; }
  o.buttons = o.buttons >>> 0; if (o.edges !== undefined) o.edges = o.edges >>> 0;
  return o;
}
const i8w = (w: BitWriter, v: number): void => w.writeBits(q8(v) & 0xff, 8);
const i8r = (r: BitReader): number => { const b = r.readBits(8); return (b > 127 ? b - 256 : b) / 127 + 0; };

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
/**
 * Wire v5: u32 ackTick, u32 viewTick, u8 n, [u32 firstSeq], n x cmd, varuint nEdges, nEdges x (varuint zigzag(seq - firstSeq), varuint edges)
 *   cmd: varuint buttons, f32 aimX, f32 aimY, bit hasMove, bit worldPoint, bit hasNudge, [i8 moveX, i8 moveY], [i8 nudgeX, i8 nudgeY]
 * Edges ride ONLY in the edge records (never in cmds), so window redundancy cannot double-apply them.
 */
export function encodeInput(m: InputMsg): Uint8Array {
  const w = new BitWriter(); writeHeader(w, MsgType.Input);
  w.writeBits(m.ackTick, 32); w.writeBits(m.viewTick ?? NONE_U32, 32); w.writeBits(m.cmds.length, 8);
  const first = m.cmds.length ? m.cmds[0]!.seq : (m.edges?.[0]?.seq ?? 0);
  if (m.cmds.length) w.writeBits(first, 32);
  for (const c of m.cmds) {
    w.writeVarUint(c.buttons >>> 0); w.writeF32(c.aimX); w.writeF32(c.aimY);
    const mv = c.moveX !== undefined || c.moveY !== undefined, nd = c.ghostNudgeX !== undefined || c.ghostNudgeY !== undefined;
    w.writeBool(mv); w.writeBool(c.aimMode === AimModeWire.WorldPoint); w.writeBool(nd);
    if (mv) { i8w(w, c.moveX ?? 0); i8w(w, c.moveY ?? 0); }
    if (nd) { i8w(w, c.ghostNudgeX ?? 0); i8w(w, c.ghostNudgeY ?? 0); }
  }
  const ed = m.edges ?? [];
  w.writeVarUint(ed.length);
  if (ed.length && !m.cmds.length) w.writeBits(first, 32);
  for (const e of ed) { const d = e.seq - first; w.writeVarUint(((d << 1) ^ (d >> 31)) >>> 0); w.writeVarUint(e.edges >>> 0); }
  return w.finish();
}
export function decodeInput(r: BitReader): InputMsg {
  const ackTick = r.readBits(32); const viewTick = r.readBits(32); const n = r.readBits(8); const cmds: InputCmd[] = [];
  let first = n ? r.readBits(32) : 0;
  for (let i = 0; i < n; i++) {
    const c: InputCmd = { seq: (first + i) >>> 0, buttons: r.readVarUint() >>> 0, aimX: r.readF32(), aimY: r.readF32() };
    const mv = r.readBool(), wp = r.readBool(), nd = r.readBool();
    if (wp) c.aimMode = AimModeWire.WorldPoint;
    if (mv) { c.moveX = i8r(r); c.moveY = i8r(r); }
    if (nd) { c.ghostNudgeX = i8r(r); c.ghostNudgeY = i8r(r); }
    cmds.push(c);
  }
  const ne = r.readVarUint(); const edges: { seq: number; edges: number }[] = [];
  if (ne && !n) first = r.readBits(32);
  for (let i = 0; i < ne; i++) { const z = r.readVarUint(); const d = (z >>> 1) ^ -(z & 1); edges.push({ seq: (first + d) >>> 0, edges: r.readVarUint() >>> 0 }); }
  const m: InputMsg = viewTick === NONE_U32 ? { ackTick, cmds } : { ackTick, viewTick, cmds };
  if (edges.length) m.edges = edges;
  return m;
}
export const emptyToken = (): Uint8Array => new Uint8Array(TOKEN_BYTES);
export const tokenKey = (t: Uint8Array): string => Array.from(t, (b) => b.toString(16).padStart(2, "0")).join("");
