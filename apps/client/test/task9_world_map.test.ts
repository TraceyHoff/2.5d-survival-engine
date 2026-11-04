// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { World, Transform } from "@engine/core";
import { canvasToWorld, worldToCanvas, markerPinColor, createWorldMap, MARKER_VISIBILITY_LABELS } from "../src/world-map.js";
import { mountCompassHud, compassHudText } from "../src/compass-hud.js";

describe("world-map coordinate helpers", () => {
  it("canvas centre maps to centre, and back", () => {
    const c = { x: 100, y: 50 }, s = 8, W = 480, H = 360;
    expect(canvasToWorld(W / 2, H / 2, W, H, c, s)).toEqual(c);
    expect(canvasToWorld(W / 2 + 16, H / 2 - 8, W, H, c, s)).toEqual({ x: 102, y: 49 });
    const p = worldToCanvas(102, 49, W, H, c, s); expect(p.px).toBeCloseTo(W / 2 + 16); expect(p.py).toBeCloseTo(H / 2 - 8);
  });
  it("north is up: a smaller world y is a smaller canvas py", () => {
    const c = { x: 0, y: 0 }; expect(worldToCanvas(0, -10, 480, 360, c, 8).py).toBeLessThan(worldToCanvas(0, 10, 480, 360, c, 8).py);
  });
  it("pin colours differ per visibility", () => {
    expect(markerPinColor(0)).not.toBe(markerPinColor(1)); expect(markerPinColor(1)).not.toBe(markerPinColor(2));
    expect(MARKER_VISIBILITY_LABELS).toEqual(["Private", "Party", "Clan"]);
  });
});

describe("world-map panel (DOM, no canvas context in jsdom)", () => {
  const mk = () => { const world = new World(); const player = world.create(); world.add(player, Transform, { x: 10, y: 20, z: 0, facing: 0 });
    const sent: unknown[] = []; const src = { world: () => world, player: () => player, tiles: () => undefined, send: (i: unknown) => { sent.push(i); return true; } };
    const m = createWorldMap(src as never); document.body.append(m.el); return { m, sent, el: m.el }; };
  it("mounts canvas, pan/centre/zoom/mark buttons and a hidden marker form", () => {
    const { m, el } = mk();
    expect(el.querySelector('[data-role="map-canvas"]')).not.toBeNull();
    expect(el.querySelector('[data-role="marker-form"]')?.getAttribute("hidden")).not.toBeNull();
    expect(el.textContent).toContain("Mark my location"); expect(el.textContent).toContain("Centre on me");
    m.destroy();
  });
  it("Mark my location opens the form; Place sends a marker intent", () => {
    const { m, el, sent } = mk();
    (el.querySelector("button") as HTMLButtonElement | null); // controls exist
    const markBtn = [...el.querySelectorAll("button")].find((b) => b.textContent === "Mark my location")!; markBtn.click();
    const form = el.querySelector('[data-role="marker-form"]') as HTMLElement; expect(form.hidden).toBe(false);
    (form.querySelector("input") as HTMLInputElement).value = "Home base";
    (form.querySelector('[data-role="submit"]') as HTMLButtonElement).click();
    expect(sent.length).toBe(1); expect(form.hidden).toBe(true);
    m.destroy();
  });
});

describe("compass HUD", () => {
  it("text: east 90°, north 0°", () => {
    expect(compassHudText(0)).toBe("E 90°"); expect(compassHudText(-Math.PI / 2)).toBe("N 0°");
  });
  it("mounts, hides when no heading, shows dir + degrees when visible", () => {
    let h: { heading: number; dir: string } | undefined = { heading: 90, dir: "E" };
    const hud = mountCompassHud({ heading: () => h }); document.body.append(hud.el);
    hud.update(true); expect(hud.el.hidden).toBe(false); expect(hud.el.textContent).toContain("E 90°");
    h = undefined; hud.update(true); expect(hud.el.hidden).toBe(true);
    hud.destroy();
  });
});
