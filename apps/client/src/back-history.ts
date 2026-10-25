/**
 * Android back / browser back (popstate) as "Back" for the menu stack (ADR-107). While something closable is open we keep
 * exactly one sentinel history entry; popping it calls `onBack` (the same action as Esc / gamepad B / the Back button).
 * When the stack empties programmatically the sentinel is removed with history.back() and that popstate is ignored.
 */
export class BackHistory {
  private armed = false; private skip = 0;
  private readonly pop = (): void => { if (this.skip > 0) { this.skip--; return; } if (!this.armed) return; this.armed = false; this.onBack(); };
  constructor(private readonly onBack: () => void, private readonly win: Window | undefined = typeof window !== "undefined" ? window : undefined) {
    this.win?.addEventListener("popstate", this.pop);
  }
  /** Call after every open/close with whether anything closable is still open. */
  sync(open: boolean): void {
    const h = this.win?.history; if (!h) return;
    try {
      if (open && !this.armed) { h.pushState({ survivazBack: true }, ""); this.armed = true; }
      else if (!open && this.armed) { this.armed = false; this.skip++; h.back(); }
    } catch { /* sandboxed iframe / file:// */ }
  }
  destroy(): void { this.win?.removeEventListener("popstate", this.pop); }
}
/** Focus and keep it visible inside a scrolling panel (ADR-107). */
/** ADR-142: focus moved by pad/keyboard navigation must show a ring. Programmatic focus after a gamepad press is not
 *  :focus-visible in Chrome (and `.gm-panel button:focus:not(:focus-visible)` hid it), so the pad user saw no cursor.
 *  Pad/keyboard navigation flags the document (`html[data-nav-focus]`, see markNavFocus) until the next pointer/touch press;
 *  while flagged, focus asks for a visible ring. Touch/mouse-opened menus show none. */
export function focusVisible(el: HTMLElement | undefined): void { if (!el) return; el.focus({ focusVisible: navFocusActive() } as FocusOptions); el.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }

let navFocusHooked = false;
export function markNavFocus(doc: Document | undefined = typeof document !== "undefined" ? document : undefined): void {
  if (!doc) return; doc.documentElement.dataset.navFocus = "1";
  if (!navFocusHooked) { navFocusHooked = true; doc.addEventListener("pointerdown", () => { delete doc.documentElement.dataset.navFocus; }, true); }
}
export function navFocusActive(doc: Document | undefined = typeof document !== "undefined" ? document : undefined): boolean { return !!doc?.documentElement.dataset.navFocus; }
