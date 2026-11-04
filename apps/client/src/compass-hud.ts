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
#compass-hud[hidden]{display:none}`;
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
