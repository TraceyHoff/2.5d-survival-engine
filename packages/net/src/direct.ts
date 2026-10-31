/**
 * In-process "direct" client (ADR-105) for virtual players hosted next to the server (singleplayer bots): it reads the
 * authoritative world instead of decoding snapshots into its own replica, but everything it *does* still travels as
 * ordinary wire messages over its transport (Hello, Input, Command, raw Chat), so the server applies the same
 * decoding, input queue, rate limits, entity-ref checks (against its AOI) and command handlers as for a human client.
 */
import { BitReader, BitWriter } from "./bits.js";
import { ChatClient } from "./chat.js";
import { writePayload, type MessageDef, type MessageDefBase, type Payload } from "./messages.js";
import { MsgType, NONE_U32, PROTOCOL_VERSION, decodeReject, decodeWelcome, emptyToken, encodeHello, encodeInput, quantizeInput, readHeader, writeHeader, type InputCmd } from "./protocol.js";
import { NO_ENTITY, type NetServer } from "./server.js";
import type { CommandRejection } from "./client.js";
import { readUtf8 } from "./utf8.js";
import type { ClientTransport } from "./transport/types.js";
import type { Entity, Schema } from "@engine/core";

export class DirectClient {
  clientId = 0;
  private active = false;
  private seq = 0;
  private raw = new Map<number, ((r: BitReader) => void)[]>();
  readonly chat: ChatClient;
  constructor(private readonly server: NetServer, private readonly transport: ClientTransport) {
    this.chat = new ChatClient(this);
    transport.onMessage((b) => this.onMessage(b));
    transport.onClose(() => { this.active = false; });
  }
  get connected(): boolean { return this.active; }
  /** Handshake over the transport; resolves once the server welcomed us and the session is marked direct. */
  async connect(): Promise<void> {
    await this.transport.connect();
    const welcome = new Promise<void>((res, rej) => { this.welcomeFns = { res, rej }; });
    this.transport.send(encodeHello({ hashes: this.server.offeredHashes, token: emptyToken() }), "reliable");
    await welcome;
  }
  private welcomeFns: { res: () => void; rej: (e: Error) => void } | undefined;
  private onMessage(bytes: Uint8Array): void {
    let r: BitReader; let h;
    try { r = new BitReader(bytes); h = readHeader(r); } catch { return; }
    if (h.type === MsgType.Reject) { const { reason, detail } = decodeReject(r); this.welcomeFns?.rej(new Error(`rejected ${reason} ${detail}`)); this.welcomeFns = undefined; this.active = false; return; }
    if (h.version !== PROTOCOL_VERSION) return;
    if (h.type === MsgType.Welcome) {
      const w = decodeWelcome(r); this.clientId = w.clientId; this.active = true;
      this.server.setDirect(w.clientId, true); this.welcomeFns?.res(); this.welcomeFns = undefined; return;
    }
    if (h.type === MsgType.CommandRejected) {
      const core = r.readBool(); const id = r.readVarUint(); const sq = r.readVarUint(); const reason = r.readVarUint(); const detail = readUtf8(r);
      const rej: CommandRejection = { source: core ? "core" : "net", command: core ? undefined : this.server.commands.get(id), commandId: id, reason, detail, ...(sq > 0 && { seq: sq - 1 }) };
      for (const f of this.rejectFns) f(rej); return;
    }
    for (const f of this.raw.get(h.type) ?? []) f(r);
  }
  private rejectFns: ((r: CommandRejection) => void)[] = [];
  onCommandRejected(fn: (r: CommandRejection) => void): () => void { this.rejectFns.push(fn); return () => { const i = this.rejectFns.indexOf(fn); if (i >= 0) this.rejectFns.splice(i, 1); }; }
  /** One input per server tick, quantized and framed exactly like NetClient's (edges carried in the same message). */
  sendInput(c: Omit<InputCmd, "seq">): void {
    if (!this.active) return;
    const cmd: InputCmd = { seq: this.seq++, ...quantizeInput(c) }; if (!cmd.edges) delete cmd.edges;
    this.transport.send(encodeInput({ ackTick: NONE_U32, viewTick: this.server.world.tick, cmds: [cmd], ...(cmd.edges ? { edges: [{ seq: cmd.seq, edges: cmd.edges }] } : {}) }), "unreliable");
  }
  /** Same Command message as NetClient.sendCommand; entity fields are authoritative entities (mapped to netIds). */
  sendCommand<S extends Schema>(def: MessageDef<S>, payload: Payload<S>): boolean {
    if (!this.active) return false;
    const d = def as unknown as MessageDefBase; const id = this.server.commands.id(d);
    const p = { ...payload } as Record<string, number>;
    for (const f of d.entityFields) {
      const e = p[f]! as Entity; if (e === NO_ENTITY) { p[f] = 0; continue; }
      const n = this.server.netIds.netIdOf(e); if (n === undefined) return false; p[f] = n;
    }
    const w = new BitWriter(); writeHeader(w, MsgType.Command); w.writeVarUint(id); w.writeVarUint(this.server.world.tick + 1);
    writePayload(w, d, p); this.transport.send(w.finish(), "reliable"); return true;
  }
  sendRaw(b: Uint8Array, ch: "reliable" | "unreliable"): boolean { if (!this.active) return false; this.transport.send(b, ch); return true; }
  onRawMessage(type: number, fn: (r: BitReader) => void): void { const l = this.raw.get(type) ?? []; l.push(fn); this.raw.set(type, l); }
  close(): void { this.active = false; this.transport.close(); }
}
