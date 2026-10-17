import { describe, expect, it } from "vitest";
import { BitReader, MsgType, PROTOCOL_VERSION, decodeHello, decodeInput, decodeWelcome, encodeHello, encodeInput, encodeWelcome, readHeader } from "../src/index.js";

describe("protocol", () => {
  it("header carries protocol version and type", () => {
    const r = new BitReader(encodeHello({ schemaHash: 0xdeadbeef, token: new Uint8Array(16).fill(3) }));
    expect(readHeader(r)).toEqual({ version: PROTOCOL_VERSION, type: MsgType.Hello });
    expect(decodeHello(r)).toEqual({ schemaHash: 0xdeadbeef, token: new Uint8Array(16).fill(3) });
    expect(readHeader(new BitReader(encodeHello({ schemaHash: 1, token: new Uint8Array(16) }, 99))).version).toBe(99);
  });
  it("welcome and input roundtrip (input seqs are consecutive)", () => {
    const wr = new BitReader(encodeWelcome({ clientId: 3, token: new Uint8Array(16).fill(9), tickHz: 20, serverTick: 1234 })); readHeader(wr);
    expect(decodeWelcome(wr)).toEqual({ clientId: 3, token: new Uint8Array(16).fill(9), tickHz: 20, serverTick: 1234 });
    const cmds = [{ seq: 10, buttons: 1, aimX: 0.5, aimY: -1 }, { seq: 11, buttons: 3, aimX: 0, aimY: 2 }];
    const ir = new BitReader(encodeInput({ ackTick: 77, cmds })); readHeader(ir);
    expect(decodeInput(ir)).toEqual({ ackTick: 77, cmds });
  });
});
