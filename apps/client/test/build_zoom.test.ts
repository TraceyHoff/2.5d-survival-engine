// Building-mode camera zoom: closer than normal, eased, and back to normal when building stops.
import { describe, expect, it } from "vitest";
import { attachZoom, BUILD_GAIN, defaultZoom } from "../src/camera-zoom.js";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const el = () => ({ addEventListener() {}, removeEventListener() {} }) as unknown as HTMLElement;
(globalThis as { addEventListener?: unknown }).addEventListener ??= () => {}; (globalThis as { removeEventListener?: unknown }).removeEventListener ??= () => {};

describe("building-mode zoom", () => {
  it("zooms in by BUILD_GAIN while building and returns to normal after", () => {
    const cam = { zoom: 0 };
    const zc = attachZoom(cam, el(), { storage: mem(), viewport: () => ({ w: 1920, h: 1080 }) });
    const base = defaultZoom(1920, 1080);
    expect(cam.zoom).toBeCloseTo(base, 4);
    for (let i = 0; i < 200; i++) zc.setBuild(true, 16);
    expect(zc.build).toBeCloseTo(BUILD_GAIN, 4);
    expect(cam.zoom).toBeCloseTo(base * BUILD_GAIN, 4);
    for (let i = 0; i < 200; i++) zc.setBuild(false, 16);
    expect(zc.build).toBeCloseTo(1, 4);
    expect(cam.zoom).toBeCloseTo(base, 4);
    zc.dispose();
  });
  it("building zoom stacks on top of the indoor zoom", () => {
    const cam = { zoom: 0 };
    const zc = attachZoom(cam, el(), { storage: mem(), viewport: () => ({ w: 1920, h: 1080 }) });
    const base = defaultZoom(1920, 1080);
    for (let i = 0; i < 200; i++) zc.setIndoor(true, 16);
    for (let i = 0; i < 200; i++) zc.setBuild(true, 16);
    expect(cam.zoom).toBeCloseTo(base * zc.indoor * BUILD_GAIN, 4);
    zc.dispose();
  });
});
