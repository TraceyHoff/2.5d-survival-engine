import { describe, it, expect } from "vitest";
import { DEFAULT_ISO, CHUNK_SIZE, toView, fromView, viewRect, worldToScreen, screenToWorld, isoDepth, type IsoConfig } from "@engine/world";
import { IsoCamera } from "../src/camera.js";
import { cliffShade, CLIFF_PX, CLIFF_PY, CLIFF_NX, CLIFF_NY } from "../src/tilemap.js";
import { viewCellToTile } from "../src/terrainTiles.js";
import { visibleChunkKeys } from "../src/sprites.js";
import { rotSideMask, SIDE_PX, SIDE_PY, SIDE_NX, SIDE_NY } from "../src/building/deckFaces.js";
import { isoPlace } from "../src/stalls/stallLogic.js";
import { chimneySmokePoint } from "../src/building/chimney.js";

const isoQ = (q: number): IsoConfig => ({ ...DEFAULT_ISO, view: q });

describe("ADR-253 view rotation math", () => {
  it("q = 0 is the legacy projection, bit for bit", () => {
    for (const [x, y, z] of [[0, 0, 0], [3.25, -7.5, 1], [-12, 40.125, 2.5]] as const) {
      const a = worldToScreen(x, y, z, DEFAULT_ISO), b = worldToScreen(x, y, z, isoQ(0));
      expect(b).toEqual(a);
      expect(a.sx).toBe((x - y) * DEFAULT_ISO.tileW / 2);
      expect(isoDepth(x, y, z)).toBe(x + y + z * 0.001); expect(isoDepth(x, y, z, 0)).toBe(isoDepth(x, y, z));
    }
  });
  it("toView / fromView invert each other and screenToWorld inverts worldToScreen in every quarter", () => {
    for (let q = 0; q < 4; q++) for (const [x, y] of [[1.5, 2.25], [-9, 4], [0.1, -33.7]] as const) {
      const v = toView(x, y, q), w = fromView(v.u, v.v, q); expect(w.x).toBeCloseTo(x, 9); expect(w.y).toBeCloseTo(y, 9);
      const s = worldToScreen(x, y, 0, isoQ(q)), b = screenToWorld(s.sx, s.sy, 0, isoQ(q)); expect(b.x).toBeCloseTo(x, 9); expect(b.y).toBeCloseTo(y, 9);
    }
  });
  it("one quarter turns world +x into view +v (screen lower-left) and four quarters are the identity", () => {
    expect(toView(1, 0, 1)).toEqual({ u: 0, v: 1 });
    let p = { x: 3, y: -2 }; for (let i = 0; i < 4; i++) { const v = toView(p.x, p.y, 1); p = { x: v.u, y: v.v }; }
    expect(p).toEqual({ x: 3, y: -2 });
  });
  it("viewRect holds exactly the rotated cells, and viewCellToTile maps them back", () => {
    for (let q = 0; q < 4; q++) {
      const ax = -3, ay = 5, fw = 3, fh = 2; const r = viewRect(ax, ay, fw, fh, q); const seen = new Set<string>();
      for (let y = ay; y < ay + fh; y++) for (let x = ax; x < ax + fw; x++) {
        const c = toView(x + 0.5, y + 0.5, q); const X = Math.floor(c.u), Y = Math.floor(c.v);
        expect(X >= r.x && X < r.x + r.w && Y >= r.y && Y < r.y + r.h).toBe(true);
        expect(viewCellToTile(X, Y, q)).toEqual({ x: x + 0, y: y + 0 }); seen.add(`${X},${Y}`);
      }
      expect(seen.size).toBe(r.w * r.h);
    }
  });
});

describe("ADR-253 camera", () => {
  it("setView keeps the pivot at the same screen offset from the camera and is a no-op for the same quarter", () => {
    const cam = new IsoCamera(); cam.lookAt(10, 4); cam.x += 37; cam.y -= 11;
    const pv = { x: 10, y: 4, z: 0 };
    const off = (): [number, number] => { const s = worldToScreen(pv.x, pv.y, 0, cam.iso); return [cam.x - s.sx, cam.y - s.sy]; };
    const o0 = off();
    for (const q of [1, 2, 3, 0, 3]) { cam.setView(q, pv); expect(cam.view).toBe(q); const o = off(); expect(o[0]).toBeCloseTo(o0[0], 9); expect(o[1]).toBeCloseTo(o0[1], 9); }
    expect(DEFAULT_ISO.view ?? 0).toBe(0); // the shared default is never mutated
    cam.setView(-1); expect(cam.view).toBe(3); cam.setView(6); expect(cam.view).toBe(2);
  });
});

describe("ADR-253 tiles, decks, attach points", () => {
  it("cliff faces shade by their view normal: exactly two visible faces per quarter", () => {
    expect(cliffShade(CLIFF_PX, 0)).toBe(0.62); expect(cliffShade(CLIFF_PY, 0)).toBe(0.8);
    expect(cliffShade(CLIFF_NX, 0)).toBe(0); expect(cliffShade(CLIFF_NY, 0)).toBe(0);
    expect(cliffShade(CLIFF_NY, 1)).toBe(0.62); expect(cliffShade(CLIFF_PX, 1)).toBe(0.8);
    for (let q = 0; q < 4; q++) expect([CLIFF_PX, CLIFF_PY, CLIFF_NX, CLIFF_NY].filter((f) => cliffShade(f, q) > 0).length).toBe(2);
  });
  it("deck side masks rotate with the view", () => {
    expect(rotSideMask(SIDE_PX, 1)).toBe(SIDE_PY); expect(rotSideMask(SIDE_PY, 1)).toBe(SIDE_NX);
    expect(rotSideMask(SIDE_NX, 1)).toBe(SIDE_NY); expect(rotSideMask(SIDE_NY, 1)).toBe(SIDE_PX);
    for (let m = 0; m < 16; m++) { expect(rotSideMask(m, 0)).toBe(m); expect(rotSideMask(rotSideMask(m, 1), 3)).toBe(m); expect(rotSideMask(m, 2)).toBe(rotSideMask(rotSideMask(m, 1), 1)); }
  });
  it("visibleChunkKeys covers the same world chunks the rotated view shows", () => {
    const hw = 32, hh = 16, rect = { x0: -400, y0: -300, x1: 400, y1: 300 };
    for (let q = 0; q < 4; q++) {
      const keys = new Set(visibleChunkKeys(rect, hw, hh, 16, 4, q));
      // every world tile whose view projection lands mid-rect must be in a listed chunk
      for (const [sx, sy] of [[0, 0], [-350, -250], [350, 250], [300, -200]] as const) {
        const w = screenToWorld(sx, sy, 0, isoQ(q)); const k = `${Math.floor(w.x / CHUNK_SIZE)},${Math.floor(w.y / CHUNK_SIZE)}`;
        expect(keys.has(k)).toBe(true);
      }
    }
  });
  it("isoPlace finds the world point that projects to the attach pixel in every quarter", () => {
    const hw = 32, hh = 16, zs = 16, zf = 1 / 3;
    for (let q = 0; q < 4; q++) {
      const p = isoPlace(37, -12, 20.3, hw, hh, zs, zf, q); const s = worldToScreen(p.x, p.y, p.z, isoQ(q));
      expect(s.sx).toBeCloseTo(37, 6); expect(s.sy).toBeCloseTo(-12, 6);
      const v = toView(p.x, p.y, q); expect(v.u + v.v + p.z * zf).toBeCloseTo(20.3, 6);
    }
  });
  it("chimney smoke stays on the chimney: q = 0 unchanged, rotated views put it at the same screen offset", () => {
    const at = { x: 6, y: -46 }; const iso0 = { tileW: 64, zStep: 16 };
    const p0 = chimneySmokePoint(4, 7, false, 0, 2, 2, 0, at, false, iso0);
    expect(chimneySmokePoint(4, 7, false, 0, 2, 2, 0, at, false, { ...iso0, view: 0 })).toEqual(p0);
    const piv0 = worldToScreen(5, 8, 0, isoQ(0)), s0 = worldToScreen(p0.x, p0.y, p0.z, isoQ(0));
    for (let q = 1; q < 4; q++) {
      const p = chimneySmokePoint(4, 7, false, 0, 2, 2, 0, at, false, { ...iso0, view: q });
      const piv = worldToScreen(5, 8, 0, isoQ(q)), s = worldToScreen(p.x, p.y, p.z, isoQ(q));
      expect(s.sx - piv.sx).toBeCloseTo(s0.sx - piv0.sx, 6); expect(s.sy - piv.sy).toBeCloseTo(s0.sy - piv0.sy, 6);
    }
  });
});
