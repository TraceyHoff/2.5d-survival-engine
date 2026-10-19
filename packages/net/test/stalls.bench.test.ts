/**
 * Market bench: 200 stalls x 24 listings in a 64x64-tile market, 100 browsing players each with one stall open,
 * switching stalls every 2 s (each switch = a full Listings snapshot), 10 price edits + 4 purchases per tick.
 * Reports wall ms/tick (server + 100 in-process clients), server capture+send ms, and bytes/client/tick. Strict ceilings only with PERF=1.
 */
import { describe, expect, it } from "vitest";
import { Transform, entityIndex } from "@engine/core";
import { StallResult } from "../src/index.js";
import { COIN, Listings, stallRig } from "./stall-fixture.js";

const PERF = process.env["PERF"] === "1";
describe("market bench (200 stalls, 100 browsers)", () => {
  it("ms/tick and bytes", async () => {
    const x = await stallRig({ interest: { radius: 2 } });
    for (let i = 0; i < 100; i++) await x.addClient(i + 1, 8 + (i % 10) * 5, 8 + Math.floor(i / 10) * 5);
    const stalls = Array.from({ length: 200 }, (_, i) => {
      const e = x.makeStall(4 + (i % 20) * 3, 4 + Math.floor(i / 20) * 6, 0, 1000 + i);
      for (let s = 0; s < 24; s++) { x.put(e, s, 100 + ((i * 7 + s) % 80), 1 + (s % 5), 2000 + ((i + s) % 300), s % 3 ? 0 : 50 + s); x.listItem(e, s, { itemId: COIN, count: 1 + ((i + s) % 40) }); }
      return e;
    });
    for (const [cid, e] of x.players) x.put(e, 0, COIN, 60000);
    x.step(60);
    let rng = 5; const r = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const open = new Map<number, number>();
    const browse = (cid: number) => { const prev = open.get(cid); if (prev !== undefined) x.viewers.get(stalls[prev]!)!.delete(cid); const k = Math.floor(r() * 200); open.set(cid, k); x.viewers.get(stalls[k]!)!.add(cid); };
    for (const cid of x.players.keys()) browse(cid);
    x.step(20);
    const bytes0 = [...x.server.sessions.values()].reduce((n, s) => n + s.stats.bytesSent, 0);
    const N = 100; let ms = 0; let buys = 0; let cap = 0, snd = 0;
    for (let t = 0; t < N; t++) {
      for (const cid of x.players.keys()) if ((t + cid * 3) % 40 === 0) browse(cid);
      for (let k = 0; k < 10; k++) { const e = stalls[Math.floor(r() * 200)]!; const s = Math.floor(r() * 24); x.sw.store(Listings).writeElement(entityIndex(e), "priceCount", s, 1 + Math.floor(r() * 60)); x.sw.setField(e, Listings, "revision", x.sw.getField(e, Listings, "revision")! + 1); }
      for (let k = 0; k < 4; k++) { // browsers buy from the stall they have open (net transport, real swap)
        const cid = 1 + Math.floor(r() * 100); const si = open.get(cid)!; const e = stalls[si]!; const pe = x.players.get(cid)!; const t0 = x.sw.get(e, Transform)!;
        x.sw.setField(pe, Transform, "x", t0.x); x.sw.setField(pe, Transform, "y", t0.y + 1);
        const L = x.sw.get(e, Listings)! as unknown as Record<string, number[]>; const s = L.listingId!.findIndex((id) => id);
        if (s >= 0) { void x.cs[cid - 1]!.stalls.buy(x.server.netIds.netIdOf(e)!, L.listingId![s]!, 0, { itemId: L.priceItem![s]!, count: L.priceCount![s]! }).then((res) => { if (res.reason === StallResult.Ok) buys++; }); }
      }
      const t1 = performance.now(); x.step(1); ms += performance.now() - t1; cap += x.server.perf.captureMs; snd += x.server.perf.sendMs;
    }
    x.step(10); await Promise.resolve();
    const bytes = [...x.server.sessions.values()].reduce((n, s) => n + s.stats.bytesSent, 0) - bytes0;
    const out = { stalls: 200, listingsPerStall: 24, browsers: 100, msPerTick: +(ms / N).toFixed(2), bytesPerClientTick: +(bytes / 100 / (N + 10)).toFixed(1), kbpsPerClient: +((bytes / 100 / (N + 10)) * 20 * 8 / 1000).toFixed(1), sales: x.stalls.stats.sales, buysOk: buys, serverCaptureMs: +(cap / N).toFixed(2), serverSendMs: +(snd / N).toFixed(2) };
    console.log(JSON.stringify(out));
    expect(x.stalls.stats.sales).toBeGreaterThan(150);
    expect(out.bytesPerClientTick).toBeLessThan(2000);
    if (PERF) expect(out.serverCaptureMs + out.serverSendMs).toBeLessThan(25); // msPerTick also includes 100 in-process client worlds
  }, 120_000);
});
