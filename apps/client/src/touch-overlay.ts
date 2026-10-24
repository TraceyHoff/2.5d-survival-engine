/**
 * Visible touch controls: draws @engine/input VirtualControls geometry (joystick ring + knob, action buttons) as
 * click-through DOM inside the UI root, so the player can see where to press, in and out of fullscreen.
 * Hooks: `#touch-overlay`, `[data-touch=<element id>]` with `data-pressed`. Hidden while a modal is open.
 */
import type { ElementGeometry } from "@engine/input";

/** Icon + short caption per control (ADR-133): every visible control says what it does. */
export const TOUCH_LABELS: Record<string, { icon: string; text: string }> = {
  attack: { icon: "⚔", text: "Hit" }, context: { icon: "✋", text: "Use" }, sprint: { icon: "»", text: "Run" }, reload: { icon: "↻", text: "Reload" },
  hotbar: { icon: "◎", text: "Slot" }, confirm: { icon: "✓", text: "Place" }, cancel: { icon: "✕", text: "Cancel" }, rotate: { icon: "⟳", text: "Rotate" },
};
const BG = (g: ElementGeometry): string => g.pressed ? "rgba(255,212,90,.45)" : `rgba(20,16,12,${g.kind === "joystick" ? ".12" : ".28"})`;
export function mountTouchOverlay(root: HTMLElement, geometry: () => ElementGeometry[], hidden: () => boolean = () => false): { destroy(): void; draw(): void } {
  const layer = document.createElement("div"); layer.id = "touch-overlay";
  layer.style.cssText = "position:absolute;inset:0;z-index:4;pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none";
  const els = new Map<string, HTMLDivElement>(); const knobs = new Map<string, HTMLDivElement>();
  root.append(layer);
  const draw = (): void => {
    layer.style.display = hidden() ? "none" : "";
    const geo = geometry(); const live = new Set(geo.map((g) => g.id));
    for (const [id, d] of els) if (!live.has(id)) { d.style.display = "none"; const k = knobs.get(id); if (k) k.style.display = "none"; }
    for (const g of geo) {
      let d = els.get(g.id);
      if (!d) {
        d = document.createElement("div"); d.dataset["touch"] = g.id;
        d.style.cssText = "position:absolute;border-radius:50%;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;color:#FFFAF0;font:700 17px system-ui,sans-serif;text-shadow:0 1px 2px #000;border:2px solid rgba(255,250,240,.45);opacity:.85";
        const lab = TOUCH_LABELS[g.id]; if (lab) { const i = document.createElement("span"); i.textContent = lab.icon; const t = document.createElement("span"); t.textContent = lab.text; t.style.cssText = "font:600 9px system-ui,sans-serif;margin-top:1px"; d.append(i, t); d.setAttribute("aria-label", lab.text); } layer.append(d); els.set(g.id, d);
        if (g.kind === "joystick") { const k = document.createElement("div"); k.style.cssText = "position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,250,240,.6)"; layer.append(k); knobs.set(g.id, k); }
      }
      d.style.display = g.visible ? "flex" : "none";
      d.style.left = `${g.x - g.r}px`; d.style.top = `${g.y - g.r}px`; d.style.width = d.style.height = `${g.r * 2}px`;
      d.dataset["pressed"] = String(g.pressed); d.style.background = BG(g);
      const k = knobs.get(g.id); if (k) { k.style.display = g.knob ? "" : "none"; if (g.knob) { k.style.left = `${g.knob.x}px`; k.style.top = `${g.knob.y}px`; } }
    }
  };
  let raf = 0; const loop = (): void => { draw(); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop);
  return { draw, destroy: () => { cancelAnimationFrame(raf); layer.remove(); } };
}

/** Context-gated control ids (ADR-133): shown only while their context holds. */
export function syncTouchHidden(hidden: Set<string>, ctx: { reload: boolean }): void { if (ctx.reload) hidden.delete("reload"); else hidden.add("reload"); }
