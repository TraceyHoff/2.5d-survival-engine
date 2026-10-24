/**
 * Anti-cheat: server-side checks, per-session suspicion score, configurable actions, structured log, player reports.
 *
 * Position authority: clients only send inputs (Input/Command); Transform is never accepted from a client, so a
 * hacked client cannot move itself. The movement validator watches the *server's* resulting motion of owned
 * entities (catches speed/teleport exploits through gameplay bugs, input abuse, or missing allowTeleport calls).
 * Every server anomaly (rate-limited/unknown/malformed commands, input floods, bad entity refs, command rejections,
 * chat flood, fire-rate) feeds the score with a per-kind weight; the score decays linearly. Crossing a threshold
 * fires its action once per crossing: "log" | "flag" | "kick".
 */
import { Transform, type Entity } from "@engine/core";
import { BitWriter, type BitReader } from "./bits.js";
import { TokenBucket, type RateLimit } from "./messages.js";
import { MsgType, writeHeader } from "./protocol.js";
import type { AnomalyKind, ClientSession, NetServer } from "./server.js";

export type AntiCheatAction = "log" | "flag" | "kick";
export const ReportReason = { Spam: 1, Abuse: 2, Cheating: 3, Other: 4 } as const;
export type ReportReason = (typeof ReportReason)[keyof typeof ReportReason];
export interface AntiCheatLogEntry {
  tick: number; clientId: number; playerId: number; kind: AnomalyKind | "report" | "action"; detail: string; score: number;
  action?: AntiCheatAction;
  /** report entries */ target?: number; reason?: ReportReason; messageTick?: number;
}
export interface PlayerReport { tick: number; reporterClientId: number; reporterPlayerId: number; targetPlayerId: number; reason: ReportReason; messageTick?: number }
export interface AntiCheatConfig {
  /** Max owned-entity speed in tiles/s (default 8) and relative tolerance (default 0.25). */
  maxSpeed?: number; speedTolerance?: number;
  /** Per-entity max speed override in tiles/s (e.g. a rider moves at its vehicle's top speed); undefined = maxSpeed. */
  maxSpeedFor?: (e: Entity) => number | undefined;
  /** One-tick displacement counted as a teleport (default 4 tiles). */
  teleportDistance?: number;
  /** Return true when a jump of `e` is legitimate (respawn, gameplay teleport). */
  allowTeleport?: (e: Entity) => boolean;
  /** Score per anomaly kind (defaults below; unknown kinds = 1). */
  weights?: Partial<Record<string, number>>;
  /** Score decay per second (default 0.5). */
  decayPerSec?: number;
  /** Ascending thresholds (default: 10 log, 25 flag, 50 kick). */
  thresholds?: { score: number; action: AntiCheatAction }[];
  onAction?: (e: AntiCheatLogEntry, session: ClientSession) => void;
  onLog?: (e: AntiCheatLogEntry) => void;
  logCapacity?: number;
  /** Player reports: rate per session (default 3/min, burst 3) and hook. */
  reportRate?: RateLimit;
  onReport?: (r: PlayerReport) => void;
  playerIdOf?: (s: ClientSession) => number;
}
export const DEFAULT_WEIGHTS: Record<string, number> = {
  speed: 3, teleport: 10, rateLimited: 1, unknownCommand: 3, malformed: 5, inputFlood: 2, badEntityRef: 1,
  commandRejected: 0.5, chatRateLimited: 0.5, fireRate: 2, tradeOffer: 2,
};
interface SessionAC { score: number; fired: Set<number>; counters: Map<string, number>; flagged: boolean; reports: TokenBucket }

export class AntiCheat {
  readonly log: AntiCheatLogEntry[] = [];
  readonly reports: PlayerReport[] = [];
  private s = new Map<number, SessionAC>();
  private last = new Map<Entity, { x: number; y: number; tick: number }>();
  constructor(readonly server: NetServer, readonly cfg: AntiCheatConfig = {}) {
    server.onAnomaly((s, kind, detail) => this.record(s, kind, detail));
    server.onRawMessage(MsgType.Report, (s, r) => this.onReport(s, r));
    server.world.addSystem("postSim", "net.anticheat.movement", () => this.movement());
    server.onTick(() => { const d = (this.cfg.decayPerSec ?? 0.5) / server.tickHz; const dt = 1 / server.tickHz; for (const a of this.s.values()) { a.score = Math.max(0, a.score - d); a.reports.refill(dt); this.rearm(a); } });
  }
  private st(clientId: number): SessionAC {
    let a = this.s.get(clientId);
    if (!a) { a = { score: 0, fired: new Set(), counters: new Map(), flagged: false, reports: new TokenBucket(this.cfg.reportRate ?? { perSec: 3 / 60, burst: 3 }) }; this.s.set(clientId, a); }
    return a;
  }
  private thresholds(): { score: number; action: AntiCheatAction }[] { return this.cfg.thresholds ?? [{ score: 10, action: "log" }, { score: 25, action: "flag" }, { score: 50, action: "kick" }]; }
  private rearm(a: SessionAC): void { this.thresholds().forEach((t, i) => { if (a.score < t.score * 0.5) a.fired.delete(i); }); }
  private playerOf(s: ClientSession): number { return this.cfg.playerIdOf ? this.cfg.playerIdOf(s) : s.clientId; }
  private push(e: AntiCheatLogEntry): void {
    this.log.push(e); if (this.log.length > (this.cfg.logCapacity ?? 1000)) this.log.shift();
    this.cfg.onLog?.(e);
  }
  score(clientId: number): number { return this.s.get(clientId)?.score ?? 0; }
  isFlagged(clientId: number): boolean { return this.s.get(clientId)?.flagged ?? false; }
  counters(clientId: number): ReadonlyMap<string, number> { return this.s.get(clientId)?.counters ?? new Map(); }
  /** Record an anomaly (also reachable through server.anomaly). */
  record(s: ClientSession, kind: AnomalyKind, detail = ""): void {
    const a = this.st(s.clientId);
    a.counters.set(kind, (a.counters.get(kind) ?? 0) + 1);
    a.score += this.cfg.weights?.[kind] ?? DEFAULT_WEIGHTS[kind] ?? 1;
    const tick = this.server.world.tick;
    this.push({ tick, clientId: s.clientId, playerId: this.playerOf(s), kind, detail, score: a.score });
    this.thresholds().forEach((t, i) => {
      if (a.score < t.score || a.fired.has(i)) return;
      a.fired.add(i);
      const e: AntiCheatLogEntry = { tick, clientId: s.clientId, playerId: this.playerOf(s), kind: "action", detail: `${kind} -> ${t.action}`, score: a.score, action: t.action };
      this.push(e);
      if (t.action === "flag") a.flagged = true;
      this.cfg.onAction?.(e, s);
      if (t.action === "kick") this.server.kick(s.clientId);
    });
  }
  private movement(): void {
    const w = this.server.world; const dt = 1 / this.server.tickHz;
    const maxStep = (this.cfg.maxSpeed ?? 8) * dt * (1 + (this.cfg.speedTolerance ?? 0.25));
    const tele = this.cfg.teleportDistance ?? 4;
    const live = new Set<Entity>();
    for (const s of this.server.connected()) for (const e of this.server.ownedEntities(s.clientId)) {
      if (!w.isAlive(e) || !w.has(e, Transform)) continue;
      live.add(e);
      const t = w.get(e, Transform)!; const p = this.last.get(e);
      this.last.set(e, { x: t.x, y: t.y, tick: w.tick });
      if (!p) continue;
      const ticks = Math.max(1, w.tick - p.tick); const d = Math.hypot(t.x - p.x, t.y - p.y);
      const ov = this.cfg.maxSpeedFor?.(e);
      if (d <= (ov === undefined ? maxStep : ov * dt * (1 + (this.cfg.speedTolerance ?? 0.25))) * ticks) continue;
      if (this.cfg.allowTeleport?.(e)) continue;
      this.record(s, d > tele * ticks ? "teleport" : "speed", `${d.toFixed(2)} tiles in ${ticks} tick(s)`);
    }
    for (const e of [...this.last.keys()]) if (!live.has(e)) this.last.delete(e);
  }
  private onReport(s: ClientSession, r: BitReader): void {
    const target = r.readVarUint(); const reason = r.readBits(8) as ReportReason; const mt = r.readVarUint();
    if (!this.st(s.clientId).reports.take()) { this.record(s, "reportRateLimited"); return; }
    if (reason < 1 || reason > 4) { this.record(s, "malformed", "report reason"); return; }
    const rep: PlayerReport = { tick: this.server.world.tick, reporterClientId: s.clientId, reporterPlayerId: this.playerOf(s), targetPlayerId: target, reason, ...(mt > 0 && { messageTick: mt - 1 }) };
    this.reports.push(rep); if (this.reports.length > 1000) this.reports.shift();
    this.push({ tick: rep.tick, clientId: s.clientId, playerId: rep.reporterPlayerId, kind: "report", detail: `player ${target}`, score: this.score(s.clientId), target, reason, ...(rep.messageTick !== undefined && { messageTick: rep.messageTick }) });
    this.cfg.onReport?.(rep);
  }
  forget(clientId: number): void { this.s.delete(clientId); }
}

/** Client: report a player (reliable; server rate-limits to ~3/min). */
export function encodeReport(targetPlayerId: number, reason: ReportReason, messageTick?: number): Uint8Array {
  const w = new BitWriter(); writeHeader(w, MsgType.Report); w.writeVarUint(targetPlayerId); w.writeBits(reason, 8); w.writeVarUint(messageTick === undefined ? 0 : messageTick + 1);
  return w.finish();
}
