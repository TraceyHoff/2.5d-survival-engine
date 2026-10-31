// @vitest-environment jsdom
// ADR-243: °F is the default HUD temperature unit; °C only when the player picked it; the Settings toggle is a pair of
// buttons near the top of both Settings panels so gamepad (D-pad + A), touch and mouse all reach it.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { World } from "@engine/core";
import * as G from "@engine/gameplay";
import { mountHud } from "../src/hud.js";
import { loadTempUnit } from "../src/hud-temp.js";
import { loadSettings, resolveTempUnit, saveSettings, tempUnitControl } from "../src/menu.js";

const KEY = "engine-settings";
const stored = (): Record<string, unknown> => JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
let h: { destroy(): void } | undefined;
beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"></div>`; localStorage.clear(); });
afterEach(() => { h?.destroy(); h = undefined; });

describe("ADR-243 Fahrenheit default", () => {
  test("migration: new players, players who never touched it (incl. ADR-239's auto-saved tempUnit:'C') get °F; an explicit °C pick is kept", () => {
    expect(loadTempUnit()).toBe("F"); expect(resolveTempUnit(undefined)).toBe("F");
    localStorage.setItem(KEY, JSON.stringify({ bots: 2, showHud: true, tempUnit: "C" })); expect(loadTempUnit()).toBe("F"); expect(resolveTempUnit(loadSettings())).toBe("F");
    localStorage.setItem(KEY, JSON.stringify({ tempUnit: "F" })); expect(loadTempUnit()).toBe("F");
    localStorage.setItem(KEY, JSON.stringify({ tempUnit: "C", tempUnitChosen: true })); expect(loadTempUnit()).toBe("C"); expect(resolveTempUnit(loadSettings())).toBe("C");
    localStorage.setItem(KEY, "{not json"); expect(loadTempUnit()).toBe("F");
  });
  test("saving Settings without touching the toggle never records a choice; pressing °C records it; pressing °F after °C goes back", () => {
    localStorage.setItem(KEY, JSON.stringify({ tempUnit: "C" })); // ADR-239-era save
    let c = tempUnitControl(loadSettings()); expect(c.value()).toBe("F"); saveSettings({ ...loadSettings(), showHud: false, ...c.patch() });
    expect(stored()["tempUnitChosen"]).toBeUndefined(); expect(loadTempUnit()).toBe("F");
    c = tempUnitControl(loadSettings()); c.el.querySelector<HTMLButtonElement>("[data-unit=C]")!.click(); expect(c.value()).toBe("C");
    saveSettings({ ...loadSettings(), ...c.patch() }); expect(stored()).toMatchObject({ tempUnit: "C", tempUnitChosen: true }); expect(loadTempUnit()).toBe("C");
    c = tempUnitControl(loadSettings()); expect(c.value()).toBe("C"); saveSettings({ ...loadSettings(), ...c.patch() }); expect(loadTempUnit()).toBe("C"); // untouched re-save keeps the pick
    c.el.querySelector<HTMLButtonElement>("[data-unit=F]")!.click(); saveSettings({ ...loadSettings(), ...c.patch() }); expect(loadTempUnit()).toBe("F");
  });
  test("toggle is pad/touch friendly: real buttons (focusable, A = click), radio semantics, big hit targets, no wrapping <label>", () => {
    const c = tempUnitControl(undefined); document.body.append(c.el);
    expect(c.el.tagName).toBe("DIV"); expect(c.el.dataset["setting"]).toBe("tempUnit"); expect(c.el.getAttribute("role")).toBe("radiogroup"); expect(c.el.querySelector("select")).toBeNull();
    expect(c.el.textContent).toContain("Temperature");
    const bs = Array.from(c.el.querySelectorAll<HTMLButtonElement>("button"));
    expect(bs.map((b) => b.textContent)).toEqual(["°F", "°C"]); expect(bs.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    for (const b of bs) { expect(b.type).toBe("button"); expect(parseInt(b.style.minHeight)).toBeGreaterThanOrEqual(40); expect(parseInt(b.style.minWidth)).toBeGreaterThanOrEqual(44); b.focus(); expect(document.activeElement).toBe(b); }
    bs[1]!.click(); expect(bs.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true"]); expect(bs[1]!.className).toBe(""); expect(bs[0]!.className).toBe("alt");
  });
  test("the HUD gauge reads °F for a default player and °C once picked", () => {
    const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {});
    h = mountHud(() => w, () => undefined, { hours: 14, season: 0, weather: 0 });
    expect(document.querySelector("#hud [data-hud=temp]")!.textContent).toMatch(/^\d+°F$/);
    const f = Number(document.querySelector("#hud [data-hud=temp]")!.textContent!.replace("°F", "")); expect(f).toBeGreaterThanOrEqual(64); expect(f).toBeLessThanOrEqual(100);
    h.destroy(); document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"></div>`;
    localStorage.setItem(KEY, JSON.stringify({ tempUnit: "C", tempUnitChosen: true }));
    h = mountHud(() => w, () => undefined, { hours: 14, season: 0, weather: 0 }); expect(document.querySelector("#hud [data-hud=temp]")!.textContent).toMatch(/^\d+°C$/);
  });
});
