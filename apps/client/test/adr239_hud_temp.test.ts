// @vitest-environment jsdom
// ADR-239: HUD temperature gauge in the vitals panel (°C default, °F setting) + season glyph; layout hooks that keep it clear of other HUD.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { World, Season, setSeason, TimeOfDay } from "@engine/core";
import * as G from "@engine/gameplay";
import { mountHud, WEATHER_LABEL } from "../src/hud.js";
import { formatTemp, gaugeFrac, hudAirTemp, loadTempUnit, tempBand, toF } from "../src/hud-temp.js";
import { tempUnitControl } from "../src/menu.js";
import { sampleDayClock, serverDays } from "../src/day-clock.js";

const world = (): World => { const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); return w; };
let h: { destroy(): void } | undefined;
beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"></div>`; localStorage.clear(); });
afterEach(() => { h?.destroy(); h = undefined; });

describe("ADR-239 HUD temperature gauge", () => {
  test("formatting, °F conversion, gauge scale and comfort bands", () => {
    expect(formatTemp(24.4, "C")).toBe("24°C"); expect(formatTemp(-7.6, "C")).toBe("−8°C"); expect(formatTemp(24.4)).toBe("76°F"); expect(formatTemp(0, "F")).toBe("32°F"); expect(formatTemp(30, "F")).toBe("86°F");
    expect(toF(-15)).toBe(5); expect(gaugeFrac(-50)).toBe(0); expect(gaugeFrac(100)).toBe(1); expect(gaugeFrac(10)).toBeCloseTo(0.5, 9);
    expect(tempBand(-3)).toBe("cold"); expect(tempBand(20)).toBe("mild"); expect(tempBand(35)).toBe("hot");
  });
  test("°F by default (ADR-243); the Settings toggle offers °F / °C and the HUD reads the stored unit", () => {
    expect(loadTempUnit()).toBe("F"); const c = tempUnitControl(undefined); expect(c.value()).toBe("F"); expect(Array.from(c.el.querySelectorAll("button")).map((o) => o.dataset["unit"])).toEqual(["F", "C"]);
    localStorage.setItem("engine-settings", JSON.stringify({ tempUnit: "F" })); expect(loadTempUnit()).toBe("F");
    const w = world(); h = mountHud(() => w, () => undefined, { hours: 14, season: 0, weather: 0 });
    expect(document.querySelector("#hud [data-hud=temp]")!.textContent).toMatch(/^-?−?\d+°F$/);
  });
  test("the gauge row lives in the vitals panel under the four stat bars, and shows season-appropriate temperatures", () => {
    const w = world(); const temps: number[] = [];
    for (const [season, lo, hi] of [[0, 18, 38], [1, 3, 20], [2, -20, 5]] as const) {
      h?.destroy(); document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"></div>`;
      h = mountHud(() => w, () => undefined, { hours: 14, season, weather: 0, unit: "C" });
      const rows = Array.from(document.querySelectorAll("#hud .row")).map((r) => (r as HTMLElement).dataset["stat"]);
      expect(rows).toEqual(["hp", "hunger", "thirst", "stamina", "temp"]);
      const t = Number(document.querySelector("#hud [data-hud=temp]")!.textContent!.replace("−", "-").replace("°C", "")); temps.push(t);
      expect(t).toBeGreaterThanOrEqual(lo); expect(t).toBeLessThanOrEqual(hi);
      expect(document.querySelector("#hud [data-hud=season]")!.textContent).toBe(["☀", "🍂", "❄"][season]);
      const air = document.querySelector<HTMLElement>("#hud .row[data-stat=temp] .air")!; expect(parseFloat(air.style.left)).toBeGreaterThan(0);
    }
    expect(temps[0]!).toBeGreaterThan(temps[1]!); expect(temps[1]!).toBeGreaterThan(temps[2]!);
  });
  test("layout: compact readout never wraps, panel width unchanged, short-viewport (phone landscape) rules, XP chip stacks below", () => {
    const w = world(); h = mountHud(() => w, () => undefined, {});
    const css = Array.from(document.querySelectorAll("style")).map((s) => s.textContent).join("\n");
    expect(css).toContain("width:clamp(112px,18vw,150px)"); // same footprint as before: no new overlap with the menubar / touch controls
    expect(css).toMatch(/\.row\[data-stat=temp\] \.tv\{flex:none;min-width:30px[^}]*white-space:nowrap/);
    expect(css).toMatch(/@media \(max-height:420px\)\{[^\n]*\.row\[data-stat=temp\] \.tv\{min-width:26px;font-size:9px\}/);
    expect(css).toMatch(/\[data-hud=weather\]\{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap/);
    expect(document.querySelector("#hud")!.contains(document.querySelector("[data-stat=temp]"))).toBe(true);
  });
  test("weather labels cover the seasonal kinds; client day count tracks the server tick", () => {
    expect(WEATHER_LABEL.slice(5)).toEqual(["Overcast", "Heat", "Blizzard", "Windy"]);
    const w = world(); const td = w.env(TimeOfDay); td.dayLengthTicks = 100; td.epochTick = 0;
    expect(serverDays(w, { serverTickEstimate: 250 })).toBeCloseTo(2.5, 9);
    sampleDayClock(w, { serverTickEstimate: 250 }, 0, 0);
    setSeason(w, 2); expect(w.env(Season).lengthDays).toBeGreaterThan(0);
    expect(hudAirTemp(w, 0.6, 3)).toBeLessThan(hudAirTemp(w, 0.6 + w.env(Season).lengthDays, 0) + 50); // finite, model wired
  });
});
