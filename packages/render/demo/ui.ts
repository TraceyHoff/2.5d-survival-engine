/** Debug overlay (plain DOM). */
import { setTimeOfDay, timeOfDay, Weather, type World } from "@engine/core";
import type { IsoRenderer } from "../src/index.js";

export const WEATHER_NAMES = ["clear", "rain", "storm", "snow", "fog"] as const;

export class DebugUI {
  readonly root: HTMLDivElement;
  private statsEl: HTMLPreElement;
  private timeSlider!: HTMLInputElement;
  private timeLabel!: HTMLSpanElement;
  freeze = false;
  follow = false;
  interpolate = true;

  constructor(private world: World, private renderer: IsoRenderer, freeze: boolean) {
    this.freeze = freeze;
    const r = (this.root = document.createElement("div"));
    r.style.cssText = "position:fixed;top:8px;left:8px;background:rgba(10,12,18,.78);color:#dfe6ee;font:12px/1.4 ui-monospace,monospace;padding:8px 10px;border-radius:6px;min-width:250px;user-select:none;z-index:10";
    this.statsEl = document.createElement("pre"); this.statsEl.style.margin = "0 0 6px";
    r.appendChild(this.statsEl);
    const row = (label: string, el: HTMLElement): void => {
      const d = document.createElement("label"); d.style.cssText = "display:flex;gap:6px;align-items:center;margin:3px 0";
      const s = document.createElement("span"); s.textContent = label; s.style.minWidth = "64px"; d.append(s, el); r.appendChild(d);
    };
    // time of day
    const tod = timeOfDay(world);
    const ts = (this.timeSlider = document.createElement("input")); ts.type = "range"; ts.min = "0"; ts.max = "24"; ts.step = "0.05";
    ts.value = String(tod.hours); ts.style.width = "130px";
    ts.oninput = () => { setTimeOfDay(world, Number(ts.value)); };
    this.timeLabel = document.createElement("span");
    const tw = document.createElement("span"); tw.style.cssText = "display:flex;gap:6px;align-items:center"; tw.append(ts, this.timeLabel);
    row("time", tw);
    row("freeze", this.check(this.freeze, (v) => (this.freeze = v)));
    // weather
    const sel = document.createElement("select");
    WEATHER_NAMES.forEach((n, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = n; sel.appendChild(o); });
    const wr = world.env(Weather); sel.value = String(wr.kind);
    sel.onchange = () => { const w = world.env(Weather); w.kind = Number(sel.value); if (w.intensity <= 0) w.intensity = 1; };
    row("weather", sel);
    const wi = document.createElement("input"); wi.type = "range"; wi.min = "0"; wi.max = "1"; wi.step = "0.05"; wi.value = String(wr.intensity || 1); wi.style.width = "130px";
    wi.oninput = () => { world.env(Weather).intensity = Number(wi.value); };
    row("intensity", wi);
    const s = renderer.settings;
    row("lights", this.check(s.lights, (v) => (s.lights = v)));
    row("shadows", this.check(s.shadows, (v) => (s.shadows = v)));
    row("fog", this.check(s.fog, (v) => (s.fog = v)));
    row("particles", this.check(s.weather, (v) => (s.weather = v)));
    row("follow", this.check(this.follow, (v) => (this.follow = v)));
    row("interp", this.check(this.interpolate, (v) => (this.interpolate = v)));
    const help = document.createElement("div"); help.style.cssText = "opacity:.7;margin-top:4px";
    help.textContent = "drag/WASD pan · wheel zoom · arrows move player · F follow · H hide";
    r.appendChild(help);
    document.body.appendChild(r);
  }

  private check(v: boolean, on: (v: boolean) => void): HTMLInputElement {
    const c = document.createElement("input"); c.type = "checkbox"; c.checked = v; c.onchange = () => on(c.checked); return c;
  }

  update(text: string): void {
    this.statsEl.textContent = text;
    const h = timeOfDay(this.world).hours;
    if (document.activeElement !== this.timeSlider) this.timeSlider.value = String(h);
    this.timeLabel.textContent = `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
    void this.renderer;
  }
}
