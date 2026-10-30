/**
 * ADR-231: pointer drag-and-drop for item slots (mouse, touch, pen) — inventory grid, inventory hotbar row, equipment,
 * open container grid and the on-screen HUD hotbar.
 *  - Sources carry `data-drag="<kind>:<slot>"`, targets `data-drop="<kind>:<slot>"` (kind p = pack/hotbar slot,
 *    c = open container slot, e = equipment slot, h = HUD hotbar slot).
 *  - Start: mouse / pen after a small move (6 px); touch after a long-press (DRAG_HOLD_MS, finger still) or, when no
 *    ancestor can scroll, after a small move. Plain taps, double-tap-to-eat and native scrolling of the grid are untouched.
 *  - While dragging a ghost copy of the tile follows the finger / cursor (pointer-events: none); the slot under it gets
 *    `data-drop-over`. Release on a target = `onDrop(from, to)` (move / swap / merge, server-authoritative); anywhere
 *    else (outside the panel, same slot) = cancel. Escape / pointercancel cancel. The click that follows a drag is swallowed.
 */
export type SlotKind = "p" | "c" | "e" | "h";
export interface SlotRef { kind: SlotKind; slot: number }
export const DRAG_HOLD_MS = 260;
export const DRAG_MOVE_PX = { mouse: 6, touch: 10 } as const;
export function parseSlotRef(s: string | undefined | null): SlotRef | undefined {
  const m = /^([pceh]):(-?\d+)$/.exec(s ?? ""); return m ? { kind: m[1] as SlotKind, slot: Number(m[2]) } : undefined;
}
export const slotRef = (kind: SlotKind, slot: number): string => `${kind}:${slot}`;
const sameRef = (a: SlotRef, b: SlotRef): boolean => a.kind === b.kind && a.slot === b.slot;

export interface SlotDragOptions {
  /** Current drop handler (looked up at release: panels re-render). undefined = drops are ignored (cancel). */
  onDrop: () => ((from: SlotRef, to: SlotRef) => void) | undefined;
  holdMs?: number;
  /** Element the ghost is appended to (default: the panel body so the tile's icon CSS applies, else the source's parent). */
  ghostHost?: (src: HTMLElement) => HTMLElement | undefined;
  /** Only sources inside an element matching this selector (document-level installs). */
  within?: string;
}
export interface SlotDrag { readonly active: boolean; cancel(): void; destroy(): void }

function canScroll(el: HTMLElement, stop: HTMLElement | Document): boolean {
  for (let n: HTMLElement | null = el.parentElement; n; n = n === stop ? null : n.parentElement) { // the root itself may be the scroller
    const cs = getComputedStyle(n); if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)) return true;
  }
  return false;
}

export function installSlotDrag(root: HTMLElement | Document, o: SlotDragOptions): SlotDrag {
  const doc = (root as Document).defaultView ? (root as Document) : (root as HTMLElement).ownerDocument;
  const win = doc.defaultView!; const hold = o.holdMs ?? DRAG_HOLD_MS;
  let pend: { id: number; x: number; y: number; src: HTMLElement; ref: SlotRef; touch: boolean; moveOk: boolean; timer: number } | undefined;
  let drag: { id: number; src: HTMLElement; ref: SlotRef; ghost: HTMLElement; over?: HTMLElement; w: number; h: number; ox: number; oy: number } | undefined;
  let swallowUntil = 0;
  const clearPend = (): void => { if (pend) win.clearTimeout(pend.timer); pend = undefined; };
  const setOver = (t: HTMLElement | undefined): void => { if (!drag || drag.over === t) return; drag.over?.removeAttribute("data-drop-over"); drag.over = t; t?.setAttribute("data-drop-over", ""); };
  const targetAt = (x: number, y: number): HTMLElement | undefined => {
    const hit = doc.elementFromPoint?.(x, y) as HTMLElement | null; const t = hit?.closest?.("[data-drop]") as HTMLElement | null;
    return t && (root === doc || (root as HTMLElement).contains(t)) ? t : undefined;
  };
  const place = (x: number, y: number): void => { if (!drag) return; drag.ghost.style.transform = `translate(${Math.round(x - drag.w / 2 - drag.ox)}px, ${Math.round(y - drag.h / 2 - drag.oy)}px)`; setOver(targetAt(x, y)); };
  const begin = (x: number, y: number): void => {
    if (!pend) return; const p = pend; clearPend();
    const r = p.src.getBoundingClientRect(); const w = r.width || 44, h = r.height || 44;
    const g = p.src.cloneNode(true) as HTMLElement; g.removeAttribute("data-key"); g.removeAttribute("id"); g.removeAttribute("data-drop"); g.removeAttribute("data-drag"); g.removeAttribute("data-sel");
    g.setAttribute("data-ghost", ""); g.setAttribute("aria-hidden", "true"); g.tabIndex = -1; // keeps data-role / data-icon: the tile's own icon CSS applies
    Object.assign(g.style, { position: "fixed", left: "0", top: "0", width: `${w}px`, height: `${h}px`, margin: "0", zIndex: "2147483000", pointerEvents: "none", opacity: "0.92", transition: "none", transform: "none" });
    (o.ghostHost?.(p.src) ?? (p.src.closest("[data-role=body]") as HTMLElement | null) ?? p.src.parentElement ?? doc.body).append(g);
    const g0 = g.getBoundingClientRect(); // a transformed ancestor becomes the fixed containing block: measure its origin once
    drag = { id: p.id, src: p.src, ref: p.ref, ghost: g, w, h, ox: g0.left || 0, oy: g0.top || 0 }; p.src.setAttribute("data-dragging", ""); doc.documentElement.setAttribute("data-slot-dragging", "");
    win.getSelection?.()?.removeAllRanges?.(); place(x, y);
  };
  const end = (drop: boolean, x = 0, y = 0): void => {
    const d = drag; if (!d) return; drag = undefined;
    const t = drop ? targetAt(x, y) : undefined; d.over?.removeAttribute("data-drop-over"); d.ghost.remove(); d.src.removeAttribute("data-dragging"); doc.documentElement.removeAttribute("data-slot-dragging");
    swallowUntil = Date.now() + 400;
    const to = parseSlotRef(t?.dataset["drop"]); if (!to || sameRef(to, d.ref)) return; // outside any slot / same slot = cancel
    o.onDrop()?.(d.ref, to);
  };
  const down = (e: PointerEvent): void => {
    if (drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    const src = (e.target as HTMLElement | null)?.closest?.("[data-drag]") as HTMLElement | null; if (!src || (root !== doc && !(root as HTMLElement).contains(src))) return;
    if (o.within && !src.closest(o.within)) return;
    const ref = parseSlotRef(src.dataset["drag"]); if (!ref) return; clearPend();
    const touch = e.pointerType === "touch"; const id = e.pointerId;
    pend = { id, x: e.clientX, y: e.clientY, src, ref, touch, moveOk: !touch || !canScroll(src, root), timer: 0 };
    if (touch || e.pointerType === "pen") pend.timer = win.setTimeout(() => { if (pend?.id === id) begin(pend.x, pend.y); }, hold);
  };
  const move = (e: PointerEvent): void => {
    if (drag && e.pointerId === drag.id) { e.preventDefault(); place(e.clientX, e.clientY); return; }
    if (!pend || e.pointerId !== pend.id) return;
    const d = Math.hypot(e.clientX - pend.x, e.clientY - pend.y); const lim = pend.touch ? DRAG_MOVE_PX.touch : DRAG_MOVE_PX.mouse;
    if (d <= lim) return;
    if (pend.moveOk) begin(e.clientX, e.clientY); else clearPend(); // touch in a scrollable grid: the finger is scrolling
  };
  const up = (e: PointerEvent): void => { if (drag && e.pointerId === drag.id) end(true, e.clientX, e.clientY); else if (pend?.id === e.pointerId) clearPend(); };
  const cancelEv = (e: PointerEvent): void => { if (drag && e.pointerId === drag.id) end(false); else if (pend?.id === e.pointerId) clearPend(); };
  const touchMove = (e: TouchEvent): void => { if (drag && e.cancelable) e.preventDefault(); }; // no page / grid scroll while dragging
  const click = (e: MouseEvent): void => { if (Date.now() < swallowUntil) { e.preventDefault(); e.stopImmediatePropagation(); swallowUntil = 0; } };
  const ctx = (e: Event): void => { if (drag || pend?.touch) e.preventDefault(); }; // long-press callout / menu
  const key = (e: KeyboardEvent): void => { if (drag && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(false); } };
  const tgt = root as EventTarget;
  tgt.addEventListener("pointerdown", down as EventListener);
  win.addEventListener("pointermove", move, { passive: false }); win.addEventListener("pointerup", up); win.addEventListener("pointercancel", cancelEv);
  win.addEventListener("touchmove", touchMove, { passive: false }); win.addEventListener("click", click, true); tgt.addEventListener("contextmenu", ctx); win.addEventListener("keydown", key, true);
  return {
    get active() { return !!drag; },
    cancel: () => { clearPend(); end(false); },
    destroy: () => { clearPend(); end(false); tgt.removeEventListener("pointerdown", down as EventListener); win.removeEventListener("pointermove", move); win.removeEventListener("pointerup", up); win.removeEventListener("pointercancel", cancelEv);
      win.removeEventListener("touchmove", touchMove); win.removeEventListener("click", click, true); tgt.removeEventListener("contextmenu", ctx); win.removeEventListener("keydown", key, true); },
  };
}
