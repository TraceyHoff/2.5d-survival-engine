/**
 * Fullscreen for play: entered from the Singleplayer / Multiplayer tap (user gesture), landscape lock where supported.
 * The target is the UI root (`#game-root`: canvas + HUD + touch controls + modals), never the
 * canvas alone, so touch controls and menus stay rendered and tappable in fullscreen (ADR-095).
 * Left on quit / pagehide. Every call fails silently (unsupported, denied, iframes). iPhone Safari has no element
 * fullscreen: there the web app manifest (display: fullscreen) applies once added to the Home Screen, and a one-time tip says so.
 */
import { loadSettings } from "./menu.js";
import { uiRoot, mountUi } from "./ui-root.js";

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
const doc = document as FsDoc;
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
      void Promise.resolve(p).then(lockLandscape, () => {});
    } else lockLandscape();
  } catch { /* unsupported */ }
  if (!canElementFs()) iosTip();
}
function lockLandscape(): void {
  try { const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }; void o?.lock?.("landscape")?.catch(() => {}); } catch { /* ignore */ }
}
export function exitFullscreen(): void {
  playing = false;
  try { (screen.orientation as { unlock?: () => void } | undefined)?.unlock?.(); } catch { /* ignore */ }
  try { if (isFullscreen()) { if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {}); else doc.webkitExitFullscreen?.(); } } catch { /* ignore */ }
}
/** After Esc / system back left fullscreen mid-game, the next tap or click on the game re-requests it. */
export function installFullscreenRestore(target: EventTarget = window): void {
  const again = (): void => { if (playing && !isFullscreen() && loadSettings().fullscreen && !standalone()) enterFullscreen(); };
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
