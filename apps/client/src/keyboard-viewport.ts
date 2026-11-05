/**
 * Task 18: keep text-entry dialogs usable while the phone keyboard is open.
 *
 * Why this exists: Chrome Android 108+ defaults to `interactive-widget=
 * resizes-visual` — the keyboard shrinks only the *visual* viewport. The
 * layout viewport, `dvh` units, and `position:fixed` overlays do NOT change,
 * so a dialog sized from `100dvh` stays full-height and its footer ends up
 * behind the keyboard (the creator's "Enter world" button was unreachable in
 * landscape, and the user could not enter the game at all). The viewport
 * meta's `interactive-widget=resizes-content` fixes Chrome Android, but it
 * is ignored by Safari and does not apply the same way inside element
 * fullscreen (the game fullscreen-targets #game-root by default, and
 * Chromium explicitly does not resize the window for the keyboard in
 * fullscreen — it only mimics the resize via the visible display frame).
 *
 * So this helper also tracks `window.visualViewport`, which DOES shrink
 * for the keyboard even in fullscreen. The keyboard inset is
 * `innerHeight - vv.height - vv.offsetTop`: when the meta already resized
 * the layout viewport, `innerHeight` shrank in step and the formula yields
 * ~0, so the two mechanisms never double-compensate. The inset is exposed
 * as `--kb-inset` on the overlay (dialog panels subtract it from their
 * `dvh` max-height) and the overlay's own height is capped to the visible
 * area, so a centred dialog re-centres above the keyboard instead of
 * staying centred on the full layout viewport.
 *
 * A page element can never paint over the keyboard itself (the IME is an
 * OS window above page content), so a "black bar where the keys should be"
 * is the IME surface failing to draw under fullscreen/edge-to-edge
 * compositing on that device — this helper cannot force the IME to draw.
 * What it guarantees is that, once the keyboard IS drawn, the dialog fits
 * above it and its buttons stay reachable. Task 20 adds the other half:
 * text fields now leave fullscreen on tap (fullscreen.ts
 * exitFullscreenForTyping / bindTypingFullscreenExit), so the keyboard
 * opens on the normal windowed path and draws keys instead of a black bar;
 * the next non-typing tap restores fullscreen.
 */
export interface KeyboardViewportSource {
  innerHeight: number;
  visualViewport?: {
    height: number;
    offsetTop: number;
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
  } | null;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

/** Pixels of the layout viewport covered by the keyboard; 0 when closed or unknown. */
export function keyboardInset(win: Pick<KeyboardViewportSource, "innerHeight" | "visualViewport">): number {
  const vv = win.visualViewport;
  if (!vv) return 0;
  return Math.max(0, win.innerHeight - vv.height - vv.offsetTop);
}

/**
 * Track the keyboard inset for one overlay element (a `position:fixed` /
 * `position:absolute; inset:0` dialog wrapper). Sets `--kb-inset` on it,
 * caps its height to the visible area while the keyboard is open, and
 * scrolls the focused control into view when the inset grows. Returns a
 * cleanup that removes the listeners and restores the overlay's styles.
 * Self-cleans if the overlay is removed from the document (dialogs whose
 * builder has no disposal hook, e.g. the sign editor via UINav).
 */
export function installKeyboardViewport(overlay: HTMLElement, win: KeyboardViewportSource): () => void {
  let prev = -1;
  let seen = overlay.isConnected;
  let gone = false;
  const doc = overlay.ownerDocument;
  const apply = (): void => {
    if (!overlay.isConnected) {
      if (seen) uninstall();
      return;
    }
    seen = true;
    const inset = keyboardInset(win);
    overlay.style.setProperty("--kb-inset", `${inset}px`);
    if (inset > 0) {
      overlay.style.setProperty("height", `calc(100% - ${inset}px)`);
      overlay.style.setProperty("box-sizing", "border-box");
      if (inset > prev) {
        const ae = doc.activeElement;
        if (ae instanceof HTMLElement && overlay.contains(ae)) {
          try {
            ae.scrollIntoView?.({ block: "nearest" });
          } catch {
            /* old browsers / headless harnesses */
          }
        }
      }
    } else {
      overlay.style.removeProperty("height");
      overlay.style.removeProperty("box-sizing");
    }
    prev = inset;
  };
  const uninstall = (): void => {
    if (gone) return;
    gone = true;
    try {
      win.visualViewport?.removeEventListener("resize", apply);
      win.visualViewport?.removeEventListener("scroll", apply);
      win.removeEventListener("resize", apply);
    } catch {
      /* already torn down */
    }
    overlay.style.removeProperty("--kb-inset");
    overlay.style.removeProperty("height");
    overlay.style.removeProperty("box-sizing");
  };
  try {
    win.visualViewport?.addEventListener("resize", apply);
    win.visualViewport?.addEventListener("scroll", apply);
    win.addEventListener("resize", apply);
  } catch {
    /* non-browser harness */
  }
  apply();
  return uninstall;
}
