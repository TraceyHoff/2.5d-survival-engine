import { describe, expect, it } from "vitest";
import { PlayerNameRegistry } from "@engine/core";
import { LoopbackNetwork, NameSync, NetClient, NetServer } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

describe("player name table", () => {
  it("on demand once per id, cached, renames pushed only to clients that cache the id; log overrun resyncs", async () => {
    const net = new LoopbackNetwork(41); const sw = makeWorld(); const reg = new PlayerNameRegistry(8);
    reg.set(7, "Ásta Smith"); reg.set(9, "Bo"); reg.set(12, "鍛冶屋");
    const server = new NetServer({ world: sw, transport: net.createServer(), interest: false });
    const sync = new NameSync(server, { names: reg });
    const A = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 30, loss: 0.1 }) });
    const B = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 30, loss: 0.1 }) });
    await join(net, A); await join(net, B);
    const step = (k: number) => frames(net, [sw, A.world, B.world], k);
    step(2);
    expect(A.names.get(7)).toBeUndefined(); expect(A.names.display(7)).toBe("#7");
    A.names.get(7); A.names.want([12, 99, 7]); B.names.get(9);
    await Promise.resolve(); step(10);
    expect(A.names.get(7)).toBe("Ásta Smith"); expect(A.names.get(12)).toBe("鍛冶屋"); expect(A.names.has(99)).toBe(true); expect(A.names.get(99)).toBeUndefined();
    const sentOnce = sync.stats.sent; expect(sentOnce).toBe(4); // 7, 12, 99 to A; 9 to B
    A.names.get(7); await Promise.resolve(); step(4); expect(sync.stats.sent).toBe(sentOnce); // cached: no re-request
    const seen: [number, string | null][] = []; A.names.on((id, n) => seen.push([id, n])); const bSeen: number[] = []; B.names.on((id) => bSeen.push(id));
    reg.set(7, "Ásta the Smith"); reg.set(99, "Newcomer"); step(10);
    expect(A.names.get(7)).toBe("Ásta the Smith"); expect(A.names.get(99)).toBe("Newcomer");
    expect(seen).toEqual([[7, "Ásta the Smith"], [99, "Newcomer"]]); expect(bSeen).toEqual([]); // B never cached 7 / 99
    for (let i = 0; i < 20; i++) reg.set(100 + i, `x${i}`); reg.set(9, "Bo II"); step(10); // overrun the 8-entry log in one tick
    expect(sync.stats.resyncs).toBe(1); expect(B.names.get(9)).toBe("Bo II"); expect(A.names.get(7)).toBe("Ásta the Smith");
  });
});
