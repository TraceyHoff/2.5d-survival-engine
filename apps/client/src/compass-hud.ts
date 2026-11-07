/**
 * Compass HUD (Task 9): a small strip near the top centre of the screen showing the player's facing as a compass
 * heading (degrees clockwise from north) + 8-point direction and a game-screen facing needle. It updates
 * from the local player's Transform.facing via @engine/gameplay's compassOf (north = (-1,-1), east = (+1,-1)). Hidden when the
 * caller says so (menus / build mode / death screen — same conditions as the hotbar). DOM hook: `#compass-hud`.
 */
import { compassFacing, compassOf } from "@engine/gameplay";
import { NORTH_FACING, DEFAULT_ISO, worldToScreen } from "@engine/world";
import { mountUi } from "./ui-root.js";

const CSS = `#compass-hud{position:fixed;top:calc(8px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:3;display:flex;gap:6px;align-items:center;padding:4px 10px;border-radius:999px;background:rgba(43,28,36,.82);color:#FFFAF0;font:700 13px Fredoka,system-ui,sans-serif;pointer-events:none;white-space:nowrap}
#compass-hud .needle{display:inline-block;color:#ff6b5e;transition:transform .15s linear}
#compass-hud[hidden]{display:none}
/* Task 25: on narrow portrait phones the top-right menu bar (4 x 44px buttons, folded behind More) reaches left
 * past the centred pill, so the leftmost ("...") button overlapped the pill. Drop the pill below the bar row
 * (bar: top 6px + 44px tall) instead of fighting it for the same strip. Wide landscape keeps the top-centre spot:
 * the bar sits far right there and the pill never reaches it. */
@media (max-width:700px){#compass-hud{top:calc(56px + env(safe-area-inset-top))}}`;
/** Facing arrow in game-screen coordinates, not a disconnected top-down compass angle. */
export function compassScreenAngle(heading: number, view = 0): number {
  const f = compassFacing(heading), p = worldToScreen(Math.cos(f), Math.sin(f), 0, { ...DEFAULT_ISO, view });
  return Math.atan2(p.sx, -p.sy) * 180 / Math.PI;
}
export function mountCompassHud(o: { view?(): number; heading(): { heading: number; dir: string } | undefined }, doc: Document = document): { el: HTMLElement; update(visible: boolean): void; destroy(): void } {
  const style = doc.createElement("style"); style.textContent = CSS; doc.head.append(style);
  const el = mountUi(doc.createElement("div"), doc); el.id = "compass-hud"; el.hidden = true;
  const needle = doc.createElement("span"); needle.className = "needle"; needle.textContent = "▲"; el.append(needle);
  const text = doc.createElement("span"); el.append(text);
  let key = "";
  const update = (visible: boolean): void => { const h = visible ? o.heading() : undefined; el.hidden = !h; if (!h) return;
    const angle = compassScreenAngle(h.heading, o.view?.() ?? 0), degrees = Math.round(h.heading) % 360;
    const k = `${degrees}${h.dir}:${angle}`; if (k === key) return; key = k;
    needle.style.transform = `rotate(${angle}deg)`; text.textContent = `${h.dir} ${degrees}°`; el.setAttribute("aria-label", `Facing ${h.dir}, ${degrees} degrees`); };
  return { el, update, destroy: () => { el.remove(); style.remove(); } };
}
/** Heading/dir from a raw facing angle (kept tiny for tests that don't want a DOM mount). */
export const compassHudText = (facing: number): string => { const { heading, dir } = compassOf(facing); return `${dir} ${Math.round(heading) % 360}°`; };
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
/** The compass reading for a standing-still player: north, in the shared geographic basis. */
export const idleCompass = (): { heading: number; dir: string } => compassOf(NORTH_FACING);
