/**
 * Survival HUD in Art's "cozy-camp" UI theme (assets/ui/theme.json palette + Fredoka, served at `<base>art/ui/`):
 * health / hunger / thirst / stamina bars, ADR-239 temperature gauge, clock, season and weather. Plain DOM, hooks: `#hud`, `[data-stat=...]`.
 * Compact and anchored top-left inside the safe area (`--sat/--sal` from ./ui-root.ts), click-through (pointer-events:none)
 * so it never eats taps meant for the touch controls, which live in the lower half / right edge.
 */
import { mountUi } from "./ui-root.js";
import { Weather, type Entity, type World } from "@engine/core";
import { dayCount, dayHours } from "./day-clock.js";
import { Exposure, Health, Survival } from "@engine/gameplay";
import { seasonAtDays } from "@engine/core";
import { formatTemp, gaugeFrac, GAUGE_GRADIENT, hudAirTemp, loadTempUnit, SEASON_GLYPH, SEASON_LABEL, tempBand, type TempUnit } from "./hud-temp.js";

export const WEATHER_LABEL = ["Clear", "Rain", "Storm", "Snow", "Fog", "Overcast", "Heat", "Blizzard", "Windy"];
const STATS = [
  { key: "hp", label: "❤", color: "#E8475F" }, { key: "hunger", label: "🍖", color: "#F4A74A" },
  { key: "thirst", label: "💧", color: "#5CC6DC" }, { key: "stamina", label: "⚡", color: "#FFD45A" },
] as const;

export interface HudOverrides { hours?: number; weather?: number; /** ADR-239 ?season= (0 summer, 1 fall, 2 winter) */ season?: number; /** tests: unit instead of Settings */ unit?: TempUnit }
type Frame = { frame: { x: number; y: number; w: number; h: number }; nineSlice?: { l: number; t: number; r: number; b: number } };

/** Art's ui_atlas sprites (assets/ui/atlas) as data URLs, so CSS can nine-slice them via border-image. */
async function uiSprites(base: string): Promise<{ url(k: string): string | undefined; frame(k: string): Frame | undefined }> {
  const empty = { url: () => undefined, frame: () => undefined };
  try {
    const j = await fetch(`${base}art/ui/atlas/ui_atlas.json`).then((r) => r.json()) as { frames: Record<string, Frame> };
    const img = new Image(); img.src = `${base}art/ui/atlas/ui_atlas.png`; await img.decode();
    const cache = new Map<string, string>();
    return {
      frame: (k) => j.frames[k],
      url: (k) => {
        const f = j.frames[k]; if (!f) return undefined; let u = cache.get(k);
        if (!u) { const c = document.createElement("canvas"); c.width = f.frame.w; c.height = f.frame.h; c.getContext("2d")!.drawImage(img, f.frame.x, f.frame.y, f.frame.w, f.frame.h, 0, 0, f.frame.w, f.frame.h); u = c.toDataURL(); cache.set(k, u); }
        return u;
      },
    };
  } catch { return empty; }
}
const SPRITE_KEYS = ["health", "hunger", "thirst", "stamina"] as const;

/** Days to evaluate the temperature at when ?season= / ?time= override the view (middle of the overridden season). */
export function overrideDays(w: World, days: number, ov: HudOverrides): number {
  const L = seasonAtDays(w, 0).lengthDays; const day = Math.floor(days), t = ov.hours !== undefined ? ov.hours / 24 : days - day;
  if (ov.season === undefined || !(L > 0)) return day + t;
  const s = seasonAtDays(w, day); const base = day - Math.floor(s.into); // start of the current season (whole days)
  const target = Math.floor(((ov.season % 3) + 3) % 3);
  return base + (((target - s.index) % 3) + 3) % 3 * L + Math.floor(L / 2) + t;
}
export function mountHud(world: () => World, player: () => Entity | undefined, ov: HudOverrides = {}): { destroy(): void } {
  const base = import.meta.env.BASE_URL;
  const style = document.createElement("style");
  style.textContent = `@font-face{font-family:Fredoka;src:url(${base}art/ui/fonts/Fredoka.ttf) format("truetype");font-display:swap}
#hud{position:absolute;left:calc(6px + var(--sal,0px));top:calc(6px + var(--sat,0px));z-index:5;font:600 11px/1.1 Fredoka,system-ui,sans-serif;color:#3B2433;background:rgba(246,234,210,.88);
border:2px solid #74432C;border-radius:10px;box-shadow:0 2px 0 #432C24;padding:4px 6px;width:clamp(112px,18vw,150px);box-sizing:border-box;user-select:none;pointer-events:none}
#hud .row{display:flex;align-items:center;gap:4px;margin:2px 0}#hud .bar{flex:1;height:6px;background:#E6C47E;border:1px solid #4A2F3D;border-radius:4px;overflow:hidden}
#hud .lab{display:flex;width:14px;font-size:10px;justify-content:center}
#hud .fill{height:100%;border-radius:3px;transition:width .2s}#hud .clock{display:flex;justify-content:space-between;margin-bottom:2px;color:#61402E;font-size:10px}
#hud .clock .l{min-width:0;white-space:nowrap}#hud [data-hud=weather]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:3px}
#hud [data-hud=season]{margin-left:2px;font-size:10px}
#hud .row[data-stat=temp] .bar{position:relative;overflow:visible}#hud .row[data-stat=temp] .grad{position:absolute;inset:0;border-radius:3px;background:${GAUGE_GRADIENT}}
#hud .row[data-stat=temp] .air{position:absolute;top:-2px;bottom:-2px;width:3px;margin-left:-1.5px;background:#FFFAF0;border:1px solid #3B2433;border-radius:2px;box-sizing:border-box;transition:left .4s}
#hud .row[data-stat=temp] .felt{position:absolute;top:-4px;width:0;height:0;margin-left:-3px;border:3px solid transparent;border-top-color:#3B2433;transition:left .4s}
#hud .row[data-stat=temp] .tv{flex:none;min-width:30px;text-align:right;font-size:10px;white-space:nowrap}
#hud .row[data-stat=temp][data-band=cold] .tv{color:#5A9BFF}#hud .row[data-stat=temp][data-band=hot] .tv{color:#FF6A4A}
@media (max-height:420px){#hud{width:100px;padding:2px 4px;opacity:.9}#hud .bar{height:5px}#hud .row{margin:1px 0}#hud .row[data-stat=temp] .tv{min-width:26px;font-size:9px}}`;
  document.head.append(style);
  const root = document.createElement("div"); root.id = "hud";
  const clock = document.createElement("div"); clock.className = "clock"; root.append(clock);
  const clockIcon = document.createElement("img"); clockIcon.className = "ic"; clockIcon.alt = "";
  const clockText = document.createElement("span"); clockText.dataset["hud"] = "clock";
  const weatherText = document.createElement("span"); weatherText.dataset["hud"] = "weather";
  const seasonText = document.createElement("span"); seasonText.dataset["hud"] = "season";
  const left = document.createElement("span"); left.className = "l"; left.append(clockIcon, clockText, seasonText); clock.append(left, weatherText);
  const icons: HTMLImageElement[] = [];
  let ui: Awaited<ReturnType<typeof uiSprites>> | undefined;
  const fills = STATS.map((s) => {
    const row = document.createElement("div"); row.className = "row"; row.dataset["stat"] = s.key;
    const l = document.createElement("span"); l.className = "lab"; l.textContent = s.label; const ic = document.createElement("img"); ic.className = "ic"; ic.alt = s.key; ic.style.display = "none"; icons.push(ic); l.prepend(ic); const bar = document.createElement("div"); bar.className = "bar";
    const f = document.createElement("div"); f.className = "fill"; f.style.background = s.color; bar.append(f); row.append(l, bar); root.append(row); return f;
  });
  // ADR-239 temperature gauge: air-temperature marker on a cold→hot gradient, felt-temperature caret, "24°C" readout
  const tRow = document.createElement("div"); tRow.className = "row"; tRow.dataset["stat"] = "temp";
  const tLab = document.createElement("span"); tLab.className = "lab"; tLab.textContent = "🌡"; const tIc = document.createElement("img"); tIc.className = "ic"; tIc.alt = "temp"; tIc.style.display = "none"; tLab.prepend(tIc);
  const tBar = document.createElement("div"); tBar.className = "bar"; const tAir = document.createElement("i"); tAir.className = "air"; const tFelt = document.createElement("i"); tFelt.className = "felt"; const tGrad = document.createElement("i"); tGrad.className = "grad"; tBar.append(tGrad, tAir, tFelt); // gradient as a child so the bar_track nine-slice frame (fill) stays around it
  const tVal = document.createElement("span"); tVal.className = "tv"; tVal.dataset["hud"] = "temp"; tRow.append(tLab, tBar, tVal); root.append(tRow);
  let unit: TempUnit = ov.unit ?? loadTempUnit(), unitAt = 0, tempIcon = "", hudBottom = -1;
  mountUi(root);
  // Art's UI kit: panel_hud plaque, bar_track / bar_fill_* nine-slices, vital_* icons (falls back to the CSS look)
  void uiSprites(base).then((u) => {
    ui = u; const css: string[] = [];
    const nine = (sel: string, k: string, extra = ""): void => { const url = u.url(k), f = u.frame(k); if (!url || !f?.nineSlice) return; const n = f.nineSlice;
      css.push(`${sel}{border-style:solid;border-width:${n.t / 2}px ${n.r / 2}px ${n.b / 2}px ${n.l / 2}px;border-image:url(${url}) ${n.t} ${n.r} ${n.b} ${n.l} fill stretch;background:none;${extra}}`); };
    nine("#hud", "panel_hud", "border-radius:0;box-shadow:none;color:#FFFAF0;padding:2px 4px;text-shadow:0 1px 0 #3B2433");
    nine("#hud .bar", "bar_track", "border-radius:0;height:5px");
    SPRITE_KEYS.forEach((k, i) => nine(`#hud .row[data-stat="${STATS[i]!.key}"] .fill`, `bar_fill_${k}`, "border-radius:0;height:0;margin:-1px 0;box-sizing:border-box;min-width:7px"));
    css.push("#hud .clock{color:#FFE7A8}#hud .ic{width:13px;height:13px;vertical-align:middle;image-rendering:auto}#hud .l{display:flex;align-items:center;gap:3px}#hud .lab{display:flex;width:14px}");
    const st = document.createElement("style"); st.textContent = css.join("\n"); style.after(st);
    icons.forEach((ic, i) => { const url = u.url(`vital_${SPRITE_KEYS[i]}`); if (url) { ic.src = url; ic.style.display = ""; ic.nextSibling?.remove(); } });
    if (u.url("icon_temp")) { tIc.style.display = ""; tIc.nextSibling?.remove(); } // Art's thermometer (icon_temp[_hot|_cold]) once it lands in the UI atlas
    update();
  });
  const update = (): void => {
    const w = world(); const p = player();
    try {
      const h = ov.hours ?? dayHours(); const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
      const wk = ov.weather ?? w.env(Weather).kind;
      clockText.textContent = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}${ov.hours !== undefined ? "*" : ""}`;
      weatherText.textContent = `${WEATHER_LABEL[wk] ?? "?"}${ov.weather !== undefined ? "*" : ""}`;
      clock.title = ov.hours !== undefined || ov.weather !== undefined ? "* view override (?time= / ?weather=)" : "";
      const night = h < 6 || h >= 19; if (ui) { const u = ui.url(night ? "ic_moon" : "ic_sun"); if (u && clockIcon.dataset["k"] !== String(night)) { clockIcon.src = u; clockIcon.dataset["k"] = String(night); } }
    } catch { clockText.textContent = ""; weatherText.textContent = ""; }
    try { // ADR-239 season + temperature
      const days = dayCount(), si = ov.season !== undefined ? Math.floor(((ov.season % 3) + 3) % 3) : seasonAtDays(w, days).index;
      seasonText.textContent = SEASON_GLYPH[si] ?? ""; seasonText.title = `${SEASON_LABEL[si] ?? ""}${ov.season !== undefined ? " (view override ?season=)" : ""}`;
      const now = Date.now(); if (!ov.unit && now - unitAt > 1000) { unitAt = now; unit = loadTempUnit(); }
      const ovr = ov.season !== undefined || ov.hours !== undefined || ov.weather !== undefined;
      const air = hudAirTemp(w, ovr ? overrideDays(w, days, ov) : days, ov.weather);
      const ex = p !== undefined ? w.get(p, Exposure) : undefined;
      // view-only overrides (?season/?time/?weather) shift the replicated felt temp by the same air delta (clothing/shelter offset kept)
      const felt = ex ? (ovr ? ex.feltTemp + air - hudAirTemp(w, days) : ex.feltTemp) : undefined;
      const band = tempBand(felt ?? air); tRow.dataset["band"] = band;
      tAir.style.left = `${(gaugeFrac(air) * 100).toFixed(1)}%`; tVal.textContent = formatTemp(air, unit);
      if (felt !== undefined && Math.abs(felt - air) >= 1) { tFelt.style.display = ""; tFelt.style.left = `${(gaugeFrac(felt) * 100).toFixed(1)}%`; } else tFelt.style.display = "none";
      tRow.title = `Air ${formatTemp(air, unit)}${felt !== undefined ? ` · feels like ${formatTemp(felt, unit)}` : ""}`;
      if (ui) { const k = band === "mild" ? "icon_temp" : `icon_temp_${band}`; const url = ui.url(k) ?? ui.url("icon_temp"); if (url && tempIcon !== k) { tIc.src = url; tempIcon = k; } }
    } catch { tVal.textContent = ""; }
    const hp = p !== undefined ? w.get(p, Health) : undefined, sv = p !== undefined ? w.get(p, Survival) : undefined;
    const vals = [hp ? hp.hp / (hp.max || 100) : 1, sv ? sv.hunger / 100 : 1, sv ? sv.thirst / 100 : 1, sv ? sv.stamina / (sv.maxStamina || 100) : 1];
    if (ui) vals.forEach((v, i) => { const low = v < 0.25; const ic = icons[i]!; if (ic.dataset["low"] !== String(low)) { const u = ui!.url(`vital_${SPRITE_KEYS[i]}${low ? "_low" : ""}`); if (u) { ic.src = u; ic.dataset["low"] = String(low); } } });
    // ADR-239: publish the HUD's bottom edge so the touch XP chip (gather-fx) stacks under the taller panel, never over it
    const hb = root.offsetTop + root.offsetHeight + 4; if (root.offsetHeight > 0 && hb !== hudBottom) { hudBottom = hb; document.documentElement.style.setProperty("--hud-bottom", `${hb}px`); }
    vals.forEach((v, i) => { fills[i]!.style.width = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`; });
  };
  const timer = setInterval(update, 250); update();
  return { destroy: () => { clearInterval(timer); root.remove(); style.remove(); } };
}
