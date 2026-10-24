/** Spawn records: sparse/zero-run bodies for wide components (protocol v8; ADR-103). */
import { describe, expect, it } from "vitest";
import { World, defineComponent, fieldType } from "@engine/core";
import { BitReader, BitWriter, NetSchema, decodeDelta, encodeDelta, writeEntityRecord, writeWire, type EntityState, type WorldState } from "../src/index.js";

const N = 96; // mirrors gameplay Container (ADR-098)
const Box = defineComponent("Box", {
  slotCount: { type: "u8", default: 12 }, maxWeight: "f32", weight: "f32", spoilMul: { type: "f32", default: 1 },
  items: { type: "u16", length: N }, counts: { type: "u16", length: N }, createdTick: { type: "u32", length: N }, durability: { type: "u16", length: N }, crafterId: { type: "u32", length: N },
}, { networked: true });
const Small = defineComponent("Small", { a: "u8", b: "u16" }, { networked: true });
const w = new World({ seed: 1 }); w.register(Box); w.register(Small);
const schema = new NetSchema(w);
const bi = schema.stores.findIndex((s) => s.def === Box); const si = schema.stores.findIndex((s) => s.def === Small);
const len = schema.specs[bi]!.length;
const idx = (f: string, e = 0) => schema.layout[bi]!.findIndex(([g, i]) => g === f && i === e);

function boxVals(fill: (v: number[]) => void): number[] {
  const v = new Array<number>(len).fill(0); v[idx("slotCount")] = 96; v[idx("maxWeight")] = Math.fround(50); v[idx("spoilMul")] = 1; fill(v); return v;
}
const empty = () => boxVals(() => {});
const sparse = () => boxVals((v) => { for (const s of [0, 7, 40, 95]) { v[idx("items", s)] = 100 + s; v[idx("counts", s)] = 3; v[idx("createdTick", s)] = 123456; v[idx("durability", s)] = 900; } });
const full = () => boxVals((v) => { for (let s = 0; s < N; s++) { v[idx("items", s)] = 1 + s; v[idx("counts", s)] = 5; v[idx("createdTick", s)] = 1e6 + s; v[idx("durability", s)] = 1000; v[idx("crafterId", s)] = 70000 + s; } });
const ent = (v: number[]): EntityState => new Map([[bi, v], [si, [1, 2]]]);
const rt = (cur: WorldState, base?: WorldState) => { const bw = new BitWriter(); encodeDelta(bw, schema, cur, base); const b = bw.finish(); return { bytes: b.length, d: decodeDelta(new BitReader(b), schema, base) }; };
const spawnBytes = (v: number[]) => { const bw = new BitWriter(); writeEntityRecord(bw, schema, 1, new Map([[bi, v]]), undefined); return bw.byteLength; };
const denseBytes = () => { const bw = new BitWriter(); bw.writeBits(1, 2); bw.writeVarUint(1); for (let i = 0; i < schema.count; i++) bw.writeBool(i === bi); schema.specs[bi]!.forEach((s) => writeWire(bw, s, 0)); return bw.byteLength; };

describe("spawn: sparse wide components", () => {
  it("round-trips empty, sparse and full containers", () => {
    for (const mk of [empty, sparse, full]) {
      const cur: WorldState = new Map([[5, ent(mk())]]);
      expect(rt(cur).d.state.get(5)).toEqual(cur.get(5));
    }
  });
  it("empty 96-slot box spawns in < 64 B (dense ~1.4 KB)", () => {
    const e = spawnBytes(empty()), s = spawnBytes(sparse()), f = spawnBytes(full());
    const d = denseBytes(); console.log(`container spawn bytes: empty ${e}, sparse(4) ${s}, full ${f}; old dense ${d}`);
    expect(e).toBeLessThan(64);
    expect(s).toBeLessThan(120);
    expect(f).toBeLessThanOrEqual(d + 1); // dense fallback costs one bit
  });
  it("deltas are unchanged (element mask / sparse indices, not spawn bodies)", () => {
    const a = ent(sparse()); const v = [...a.get(bi)!]; v[idx("counts", 7)] = 4;
    const base: WorldState = new Map([[5, a]]); const cur: WorldState = new Map([[5, new Map([[bi, v], [si, [1, 2]]])]]);
    const r = rt(cur, base); expect(r.d.state.get(5)).toEqual(cur.get(5)); expect(r.bytes).toBeLessThanOrEqual(8);
  });
  it("fuzz: encode/decode equivalence over random spawns and deltas", () => {
    let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const rv = (density: number) => { const v = new Array<number>(len).fill(0); schema.specs[bi]!.forEach((s, i) => { if (rnd() < density) v[i] = fieldType(s) === "f32" ? Math.fround(rnd() * 100) : Math.floor(rnd() * (fieldType(s) === "u8" ? 256 : fieldType(s) === "u16" ? 65536 : 2 ** 32)); }); return v; };
    let base: WorldState | undefined; let client: WorldState | undefined;
    for (let it = 0; it < 200; it++) {
      const cur = new Map<number, EntityState>();
      for (let id = 1; id <= 6; id++) if (rnd() < 0.8) cur.set(id, rnd() < 0.5 && base?.get(id) ? base.get(id)! : new Map(rnd() < 0.9 ? [[bi, rv([0, 0.02, 0.3, 1][it % 4]!)], [si, [it & 255, id]]] : [[si, [1, 1]]]));
      const bw = new BitWriter(); encodeDelta(bw, schema, cur, base);
      client = decodeDelta(new BitReader(bw.finish()), schema, client).state;
      expect(client).toEqual(cur); base = cur;
      if (it % 17 === 0) { base = undefined; client = undefined; }
    }
  });
});
