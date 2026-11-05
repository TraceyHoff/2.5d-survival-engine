/**
 * Compass HUD (Task 9): a small strip near the top centre of the screen showing the player's facing as a compass
 * heading (degrees clockwise from north) + 8-point direction, flanked by the neighbouring cardinal marks. It updates
 * from the local player's Transform.facing via @engine/gameplay's compassOf (north = -y, east = +x). Hidden when the
 * caller says so (menus / build mode / death screen — same conditions as the hotbar). DOM hook: `#compass-hud`.
 */
import { compassOf } from "@engine/gameplay";
import { mountUi } from "./ui-root.js";

const CSS = `#compass-hud{position:fixed;top:calc(8px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:3;display:flex;gap:6px;align-items:center;padding:4px 10px;border-radius:999px;background:rgba(43,28,36,.82);color:#FFFAF0;font:700 13px Fredoka,system-ui,sans-serif;pointer-events:none;white-space:nowrap}
#compass-hud .needle{display:inline-block;color:#ff6b5e;transition:transform .15s linear}
#compass-hud[hidden]{display:none}
/* Task 25: on narrow portrait phones the top-right menu bar (4 x 44px buttons, folded behind More) reaches left
 * past the centred pill, so the leftmost ("...") button overlapped the pill. Drop the pill below the bar row
 * (bar: top 6px + 44px tall) instead of fighting it for the same strip. Wide landscape keeps the top-centre spot:
 * the bar sits far right there and the pill never reaches it. */
@media (max-width:700px){#compass-hud{top:calc(56px + env(safe-area-inset-top))}}`;
export function mountCompassHud(o: { heading(): { heading: number; dir: string } | undefined }, doc: Document = document): { el: HTMLElement; update(visible: boolean): void; destroy(): void } {
  const style = doc.createElement("style"); style.textContent = CSS; doc.head.append(style);
  const el = mountUi(doc.createElement("div"), doc); el.id = "compass-hud"; el.hidden = true;
  const needle = doc.createElement("span"); needle.className = "needle"; needle.textContent = "▲"; el.append(needle);
  const text = doc.createElement("span"); el.append(text);
  let key = "";
  const update = (visible: boolean): void => { const h = visible ? o.heading() : undefined; el.hidden = !h; if (!h) return;
    const k = `${Math.round(h.heading)}${h.dir}`; if (k === key) return; key = k;
    needle.style.transform = `rotate(${h.heading}deg)`; text.textContent = `${h.dir} ${Math.round(h.heading)}°`; el.setAttribute("aria-label", `Facing ${h.dir}, ${Math.round(h.heading)} degrees`); };
  return { el, update, destroy: () => { el.remove(); style.remove(); } };
}
/** Heading/dir from a raw facing angle (kept tiny for tests that don't want a DOM mount). */
export const compassHudText = (facing: number): string => { const { heading, dir } = compassOf(facing); return `${dir} ${Math.round(heading)}°`; };
/**
 * Idle tracker for the "compass settles north" rule: the compass shows the player's facing while they move, and
 * points north once they have stood still for `idleAfterMs`. Movement is a position change bigger than `moveEps`
 * tiles since the last sample (the HUD samples every ~120 ms, the map every frame, so the epsilon is per-sample,
 * not per-second). `now` is injected so tests can drive the clock.
 */
export function createIdleTracker(idleAfterMs = 250, moveEps = 0.05): { isIdle(pos: { x: number; y: number }, now: number): boolean } {
  let last: { x: number; y: number } | undefined; let lastMove = 0;
  return { isIdle(pos, now): boolean {
    if (!last || Math.hypot(pos.x - last.x, pos.y - last.y) > moveEps) { last = { x: pos.x, y: pos.y }; lastMove = now; return false; }
    return now - lastMove >= idleAfterMs;
  } };
}
/** The compass reading for a standing-still player: north, exactly as compassOf(-PI/2) reports it. */
export const idleCompass = (): { heading: number; dir: string } => compassOf(-Math.PI / 2);
