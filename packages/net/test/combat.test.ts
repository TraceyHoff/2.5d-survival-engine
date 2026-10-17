import { describe, expect, it } from "vitest";
import { Owner, Transform, type Entity } from "@engine/core";
import { FireRateGuard, LoopbackNetwork, NetClient, NetServer, NO_ENTITY, defineCommand, rewindTickFor, validateHit, type HitResult } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

const Attack = defineCommand("Attack", { target: "u32", aimX: "f32", aimY: "f32" }, { entityFields: ["target"], rate: { perSec: 20, burst: 20 } });

describe("combat validation helpers", () => {
  it("laggy attacker hits a moving target via rewind; over-reach, cone and fire-rate are rejected", async () => {
    const net = new LoopbackNetwork(21); const sw = makeWorld(); let attacker = 0 as Entity;
    const server = new NetServer({ world: sw, transport: net.createServer(), commands: [Attack], interest: false,
      onClientJoin: (s, w) => { attacker = w.create(); w.add(attacker, Transform, { x: 0, y: 0 }).add(attacker, Owner, { clientId: s.clientId }); } });
    const target = sw.create(); sw.add(target, Transform, { x: -30, y: 0.3 });
    sw.addSystem("simulation", "walk", (w) => { const x = w.getField(target, Transform, "x")!; w.setField(target, Transform, "x", x + 0.5); }); // 10 tiles/s
    const guard = new FireRateGuard(server);
    const results: (HitResult & { naive: number; fire: boolean })[] = [];
    server.onCommand(Attack, (s, p, w) => {
      const fire = guard.tryUse(s, "melee", 10);
      if (p.target === NO_ENTITY) return;
      const r = validateHit(server, s, attacker, p.target, { reach: 1.0, coneDeg: 90, aim: { x: p.aimX, y: p.aimY } });
      const t = w.get(p.target, Transform)!; results.push({ ...r, naive: Math.hypot(t.x, t.y - 0), fire });
    });
    const A = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 100, jitterMs: 10 }), interpDelayTicks: 3, commands: [Attack] });
    await join(net, A);
    const step = (n = 1) => frames(net, [sw, A.world], n);
    for (let i = 0; i < 40 && A.entityOf(server.netIds.netIdOf(target) ?? -1) === undefined; i++) step();
    const tOnA = () => A.world.get(A.entityOf(server.netIds.netIdOf(target)!)!, Transform)!;
    let sent = false; let seenX = 0;
    for (let i = 0; i < 80 && !sent; i++) { step(); const t = tOnA(); if (Math.abs(t.x) <= 0.5) { seenX = t.x; A.sendCommand(Attack, { target: A.entityOf(server.netIds.netIdOf(target)!)!, aimX: t.x, aimY: t.y }); sent = true; } }
    step(4);
    const hit = results[0]!;
    expect(hit.ok).toBe(true);
    expect(hit.naive).toBeGreaterThan(1.25); // without rewind the target is already out of reach
    expect(hit.ok && Math.abs(hit.targetPos.x - seenX)).toBeLessThan(0.6); // rewound to what the attacker saw
    const s = server.sessions.get(1)!;
    expect(sw.tick - rewindTickFor(server, s)).toBeLessThanOrEqual(4); // capped at 200 ms
    // over-reach: target is ~3-4 tiles away on the client
    for (let i = 0; i < 40; i++) { step(); const t = tOnA(); if (t.x >= 4) { A.sendCommand(Attack, { target: A.entityOf(server.netIds.netIdOf(target)!)!, aimX: t.x, aimY: t.y }); break; } }
    step(4);
    const far = results[1]!; expect(far.ok).toBe(false); expect(far.ok ? "" : far.reason).toBe("reach");
    // cone: target behind the aim direction
    sw.setField(target, Transform, "x", 1); step(30);
    sw.removeSystem("walk");
    A.sendCommand(Attack, { target: A.entityOf(server.netIds.netIdOf(target)!)!, aimX: -1, aimY: 0 }); step(4);
    const cone = results.at(-1)!; expect(cone.ok ? "" : cone.reason).toMatch(/cone|reach/);
    // fire rate: two attacks one tick apart
    A.sendCommand(Attack, { target: NO_ENTITY, aimX: 1, aimY: 0 }); step(1); A.sendCommand(Attack, { target: NO_ENTITY, aimX: 1, aimY: 0 }); step(4);
    expect(guard.violations.get(1)).toBeGreaterThan(0);
  });
});
