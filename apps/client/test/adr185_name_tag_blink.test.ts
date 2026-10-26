// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { PlayerId, PrevTransform, Transform, World, installPermissions } from "@engine/core";
import * as G from "@engine/gameplay";
import { nameTagPoints } from "../src/name-tags.js";

const cam = { x: 0, y: 0, viewW: 1920, viewH: 1080, dpr: 1, drawZoom: 1, cssToWorld: (x: number, y: number) => ({ x, y }) };

/** ADR-185: two overlapping players about equally far from me must keep one tag draw order while their distances jitter. */
describe("ADR-185: name tags do not blink over each other", () => {
  test("draw order is stable while the nearer-to-me player flips every frame", () => {
    const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w);
    const mk = (id: number, x: number, y: number) => { const e = G.spawnPlayer(w, { x, y, maxWeight: 0, clientId: id }); if (!w.has(e, PlayerId)) w.add(e, PlayerId, { id }); return e; };
    const me = mk(1, 0, 0); const a = mk(2, 5, 5); const b = mk(3, 5.6, 5.3); // b sits just below a on screen, tags overlap
    const names = { get: (id: number) => `P${id}` };
    const orders = new Set<string>();
    for (let f = 0; f < 12; f++) {
      const j = f % 2 ? 0.25 : -0.25; // interpolation jitter: which of the two is nearer to me alternates
      const ta = w.get(a, Transform)!; ta.x = 5 + j; ta.y = 5 + j; const tb = w.get(b, Transform)!; tb.x = 5.6 - j * 0.6; tb.y = 5.3 - j * 0.6;
      for (const e of [a, b]) if (w.has(e, PrevTransform)) w.remove(e, PrevTransform);
      const pts = nameTagPoints(w, me, cam, names);
      expect(Math.abs(pts[0]!.y - pts[1]!.y)).toBeLessThan(20); // overlapping tags
      orders.add(pts.map((p) => p.name).join(","));
    }
    expect([...orders]).toEqual(["P2,P3"]);
  });
});
