import { describe, expect, it } from "vitest";
import { LoopbackNetwork } from "../src/index.js";

describe("LoopbackNetwork conditioner", () => {
  it("delivers after latency, keeps reliable order under jitter, drops only unreliable", async () => {
    const net = new LoopbackNetwork(42); const server = net.createServer();
    const got: number[] = []; const unrel: number[] = [];
    server.onMessage((_c, b, ch) => (ch === "reliable" ? got : unrel).push(b[0]!));
    const c = net.createClient({ latencyMs: 50, jitterMs: 40, loss: 0.5 }); await c.connect();
    for (let i = 0; i < 100; i++) { c.send(new Uint8Array([i]), "reliable"); c.send(new Uint8Array([i]), "unreliable"); }
    net.advance(49); expect(got.length).toBe(0);
    net.advance(100);
    expect(got).toEqual([...Array(100).keys()]);
    expect(unrel.length).toBeGreaterThan(20); expect(unrel.length).toBeLessThan(80);
    expect(net.stats.dropped).toBe(100 - unrel.length);
  });
  it("server send reaches the right client; close fires disconnect", async () => {
    const net = new LoopbackNetwork(); const server = net.createServer();
    const conns: number[] = []; const gone: number[] = [];
    server.onConnect((c) => conns.push(c)); server.onDisconnect((c) => gone.push(c));
    const a = net.createClient(), b = net.createClient(); await a.connect(); await b.connect();
    const ra: number[] = [], rb: number[] = [];
    a.onMessage((x) => ra.push(x[0]!)); b.onMessage((x) => rb.push(x[0]!));
    server.send(conns[1]!, new Uint8Array([7]), "unreliable"); net.advance(1);
    expect(ra).toEqual([]); expect(rb).toEqual([7]);
    a.close(); expect(gone).toEqual([conns[0]]); expect(a.connected).toBe(false);
  });
});
