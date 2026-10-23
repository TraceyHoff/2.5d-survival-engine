/**
 * Survival HUD in Art's "cozy-camp" UI theme (assets/ui/theme.json palette + Fredoka, served at `<base>art/ui/`):
 * health / hunger / thirst / stamina bars, clock and weather. Plain DOM, hooks: `#hud`, `[data-stat=...]`.
 */
import { Weather, timeOfDay, type Entity, type World } from "@engine/core";
import { Health, Survival } from "@engine/gameplay";

const WEATHER_LABEL = ["Clear", "Rain", "Storm", "Snow", "Fog"];
const STATS = [
  { key: "hp", label: "❤", color: "#E8475F" }, { key: "hunger", label: "🍖", color: "#F4A74A" },
  { key: "thirst", label: "💧", color: "#5CC6DC" }, { key: "stamina", label: "⚡", color: "#FFD45A" },
] as const;

export function mountHud(world: () => World, player: () => Entity | undefined): { destroy(): void } {
  const base = import.meta.env.BASE_URL;
  const style = document.createElement("style");
  style.textContent = `@font-face{font-family:Fredoka;src:url(${base}art/ui/fonts/Fredoka.ttf) format("truetype");font-display:swap}
#hud{position:fixed;left:12px;bottom:12px;z-index:5;font:600 13px Fredoka,system-ui,sans-serif;color:#3B2433;background:#F6EAD2;
border:3px solid #74432C;border-radius:14px;box-shadow:0 3px 0 #432C24,0 6px 14px rgba(0,0,0,.35);padding:8px 10px;min-width:190px;user-select:none}
#hud .row{display:flex;align-items:center;gap:6px;margin:3px 0}#hud .bar{flex:1;height:10px;background:#E6C47E;border:2px solid #4A2F3D;border-radius:6px;overflow:hidden}
#hud .fill{height:100%;border-radius:4px;transition:width .2s}#hud .clock{display:flex;justify-content:space-between;margin-bottom:4px;color:#61402E}`;
  document.head.append(style);
  const root = document.createElement("div"); root.id = "hud";
  const clock = document.createElement("div"); clock.className = "clock"; root.append(clock);
  const fills = STATS.map((s) => {
    const row = document.createElement("div"); row.className = "row"; row.dataset["stat"] = s.key;
    const l = document.createElement("span"); l.textContent = s.label; const bar = document.createElement("div"); bar.className = "bar";
    const f = document.createElement("div"); f.className = "fill"; f.style.background = s.color; bar.append(f); row.append(l, bar); root.append(row); return f;
  });
  document.body.append(root);
  const update = (): void => {
    const w = world(); const p = player();
    try {
      const h = timeOfDay(w).hours; const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
      const wk = w.env(Weather).kind;
      clock.textContent = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}  ·  ${WEATHER_LABEL[wk] ?? "?"}`;
    } catch { clock.textContent = ""; }
    const hp = p !== undefined ? w.get(p, Health) : undefined, sv = p !== undefined ? w.get(p, Survival) : undefined;
    const vals = [hp ? hp.hp / (hp.max || 100) : 1, sv ? sv.hunger / 100 : 1, sv ? sv.thirst / 100 : 1, sv ? sv.stamina / (sv.maxStamina || 100) : 1];
    vals.forEach((v, i) => { fills[i]!.style.width = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`; });
  };
  const timer = setInterval(update, 250); update();
  return { destroy: () => { clearInterval(timer); root.remove(); style.remove(); } };
}
