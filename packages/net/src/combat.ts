/**
 * Combat validation helpers (net owns the plumbing; damage/rules are gameplay's).
 * validateHit rewinds the target to what the attacker saw (session.lastViewTick, capped at maxRewindMs) using
 * server.positions, then checks reach (+slack) and an optional aim cone. FireRateGuard enforces per-session,
 * per-action minimum intervals and reports violations as anomalies.
 */
import { Transform, type Entity } from "@engine/core";
import type { ClientSession, NetServer } from "./server.js";

export interface HitCheck {
  /** Max reach in tiles (attacker centre to target centre). */
  reach: number;
  /** Optional cone: full angle in degrees around `aim` (attacker's aim vector, e.g. from InputCmd aimX/aimY). */
  coneDeg?: number;
  aim?: { x: number; y: number };
  /** Rewind cap (default 200 ms). */
  maxRewindMs?: number;
  /** Tolerance in tiles (quantization, float error; default 0.25). */
  slack?: number;
  /** Attacker's position source: "current" (server now, default) or "rewound" (also rewind the attacker). */
  attackerAt?: "current" | "rewound";
}
export type HitResult =
  | { ok: true; rewindTick: number; distance: number; targetPos: { x: number; y: number } }
  | { ok: false; reason: "noAttacker" | "noTarget" | "reach" | "cone"; rewindTick: number; distance?: number };

/** The tick the server rewinds to for this session: lastViewTick, clamped to [now - maxRewind, now]. */
export function rewindTickFor(server: NetServer, session: ClientSession, maxRewindMs = 200): number {
  const now = server.world.tick; const maxTicks = (maxRewindMs / 1000) * server.tickHz;
  const view = session.lastViewTick < 0 ? now : session.lastViewTick;
  return Math.max(now - maxTicks, Math.min(now, view));
}

export function validateHit(server: NetServer, session: ClientSession, attacker: Entity, target: Entity, o: HitCheck): HitResult {
  const w = server.world; const tick = rewindTickFor(server, session, o.maxRewindMs ?? 200);
  const ta = o.attackerAt === "rewound" ? server.positions.getPositionAt(attacker, tick) : (w.isAlive(attacker) ? w.get(attacker, Transform) : undefined);
  if (!ta) return { ok: false, reason: "noAttacker", rewindTick: tick };
  const tp = server.positions.getPositionAt(target, tick);
  if (!tp) return { ok: false, reason: "noTarget", rewindTick: tick };
  const dx = tp.x - ta.x, dy = tp.y - ta.y; const d = Math.hypot(dx, dy);
  if (d > o.reach + (o.slack ?? 0.25)) return { ok: false, reason: "reach", rewindTick: tick, distance: d };
  if (o.coneDeg !== undefined && o.aim && d > 1e-6) {
    const al = Math.hypot(o.aim.x, o.aim.y);
    if (al > 1e-6) {
      const cos = (dx * o.aim.x + dy * o.aim.y) / (d * al);
      // widen by the target's angular size at this distance (slack as radius)
      const half = (o.coneDeg / 2) * Math.PI / 180 + Math.atan2(o.slack ?? 0.25, d);
      if (cos < Math.cos(Math.min(Math.PI, half))) return { ok: false, reason: "cone", rewindTick: tick, distance: d };
    }
  }
  return { ok: true, rewindTick: tick, distance: d, targetPos: { x: tp.x, y: tp.y } };
}

/** Per-session, per-action fire-rate / cooldown guard. */
export class FireRateGuard {
  private last = new Map<string, number>();
  /** Violations per session (also reported as "fireRate" anomalies when a server is given). */
  readonly violations = new Map<number, number>();
  constructor(private readonly server?: NetServer, readonly toleranceTicks = 1) {}
  /**
   * True (and records the use) if `action` is allowed now: at least `minIntervalTicks` since the last allowed use,
   * minus `toleranceTicks` (input jitter). False = too soon (not recorded).
   */
  tryUse(session: ClientSession, action: string | number, minIntervalTicks: number, tick = this.server?.world.tick ?? 0): boolean {
    const k = `${session.clientId}:${action}`; const prev = this.last.get(k);
    if (prev !== undefined && tick - prev < minIntervalTicks - this.toleranceTicks) {
      this.violations.set(session.clientId, (this.violations.get(session.clientId) ?? 0) + 1);
      this.server?.anomaly(session, "fireRate", String(action));
      return false;
    }
    this.last.set(k, tick); return true;
  }
  forget(clientId: number): void { for (const k of [...this.last.keys()]) if (k.startsWith(`${clientId}:`)) this.last.delete(k); this.violations.delete(clientId); }
}
