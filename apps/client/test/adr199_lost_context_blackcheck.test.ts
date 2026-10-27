import { describe, it, expect } from "vitest";
import { blackFrameStep } from "../src/view.js";
import { glInfo } from "../src/glcheck.js";
import { errorLog } from "../src/error-log.js";

const fakeGl = (lost: () => boolean): WebGL2RenderingContext => ({ isContextLost: lost, getExtension: () => null, getParameter: (p: number) => (p === 0x1f01 ? "TestGPU" : 4096), RENDERER: 0x1f01, MAX_TEXTURE_SIZE: 1, MAX_RENDERBUFFER_SIZE: 2, drawingBufferWidth: 8, drawingBufferHeight: 8, getError: () => 0 }) as unknown as WebGL2RenderingContext;

describe("ADR-199: no false 'World rendered black' after a WebGL context loss", () => {
  it("a readback in flight when the context is lost (all zeros) does not report a black world, even after restore", () => {
    let lost = false; const gl = fakeGl(() => lost);
    const bc = { gl, pending: true, poll: () => true, start: () => undefined };
    const st = { checks: 0, blackFrames: 0, blackCheck: bc as never };
    const before = errorLog().list().filter((e) => e.kind === "World rendered black").length;
    lost = true; for (let i = 0; i < 5; i++) blackFrameStep(st, { gl, heldFrames: 0 }, 0, () => 1);
    lost = false; st.blackCheck = bc as never; for (let i = 0; i < 5; i++) blackFrameStep(st, { gl, heldFrames: 0 }, 0, () => 1); // restored but resources stale until reload
    expect(errorLog().list().filter((e) => e.kind === "World rendered black").length).toBe(before);
  });
  it("glInfo keeps the GPU name once the context is lost instead of 'GPU: null'", () => {
    let lost = false; const gl = fakeGl(() => lost);
    expect(glInfo(gl)).toContain("GPU: TestGPU"); lost = true;
    expect(glInfo(gl)).toMatch(/GPU: TestGPU \(context lost\)/);
  });
});
