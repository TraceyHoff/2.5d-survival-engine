/**
 * ADR-179: on-screen hotbar — inventory slots 1..8 (the ones Hotbar1..8 / 1-8 keys / LB+D-pad / the touch "Slot" radial
 * equip via EquipCmd) as a compact strip anchored bottom-centre inside the safe area. Until now no hotbar view existed
 * at all, so the slots were invisible on every platform. DOM hook: `#hotbar.hotbar [data-slot][data-icon][data-equipped]`.
 * Rebuilt only when the slot contents change (ADR-158 change-only updates); hidden while a menu / build mode / death
 * screen owns the screen. Slots are tappable/clickable (equip); the strip itself is click-through.
 */
import { mountUi } from "./ui-root.js";

export const HOTBAR_SLOTS = 8;
export interface HotbarSource { slot: number; item?: number; icon: string; name: string; count: number; equipped?: boolean }
export interface HotbarCell { slot: number; item: number; icon: string; name: string; count: number; equipped: boolean }
/** Pure model: one cell per hotbar slot 0..n-1 (empty cells have icon ""). */
export function hotbarCells(view: readonly HotbarSource[], n = HOTBAR_SLOTS): HotbarCell[] {
  return Array.from({ length: n }, (_, slot) => { const v = view.find((s) => s.slot === slot && s.count > 0);
    return v ? { slot, item: v.item ?? 0, icon: v.icon, name: v.name, count: v.count, equipped: !!v.equipped } : { slot, item: 0, icon: "", name: "", count: 0, equipped: false }; });
}
/** Next/previous filled hotbar slot from `cur` (-1 / none = start of the bar); -1 when the bar is empty. */
export function hotbarCycle(cells: readonly HotbarCell[], cur: number, dir: 1 | -1): number {
  const n = cells.length; if (!n) return -1; let i = cur >= 0 && cur < n ? cur : dir > 0 ? -1 : n;
  for (let k = 0; k < n; k++) { i = (i + dir + n) % n; if (cells[i]!.count > 0) return i; }
  return -1;
}
/** Slot (0-based) for the first Hotbar1..8 action pressed this update, else -1. */
export function pressedHotbarSlot(pressed: (action: string) => boolean, n = HOTBAR_SLOTS): number {
  for (let i = 0; i < n; i++) if (pressed(`Hotbar${i + 1}`)) return i;
  return -1;
}
export const hotbarKey = (cells: readonly HotbarCell[], device: string): string => device + "|" + cells.map((c) => `${c.icon}:${c.count}:${c.equipped ? 1 : 0}`).join(",");

const CSS = `#hotbar{position:absolute;left:50%;bottom:calc(8px + var(--sab,0px));transform:translateX(-50%);z-index:5;display:flex;gap:4px;padding:4px;border-radius:10px;background:rgba(59,36,51,.55);pointer-events:none;font:700 10px/1 Fredoka,system-ui,sans-serif;color:#FFFAF0;max-width:calc(100vw - 16px - var(--sal,0px) - var(--sar,0px))}
#hotbar[hidden]{display:none}
#hotbar button{position:relative;flex:none;width:44px;height:44px;padding:0;margin:0;border:2px solid rgba(255,250,240,.35);border-radius:8px;background:rgba(20,16,12,.45);pointer-events:auto;cursor:pointer;color:inherit;font:inherit;touch-action:manipulation}
#hotbar button[data-equipped=true]{border-color:#FFD45A;box-shadow:0 0 0 2px rgba(255,212,90,.45)}
#hotbar button .ic{position:absolute;inset:5px;background:var(--cz-icon,none) var(--cz-ipos,center) / var(--cz-isize,contain) no-repeat;image-rendering:pixelated}
#hotbar button .n{position:absolute;left:3px;top:2px;opacity:.75}#hotbar button .c{position:absolute;right:3px;bottom:2px;text-shadow:0 1px 1px #000}
#hotbar[data-device=gamepad] button .n,#hotbar[data-device=touch] button .n{display:none}
@media (max-width:480px),(max-height:440px){#hotbar{gap:3px;padding:3px}#hotbar button{width:36px;height:36px}#hotbar button .ic{inset:4px}}`;

export interface HotbarOptions { view: () => readonly HotbarSource[] | undefined; equip: (slot: number) => void; device: () => string; icon?: (icon: string, item: number) => string }
export function mountHotbar(o: HotbarOptions, doc: Document = document): { el: HTMLElement; update(visible: boolean): void; destroy(): void } {
  const style = doc.createElement("style"); style.textContent = CSS; doc.head.append(style);
  const el = mountUi(doc.createElement("div"), doc); el.id = "hotbar"; el.className = "hotbar"; el.setAttribute("role", "toolbar"); el.setAttribute("aria-label", "Hotbar"); el.hidden = true;
  let key = "";
  el.addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest?.("button[data-slot]") as HTMLElement | null; if (b) { e.preventDefault(); o.equip(Number(b.dataset["slot"])); } });
  el.addEventListener("pointerdown", (e) => e.stopPropagation()); // taps on slots must not reach the canvas / touch controls
  const update = (visible: boolean): void => {
    const v = visible ? o.view() : undefined; el.hidden = !v; if (!v) return;
    const dev = o.device(); const cells = hotbarCells(v); const k = hotbarKey(cells, dev); if (k === key) return; key = k;
    el.dataset["device"] = dev;
    el.replaceChildren(...cells.map((c) => { const b = doc.createElement("button"); b.type = "button"; b.tabIndex = -1; b.dataset["slot"] = String(c.slot); b.dataset["equipped"] = String(c.equipped);
      b.title = c.count ? `${c.name}${c.count > 1 ? ` ×${c.count}` : ""} (${c.slot + 1})` : `Slot ${c.slot + 1}`; b.setAttribute("aria-label", b.title);
      const n = doc.createElement("span"); n.className = "n"; n.textContent = String(c.slot + 1); b.append(n);
      if (c.count) { const ic = doc.createElement("span"); ic.className = "ic"; ic.dataset["icon"] = o.icon ? o.icon(c.icon, c.item) : c.icon; b.append(ic);
        if (c.count > 1) { const ct = doc.createElement("span"); ct.className = "c"; ct.textContent = String(c.count); b.append(ct); } }
      return b; }));
  };
  return { el, update, destroy: () => { el.remove(); style.remove(); } };
}
