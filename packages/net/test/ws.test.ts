import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Transform } from "@engine/core";
import { NetClient, NetServer, WebSocketClientTransport, type WebSocketCtor } from "../src/index.js";
import { WsServerTransport } from "../src/node.js";
import { DT, makeWorld } from "./fixture.js";

const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 5)); }
};

describe("WebSocket transports (ws server + browser-style client)", () => {
  it("handshakes and replicates a snapshot over a real socket", async () => {
    const st = new WsServerTransport(); const port = await st.listen(0);
    const sworld = makeWorld();
    new NetServer({ world: sworld, transport: st });
    const e = sworld.create(); sworld.add(e, Transform, { x: 3, y: 4 });
    const cworld = makeWorld();
    const client = new NetClient({ world: cworld, transport: new WebSocketClientTransport(`ws://127.0.0.1:${port}`, WebSocket as unknown as WebSocketCtor) });
    const welcome = await client.connect();
    expect(welcome.clientId).toBe(1);
    sworld.step(DT);
    await until(() => { cworld.step(DT); return client.entities.size === 1; });
    expect(cworld.get(client.entities.values().next().value!, Transform)!.x).toBe(3);
    client.close(); await st.close();
  });
});
