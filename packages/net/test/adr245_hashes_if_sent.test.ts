import { describe, expect, it } from "vitest";
import { BitReader, LoopbackNetwork, MsgType, NetClient, NetRejectedError, NetServer, RejectReason, encodeHello, readHeader } from "../src/index.js";
import { join, makeWorld } from "./fixture.js";

/** ADR-245: the cosmetics catalog hash is checked only when the client sends one (art-less debug clients / bots still join). */
describe("NetServer hashesIfSent (ADR-245 cosmetics handshake)", () => {
  const setup = () => { const net = new LoopbackNetwork(3); const server = new NetServer({ world: makeWorld(), transport: net.createServer(), hashesIfSent: { cosmetics: 0xabc123 } }); return { net, server }; };
  it("mismatched cosmetics -> HashMismatch; absent or matching -> accepted", async () => {
    const { net, server } = setup();
    const raw = net.createClient(); await raw.connect(); const replies: number[][] = [];
    raw.onMessage((b) => { const r = new BitReader(b); const h = readHeader(r); replies.push([h.type, h.type === MsgType.Reject ? r.readBits(8) : -1]); });
    const ok = server.requiredHashes; expect(ok.cosmetics).toBeUndefined(); expect(server.offeredHashes.cosmetics).toBe(0xabc123);
    raw.send(encodeHello({ hashes: { ...ok, cosmetics: 0xabc124 }, token: new Uint8Array(16) }), "reliable");
    net.advance(1);
    expect(replies).toEqual([[MsgType.Reject, RejectReason.HashMismatch]]); expect(server.sessions.size).toBe(0);
    await join(net, new NetClient({ world: makeWorld(), transport: net.createClient() })); // no cosmetics hash sent
    await join(net, new NetClient({ world: makeWorld(), transport: net.createClient(), hashes: { cosmetics: 0xabc123 } }));
    expect(server.sessions.size).toBe(2);
    await expect(join(net, new NetClient({ world: makeWorld(), transport: net.createClient(), hashes: { cosmetics: 1 } }))).rejects.toBeInstanceOf(NetRejectedError);
    expect(server.sessions.size).toBe(2);
  });
});
