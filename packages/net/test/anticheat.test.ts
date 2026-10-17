import { describe, expect, it } from "vitest";
import { Owner, Transform, type Entity } from "@engine/core";
import { AntiCheat, LoopbackNetwork, NetClient, NetServer, ReportReason, defineCommand, type AntiCheatLogEntry, type PlayerReport } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

const Poke = defineCommand("Poke", { n: "u8" }, { rate: { perSec: 2, burst: 2 } });

async function setup(cfg: ConstructorParameters<typeof AntiCheat>[1] = {}) {
  const net = new LoopbackNetwork(5); const sw = makeWorld(); const ents = new Map<number, Entity>();
  const server = new NetServer({ world: sw, transport: net.createServer(), commands: [Poke], interest: false,
    onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: 0, y: 0 }).add(e, Owner, { clientId: s.clientId }); ents.set(s.clientId, e); } });
  const actions: AntiCheatLogEntry[] = []; const reports: PlayerReport[] = [];
  const ac = new AntiCheat(server, { maxSpeed: 5, teleportDistance: 3, onAction: (e) => actions.push(e), onReport: (r) => reports.push(r), ...cfg });
  const A = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 40 }), commands: [Poke] });
  await join(net, A);
  const step = (n = 1) => frames(net, [sw, A.world], n);
  step(3);
  return { net, sw, server, ac, A, step, ents, actions, reports };
}

describe("anti-cheat", () => {
  it("movement: tolerates max speed, flags over-speed and teleports, honours allowTeleport", async () => {
    let allow = false;
    const x = await setup({ allowTeleport: () => allow });
    const e = x.ents.get(1)!; const mv = (dx: number) => x.sw.setField(e, Transform, "x", x.sw.getField(e, Transform, "x")! + dx);
    x.sw.addSystem("simulation", "mover", () => mv(speed)); let speed = 0.25; // 5 tiles/s = max
    x.step(20); expect(x.ac.counters(1).get("speed") ?? 0).toBe(0);
    speed = 0.5; x.step(5); expect(x.ac.counters(1).get("speed")).toBeGreaterThanOrEqual(4);
    speed = 0; x.step(1); mv(50); x.step(1); expect(x.ac.counters(1).get("teleport")).toBe(1);
    allow = true; mv(50); x.step(1); expect(x.ac.counters(1).get("teleport")).toBe(1);
    const entry = x.ac.log.find((l) => l.kind === "teleport")!;
    expect(entry).toMatchObject({ clientId: 1, playerId: 1, kind: "teleport" }); expect(entry.score).toBeGreaterThan(0);
  });

  it("command anomalies raise the score; thresholds fire log/flag/kick once; score decays", async () => {
    const x = await setup({ thresholds: [{ score: 3, action: "log" }, { score: 6, action: "flag" }, { score: 12, action: "kick" }], decayPerSec: 1 });
    for (let i = 0; i < 8; i++) x.A.sendCommand(Poke, { n: i }); // burst 2 -> 6 rate-limited
    x.step(3);
    expect(x.ac.counters(1).get("rateLimited")).toBe(6);
    expect(x.actions.map((a) => a.action)).toEqual(["log", "flag"]); expect(x.ac.isFlagged(1)).toBe(true);
    const s6 = x.ac.score(1); x.step(20); expect(x.ac.score(1)).toBeCloseTo(s6 - 1, 5);
    x.server.anomaly(x.server.sessions.get(1)!, "malformed"); x.server.anomaly(x.server.sessions.get(1)!, "malformed"); x.step(2);
    expect(x.actions.at(-1)!.action).toBe("kick");
    expect(x.server.sessions.get(1)).toBeUndefined();
  });

  it("player reports are rate limited (~3/min), logged structurally and hooked", async () => {
    const x = await setup();
    for (let i = 0; i < 5; i++) x.A.reportPlayer(7, ReportReason.Spam, 100 + i);
    x.A.reportPlayer(8, ReportReason.Cheating); x.step(3);
    expect(x.reports.length).toBe(3);
    expect(x.reports[0]).toMatchObject({ reporterClientId: 1, targetPlayerId: 7, reason: ReportReason.Spam, messageTick: 100 });
    expect(x.ac.log.filter((l) => l.kind === "report").length).toBe(3);
    expect(x.ac.counters(1).get("reportRateLimited")).toBe(3);
    x.step(20 * 21); x.A.reportPlayer(8, ReportReason.Cheating); x.step(3);
    expect(x.reports.at(-1)).toMatchObject({ targetPlayerId: 8, reason: ReportReason.Cheating }); expect(x.reports.at(-1)!.messageTick).toBeUndefined();
  });
});

describe("session plumbing for persistence", () => {
  it("RTT on session and client; resume from a stored token; forget a session inside onClientLeave", async () => {
    const net = new LoopbackNetwork(6); const sw = makeWorld(); const left: number[] = [];
    let forget = false;
    const known = new Set<string>(["7".repeat(32)]);
    const server = new NetServer({ world: sw, transport: net.createServer(), interest: false, pingIntervalMs: 500,
      resumeToken: (t) => known.has([...t].map((b) => b.toString(16).padStart(2, "0")).join("")),
      onClientLeave: (s) => { left.push(s.clientId); if (forget) server.kick(s.clientId); } });
    const A = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 40 }) });
    await join(net, A); frames(net, [sw, A.world], 60);
    const s = server.sessions.get(1)!;
    expect(s.rttMs).toBeGreaterThan(70); expect(s.rttMs).toBeLessThan(120); expect(A.rttMs).toBeGreaterThan(70);
    // stored token from "before the restart"
    const stored = new Uint8Array(16).fill(0x77);
    const B = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 10 }) });
    const wb = await join(net, B, stored);
    expect(server.sessions.get(wb.clientId)!.resumed).toBe(true); expect([...wb.token]).toEqual([...stored]);
    const C = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 10 }) });
    await expect(join(net, C, new Uint8Array(16).fill(0x55))).rejects.toThrow();
    forget = true; A.close(); frames(net, [sw], 3);
    expect(left).toContain(1); expect(server.sessions.get(1)).toBeUndefined();
  });
});
