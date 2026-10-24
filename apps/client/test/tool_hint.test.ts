// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOOL_REQ_ICONS } from "@engine/gameplay";

const hint = { node: 1, x: 0, y: 0, resource: "oak_tree", icon: "axe", minTier: 2, have: false, equipped: false, bare: false, label: "oak tree: needs axe (tier 2+)" };
let next: typeof hint | undefined = hint;
vi.mock("@engine/gameplay", async (orig) => ({ ...(await orig<typeof import("@engine/gameplay")>()), toolHint: () => next }));
const { drawLock, drawToolPlaceholder, hintVisual, mountToolHint, toolIconFrame } = await import("../src/tool-hint.js");
const { loadManifest } = await import("@engine/assets");
const { readFileSync } = await import("node:fs");
const { loadSettings } = await import("../src/menu.js");

function fakeCtx(): { g: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const g = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => k in t ? t[k] : (...a: unknown[]) => { calls.push(k); void a; }, set: (t, k: string, v) => { t[k] = v; return true; } });
  return { g: g as unknown as CanvasRenderingContext2D, calls };
}
const cam = { x: 0, y: 0, viewW: 800, viewH: 600, dpr: 1, drawZoom: 1, cssToWorld: () => ({ x: 0, y: 0 }) };
let raf: FrameRequestCallback[] = [];
const frame = (t: number): void => { const q = raf; raf = []; q.forEach((f) => f(t)); };
afterEach(() => { document.body.innerHTML = ""; localStorage.clear(); next = hint; });

describe("tool requirement symbol (ADR-126)", () => {
  it("every icon has a vector placeholder (no text / emoji) and a lock badge", () => {
    for (const icon of TOOL_REQ_ICONS) { const { g, calls } = fakeCtx(); drawToolPlaceholder(g, icon); expect(calls.length, icon).toBeGreaterThan(2); expect(calls).not.toContain("fillText"); }
    const { g, calls } = fakeCtx(); drawLock(g); expect(calls).toContain("arc");
  });
  it("owned tools draw normally, missing ones greyed with a lock", () => {
    expect(hintVisual({ have: true, equipped: true })).toMatchObject({ grey: false, lock: false });
    expect(hintVisual({ have: true, equipped: false })).toMatchObject({ grey: false, lock: false });
    expect(hintVisual({ have: false, equipped: false })).toMatchObject({ grey: true, lock: true });
  });
  it("shows over the node, fades out when hidden or disabled in Settings; on by default", () => {
    expect(loadSettings().toolHints).toBe(true);
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { raf.push(f); return raf.length; }); vi.stubGlobal("cancelAnimationFrame", () => undefined);
    (HTMLCanvasElement.prototype as { getContext: unknown }).getContext = () => fakeCtx().g;
    let hidden = false, enabled = true;
    const h = mountToolHint(document.body, { world: () => ({}) as never, player: () => 5 as never, camera: () => cam, hidden: () => hidden, enabled: () => enabled, device: () => "touch" });
    frame(1000); const el = document.getElementById("tool-hint")!;
    expect(el.dataset).toMatchObject({ show: "true", icon: "axe", have: "false" }); expect(el.getAttribute("aria-label")).toContain("needs axe");
    expect(el.style.transform).toMatch(/translate\(378px,\d+px\)/); // centred on the node, 44px touch size
    hidden = true; frame(1200); expect(el.dataset["show"]).toBe("false");
    hidden = false; frame(1400); expect(el.dataset["show"]).toBe("true");
    enabled = false; frame(1600); expect(el.dataset["show"]).toBe("false");
    next = undefined; enabled = true; frame(1800); expect(el.dataset["show"]).toBe("false");
    h.destroy(); expect(document.getElementById("tool-hint")).toBeNull(); vi.unstubAllGlobals();
  });
  it("every icon resolves to its tool_req_<icon> frame in the nature_toolicons atlas (@2x page for hi-dpi)", () => {
    const m = JSON.parse(readFileSync(`${process.cwd()}/packages/assets/pack/nature/manifest.nature.json`, "utf8"));
    const { registry } = loadManifest(m);
    TOOL_REQ_ICONS.forEach((icon, i) => {
      expect(toolIconFrame(registry, icon, 1)).toMatchObject({ sx: i * 32, sy: 0, sw: 32, sh: 32 });
      const hi = toolIconFrame(registry, icon, 2.5)!; expect(hi.src).toContain("@2x"); expect(hi).toMatchObject({ sx: i * 64, sw: 64 });
    });
    expect(toolIconFrame(undefined, "axe")).toBeUndefined();
    expect(toolIconFrame({ byKey: () => { throw new Error("missing"); } }, "axe")).toBeUndefined(); // placeholder fallback
  });
});
