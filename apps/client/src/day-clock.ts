/**
 * ADR-115: the client's one day clock, shared by the renderer (view.ts) and the HUD clock.
 * Source of truth = authoritative server tick (NetClient.serverTickEstimate, seeded from Welcome.serverTick and
 * clamped to snapshot ticks) + the frame's interpolation alpha, against the replicated TimeOfDay {dayLengthTicks,
 * epochTick}. Same for dedicated servers, P2P hosts and the singleplayer Worker (all reach the sim through a
 * NetClient). The client's own world.tick is NOT used: it starts at 0 on join and differs per client.
 */
import { DayClock, DEFAULT_TICK_HZ, TimeOfDay, dayFractionAt, type World } from "@engine/core";

export interface ServerTickSource { serverTickEstimate: number }
const clock = new DayClock(2); // persists across reconnects: a new Welcome blends, never snaps
let lastMs: number | undefined; let lastT = 0.5;

/** Target fraction from the authoritative clock (pure; used by tests to compare peers). */
export function serverDayFraction(net: World, src: ServerTickSource | undefined, alpha = 0): number {
  const td = net.env(TimeOfDay); const tick = src ? src.serverTickEstimate + alpha : net.tick + alpha;
  return dayFractionAt(tick, td.epochTick, td.dayLengthTicks || 72000);
}
/** Advance the shared smoothed clock once per frame; returns the day fraction to draw. */
export function sampleDayClock(net: World, src: ServerTickSource | undefined, alpha: number, nowMs = performance.now()): number {
  const len = net.env(TimeOfDay).dayLengthTicks || 72000;
  const dt = lastMs === undefined ? 0 : (nowMs - lastMs) / 1000; lastMs = nowMs;
  return (lastT = clock.update(serverDayFraction(net, src, alpha), dt, len / DEFAULT_TICK_HZ));
}
/** Last drawn day fraction / hours (HUD reads this so its clock matches the lighting exactly). */
export const dayFraction = (): number => lastT;
export const dayHours = (): number => lastT * 24;
