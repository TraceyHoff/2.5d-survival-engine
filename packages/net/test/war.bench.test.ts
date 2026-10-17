/**
 * Large-group benchmarks: 50v50 clan war (rosters, clan markers, party-scoped component, hit events) and a
 * 100-player brawl with an event per player per tick. Server-only with fake sessions auto-acking 3 ticks late.
 * Strict timing ceilings only with PERF=1; otherwise loose sanity bounds.
 */
import { describe, expect, it } from "vitest";
import { defineComponent, Owner, Rng, Transform, type Entity } from "@engine/core";
import { GroupRegistry } from "@engine/core";
import { GroupKind, GroupReplicator, GroupRole, NetServer, defineNetEvent, encodeHello, encodeInput, type Channel, type ConnId, type ServerTransport } from "../src/index.js";
import { DT, makeWorld } from "./fixture.js";

const PERF = process.env["PERF"] === "1";
const Hp = defineComponent("Hp", { hp: { type: "f32", quant: { bits: 10, min: 0, max: 1000 } } }, { networked: true });
const PartyInfo = defineComponent("PartyInfo", { stamina: "u8" }, { networked: true });
const Hit = defineNetEvent("Hit", { attacker: "u32", target: "u32", damage: "u16" }, { entityFields: ["attacker", "target"] });

class FakeTransport implements ServerTransport {
  bytes = new Map<ConnId, number>(); events = 0;
  private msg: ((c: ConnId, b: Uint8Array, ch: Channel) => void)[] = [];
  onConnect(): void {} onDisconnect(): void {}
  onMessage(fn: (c: ConnId, b: Uint8Array, ch: Channel) => void): void { this.msg.push(fn); }
  send(c: ConnId, b: Uint8Array): void { this.bytes.set(c, (this.bytes.get(c) ?? 0) + b.length); }
  disconnect(): void {} close(): void {}
  inject(c: ConnId, b: Uint8Array): void { for (const f of this.msg) f(c, b, "reliable"); }
}

function run(name: string, o: { players: number; area: number; props: number; hitsPerTick: number; clans: boolean }) {
  const w = makeWorld(); w.register(Hp); w.register(PartyInfo); const rng = new Rng(5); const t = new FakeTransport();
  const players: Entity[] = [];
  const server = new NetServer({ world: w, transport: t, events: [Hit], budgetBytes: 8192, randomToken: () => new Uint8Array(16).fill(1 + (players.length % 200)),
    onClientJoin: (s, world) => { const e = world.create(); world.add(e, Transform, { x: rng.range(0, o.area), y: rng.range(0, o.area) }).add(e, Owner, { clientId: s.clientId }).add(e, Hp, { hp: 100 }).add(e, PartyInfo, { stamina: 50 }); players.push(e); } });
  server.setScope(PartyInfo, "party");
  const groups = new GroupRegistry();
  let rep: GroupReplicator | undefined;
  if (o.clans) {
    rep = new GroupReplicator(server, { groups, markerHealth: (e) => w.getField(e, Hp, "hp") });
    const red = groups.create(GroupKind.Clan).id, blue = groups.create(GroupKind.Clan).id;
    for (let p = 1; p <= o.players; p++) groups.setRole(p <= o.players / 2 ? red : blue, p, p === 1 || p === o.players / 2 + 1 ? GroupRole.Leader : GroupRole.Member);
    for (let p = 1; p <= o.players; p += 5) { const party = groups.create(GroupKind.Party).id; for (let q = p; q < p + 5 && q <= o.players; q++) groups.setRole(party, q, GroupRole.Member); }
  }
  for (let i = 0; i < o.props; i++) { const e = w.create(); w.add(e, Transform, { x: rng.range(0, 2048), y: rng.range(0, 2048) }); }
  for (let c = 1; c <= o.players; c++) t.inject(c, encodeHello({ hashes: server.requiredHashes, token: new Uint8Array(16) }));
  const tick = (): void => {
    for (const p of players) { w.setField(p, Transform, "x", Math.max(0, Math.min(o.area, w.getField(p, Transform, "x")! + rng.range(-0.25, 0.25)))); }
    for (let h = 0; h < o.hitsPerTick; h++) {
      const a = players[rng.int(0, players.length)]!, b = players[rng.int(0, players.length)]!;
      const hp = Math.max(0, w.getField(b, Hp, "hp")! - 1); w.setField(b, Hp, "hp", hp < 1 ? 100 : hp);
      const tb = w.get(b, Transform)!;
      server.emitEvent(Hit, { attacker: a, target: b, damage: 7 }, { reliable: false, scope: { nearby: { x: tb.x, y: tb.y } } });
    }
    w.step(DT);
    for (let c = 1; c <= o.players; c++) t.inject(c, encodeInput({ ackTick: Math.max(0, w.tick - 3), cmds: [] }));
  };
  for (let i = 0; i < 30; i++) tick();
  t.bytes.clear(); if (rep) { rep.stats.markerBytes = 0; rep.stats.rosterBytes = 0; }
  const N = 40; const t0 = performance.now();
  for (let i = 0; i < N; i++) tick();
  const ms = (performance.now() - t0) / N;
  const total = [...t.bytes.values()].reduce((a, b) => a + b, 0);
  const r = { scenario: name, msPerTick: +ms.toFixed(2), bytesPerClientTick: Math.round(total / o.players / N), kbpsPerClient: +((total / o.players / N) * 20 * 8 / 1000).toFixed(1),
    markerBytesPerClientTick: rep ? +(rep.stats.markerBytes / o.players / N).toFixed(1) : 0, hitsPerTick: o.hitsPerTick };
  console.log(JSON.stringify(r));
  return r;
}

describe("large-group benchmarks", () => {
  it("50v50 clan war in a 256x256 area: rosters, clan markers, party-scoped component, 30 hit events/tick", () => {
    const r = run("50v50 clan war (256^2, 3k props)", { players: 100, area: 256, props: 3000, hitsPerTick: 30, clans: true });
    expect(r.msPerTick).toBeLessThan(PERF ? 30 : 500);
    expect(r.bytesPerClientTick).toBeLessThan(PERF ? 2500 : 8192 + 2048);
  }, 120_000);
  it("100 players fighting in one 64x64 area, one hit event per player per tick (batched per tick per client)", () => {
    const r = run("100p brawl (64^2, 100 hits/tick)", { players: 100, area: 64, props: 0, hitsPerTick: 100, clans: false });
    expect(r.msPerTick).toBeLessThan(PERF ? 40 : 500);
    expect(r.bytesPerClientTick).toBeLessThan(PERF ? 3000 : 8192 + 4096);
  }, 120_000);
});
