import { describe, expect, it } from "vitest";
import { Owner, Transform, type Entity } from "@engine/core";
import { BitReader, BitWriter, LoopbackNetwork, NetClient, NetServer, defineCommand, readPayload, writePayload } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

// mirrors gameplay.setStallName: entity ref + fixed u8[24] name
const SetName = defineCommand("gameplay.setStallName", { stall: "u32", name: { type: "u8", length: 24 } }, { entityFields: ["stall"] });
const bytes = (s: string) => Array.from(new TextEncoder().encode(s));

describe("command codec: fixed array fields", () => {
  it("round-trips exactly `length` elements; pads short arrays with 0, truncates long ones", () => {
    const enc = (name: number[]) => { const w = new BitWriter(); writePayload(w, SetName, { stall: 7, name }); return readPayload(new BitReader(w.finish()), SetName) as unknown as { stall: number; name: number[] }; };
    const p = enc(bytes("Bob's Fish"));
    expect(p.stall).toBe(7); expect(p.name).toHaveLength(24);
    expect(p.name.slice(0, 10)).toEqual(bytes("Bob's Fish")); expect(p.name.slice(10).every((b) => b === 0)).toBe(true);
    expect(enc(Array.from({ length: 30 }, (_, i) => i + 1)).name).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it("delivers array payloads end to end with the entity field resolved", async () => {
    const net = new LoopbackNetwork(3); const sw = makeWorld();
    const server = new NetServer({ world: sw, transport: net.createServer(), commands: [SetName],
      onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: 0, y: 0 }).add(e, Owner, { clientId: s.clientId }); } });
    const A = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 20 }), commands: [SetName] }); await join(net, A);
    const stall = sw.create(); sw.add(stall, Transform, { x: 2, y: 2 });
    const got: [Entity, string][] = [];
    server.onCommand(SetName, (_s, p) => got.push([p.stall, new TextDecoder().decode(Uint8Array.from(p.name)).replace(/\0+$/, "")]));
    frames(net, [sw, A.world], 6);
    expect(A.sendCommand(SetName, { stall: A.entityOf(server.netIds.netIdOf(stall)!)!, name: bytes("Pavilion of Ünïcode") })).toBe(true);
    frames(net, [sw, A.world], 3);
    expect(got).toEqual([[stall, "Pavilion of Ünïcode"]]);
  });
});
