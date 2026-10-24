/**
 * Survival HUD in Art's "cozy-camp" UI theme (assets/ui/theme.json palette + Fredoka, served at `<base>art/ui/`):
 * health / hunger / thirst / stamina bars, clock and weather. Plain DOM, hooks: `#hud`, `[data-stat=...]`.
 * Compact and anchored top-left inside the safe area (`--sat/--sal` from ./ui-root.ts), click-through (pointer-events:none)
 * so it never eats taps meant for the touch controls, which live in the lower half / right edge.
 */
import { mountUi } from "./ui-root.js";
import { Weather, type Entity, type World } from "@engine/core";
import { dayHours } from "./day-clock.js";
import { Health, Survival } from "@engine/gameplay";

const WEATHER_LABEL = ["Clear", "Rain", "Storm", "Snow", "Fog"];
const STATS = [
  { key: "hp", label: "❤", color: "#E8475F" }, { key: "hunger", label: "🍖", color: "#F4A74A" },
  { key: "thirst", label: "💧", color: "#5CC6DC" }, { key: "stamina", label: "⚡", color: "#FFD45A" },
] as const;

export interface HudOverrides { hours?: number; weather?: number }
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

export function mountHud(world: () => World, player: () => Entity | undefined, ov: HudOverrides = {}): { destroy(): void } {
  const base = import.meta.env.BASE_URL;
  const style = document.createElement("style");
  style.textContent = `@font-face{font-family:Fredoka;src:url(${base}art/ui/fonts/Fredoka.ttf) format("truetype");font-display:swap}
#hud{position:absolute;left:calc(6px + var(--sal,0px));top:calc(6px + var(--sat,0px));z-index:5;font:600 11px/1.1 Fredoka,system-ui,sans-serif;color:#3B2433;background:rgba(246,234,210,.88);
border:2px solid #74432C;border-radius:10px;box-shadow:0 2px 0 #432C24;padding:4px 6px;width:clamp(112px,18vw,150px);box-sizing:border-box;user-select:none;pointer-events:none}
#hud .row{display:flex;align-items:center;gap:4px;margin:2px 0}#hud .bar{flex:1;height:6px;background:#E6C47E;border:1px solid #4A2F3D;border-radius:4px;overflow:hidden}
#hud .lab{display:flex;width:14px;font-size:10px;justify-content:center}
#hud .fill{height:100%;border-radius:3px;transition:width .2s}#hud .clock{display:flex;justify-content:space-between;margin-bottom:2px;color:#61402E;font-size:10px}
@media (max-height:420px){#hud{width:112px;padding:3px 5px}#hud .bar{height:5px}#hud .row{margin:1px 0}}`;
  document.head.append(style);
  const root = document.createElement("div"); root.id = "hud";
  const clock = document.createElement("div"); clock.className = "clock"; root.append(clock);
  const clockIcon = document.createElement("img"); clockIcon.className = "ic"; clockIcon.alt = "";
  const clockText = document.createElement("span"); clockText.dataset["hud"] = "clock";
  const weatherText = document.createElement("span"); weatherText.dataset["hud"] = "weather";
  const left = document.createElement("span"); left.className = "l"; left.append(clockIcon, clockText); clock.append(left, weatherText);
  const icons: HTMLImageElement[] = [];
  let ui: Awaited<ReturnType<typeof uiSprites>> | undefined;
  const fills = STATS.map((s) => {
    const row = document.createElement("div"); row.className = "row"; row.dataset["stat"] = s.key;
    const l = document.createElement("span"); l.className = "lab"; l.textContent = s.label; const ic = document.createElement("img"); ic.className = "ic"; ic.alt = s.key; ic.style.display = "none"; icons.push(ic); l.prepend(ic); const bar = document.createElement("div"); bar.className = "bar";
    const f = document.createElement("div"); f.className = "fill"; f.style.background = s.color; bar.append(f); row.append(l, bar); root.append(row); return f;
  });
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
    const hp = p !== undefined ? w.get(p, Health) : undefined, sv = p !== undefined ? w.get(p, Survival) : undefined;
    const vals = [hp ? hp.hp / (hp.max || 100) : 1, sv ? sv.hunger / 100 : 1, sv ? sv.thirst / 100 : 1, sv ? sv.stamina / (sv.maxStamina || 100) : 1];
    if (ui) vals.forEach((v, i) => { const low = v < 0.25; const ic = icons[i]!; if (ic.dataset["low"] !== String(low)) { const u = ui!.url(`vital_${SPRITE_KEYS[i]}${low ? "_low" : ""}`); if (u) { ic.src = u; ic.dataset["low"] = String(low); } } });
    vals.forEach((v, i) => { fills[i]!.style.width = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`; });
  };
  const timer = setInterval(update, 250); update();
  return { destroy: () => { clearInterval(timer); root.remove(); style.remove(); } };
}
