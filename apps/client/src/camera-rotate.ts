/**
 * ADR-253 camera rotation: four 90° isometric views. The renderer (WebGL2 IsoRenderer or the Canvas2D sprite renderer)
 * owns the projection; this module picks the quarter, keeps the player fixed on screen while it snaps, tells the input
 * layer (camera-relative movement / aim / pad cursor) and the audio pan, persists the choice in "engine-settings"
 * (key `view`), and shows a small ⟲ / ⟳ HUD pair for mouse and touch under the top-right menu bar.
 * Controls: KBM `[` / `]`, gamepad hold RB + D-pad ←/→ (build mode: LT + D-pad ←/→), touch/mouse the HUD buttons.
 * ADR-267: two complete player-centred frames, opacity only. Capture at the renderer's
 * presentation boundary (WebGL default buffers may be cleared between callbacks). Keep the
 * outgoing frame fully opaque until destination meshes and its first complete frame are ready.
 * Reduced motion remains an instant snap. No projection tween, scaling or squashing.
 * The server and simulation never see the view.
 */
import { rotateScreenVec } from "@engine/input";

const KEY = "engine-settings";
type KV = Pick<Storage, "getItem" | "setItem">;
/** Normalise any integer to a quarter 0..3. */
export const normView = (q: number): number => (Number.isFinite(q) ? ((Math.round(q) % 4) + 4) % 4 : 0);
/** Quarter after one step: +1 = clockwise (the world turns clockwise on screen), -1 = counter-clockwise. */
export const stepView = (q: number, dir: number): number => normView(q + Math.sign(dir));
export function loadView(st: KV = localStorage): number {
  try { return normView(Number((JSON.parse(st.getItem(KEY) ?? "{}") as { view?: unknown }).view ?? 0)); } catch { return 0; }
}
export function saveView(q: number, st: KV = localStorage): void {
  try { const cur = JSON.parse(st.getItem(KEY) ?? "{}") as Record<string, unknown>; st.setItem(KEY, JSON.stringify({ ...cur, view: normView(q) })); } catch { /* private mode */ }
}
/**
 * Screen direction (+x right, +y down) -> unit world direction for view `q`: the same 45° iso mapping the sim's
 * moveVector applies to q0 screen input, after rotating the screen vector into q0 (AimResolver `dirToWorld`).
 */
export function screenDirToWorld(x: number, y: number, q: number): { x: number; y: number } {
  const [sx, sy] = rotateScreenVec([x, y], q); const dx = sx + sy, dy = sy - sx; const l = Math.hypot(dx, dy);
  return l > 1e-9 ? { x: dx / l, y: dy / l } : { x: 0, y: 0 };
}
/** Rotation requested this frame by the bound actions (+1 CW, -1 CCW, 0 none; both = none). */
export function rotateRequest(input: { pressed(a: string): boolean }): number {
  return (input.pressed("Camera.RotateCW") ? 1 : 0) - (input.pressed("Camera.RotateCCW") ? 1 : 0);
}

export interface RotateTarget { readonly viewRotation: number; setViewRotation(q: number, pivot?: { x: number; y: number; z?: number }): void }
export interface CameraRotateOptions {
  /** The renderer once it exists (undefined while booting / on the debug view: input stays q0 so it matches the screen). */
  target(): RotateTarget | undefined;
  /** World point kept fixed on screen (the local player). */
  pivot(): { x: number; y: number; z?: number } | undefined;
  /** Input system: its `viewQuarter` makes movement / nudge camera-relative. */
  input: { viewQuarter: number; pressed(a: string): boolean };
  /** Other view-dependent consumers (audio pan...). */
  onChange?(q: number): void;
  storage?: KV;
  /** Where the HUD buttons go (omit for no HUD: tests). */
  root?: HTMLElement;
  /** Hide the HUD (main menu, death screen, open panels). */
  hidden?(): boolean;
  /** Game canvas to cross-fade over during a rotation (omit: the view snaps instantly, as before). */
  spinTarget?(): HTMLElement | undefined;
  /** Screenshot of the spin target for the cross-fade (tests inject a fake; production snapshots the canvas).
   * Returning undefined means the screenshot failed: the view snaps instantly rather than blinking. */
  captureTarget?: (el: HTMLElement) => HTMLCanvasElement | undefined;
  /** Production calls frameComplete synchronously after a successful, fully prepared render. */
  frameBoundary?: boolean;
  /** Rotation transition length in ms (default 500). */
  spinMs?: number;
}
export interface CameraRotateControl {
  readonly view: number;
  /** Rotate one step (+1 CW / -1 CCW). */
  rotate(dir: number): void;
  /** Snap to a quarter. */
  set(q: number): void;
  /** Per UI frame while gameplay / build mode owns input: reads the bound actions and syncs the HUD and renderer. */
  poll(): void;
  /** Call immediately after presentation, before WebGL discards the default buffer. */
  frameComplete(): void;
  dispose(): void;
}
/** Opacity only: the complete frames always retain their native dimensions and pivot. */
export const ROTATE_CROSSFADE_MIN_SCALE = 1;
/** Ease in-out cubic for the rotation transition (0 -> 1). */
export const spinEase = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export function rotateCrossfadeAt(t: number): { opacity: number; scale: number } {
  const p = spinEase(Math.max(0, Math.min(1, t)));
  return { opacity: 1 - p, scale: 1 };
}
/** Screenshot of a canvas element for the cross-fade overlay, or undefined when it cannot be captured
 * (WebGL without preserveDrawingBuffer may already have cleared its buffer: then the caller snaps instantly
 * instead of fading to black). */
export function snapshotCanvas(el: HTMLElement): HTMLCanvasElement | undefined {
  try {
    const src = el as HTMLCanvasElement; if (typeof src.width !== "number" || !src.width || !src.height) return undefined;
    const c = document.createElement("canvas"); c.width = src.width; c.height = src.height;
    const g = c.getContext("2d"); if (!g) return undefined;
    g.drawImage(src, 0, 0); return c;
  } catch { return undefined; }
}

export const CAM_ROTATE_CSS = `#cam-rotate{position:absolute;right:calc(6px + var(--sar,0px));top:calc(56px + var(--sat,0px));z-index:11;display:flex;gap:6px;pointer-events:auto}
#cam-rotate[hidden]{display:none}
#cam-rotate button{width:44px;height:44px;padding:0;font:700 22px/1 Fredoka,system-ui,sans-serif;color:#3B2433;background:rgba(246,234,210,.92);border:2px solid #74432C;border-radius:10px;box-shadow:0 2px 0 #432C24;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none}
#cam-rotate button:active{transform:translateY(1px);box-shadow:0 1px 0 #432C24}
#cam-rotate button:focus-visible{outline:3px solid #ffd45a;outline-offset:1px}`;

export function attachCameraRotate(o: CameraRotateOptions): CameraRotateControl {
  const st = o.storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  let view = st ? loadView(st) : 0;
  /** Quarter actually on the renderer (with a cross-fade it snaps to `view` at once; the overlay lags behind). */
  let shown = view;
  /** In-flight cross-fade: the old-view screenshot fading over the already-snapped live canvas. */
  let pending = false;
  let waiting = false;
  let spin: { from: number; to: number; start: number | undefined; overlay: HTMLCanvasElement; raf: number } | undefined;
  const reducedMotion = typeof matchMedia !== "undefined" && (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();
  const finishSpin = (): void => {
    if (!spin) return; const s = spin; spin = undefined;
    try { cancelAnimationFrame(s.raf); } catch { /* no rAF */ }
    s.overlay.remove(); waiting = false; shown = s.to; sync();
  };
  /** Push the quarter actually on screen to the renderer + input (input follows what is actually on screen). */
  const sync = (): void => {
    const t = o.target();
    const q = t ? shown : 0;
    if (t && t.viewRotation !== q) t.setViewRotation(q, o.pivot());
    if (o.input.viewQuarter !== q) { o.input.viewQuarter = q; o.onChange?.(q); }
  };
  const begin = (): void => {
    pending = false;
    const el = o.spinTarget?.();
    const overlay = el && (o.captureTarget ?? snapshotCanvas)(el);
    if (!el || !overlay) { shown = view; sync(); return; }
    const r = el.getBoundingClientRect();
    overlay.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:2;pointer-events:none;opacity:1`;
    overlay.dataset["role"] = "rotate-fade";
    (el.parentElement ?? document.body).append(overlay);
    // Cover the canvas BEFORE changing quarter. A held / loading frame can never leak through.
    spin = { from: shown, to: view, start: undefined, overlay, raf: 0 };
    waiting = true; shown = view; sync();
    if (!o.frameBoundary) reveal();
  };
  const reveal = (): void => {
    if (!spin || !waiting) return;
    waiting = false; const current = spin; const ms = Math.max(1, o.spinMs ?? 500);
    const step = (now: number): void => {
      if (spin !== current) return;
      current.start ??= now;
      const t = Math.min(1, (now - current.start) / ms);
      current.overlay.style.opacity = String(rotateCrossfadeAt(t).opacity);
      if (t >= 1) finishSpin(); else current.raf = requestAnimationFrame(step);
    };
    current.raf = requestAnimationFrame(step);
  };
  const frameComplete = (): void => {
    if (pending) begin(); else if (waiting) reveal();
  };
  const set = (q: number): void => {
    const n = normView(q); if (n === view) { sync(); return; }
    // Ignore rapid turns until the current destination has actually rendered. Never remove its cover early.
    if (waiting) return;
    view = n; if (st) saveView(view, st);
    if (spin) finishSpin();
    if (!o.spinTarget?.() || reducedMotion || !o.target()) { pending = false; shown = view; sync(); return; }
    if (o.frameBoundary) pending = true; else begin();
  };
  const rotate = (dir: number): void => { if (dir) set(stepView(view, dir)); };
  let box: HTMLDivElement | undefined, style: HTMLStyleElement | undefined;
  if (o.root && typeof document !== "undefined") {
    style = document.createElement("style"); style.textContent = CAM_ROTATE_CSS; document.head.append(style);
    box = document.createElement("div"); box.id = "cam-rotate"; box.setAttribute("role", "group"); box.setAttribute("aria-label", "Rotate camera");
    const mk = (txt: string, dir: number, title: string): HTMLButtonElement => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = txt; b.dataset["rot"] = dir > 0 ? "cw" : "ccw"; b.title = title; b.setAttribute("aria-label", title);
      // keep the tap / click out of gameplay (attack, tap-to-move) and do not steal keyboard focus from the game
      for (const ev of ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown"]) b.addEventListener(ev, (e) => e.stopPropagation());
      b.addEventListener("pointerdown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => { e.stopPropagation(); rotate(dir); b.blur(); });
      return b;
    };
    box.append(mk("⟲", -1, "Rotate view counter-clockwise ( [ )"), mk("⟳", 1, "Rotate view clockwise ( ] )"));
    o.root.append(box);
  }
  const poll = (): void => { rotate(rotateRequest(o.input)); sync(); };
  let raf = 0;
  if (box && typeof requestAnimationFrame !== "undefined") {
    const tick = (): void => { raf = requestAnimationFrame(tick); const h = !o.target() || !!o.hidden?.(); if (box!.hidden !== h) box!.hidden = h; sync(); };
    raf = requestAnimationFrame(tick);
  }
  sync();
  return { get view() { return view; }, rotate, set, poll, frameComplete,
    dispose: () => { if (spin) finishSpin(); if (raf) cancelAnimationFrame(raf); box?.remove(); style?.remove(); } };
}
