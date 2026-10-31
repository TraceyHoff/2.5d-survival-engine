/**
 * The game's single UI root (`#game-root`): it holds the canvas, the HUD, the touch overlay/menu bar and every
 * modal. Fullscreen targets this element (./fullscreen.ts), so everything the player needs stays inside the
 * fullscreen subtree: an element outside it is not rendered in fullscreen and can't receive taps.
 * Exposes the safe-area insets as `--sat/--sar/--sab/--sal` for HUD/menu placement.
 */
export const ROOT_ID = "game-root";
const STYLE_ID = "game-root-style";
const CSS = `#${ROOT_ID}{position:fixed;inset:0;overflow:hidden;background:#111;
--sat:env(safe-area-inset-top,0px);--sar:env(safe-area-inset-right,0px);--sab:env(safe-area-inset-bottom,0px);--sal:env(safe-area-inset-left,0px);
touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
#${ROOT_ID}:fullscreen{width:100%;height:100%}
#${ROOT_ID} canvas{display:block;width:100%;height:100%;touch-action:none}
/* ADR-107: every menu/panel/modal scrolls inside the visible viewport (dvh + safe areas), also in fullscreen */
#${ROOT_ID} [data-modal]>*,#${ROOT_ID} .gm-panel,#${ROOT_ID} [data-role=delete-confirm],.ui-scroll{max-height:calc(100vh - 16px);max-height:calc(100dvh - var(--sat,0px) - var(--sab,0px) - 16px);
overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior:contain;box-sizing:border-box}
#${ROOT_ID} [data-modal]{touch-action:pan-y}
html,body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#${ROOT_ID} *{-webkit-touch-callout:none}
/* QA2: game canvas + HUD never select or show the long-press callout, even when mounted outside the root */
canvas,#hud,#hud *,#touch-overlay,#touch-overlay *,.build-hud,.build-hud *{-webkit-touch-callout:none;user-select:none;-webkit-user-select:none}
#${ROOT_ID} button,#${ROOT_ID} input,#${ROOT_ID} select,#${ROOT_ID} textarea{touch-action:manipulation}
#${ROOT_ID} button{user-select:none;-webkit-user-select:none}
#${ROOT_ID} input,#${ROOT_ID} select,#${ROOT_ID} textarea,#${ROOT_ID} [contenteditable]{user-select:text;-webkit-user-select:text;-webkit-touch-callout:default}`;

/** True for targets where text selection / the long-press menu is wanted (text fields). */
export function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null; if (!el || typeof el.closest !== "function") return false;
  return !!el.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])");
}
/** ADR-133: no browser Copy / Select all / Web search popup on long-press anywhere in the game (text fields excepted). */
export function blockLongPressMenus(target: Document | HTMLElement): void {
  const stop = (e: Event): void => { if (!isEditable(e.target)) e.preventDefault(); };
  target.addEventListener("contextmenu", stop); target.addEventListener("selectstart", stop);
}

/** The root container (created around `#game` if index.html doesn't have it). */
export function uiRoot(doc: Document = document): HTMLElement {
  let r = doc.getElementById(ROOT_ID);
  if (!r) {
    r = doc.createElement("div"); r.id = ROOT_ID;
    const c = doc.getElementById("game");
    if (c?.parentElement) { c.parentElement.insertBefore(r, c); r.append(c); } else doc.body.append(r);
  }
  if (!doc.getElementById(STYLE_ID)) { const st = doc.createElement("style"); st.id = STYLE_ID; st.textContent = CSS; doc.head.append(st); blockLongPressMenus(doc); }
  return r;
}
/** Mount UI (HUD, overlays, modals) inside the root so it is visible and tappable in fullscreen. */
export function mountUi<T extends Node>(node: T, doc: Document = document): T { uiRoot(doc).append(node); return node; }

/** Safe-area insets in px, measured with a probe (custom properties holding env() don't resolve in getComputedStyle). */
export function safeAreaInsets(doc: Document = document): { top: number; right: number; bottom: number; left: number } {
  const p = doc.createElement("div");
  p.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  doc.body.append(p); const cs = getComputedStyle(p); const n = (v: string): number => parseFloat(v) || 0;
  const r = { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) }; p.remove(); return r;
}
