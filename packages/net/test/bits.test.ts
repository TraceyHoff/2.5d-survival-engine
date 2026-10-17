import { describe, expect, it } from "vitest";
import { BitReader, BitWriter } from "../src/index.js";

describe("BitWriter/BitReader", () => {
  it("roundtrips arbitrary widths, bools and varuints", () => {
    const w = new BitWriter();
    w.writeBits(5, 3); w.writeBool(true); w.writeBits(0xffffffff, 32); w.writeBits(1023, 10);
    for (const v of [0, 1, 127, 128, 300, 0xffffffff]) w.writeVarUint(v);
    const bytes = w.finish();
    expect(bytes.length).toBe(Math.ceil(w.bitLength / 8));
    const r = new BitReader(bytes);
    expect([r.readBits(3), r.readBool(), r.readBits(32), r.readBits(10)]).toEqual([5, true, 0xffffffff, 1023]);
    for (const v of [0, 1, 127, 128, 300, 0xffffffff]) expect(r.readVarUint()).toBe(v);
  });
  it("roundtrips every core field type unaligned (FieldWriter compatible)", () => {
    const cases = [["i8", -5], ["u8", 250], ["i16", -30000], ["u16", 65000], ["i32", -2e9], ["u32", 4e9], ["f32", Math.fround(1.25)], ["f64", Math.PI]] as const;
    const w = new BitWriter(); w.writeBits(1, 1);
    for (const [t, v] of cases) w.write(t, v);
    const r = new BitReader(w.finish()); r.readBits(1);
    for (const [t, v] of cases) expect(r.read(t)).toBe(v);
  });
  it("throws on overrun and bad widths", () => {
    const r = new BitReader(new Uint8Array(1));
    r.readBits(8);
    expect(() => r.readBits(1)).toThrow(RangeError);
    expect(() => new BitWriter().writeBits(0, 33)).toThrow(RangeError);
  });
});
describe("appendBits", () => {
  it("concatenates unaligned bit streams exactly", () => {
    const a = new BitWriter(); a.writeBits(5, 3); a.writeBits(0x1abc, 13);
    const b = new BitWriter(); b.writeBits(1, 1); b.writeVarUint(300); b.writeBits(7, 3);
    for (const lead of [0, 3, 8]) {
      const w = new BitWriter(); w.writeBits(0, lead); const sa = a.snapshotBits(), sb = b.snapshotBits();
      w.appendBits(sa.bytes, sa.bits); w.appendBits(sb.bytes, sb.bits); w.writeBits(3, 2);
      const r = new BitReader(w.finish()); r.readBits(lead);
      expect([r.readBits(3), r.readBits(13), r.readBits(1), r.readVarUint(), r.readBits(3), r.readBits(2)]).toEqual([5, 0x1abc, 1, 300, 7, 3]);
    }
  });
});
