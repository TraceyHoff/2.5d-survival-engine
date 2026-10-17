/**
 * Procedural texture atlas: placeholder art drawn with Canvas2D at startup, shelf-packed into one
 * texture, plus a numeric frame table (uv rect, size, anchor) uploaded as an RGBA32F texture
 * so the sprite shader can look frames up by FrameId.
 */
import { Rng } from "@engine/core";

/** Frame ids of the procedural atlas (atlasId 0). Numeric, as stored in Sprite.frameId. */
export const enum FrameId {
  Pine0, Pine1, Pine2, Oak0, Oak1, DeadTree, Rock0, Rock1, Boulder, Bush, GrassTuft, Flowers,
  PlayerS, PlayerN, Survivor0S, Survivor0N, Survivor1S, Survivor1N,
  Campfire0, Campfire1, Campfire2, Torch0, Torch1, Tent, Crate,
  Count,
}

export interface AtlasFrame { x: number; y: number; w: number; h: number; ax: number; ay: number }

export interface Atlas {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly AtlasFrame[];
  readonly image: HTMLCanvasElement | OffscreenCanvas;
  /** Largest frame extent (px) – used as the cull margin. */
  readonly maxExtent: number;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
interface FrameDef { w: number; h: number; ax?: number; ay?: number; draw: (c: Ctx, w: number, h: number, r: Rng) => void }

const PAD = 2;

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== "undefined") { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}

const shade = (hex: string, f: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
};

function ellipse(c: Ctx, x: number, y: number, rx: number, ry: number, fill: string): void {
  c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
}

function pine(base: string, tiers: number) {
  return (c: Ctx, w: number, h: number, r: Rng): void => {
    const cx = w / 2;
    c.fillStyle = "#5a3b22"; c.fillRect(cx - 3, h - 22, 6, 18);
    c.fillStyle = "#3e2716"; c.fillRect(cx + 1, h - 22, 2, 18);
    const top = 6, bottom = h - 16;
    for (let i = 0; i < tiers; i++) {
      const t0 = top + ((bottom - top) * i) / (tiers + 0.6);
      const t1 = t0 + (bottom - top) / tiers * 1.5;
      const half = (w / 2 - 3) * (0.45 + 0.55 * ((i + 1) / tiers));
      const g = c.createLinearGradient(cx - half, 0, cx + half, 0);
      g.addColorStop(0, shade(base, 1.25)); g.addColorStop(0.55, base); g.addColorStop(1, shade(base, 0.6));
      c.fillStyle = g;
      c.beginPath(); c.moveTo(cx, t0); c.lineTo(cx + half, t1); c.lineTo(cx - half, t1); c.closePath(); c.fill();
      c.fillStyle = shade(base, 0.55);
      for (let k = 0; k < 4; k++) c.fillRect(cx - half + r.range(4, half * 2 - 4), t1 - 3, 3, 3);
    }
  };
}

function oak(base: string) {
  return (c: Ctx, w: number, h: number, r: Rng): void => {
    const cx = w / 2;
    c.fillStyle = "#6b4528"; c.fillRect(cx - 4, h - 34, 8, 30);
    c.fillStyle = "#4a2e19"; c.fillRect(cx + 1, h - 34, 3, 30);
    const blobs: [number, number, number][] = [];
    for (let i = 0; i < 9; i++) blobs.push([cx + r.range(-w * 0.28, w * 0.28), r.range(18, h - 44), r.range(12, 18)]);
    for (const [x, y, rad] of blobs) ellipse(c, x + 2, y + 3, rad, rad * 0.9, shade(base, 0.6));
    for (const [x, y, rad] of blobs) ellipse(c, x, y, rad, rad * 0.9, base);
    for (const [x, y, rad] of blobs) ellipse(c, x - rad * 0.3, y - rad * 0.35, rad * 0.45, rad * 0.35, shade(base, 1.3));
  };
}

function rock(base: string, scale: number) {
  return (c: Ctx, w: number, h: number, r: Rng): void => {
    const cx = w / 2, cy = h - 6 - 10 * scale;
    const pts: [number, number][] = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = (w / 2 - 3) * r.range(0.75, 1);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * (Math.sin(a) > 0 ? 0.45 : 0.9)]);
    }
    const g = c.createLinearGradient(0, cy - 20 * scale, w * 0.4, h);
    g.addColorStop(0, shade(base, 1.35)); g.addColorStop(1, shade(base, 0.6));
    c.fillStyle = g; c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill();
    c.strokeStyle = shade(base, 0.45); c.lineWidth = 1.5; c.stroke();
    c.fillStyle = shade(base, 1.5); c.fillRect(cx - w * 0.18, cy - h * 0.18 * scale, w * 0.12, 3);
  };
}

function person(shirt: string, pants: string, back: boolean) {
  return (c: Ctx, w: number, _h: number): void => {
    const cx = w / 2;
    c.fillStyle = pants; c.fillRect(cx - 6, 34, 5, 14); c.fillRect(cx + 1, 34, 5, 14);
    c.fillStyle = "#2b1d12"; c.fillRect(cx - 7, 46, 6, 3); c.fillRect(cx + 1, 46, 6, 3);
    c.fillStyle = shirt; c.fillRect(cx - 8, 18, 16, 18);
    c.fillStyle = shade(shirt, 0.7); c.fillRect(cx + 3, 18, 5, 18);
    c.fillStyle = "#e0b48c"; c.fillRect(cx - 11, 20, 3, 12); c.fillRect(cx + 8, 20, 3, 12);
    c.fillStyle = "#e7bf98"; c.fillRect(cx - 6, 5, 12, 13);
    c.fillStyle = "#4a2f1d"; c.fillRect(cx - 7, 3, 14, back ? 13 : 5);
    if (!back) { c.fillStyle = "#222"; c.fillRect(cx - 4, 10, 2, 2); c.fillRect(cx + 2, 10, 2, 2); }
  };
}

function fire(phase: number) {
  return (c: Ctx, w: number, h: number, r: Rng): void => {
    const cx = w / 2;
    c.save(); c.translate(cx, h - 8);
    for (const a of [-0.5, 0.5, 0]) { c.save(); c.rotate(a); c.fillStyle = a ? "#5b3a1f" : "#6e4826"; c.fillRect(-14, -3, 28, 6); c.restore(); }
    for (let i = 0; i < 6; i++) { c.fillStyle = "#777"; c.beginPath(); c.arc(Math.cos(i) * 16, Math.sin(i) * 6, 3, 0, 7); c.fill(); }
    const fl = (s: number, col: string): void => {
      c.fillStyle = col; c.beginPath(); c.moveTo(-10 * s, -2);
      c.quadraticCurveTo(-10 * s, -18 * s, (phase - 1) * 3 * s, -34 * s - r.range(0, 4));
      c.quadraticCurveTo(10 * s, -16 * s, 10 * s, -2); c.closePath(); c.fill();
    };
    fl(1, "#e8501c"); fl(0.72, "#ffa52b"); fl(0.42, "#fff2a0");
    c.restore();
  };
}

function torch(phase: number) {
  return (c: Ctx, w: number, h: number): void => {
    const cx = w / 2;
    c.fillStyle = "#5b3a1f"; c.fillRect(cx - 2, 16, 4, h - 20);
    c.fillStyle = "#333"; c.fillRect(cx - 4, 14, 8, 4);
    c.fillStyle = "#ff7a1c"; c.beginPath(); c.ellipse(cx + (phase ? 1 : -1), 9, 5, 8, 0, 0, 7); c.fill();
    c.fillStyle = "#fff0a0"; c.beginPath(); c.ellipse(cx, 11, 2.5, 4, 0, 0, 7); c.fill();
  };
}

const FRAME_DEFS: Record<FrameId, FrameDef> = {
  [FrameId.Pine0]: { w: 56, h: 112, draw: pine("#2f6b3a", 4) },
  [FrameId.Pine1]: { w: 48, h: 96, draw: pine("#2a5e3c", 3) },
  [FrameId.Pine2]: { w: 64, h: 128, draw: pine("#356f33", 5) },
  [FrameId.Oak0]: { w: 76, h: 100, draw: oak("#4f8a35") },
  [FrameId.Oak1]: { w: 84, h: 108, draw: oak("#6b8f2c") },
  [FrameId.DeadTree]: { w: 48, h: 80, draw: (c, w, h) => {
    c.strokeStyle = "#5e4a3a"; c.lineCap = "round"; c.lineWidth = 6; c.beginPath(); c.moveTo(w / 2, h - 4); c.lineTo(w / 2, 20); c.stroke();
    c.lineWidth = 3; c.beginPath(); c.moveTo(w / 2, 40); c.lineTo(w / 2 - 14, 22); c.moveTo(w / 2, 32); c.lineTo(w / 2 + 15, 14); c.moveTo(w / 2, 55); c.lineTo(w / 2 + 12, 44); c.stroke();
  } },
  [FrameId.Rock0]: { w: 36, h: 28, draw: rock("#8a8a86", 0.8) },
  [FrameId.Rock1]: { w: 30, h: 24, draw: rock("#7d766c", 0.7) },
  [FrameId.Boulder]: { w: 56, h: 48, draw: rock("#91908a", 1.4) },
  [FrameId.Bush]: { w: 40, h: 30, draw: (c, w, h, r) => {
    for (let i = 0; i < 6; i++) { const x = r.range(12, w - 12), y = r.range(12, h - 10); ellipse(c, x + 1, y + 2, 10, 8, "#2b5520"); ellipse(c, x, y, 10, 8, "#3f7a2c"); ellipse(c, x - 3, y - 3, 4, 3, "#5d9c3e"); }
  } },
  [FrameId.GrassTuft]: { w: 24, h: 20, draw: (c, w, h, r) => {
    c.strokeStyle = "#5b9a3a"; c.lineWidth = 2;
    for (let i = 0; i < 7; i++) { const x = r.range(5, w - 5); c.beginPath(); c.moveTo(x, h - 4); c.lineTo(x + r.range(-4, 4), r.range(3, 10)); c.stroke(); }
  } },
  [FrameId.Flowers]: { w: 24, h: 18, draw: (c, w, h, r) => {
    c.strokeStyle = "#4f8a35"; c.lineWidth = 1.5;
    const cols = ["#f4e04d", "#e85d75", "#ffffff", "#9b7bff"];
    for (let i = 0; i < 5; i++) { const x = r.range(4, w - 4), y = r.range(4, h - 8); c.beginPath(); c.moveTo(x, h - 4); c.lineTo(x, y); c.stroke(); ellipse(c, x, y, 2.5, 2.5, r.pick(cols)); }
  } },
  [FrameId.PlayerS]: { w: 32, h: 54, ay: 50, draw: person("#c8463a", "#334a7a", false) },
  [FrameId.PlayerN]: { w: 32, h: 54, ay: 50, draw: person("#c8463a", "#334a7a", true) },
  [FrameId.Survivor0S]: { w: 32, h: 54, ay: 50, draw: person("#3f7fbf", "#4d3b2a", false) },
  [FrameId.Survivor0N]: { w: 32, h: 54, ay: 50, draw: person("#3f7fbf", "#4d3b2a", true) },
  [FrameId.Survivor1S]: { w: 32, h: 54, ay: 50, draw: person("#d9a336", "#3b4a32", false) },
  [FrameId.Survivor1N]: { w: 32, h: 54, ay: 50, draw: person("#d9a336", "#3b4a32", true) },
  [FrameId.Campfire0]: { w: 48, h: 48, ay: 42, draw: fire(0) },
  [FrameId.Campfire1]: { w: 48, h: 48, ay: 42, draw: fire(1) },
  [FrameId.Campfire2]: { w: 48, h: 48, ay: 42, draw: fire(2) },
  [FrameId.Torch0]: { w: 16, h: 48, draw: torch(0) },
  [FrameId.Torch1]: { w: 16, h: 48, draw: torch(1) },
  [FrameId.Tent]: { w: 80, h: 60, ay: 54, draw: (c, w, h) => {
    c.fillStyle = "#b08a52"; c.beginPath(); c.moveTo(w / 2, 6); c.lineTo(w - 6, h - 8); c.lineTo(6, h - 8); c.closePath(); c.fill();
    c.fillStyle = "#8a6a3c"; c.beginPath(); c.moveTo(w / 2, 6); c.lineTo(w - 6, h - 8); c.lineTo(w / 2 + 8, h - 8); c.closePath(); c.fill();
    c.fillStyle = "#3a2a18"; c.beginPath(); c.moveTo(w / 2, 26); c.lineTo(w / 2 + 9, h - 8); c.lineTo(w / 2 - 9, h - 8); c.closePath(); c.fill();
  } },
  [FrameId.Crate]: { w: 34, h: 36, ay: 32, draw: (c, w) => {
    c.fillStyle = "#9a6b3b"; c.fillRect(3, 6, w - 6, 26); c.fillStyle = "#7a5029"; c.fillRect(3, 6, w - 6, 4); c.fillRect(3, 18, w - 6, 3);
    c.strokeStyle = "#5a3a1c"; c.lineWidth = 2; c.strokeRect(3, 6, w - 6, 26);
  } },
  [FrameId.Count]: { w: 1, h: 1, draw: () => {} },
};

/** Draws all frames and shelf-packs them. Deterministic (seeded). */
export function buildProceduralAtlas(seed = 1337, size = 512): Atlas {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d") as Ctx | null;
  if (!ctx) throw new Error("2D canvas unavailable for atlas");
  const rng = new Rng(seed);
  const frames: AtlasFrame[] = [];
  let x = PAD, y = PAD, rowH = 0, maxExtent = 0;
  for (let id = 0; id < FrameId.Count; id++) {
    const d = FRAME_DEFS[id as FrameId];
    if (x + d.w + PAD > size) { x = PAD; y += rowH + PAD * 2; rowH = 0; }
    if (y + d.h + PAD > size) throw new Error("atlas overflow");
    ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.rect(0, 0, d.w, d.h); ctx.clip();
    d.draw(ctx, d.w, d.h, rng);
    ctx.restore();
    frames.push({ x, y, w: d.w, h: d.h, ax: d.ax ?? d.w / 2, ay: d.ay ?? d.h - 4 });
    maxExtent = Math.max(maxExtent, d.w, d.h);
    x += d.w + PAD * 2; rowH = Math.max(rowH, d.h);
  }
  return { width: size, height: size, frames, image: canvas, maxExtent };
}

/** GPU-side atlas: color texture + frame table texture (2 RGBA32F texels per frame). */
export class GpuAtlas {
  readonly tex: WebGLTexture;
  readonly frameTex: WebGLTexture;
  constructor(gl: WebGL2RenderingContext, readonly atlas: Atlas) {
    const t = gl.createTexture(); if (!t) throw new Error("texture");
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlas.image as TexImageSource);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex = t;
    const n = atlas.frames.length;
    const data = new Float32Array(n * 8);
    atlas.frames.forEach((f, i) => {
      data.set([f.x / atlas.width, f.y / atlas.height, (f.x + f.w) / atlas.width, (f.y + f.h) / atlas.height, f.w, f.h, f.ax, f.ay], i * 8);
    });
    const ft = gl.createTexture(); if (!ft) throw new Error("texture");
    gl.bindTexture(gl.TEXTURE_2D, ft);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n * 2, 1, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.frameTex = ft;
  }
}
