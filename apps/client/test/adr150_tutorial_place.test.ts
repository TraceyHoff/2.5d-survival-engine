// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { placeCard, playerZone, type Rect } from "../src/tutorial/overlay.js";
const ov = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const layouts = { phoneP: { w: 390, h: 844 }, phoneL: { w: 844, h: 390 }, pad: { w: 1920, h: 1080 }, pc: { w: 1366, h: 768 } };
describe("ADR-150 tutorial card placement", () => {
  for (const [name, view] of Object.entries(layouts)) {
    it(`${name}: never covers the target, the player or the controls when a free spot exists`, () => {
      const card = { w: Math.min(280, view.w - 16), h: 130 };
      const stick: Rect = { x: 20, y: view.h - 170, w: 150, h: 150 }, btns: Rect = { x: view.w - 190, y: view.h - 220, w: 180, h: 210 };
      const hotbar: Rect = { x: view.w / 2 - 150, y: view.h - 60, w: 300, h: 56 }, hud: Rect = { x: 4, y: 4, w: 112, h: 70 };
      const target = btns; const avoid = [stick, hotbar, hud];
      const p = placeCard(view, card, target, avoid); const r = { ...p, ...card };
      expect(ov(r, target)).toBe(0);
      for (const a of avoid) expect(ov(r, a)).toBe(0);
      expect(ov(r, playerZone(view))).toBe(0);
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.w).toBeLessThanOrEqual(view.w); expect(r.y + r.h).toBeLessThanOrEqual(view.h);
    });
  }
});
