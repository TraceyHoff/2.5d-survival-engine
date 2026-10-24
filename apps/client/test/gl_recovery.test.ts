/** Context-loss recovery: preventDefault, step down one level per loss, rebuild on restore or timeout, ends on debug. */
import { describe, it, expect, vi } from "vitest";
import { attachContextRecovery, effectiveLevel, GL_LEVEL_KEY, levelFlags, stepDownAfterLoss } from "../src/gl-recovery.js";

const kv = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

describe("gl recovery levels", () => {
  it("url levels", () => { const s = kv(); expect(effectiveLevel("", s)).toBe("full"); expect(effectiveLevel("?gl=lowend", s)).toBe("lowend"); expect(effectiveLevel("?safe=1", s)).toBe("safe"); expect(effectiveLevel("?renderer=debug", s)).toBe("debug"); });
  it("each loss steps down to safe (sprites kept), never auto debug/dots", () => {
    const s = kv(); expect(stepDownAfterLoss("", s)).toBe("lowend"); expect(stepDownAfterLoss("", s)).toBe("safe"); expect(stepDownAfterLoss("", s)).toBe("safe");
    expect(effectiveLevel("", s)).toBe("safe");
  });
  it("flags", () => { expect(levelFlags("full")).toBeUndefined(); expect(levelFlags("lowend")).toEqual(["lowend"]); expect(levelFlags("safe")).toEqual(["lowend", "safe"]); });
});

describe("attachContextRecovery", () => {
  const setup = () => {
    const s = kv(); vi.stubGlobal("sessionStorage", s);
    const ls: Record<string, (e: Event) => void> = {}; const canvas = { addEventListener: (t: string, f: (e: Event) => void) => { ls[t] = f; }, removeEventListener() {} } as unknown as HTMLCanvasElement;
    const reload = vi.fn(), notify = vi.fn(); attachContextRecovery(canvas, { notify, reload, search: "", timeoutMs: 1000 });
    const ev = { preventDefault: vi.fn() } as unknown as Event; return { s, ls, reload, notify, ev };
  };
  it("loss: preventDefault + lowend saved; restore reloads once", () => {
    const t = setup(); t.ls["webglcontextlost"]!(t.ev);
    expect((t.ev.preventDefault as ReturnType<typeof vi.fn>)).toHaveBeenCalled(); expect(t.s.m.get(GL_LEVEL_KEY)).toBe("lowend"); expect(t.notify).toHaveBeenCalledOnce();
    t.ls["webglcontextrestored"]!(t.ev); t.ls["webglcontextrestored"]!(t.ev); expect(t.reload).toHaveBeenCalledTimes(1);
  });
  it("restore never arrives (canvas 0x0): reload after the timeout", () => {
    vi.useFakeTimers(); const t = setup(); t.ls["webglcontextlost"]!(t.ev); expect(t.reload).not.toHaveBeenCalled(); vi.advanceTimersByTime(1000); expect(t.reload).toHaveBeenCalledOnce(); vi.useRealTimers();
  });
});
