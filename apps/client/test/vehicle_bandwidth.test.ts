/**
 * P2P vehicle bandwidth (ADR-102): mobile host config (cap 6 = host + 5 guests, RTC unreliable sends dropped above
 * 64 KiB bufferedAmount) with 8 fast vehicles towing 8 trailers. Measures the snapshot bytes each guest receives and
 * asserts the stated budget (VEHICLE_P2P_BUDGET).
 */
import { describe, it, expect } from "vitest";
import { NetId, Transform, type Entity, type World } from "@engine/core";
import { FakeRtcNetwork, type FakeLinkOptions, type RtcPeerLink } from "@engine/net";
import { MemoryWorldStore } from "@engine/persist";
import { Driver, hitchVehicles, setDriveInput, setVehicleBlocker, spawnVehicle, VehicleSeats } from "@engine/gameplay";
import { ClientSession, type KeyValue } from "../src/session.js";
import { startP2PHost, guestTransport, type P2PHost } from "../src/host.js";
import { MOBILE_PLAYER_CAP, SignalingError, type Signaling, type SignalingRoom } from "../src/p2p.js";

/** Stated budget per guest (20 Hz snapshots). Measured (seeded): unthrottled mean 846 B (677 kbit/s host uplink); with P2P_DISTANT_THROTTLE mean 353 B, p95 719, max 897 (282 kbit/s). Max stays far below the 64 KiB RTC unreliable drop limit. */
export const VEHICLE_P2P_BUDGET = { meanBytesPerTick: 600, p95BytesPerTick: 1000, maxBytesPerTick: 2048, hostUplinkKbps: 400 };

class MapStorage implements KeyValue { m = new Map<string, string>(); getItem(k: string): string | null { return this.m.get(k) ?? null; } setItem(k: string, v: string): void { this.m.set(k, v); } }
class FakeSignaling implements Signaling {
  rooms = new Map<string, (l: RtcPeerLink) => void>();
  constructor(readonly net: FakeRtcNetwork, readonly link: FakeLinkOptions = {}) {}
  host(code: string): Promise<SignalingRoom> {
    if (this.rooms.has(code)) return Promise.reject(new SignalingError("taken", "taken"));
    const fns: ((l: RtcPeerLink) => void)[] = []; this.rooms.set(code, (l) => { for (const f of fns) f(l); });
    return Promise.resolve({ code, onPeer: (f) => fns.push(f), onError: () => {}, close: () => this.rooms.delete(code) });
  }
  join(code: string): Promise<RtcPeerLink> {
    const r = this.rooms.get(code); if (!r) return Promise.reject(new SignalingError("not-found", "nope"));
    const [guest, host] = this.net.link(this.link); r(host); return Promise.resolve(guest);
  }
}
interface Rig { net: FakeRtcNetwork; sig: FakeSignaling; host: P2PHost; sessions: ClientSession[] }
async function tick(r: Rig, onTick?: () => void): Promise<void> {
  r.net.flush(); onTick?.(); r.host.local.pump(50); r.net.flush();
  for (const s of r.sessions) { s.world?.step(1 / 20); s.poll(); }
  await Promise.resolve(); await Promise.resolve();
}
async function until<T>(r: Rig, p: Promise<T>): Promise<T> {
  let done = false, val: T | undefined, err: unknown; p.then((v) => { done = true; val = v; }, (e: unknown) => { done = true; err = e; });
  for (let t = 0; t < 3000 && !done; t += 50) await tick(r);
  if (err) throw err; if (!done) throw new Error("timeout"); return val as T;
}

async function measure(fleet: number, ticks: number): Promise<{ mean: number; p95: number; max: number; samples: number; throttled: number }> {
  const net = new FakeRtcNetwork(3); const sig = new FakeSignaling(net, { loss: 0.02, reorder: 0.05 });
  let x = 7; const random = (): number => ((x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const host = await startP2PHost({ signaling: sig, store: new MemoryWorldStore(), seed: 9, cap: MOBILE_PLAYER_CAP, population: false, random });
  const r: Rig = { net, sig, host, sessions: [] };
  const mk = (slot: string): ClientSession => { const s = new ClientSession({ storage: new MapStorage(), slot, sampleButtons: () => 0 }); r.sessions.push(s); return s; };
  const hs = mk("h"); await until(r, hs.connect("p2p-host", "Host", host.hostTransport)); host.hostClientId = hs.client!.clientId;
  for (let i = 0; i < MOBILE_PLAYER_CAP - 1; i++) { const s = mk(`g${i}`); await until(r, s.connect(`p2p:${host.code}`, `G${i}`, guestTransport(sig, host.code))); }
  const gs = host.local.game; const w: World = gs.world;
  setVehicleBlocker(w, () => false);
  // ring centre = the host player's spawn point (ADR-106: joins spread over 4 far-apart spawn points)
  const hp = w.get([...gs.players.values()].find((p) => p.entity !== undefined)!.entity, Transform)!; const CX = hp.x, CY = hp.y;
  // fleet: cars + trucks on rings 6..60 tiles around the host's spawn, each towing a trailer, driven by an NPC rider at full boost
  const drivers: Entity[] = [];
  for (let i = 0; i < fleet; i++) {
    const a = (i / fleet) * Math.PI * 2, rad = 6 + (i * 54) / Math.max(1, fleet - 1);
    const v = spawnVehicle(w, i % 2 ? "truck_pickup" : "car_offroad", CX + Math.cos(a) * rad, CY + Math.sin(a) * rad, a + Math.PI / 2); gs.net.netIds.assign(v);
    const t = spawnVehicle(w, "trailer_utility_small", CX + Math.cos(a) * rad - 4, CY + Math.sin(a) * rad, a + Math.PI / 2); gs.net.netIds.assign(t);
    const d = w.create(); w.add(d, Transform, { x: CX + Math.cos(a) * rad, y: CY + Math.sin(a) * rad }); gs.net.netIds.assign(d);
    w.add(d, Driver, { vehicleNetId: w.getField(v, NetId, "id")!, seat: 0 });
    const occ = Array.from(w.get(v, VehicleSeats)!.occupant as ArrayLike<number>); occ[0] = w.getField(d, NetId, "id")!; w.set(v, VehicleSeats, { occupant: occ });
    w.set(t, Transform, { x: 0, y: 0 }); // snap next to the tow's pin for hitching
    const tt = w.get(v, Transform)!; w.set(t, Transform, { x: tt.x - Math.cos(tt.facing) * 4.25, y: tt.y - Math.sin(tt.facing) * 4.25, facing: tt.facing });
    expect(hitchVehicles(w, d, t, v)).toBeUndefined();
    drivers.push(d);
  }
  const steer = (): void => { let k = 0; for (const d of drivers) { const h = (w.tick * 0.02 + k++); setDriveInput(w, d, Math.cos(h), Math.sin(h), true); } };
  for (let i = 0; i < 40; i++) await tick(r, steer); // warm up: spawns + full snapshots
  const guestIds = new Set(r.sessions.slice(1).map((s) => s.client!.clientId));
  const samples: number[] = []; let throttled0 = 0;
  for (const s of gs.net.connected()) if (guestIds.has(s.clientId)) throttled0 += s.stats.throttled;
  for (let i = 0; i < ticks; i++) {
    await tick(r, steer);
    for (const s of gs.net.connected()) if (guestIds.has(s.clientId)) samples.push(s.lastSnapshotBytes);
  }
  let throttled = -throttled0; for (const s of gs.net.connected()) if (guestIds.has(s.clientId)) throttled += s.stats.throttled;
  for (const s of r.sessions) s.disconnect(); await host.leave();
  samples.sort((a, b) => a - b);
  return { mean: samples.reduce((a, b) => a + b, 0) / samples.length, p95: samples[Math.floor(samples.length * 0.95)]!, max: samples[samples.length - 1]!, samples: samples.length, throttled };
}

describe("P2P vehicle bandwidth (mobile host, cap 6)", () => {
  it("8 fast vehicles + 8 trailers stay inside the per-guest snapshot budget", async () => {
    const m = await measure(8, 200);
    const kbpsHost = (m.mean * 20 * 8 * (MOBILE_PLAYER_CAP - 1)) / 1000;
    console.log(JSON.stringify({ ...m, mean: +m.mean.toFixed(1), hostUplinkKbps: +kbpsHost.toFixed(1), budget: VEHICLE_P2P_BUDGET }));
    expect(m.throttled).toBeGreaterThan(0);
    expect(m.samples).toBe(200 * (MOBILE_PLAYER_CAP - 1));
    expect(m.mean).toBeLessThanOrEqual(VEHICLE_P2P_BUDGET.meanBytesPerTick);
    expect(m.p95).toBeLessThanOrEqual(VEHICLE_P2P_BUDGET.p95BytesPerTick);
    expect(m.max).toBeLessThanOrEqual(VEHICLE_P2P_BUDGET.maxBytesPerTick);
    expect(kbpsHost).toBeLessThanOrEqual(VEHICLE_P2P_BUDGET.hostUplinkKbps);
  }, 60_000);
});
