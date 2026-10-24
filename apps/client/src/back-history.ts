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
export function focusVisible(el: HTMLElement | undefined): void { if (!el) return; el.focus(); el.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }
