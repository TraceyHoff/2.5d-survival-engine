import { describe, it, expect, vi } from "vitest";
import { ErrorLog, ERROR_LOG_KEY, ERROR_LOG_MAX, errorCode, type StorageLike } from "../src/error-log.js";

const mem = (): StorageLike & { m: Map<string, string>; writes: number } => { const m = new Map<string, string>(); const s = { m, writes: 0, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { s.writes++; m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; return s; };

describe("ADR-198 persistent error log", () => {
  it("records message, stack, renderer, gpu, build and persists (throttled) across reloads", () => {
    vi.useFakeTimers(); const st = mem(); const log = new ErrorLog(st, () => 1000);
    log.ctx = { renderer: () => "canvas2d", gpu: () => "GPU: test" };
    for (let i = 0; i < 50; i++) log.record("Frame error", new Error(`boom ${i}`));
    expect(st.writes).toBe(0); vi.advanceTimersByTime(1100); expect(st.writes).toBe(1);
    const re = new ErrorLog(st); const e = re.list().at(-1)!;
    expect(e).toMatchObject({ kind: "Frame error", message: "boom 49", renderer: "canvas2d", gpu: "GPU: test", t: 1000 });
    expect(e.stack).toContain("boom 49"); expect(e.code).toMatch(/^E-[0-9A-F]{4}$/); expect(e.build).toBeTruthy();
    vi.useRealTimers();
  });
  it("is a ring buffer and coalesces repeats", () => {
    const log = new ErrorLog(mem());
    for (let i = 0; i < ERROR_LOG_MAX + 20; i++) log.record("x", `m${i}`);
    expect(log.list().length).toBe(ERROR_LOG_MAX); expect(log.list()[0]!.message).toBe("m20");
    log.record("y", "same"); log.record("y", "same"); expect(log.list().at(-1)!.count).toBe(2);
  });
  it("survives corrupt storage, throwing storage and unserializable errors", () => {
    const bad: StorageLike = { getItem: () => "{not json", setItem: () => { throw new Error("quota"); }, removeItem: () => {} };
    const log = new ErrorLog(bad); const cyc: Record<string, unknown> = {}; cyc["self"] = cyc;
    expect(() => { log.record("r", cyc); log.flush(); }).not.toThrow();
    log.ctx = { renderer: () => { throw new Error("no"); }, gpu: () => "" }; expect(() => log.record("r", "z")).not.toThrow();
  });
  it("short codes are stable per error", () => { expect(errorCode("A", "m\nstack1")).toBe(errorCode("A", "m\nstack2")); expect(errorCode("A", "m")).not.toBe(errorCode("B", "m")); });
  it("text() report includes code, renderer and stack", () => { const log = new ErrorLog(mem()); log.record("Unhandled rejection", new Error("nope")); expect(log.text()).toMatch(/E-[0-9A-F]{4} Unhandled rejection\nnope\nrenderer: unknown/); expect(ERROR_LOG_KEY).toBeTruthy(); });
});
