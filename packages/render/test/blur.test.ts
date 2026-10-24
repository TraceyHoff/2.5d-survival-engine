import { describe, expect, it } from "vitest";
import { FallbackLadder } from "../src/gl/fallback.js";
import { IsoCamera } from "../src/camera.js";

describe("blur fixes", () => {
  it("fallback ladder steps back up after a quiet period (never below an atLeast floor, safe is sticky)", () => {
    const l = new FallbackLadder(30);
    expect(l.fault("atlas", "oom", 100)).toBe(1); expect(l.fault("atlas", "oom", 200)).toBe(2);
    expect(l.recover(1000, 1800)).toBeNull();
    expect(l.recover(2000, 1800)).toBe(1); expect(l.recover(2100, 1800)).toBeNull(); expect(l.recover(3800, 1800)).toBe(0);
    expect(l.recover(9000, 1800)).toBeNull();
    const f = new FallbackLadder(); f.atLeast(1); f.fault("x", "y", 0); expect(f.recover(1e6)).toBe(1); expect(f.recover(2e6)).toBeNull();
    const s = new FallbackLadder(); s.atLeast(4); expect(s.recover(1e6)).toBeNull();
  });
  it("camera snaps the device scale to quarter steps and the view center to whole device pixels", () => {
    const c = new IsoCamera(); c.setViewport(1082, 2402, 2.625); c.zoom = 1.4;
    expect(c.scale).toBe(3.75); expect(c.drawZoom).toBeCloseTo(3.75 / 2.625);
    c.x = 10.1234; c.y = -3.3; const u = c.viewUniform(new Float32Array(4));
    expect(Math.abs(u[0]! * 3.75 - Math.round(u[0]! * 3.75))).toBeLessThan(1e-3);
    c.snap = false; expect(c.scale).toBeCloseTo(3.675);
    // input mapping uses the drawn zoom: the view center maps back to the camera position
    c.snap = true; const p = c.cssToIso(1082 / 2.625 / 2, 2402 / 2.625 / 2); expect(p.x).toBeCloseTo(c.x); expect(p.y).toBeCloseTo(c.y);
  });
});

import { probeCompressedTextures } from "../src/gl/capabilities.js";
import { ktx2Target, pickTextureUrl, setKtx2Transcoder } from "../src/assets/ktx2.js";
describe("compressed textures", () => {
  it("probes ETC2/ASTC/S3TC/BPTC and falls back to PNG without a transcoder", () => {
    const gl = { getExtension: (n: string) => (n === "WEBGL_compressed_texture_astc" || n === "WEBGL_compressed_texture_etc" ? {} : null) };
    const c = probeCompressedTextures(gl); expect(c).toEqual({ etc2: true, astc: true, s3tc: false, bptc: false });
    expect(probeCompressedTextures(gl, true).astc).toBe(false);
    expect(ktx2Target(c)).toBeNull(); expect(pickTextureUrl("a/x.png", c)).toBe("a/x.png");
    setKtx2Transcoder(async () => ({ width: 1, height: 1, levels: [], internalFormat: 0 }));
    expect(ktx2Target(c)).toBe("astc"); expect(pickTextureUrl("a/x.png", c)).toBe("a/x.ktx2"); expect(pickTextureUrl("a/x.png", c, () => false)).toBe("a/x.png");
    setKtx2Transcoder(null);
  });
});
