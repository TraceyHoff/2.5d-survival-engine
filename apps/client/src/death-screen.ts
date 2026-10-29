/**
 * ADR-153: death screen + respawn. While the local player has `Dead`, a full-screen card ("You died") with a real
 * Respawn button sits above every overlay (tutorial, menus, HUD). The button counts down PVP.respawnSeconds, then
 * sends gameplay.respawnPlayer (server-authoritative; singleplayer runs the same in-process server). It answers to
 * mouse / touch (click), keyboard (Enter / Space / R) and gamepad (A / Start), retrying if the server has not
 * respawned us yet. After respawn a compass pill points at the newest death bag ("Your bag 23 m") until it is looted.
 * Hooks: `#death-screen[data-ready]`, `#death-respawn`, `#bag-compass[data-dist]`.
 */
import { navPad, padHeld, padKeyEdge } from "./pad-input.js";
import { setData, setDisabled, setHidden, setStyle, setText } from "./dom-diff.js";
import { PlayerId, Transform, type Entity, type World } from "@engine/core";
import { worldToScreen } from "@engine/world";
import { Dead, PVP, deathBagsOf } from "@engine/gameplay";

/** Seconds after death before the button unlocks (server rule + a little slack for tick / latency skew). */
export const RESPAWN_UNLOCK_S = PVP.respawnSeconds + 0.4;
/** Re-arm the button if we are still dead this long after pressing it (lost packet, early press). */
export const RESPAWN_RETRY_MS = 1500;

export interface DeathUi { dead: boolean; secondsLeft: number; ready: boolean; pending: boolean }
/** Pure: what the death card shows `nowMs` after death (`deadAtMs`), with the last press at `sentAtMs`. */
export function deathUiState(dead: boolean, deadAtMs: number, nowMs: number, sentAtMs: number | undefined): DeathUi {
  if (!dead) return { dead, secondsLeft: 0, ready: false, pending: false };
  const secondsLeft = Math.max(0, Math.ceil(RESPAWN_UNLOCK_S - (nowMs - deadAtMs) / 1000));
  const pending = sentAtMs !== undefined && nowMs - sentAtMs < RESPAWN_RETRY_MS;
  return { dead, secondsLeft, ready: secondsLeft === 0 && !pending, pending };
}
/** Pure: screen-space bearing (radians, 0 = right, +y down) and distance (tiles) from `p` to `bag`. */
export function bagBearing(p: { x: number; y: number }, bag: { x: number; y: number }): { angle: number; dist: number } {
  const s = worldToScreen(bag.x - p.x, bag.y - p.y); return { angle: Math.atan2(s.sy, s.sx), dist: Math.hypot(bag.x - p.x, bag.y - p.y) };
}

export interface DeathScreenOptions {
  world: () => World; player: () => Entity | undefined;
  /** Send gameplay.respawnPlayer; true when queued. */
  respawn: () => boolean;
  /** Called once on the alive -> dead edge (close menus, stop build mode...). */
  onDeath?: () => void;
  now?: () => number;
  getGamepads?: () => readonly (Gamepad | null)[];
}
export interface DeathScreen { frame(): void; readonly dead: boolean; readonly el: HTMLElement; readonly compass: HTMLElement; press(): boolean }

const CSS = `#death-screen{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;background:rgba(40,8,8,.62);pointer-events:auto;font:600 16px/1.4 Fredoka,system-ui,sans-serif}
#death-screen[hidden]{display:none}
#death-screen .card{background:rgba(246,234,210,.98);color:#3B2433;border:3px solid #74432C;border-radius:14px;box-shadow:0 4px 0 #432C24;padding:18px 22px;max-width:min(380px,calc(100vw - 32px));text-align:center}
#death-screen h2{margin:0 0 6px;font-size:28px;color:#8B1E1E}
#death-screen p{margin:0 0 14px}
#death-respawn{font:700 20px Fredoka,system-ui,sans-serif;min-width:200px;min-height:52px;padding:8px 18px;border-radius:12px;border:3px solid #432C24;background:#6FA84B;color:#FFFAF0;cursor:pointer}
#death-respawn:disabled{background:#9A8F80;cursor:default}
#death-respawn:focus-visible,#death-respawn:focus{outline:3px solid #FFD45A;outline-offset:3px}
#death-screen .hint{margin-top:10px;font-size:13px;opacity:.8}
#bag-compass{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 54px);transform:translateX(-50%);z-index:40;pointer-events:none;background:rgba(59,36,51,.82);color:#FFFAF0;border:2px solid #FFD45A;border-radius:999px;padding:3px 12px;font:700 14px Fredoka,system-ui,sans-serif;display:flex;gap:6px;align-items:center}
#bag-compass[hidden]{display:none}
#bag-compass .arrow{display:inline-block;color:#FFD45A;font-size:18px;line-height:1}`;

export function mountDeathScreen(root: HTMLElement, o: DeathScreenOptions): DeathScreen {
  const now = o.now ?? (() => performance.now());
  if (!document.getElementById("death-screen-css")) { const st = document.createElement("style"); st.id = "death-screen-css"; st.textContent = CSS; document.head.append(st); }
  const el = document.createElement("div"); el.id = "death-screen"; el.hidden = true; el.setAttribute("role", "alertdialog"); el.setAttribute("aria-labelledby", "death-title");
  el.innerHTML = `<div class="card"><h2 id="death-title">You died</h2><p>Your items dropped in a bag where you fell. Follow the 🎒 compass to get them back.</p><button type="button" id="death-respawn" disabled>Respawn</button><div class="hint">Click, tap, press Enter / R, or Ⓐ on a controller</div></div>`;
  const btn = el.querySelector<HTMLButtonElement>("#death-respawn")!;
  const compass = document.createElement("div"); compass.id = "bag-compass"; compass.hidden = true; compass.innerHTML = `🎒 <span class="lbl">Your bag</span> <span class="dist"></span> <span class="arrow">➜</span>`;
  root.append(el, compass);
  let dead = false; let deadAt = 0; let deathSpot: { x: number; y: number } | undefined; let sentAt: number | undefined; let prevPad = false; let lastLabel = "";
  const press = (): boolean => {
    const s = deathUiState(dead, deadAt, now(), sentAt); if (!s.ready) return false;
    sentAt = now(); const ok = o.respawn(); if (!ok) sentAt = undefined; update(); return ok;
  };
  btn.addEventListener("click", (e) => { e.preventDefault(); press(); });
  addEventListener("keydown", (e) => {
    if (!dead) return;
    // ADR-213: Edge on Xbox sends the controller as keys (GamepadA / GamepadMenu / keyCode 195/207)
    const pk = padKeyEdge(e); if (pk !== undefined) { e.preventDefault(); e.stopImmediatePropagation(); if (pk === "A" || pk === "START") press(); return; }
    if (e.code === "Enter" || e.code === "Space" || e.code === "KeyR" || e.code === "NumpadEnter") { e.preventDefault(); e.stopPropagation(); if (!e.repeat) press(); }
    else if (e.code === "Escape" || e.code === "Tab") { e.preventDefault(); e.stopPropagation(); } // nothing else to open while dead
  }, true);
  addEventListener("keyup", (e) => { if (dead) padKeyEdge(e); }, true);
  const pads = (): readonly (Gamepad | null)[] => { try { return o.getGamepads?.() ?? (typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : []); } catch { return []; } };
  function update(): void {
    const s = deathUiState(dead, deadAt, now(), sentAt);
    setHidden(el, !dead); setData(el, "ready", s.ready ? "1" : "0");
    const label = s.pending ? "Respawning…" : s.secondsLeft > 0 ? `Respawn in ${s.secondsLeft}` : "Respawn";
    if (label !== lastLabel) { btn.textContent = label; lastLabel = label; }
    setDisabled(btn, !s.ready);
    if (s.ready && dead && document.activeElement !== btn) btn.focus();
  }
  function frame(): void {
    const w = o.world(); const p = o.player();
    const isDead = p !== undefined && w.isRegistered(Dead) && w.has(p, Dead);
    if (isDead && !dead) { dead = true; deadAt = now(); sentAt = undefined; const t0 = p !== undefined ? w.get(p, Transform) : undefined; deathSpot = t0 ? { x: t0.x, y: t0.y } : undefined; o.onDeath?.(); }
    else if (!isDead && dead) { dead = false; sentAt = undefined; (document.activeElement as HTMLElement | null)?.blur?.(); }
    if (dead) {
      const g = navPad(pads as never), pad = padHeld(g, "A") || padHeld(g, "START"); // ADR-213: merged + mapping "" normalised
      if (pad && !prevPad) press();
      prevPad = pad;
    } else prevPad = false;
    update();
    // compass to the newest own death bag
    const pid = p !== undefined && w.isRegistered(PlayerId) ? w.getField(p, PlayerId, "id") ?? 0 : 0;
    const t = p !== undefined ? w.get(p, Transform) : undefined; const seen = deathBagsOf(w, pid)[0];
    // The bag only replicates near us (AOI): out of range, aim at the remembered death spot; once we are near it and
    // no bag is there (looted / despawned / nothing dropped), stop.
    if (!seen && deathSpot && t && Math.hypot(t.x - deathSpot.x, t.y - deathSpot.y) < 12 && !dead) deathSpot = undefined;
    const bag = seen ?? deathSpot;
    if (!t || !bag) { setHidden(compass, true); return; }
    const b = bagBearing(t, bag); const d = Math.round(b.dist);
    setHidden(compass, d < 2 && !dead); setData(compass, "dist", String(d));
    setText(compass.querySelector(".dist")!, `${d} m`); setText(compass.querySelector(".lbl")!, seen ? "Your bag" : "Where you fell");
    setStyle(compass.querySelector(".arrow") as HTMLElement, "transform", `rotate(${b.angle}rad)`);
  }
  return { frame, get dead() { return dead; }, el, compass, press };
}
