import { describe, it, expect } from "vitest";
import { ClaimRegistry, BinaryWriter } from "../src/index.js";

describe("ClaimRegistry encode/decode", () => {
  it("round-trips claims, defaultFlags and nextId (removed ids not reused)", () => {
    const r = new ClaimRegistry(); r.defaultFlags = 5;
    r.add({ ownerGroup: 3, x0: 0, y0: 0, x1: 40.5, y1: 64, flags: 1 }); const b = r.add({ ownerGroup: 4, x0: -10, y0: -10, x1: 10, y1: 10, flags: 6, priority: -2 });
    r.add({ ownerGroup: 9, x0: 1, y0: 1, x1: 2, y1: 2, flags: 0 }); r.remove(3);
    const d = ClaimRegistry.decode(r.encode());
    expect(d.all()).toEqual(r.all()); expect(d.defaultFlags).toBe(5); expect(d.nextClaimId).toBe(4); expect(d.claimAt(0, 0)!.id).toBe(1);
    expect(d.zoneAt(5, -5)).toBe(6); expect(d.zoneAt(500, 500)).toBe(5); expect(d.get(b.id)!.priority).toBe(-2);
    expect(Array.from(d.encode())).toEqual(Array.from(r.encode()));
    expect(d.add({ ownerGroup: 1, x0: 0, y0: 0, x1: 1, y1: 1, flags: 0 }).id).toBe(4);
  });
  it("reads persist's committed v1 claims blob byte layout", () => {
    const w = new BinaryWriter(); w.write("u32", 0x4d4c4c43); w.write("u8", 1); w.write("u32", 10); w.write("u32", 2); w.write("u32", 1);
    w.write("u32", 7); w.write("u32", 2); for (const v of [0, 0, 32, 32]) w.write("f64", v); w.write("u32", 8); w.write("i32", 3);
    const bytes = w.finish(); const d = ClaimRegistry.decode(bytes);
    expect(d.all()).toEqual([{ id: 7, ownerGroup: 2, x0: 0, y0: 0, x1: 32, y1: 32, flags: 8, priority: 3 }]); expect(d.nextClaimId).toBe(10); expect(d.defaultFlags).toBe(2);
    expect(Array.from(d.encode())).toEqual(Array.from(bytes));
  });
  it("load() replaces in place; bad input throws", () => {
    const src = new ClaimRegistry(); src.add({ ownerGroup: 1, x0: 0, y0: 0, x1: 4, y1: 4, flags: 2 });
    const live = new ClaimRegistry(); live.add({ ownerGroup: 5, x0: 100, y0: 100, x1: 101, y1: 101, flags: 1 });
    expect(live.load(src.encode())).toBe(live); expect(live.all()).toEqual(src.all()); expect(live.claimAt(100, 100)).toBeUndefined();
    expect(() => ClaimRegistry.decode(new Uint8Array(3))).toThrow(/truncated/);
    const bad = src.encode(); bad[0] = 0; expect(() => ClaimRegistry.decode(bad)).toThrow(/magic/);
    const v2 = src.encode(); v2[4] = 2; expect(() => ClaimRegistry.decode(v2)).toThrow(/version 2/);
  });
});
