/**
 * Fullscreen for play: entered from the Singleplayer / Multiplayer tap (user gesture). Orientation is deliberately
 * NOT locked (Task 19): the game follows how the phone is held, in fullscreen as well as windowed, so the player can
 * rotate between portrait and landscape at any time. Rotation fires a window resize, which reflows the renderer
 * (main.ts onResize), the camera zoom (camera-zoom attachZoom), and the keyboard-viewport helper — no reload needed.
 * The target is the UI root (`#game-root`: canvas + HUD + touch controls + modals), never the
 * canvas alone, so touch controls and menus stay rendered and tappable in fullscreen (ADR-095).
 * Left on quit / pagehide. Every call fails silently (unsupported, denied, iframes). iPhone Safari has no element
 * fullscreen: there the web app manifest (display: fullscreen) applies once added to the Home Screen, and a one-time tip says so.
 *
 * Task 20 (typing): leaving fullscreen while a text field is focused is a SEPARATE path from quitting
 * (exitFullscreenForTyping). On Chrome Android the IME surface can stay black — present but not drawing keys —
 * while the game is in element fullscreen, and repeated taps only eventually force it to composite; exiting
 * fullscreen removes the failing condition so the keyboard draws on the normal windowed path. The typing exit
 * deliberately does NOT clear `playing`, so the next-tap restore below re-enters fullscreen once typing ends,
 * and the restore itself never fires while a text field is focused (it would otherwise undo the exit on the
 * very tap that focused the field, or mid-typing on every keystroke).
 */
import { loadSettings } from "./menu.js";
import { uiRoot, mountUi } from "./ui-root.js";

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
/** Captured once; guarded so node-environment test files that import this module (via delete-progress /
 * character-creator) can load it without a DOM — every call below already fails silently without one. */
const doc = (typeof document !== "undefined" ? document : {}) as unknown as FsDoc;
let playing = false;

export const isFullscreen = (): boolean => !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
const standalone = (): boolean => matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
/** The element passed to requestFullscreen. */
export const fullscreenTarget = (): HTMLElement => uiRoot();
const canElementFs = (): boolean => { const el = fullscreenTarget() as FsEl; return typeof el.requestFullscreen === "function" || typeof el.webkitRequestFullscreen === "function"; };

/** Call synchronously inside the tap/click/key handler. */
export function enterFullscreen(): void {
  playing = true;
  if (!loadSettings().fullscreen || standalone()) return;
  const el = fullscreenTarget() as FsEl;
  try {
    if (!isFullscreen()) {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : (el.webkitRequestFullscreen?.(), undefined);
      void Promise.resolve(p).catch(() => {});
    }
  } catch { /* unsupported */ }
  if (!canElementFs()) iosTip();
}
export function exitFullscreen(): void {
  playing = false;
  // No orientation lock is requested anymore (Task 19); unlock stays as a harmless safeguard.
  try { (screen.orientation as { unlock?: () => void } | undefined)?.unlock?.(); } catch { /* ignore */ }
  try { if (isFullscreen()) { if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {}); else doc.webkitExitFullscreen?.(); } } catch { /* ignore */ }
}
/** Touch-capable device (phone/tablet, incl. hybrid laptops with a touchscreen). */
const isTouchDevice = (): boolean => {
  try { return navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches; } catch { return false; }
};
/**
 * Task 20: leave fullscreen so the phone IME can draw (see the header note). No-op on non-touch devices
 * (desktop keyboards have no IME compositing problem) and when not fullscreen. Unlike exitFullscreen()
 * this does NOT clear `playing`, so the restore below re-enters on the next non-typing gesture.
 * exitFullscreen needs no user gesture, so calling this from a pointerdown/focus handler is fine.
 */
export function exitFullscreenForTyping(): void {
  if (!isTouchDevice() || !isFullscreen()) return;
  try { if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {}); else doc.webkitExitFullscreen?.(); } catch { /* ignore */ }
}
/**
 * Wire a text input so tapping it leaves fullscreen for typing (creator name, menu room-code/server-url,
 * delete-confirm word, chat). Pointerdown exits before focus/keyboard-show in the tap sequence; a focus
 * after any tap on the input re-exits (covers refocus paths like the creator's empty-name refocus, where
 * the button's pointerup may have restored fullscreen first). Returns a cleanup (elements removed with
 * their dialog drop their listeners anyway; callers with a disposal hook use it).
 */
export function bindTypingFullscreenExit(input: HTMLElement): () => void {
  let touched = false;
  const down = (): void => { touched = true; exitFullscreenForTyping(); };
  const onFocus = (): void => { if (touched) exitFullscreenForTyping(); };
  input.addEventListener("pointerdown", down);
  input.addEventListener("focus", onFocus);
  return () => { input.removeEventListener("pointerdown", down); input.removeEventListener("focus", onFocus); };
}
/** After Esc / system back left fullscreen mid-game, the next tap or click on the game re-requests it. */
export function installFullscreenRestore(target: EventTarget = window): void {
  const again = (): void => {
    // Task 20: never yank fullscreen back while the user is typing. The restore runs on pointerup/keyup,
    // which fire while a text field is focused (every keystroke, and the tap that focused the field);
    // without this guard a typing-driven exit would be undone by that very tap, or mid-typing.
    const ae = doc.activeElement as HTMLElement | null;
    if (ae && (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || ae.isContentEditable)) return;
    if (playing && !isFullscreen() && loadSettings().fullscreen && !standalone()) enterFullscreen();
  };
  target.addEventListener("pointerup", again); target.addEventListener("keyup", (e) => { if ((e as KeyboardEvent).key !== "Escape") again(); });
  addEventListener("pagehide", exitFullscreen);
}
const TIP_KEY = "engine-fs-tip";
function iosTip(): void {
  if (standalone() || localStorage.getItem(TIP_KEY)) return; localStorage.setItem(TIP_KEY, "1");
  const t = document.createElement("div"); t.textContent = "Tip: Share → Add to Home Screen for fullscreen";
  t.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9998;padding:8px 14px;border-radius:8px;background:rgba(20,16,12,.88);color:#f4e7cf;font:14px system-ui,sans-serif;pointer-events:auto";
  t.addEventListener("click", () => t.remove()); mountUi(t); setTimeout(() => t.remove(), 7000);
}
