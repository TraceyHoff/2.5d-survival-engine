import { describe, it, expect } from "vitest";
import { World, defineComponent, Transform, NetId, BinaryWriter, BinaryReader, encodeSnapshot, decodeSnapshot, applySnapshot,
  writeRecord, readRecord, quantize, dequantize, encodeField, decodeField, wireValue, schemaHash } from "../src/index.js";

const Pos = defineComponent("Pos", { x: { type: "f32", quant: { bits: 16, min: -1024, max: 1024 } }, kind: "u16" }, { networked: true });
const Local = defineComponent("Local", { a: "f64" });

describe("serialization", () => {
  it("roundtrips every field type", () => {
    const s = { a: "f32", b: "f64", c: "i8", d: "i16", e: "i32", f: "u8", g: "u16", h: "u32" } as const;
    const v = { a: 1.5, b: Math.PI, c: -5, d: -300, e: -70000, f: 250, g: 65000, h: 4000000000 };
    const w = new BinaryWriter(2); writeRecord(w, s, v);
    const r = new BinaryReader(w.finish()); expect(readRecord(r, s)).toEqual(v); expect(r.remaining).toBe(0);
  });
  it("field order independent of declaration order", () => {
    expect(schemaHash({ a: "u8", b: "f32" })).toBe(schemaHash({ b: "f32", a: "u8" }));
    expect(schemaHash({ a: "u8" })).not.toBe(schemaHash({ a: { type: "u8", quant: { bits: 4, min: 0, max: 15 } } }));
  });
  it("per-field encode/decode", () => {
    const w = new World(); w.register(Pos); const e = w.create(); w.add(e, Pos, { x: 12.25, kind: 7 });
    const st = w.store(Pos); const slot = st.slot(e & 0xfffff); const bw = new BinaryWriter();
    encodeField(st, "x", slot, bw); encodeField(st, "kind", slot, bw);
    st.data.x[slot] = 0; st.data.kind[slot] = 0;
    const br = new BinaryReader(bw.finish()); decodeField(st, "x", slot, br); decodeField(st, "kind", slot, br);
    expect(w.get(e, Pos)).toEqual({ x: 12.25, kind: 7 });
  });
  it("quantization hint on wire only; sim keeps precision", () => {
    const q = { bits: 16, min: -1024, max: 1024 };
    expect(Math.abs(dequantize(quantize(123.456, q), q) - 123.456)).toBeLessThan(2048 / 65535);
    expect(quantize(99999, q)).toBe(65535); expect(quantize(-99999, q)).toBe(0);
    const w = new World(); w.register(Pos); const e = w.create(); w.add(e, Pos, { x: 1.2345 });
    const st = w.store(Pos); const wv = wireValue(st, "x", st.slot(e & 0xfffff));
    expect(wv.quant).toEqual(q); expect(Number.isInteger(wv.value)).toBe(true);
    expect(w.getField(e, Pos, "x")).toBeCloseTo(1.2345, 5);
  });
  it("snapshot encodes networked comps only and roundtrips", () => {
    const mk = () => { const w = new World(); w.register(Pos); w.register(Local); return w; };
    const a = mk();
    for (let i = 0; i < 10; i++) { const e = a.create(); a.add(e, NetId, { id: 100 + i }).add(e, Transform, { x: i * 1.5, y: -i }).add(e, Local, { a: i }); }
    a.tick = 77;
    const bytes = encodeSnapshot(a);
    const b = mk(); for (let i = 0; i < 10; i++) b.create();
    const snap = decodeSnapshot(b, bytes); applySnapshot(b, snap);
    expect(snap.tick).toBe(77); expect(snap.components.has(b.componentId(Local))).toBe(false);
    for (const e of a.query([NetId])) { expect(b.get(e, NetId)).toEqual(a.get(e, NetId)); expect(b.get(e, Transform)).toEqual(a.get(e, Transform)); }
  });
  it("rejects mismatched schema / bad data", () => {
    const a = new World(); a.register(Pos); const bytes = encodeSnapshot(a);
    expect(() => decodeSnapshot(new World(), bytes)).toThrow(/schema/);
    expect(() => decodeSnapshot(a, new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
