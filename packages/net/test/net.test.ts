import { describe, it, expect } from "vitest";
import { BinaryWriter, BinaryReader, writeRecord, readRecord } from "@engine/core";
import { MessageSchemas, MsgType } from "../src/index.js";
describe("net schemas", () => {
  it("Input message roundtrips", () => {
    const s = MessageSchemas[MsgType.Input]; const w = new BinaryWriter();
    writeRecord(w, s, { tick: 7, buttons: 5, aimX: 1.5, aimY: -2 });
    expect(readRecord(new BinaryReader(w.finish()), s)).toEqual({ tick: 7, buttons: 5, aimX: 1.5, aimY: -2 });
  });
});
