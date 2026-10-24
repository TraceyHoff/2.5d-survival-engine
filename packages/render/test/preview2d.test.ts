import { describe, it, expect } from "vitest";
import type { AssetRegistry } from "@engine/assets";
import { CharacterPreview2D, facingAngle, layerTintRef, previewLayers2D, tintPixels, type AppearanceBinding, type CharacterDrawLayer } from "../src/index.js";

// registry stub: sprite 1 = body (atlas "body"), 2 = top (atlas "top", tintmask); dirFrame records the facing it was asked for
const asked: number[] = [];
const ref = (key: string, sprite: number, facing: number) => ({ atlas: { key, image: `${key}.png`, masks: key === "top" ? { tintmask: `${key}.tint.png` } : {} }, frame: 0, x: Math.round(facing * 10), y: 0, w: 64, h: 64, anchorX: 32 + sprite, anchorY: 60, flipX: facing > Math.PI, pages: [], masks: {} });
const registry = { sprite: (id: number) => ({ animations: new Map(id === 1 ? [["idle", {}]] : [["walk", {}]]) }), dirFrame: (id: number, _a: string, f: number) => { asked.push(f); return ref(id === 1 ? "body" : "top", id, f); } } as unknown as AssetRegistry;
const layers: CharacterDrawLayer[] = [{ slot: "body", sprite: 1, anim: "idle", tintR: 0xe0b08a }, { slot: "top", sprite: 2, anim: "walk", tintR: 0x2244aa, tintMode: "multiply", tintStrength: 1 }];
const binding = { resolve: () => layers } as unknown as AppearanceBinding;
const look = { bodyType: 0, skinTone: 0, parts: [], primary: [], secondary: [] };

describe("Canvas2D creator preview (same layers / anchors / tint as in-game)", () => {
  it("previewLayers2D: back-to-front resolve per facing index, dirFrame anchors, sheet + tintmask URLs from sources", () => {
    asked.length = 0; const src = new Map([["body", { url: "/p/body.png" }], ["top", { url: "/p/top.png", masks: { tintmask: "/p/top_tint.png" } }]]);
    const L = previewLayers2D(registry, binding, look as never, 3, 0, src);
    expect(L.map((l) => l.layer.slot)).toEqual(["body", "top"]); expect(asked).toEqual([facingAngle(3), facingAngle(3)]);
    expect(L[0]!.url).toBe("/p/body.png"); expect(L[0]!.maskUrl).toBeUndefined(); expect(L[1]!.maskUrl).toBe("/p/top_tint.png");
    expect(L[1]!.ref.anchorX).toBe(34); // the renderer's per-sprite anchor, not a re-centred frame
    expect(previewLayers2D(registry, binding, look as never, 0)[1]!.url).toBe("top.png"); // no sources: manifest image
  });
  it("tintPixels == layerTintRef (the shader's layerTint) through the tintmask R channel", () => {
    const px = new Uint8ClampedArray([200, 200, 200, 255, 100, 150, 200, 255, 9, 9, 9, 0]), mask = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    tintPixels(px, mask, layers[1]!);
    const want = layerTintRef([200 / 255, 200 / 255, 200 / 255], [0x22 / 255, 0x44 / 255, 0xaa / 255], 0, 1, 1, 1, 0.78).map((c) => Math.round(c * 255));
    expect([px[0], px[1], px[2]].map((c) => Math.abs(c! - want[[px[0], px[1], px[2]].indexOf(c)]!) <= 1)).toEqual([true, true, true]);
    expect([px[4], px[5], px[6]]).toEqual([100, 150, 200]); // mask 0: untouched
    expect([px[8], px[9], px[10]]).toEqual([9, 9, 9]); // transparent: untouched
  });
  it("device-DPR backing store and integer pixel scale (no blur on phones); 8 facings wrap; sheets load before swap", async () => {
    const cv = { width: 0, height: 0, style: {} as Record<string, string>, ownerDocument: {}, getContext: () => null } as unknown as HTMLCanvasElement;
    const loaded: string[] = [];
    const pv = new CharacterPreview2D(cv, { registry, binding, appearance: look as never, loadImage: async (u) => { loaded.push(u); return { width: 64, height: 64 } as never; } });
    pv.resize(168, 216, 2.625); expect([cv.width, cv.height]).toEqual([441, 567]); expect(cv.style.width).toBe("168px");
    expect(Number.isInteger(pv.scale)).toBe(true); expect(pv.scale).toBe(5);
    pv.setFacing(9); expect(pv.facing).toBe(1); pv.rotate(-2); expect(pv.facing).toBe(7);
    await pv.setAppearance(look as never); expect(new Set(loaded)).toEqual(new Set(["body.png", "top.png", "top.tint.png"]));
    pv.renderNow(0); // no 2D context: no-op, no throw
  });
});
