// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { type CosmeticCatalogLike, type WearableDef } from "@engine/core";
import type { AssetRegistry } from "@engine/assets";
import { createPreviewDriver, previewModeFromQuery, showCharacterCreator, PREVIEW_CSS, type CreatorPreviewSource } from "../src/character-creator.js";

const W = (id: number, key: string, slot: WearableDef["slot"]): WearableDef => ({ id, key, slot, bodies: { male: { sprite: 1, anim: "idle" }, female: { sprite: 1, anim: "idle" } }, hidesSlots: [], hatHair: false, unlockTags: [], layer: 0, z: 0, tintChannels: 1 }) as unknown as WearableDef;
const parts = [W(1, "hair_short", "hair"), W(4, "top_tee", "top"), W(9, "top_hoodie", "top"), W(6, "bottom_jeans", "bottom"), W(7, "shoes_boots", "shoes"), W(8, "eyes_round", "eyes")];
const C = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, key: `c${i}`, color: 0x102030 * (i + 1) }));
const cat: CosmeticCatalogLike = { wearable: (id) => parts.find((p) => p.id === id), bodySprite: () => ({ sprite: 1, anim: "idle" }), skinTones: C(6), hairColors: C(5), clothingColors: C(8), defaults: { top: 4, bottom: 6, shoes: 7, eyes: 8 } };
const registry = { cosmetics: cat } as unknown as AssetRegistry;
const tick = () => new Promise((r) => setTimeout(r, 0));
function glStub() {
  const calls = { set: [] as unknown[], facing: [] as number[], disposed: 0, resize: [] as number[][] };
  const createGl = vi.fn(async (_cv: unknown, o: { facing?: number | undefined }) => { calls.facing.push(o.facing ?? -1); return { setAppearance: async (a: unknown) => { calls.set.push(a); }, setFacing: (k: number) => calls.facing.push(k), resize: (w: number, h: number, d: number) => calls.resize.push([w, h, d]), dispose: () => { calls.disposed++; } } as never; }) as unknown as NonNullable<CreatorPreviewSource["createGl"]>;
  return { calls, createGl };
}

describe("ADR-114 creator preview (render package sprites)", () => {
  it("?creator=2d forces Canvas2D", () => { expect(previewModeFromQuery(new URLSearchParams("creator=2d"))).toBe("canvas2d"); expect(previewModeFromQuery(new URLSearchParams(""))).toBe("auto"); });
  it("auto = WebGL2 via createCharacterPreview at the device DPR; falls back to Canvas2D when WebGL2 fails; canvas2d skips GL", async () => {
    const host = document.createElement("div"); const { calls, createGl } = glStub(); Object.defineProperty(window, "devicePixelRatio", { value: 2.625, configurable: true });
    const d = await createPreviewDriver(host, { registry, sources: new Map(), createGl }, {} as never, 1);
    expect(d?.kind).toBe("webgl2"); expect(calls.resize[0]).toEqual([PREVIEW_CSS.w, PREVIEW_CSS.h, 2.625]); d!.dispose(); expect(calls.disposed).toBe(1);
    const mk2d = vi.fn(() => ({ setAppearance: async () => undefined, setFacing: () => undefined, resize: () => undefined, renderNow: () => undefined, facing: 1 }));
    const failGl = vi.fn(async () => { throw new Error("no webgl2"); });
    const d2 = await createPreviewDriver(host, { registry, sources: new Map(), createGl: failGl as never, create2d: mk2d }, {} as never, 1);
    expect(d2?.kind).toBe("canvas2d"); expect(host.querySelector("canvas")?.dataset["renderer"]).toBe("canvas2d");
    const gl3 = glStub(); const d3 = await createPreviewDriver(host, { registry, sources: new Map(), mode: "canvas2d", createGl: gl3.createGl, create2d: mk2d }, {} as never, 1);
    expect(d3?.kind).toBe("canvas2d"); expect(gl3.createGl).not.toHaveBeenCalled();
  });
  it("creator: live reaction to choices, 8 facings via buttons / gamepad LB-RB / drag, disposed on close", async () => {
    const root = document.createElement("div"); document.body.append(root); const { calls, createGl } = glStub();
    let pad: Gamepad | null = null; const pads = () => [pad];
    const preview: CreatorPreviewSource = { registry, sources: new Map(), createGl };
    const p = showCharacterCreator({ root, catalog: cat, pads, preview }); await tick(); await tick();
    const wrap = root.querySelector<HTMLElement>("[data-boot=creator]")!; expect(wrap.dataset["preview"]).toBe("webgl2");
    const topOf = () => (calls.set.at(-1) as { parts: number[] }).parts[3]; const t0 = topOf(); const n0 = calls.set.length;
    root.querySelector<HTMLButtonElement>("[data-action=next-top]")!.click(); expect(calls.set.length).toBe(n0 + 1); expect(topOf()).not.toBe(t0); expect([4, 9]).toContain(topOf());
    const f = () => calls.facing.at(-1)!;
    const rr = root.querySelector<HTMLButtonElement>("[data-action=rotate-right]")!; const seen = new Set<number>();
    for (let i = 0; i < 8; i++) { rr.click(); seen.add(f()); } expect(seen.size).toBe(8);
    const before = f(); root.querySelector<HTMLButtonElement>("[data-action=rotate-left]")!.click(); expect(f()).toBe((before + 7) % 8);
    // gamepad RB -> next facing (edge triggered by the creator's rAF poll)
    const btn = (i: number) => ({ buttons: Array.from({ length: 16 }, (_, k) => ({ pressed: k === i, value: k === i ? 1 : 0, touched: false })), axes: [0, 0, 0, 0] }) as unknown as Gamepad;
    const b0 = f(); pad = btn(5); await new Promise((r) => setTimeout(r, 60)); expect(f()).toBe((b0 + 1) % 8); pad = null; await new Promise((r) => setTimeout(r, 40));
    // touch / mouse drag on the preview turns it
    const host = root.querySelector<HTMLElement>("[data-role=creator-preview-host]")!; const d0 = f();
    const ev = (t: string, x: number) => { const e = new Event(t) as PointerEvent; Object.assign(e, { clientX: x, pointerId: 1 }); host.dispatchEvent(e); };
    ev("pointerdown", 100); ev("pointermove", 166); ev("pointerup", 166); expect(f()).toBe((d0 + 6) % 8);
    root.querySelector<HTMLButtonElement>("[data-action=creator-back]")!.click(); expect(await p).toBeUndefined(); expect(calls.disposed).toBe(1);
  });
});
