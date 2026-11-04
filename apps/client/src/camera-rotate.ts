/**
 * ADR-253 camera rotation: four 90° isometric views. The renderer (WebGL2 IsoRenderer or the Canvas2D sprite renderer)
 * owns the projection; this module picks the quarter, keeps the player fixed on screen while it snaps, tells the input
 * layer (camera-relative movement / aim / pad cursor) and the audio pan, persists the choice in "engine-settings"
 * (key `view`), and shows a small ⟲ / ⟳ HUD pair for mouse and touch under the top-right menu bar.
 * Controls: KBM `[` / `]`, gamepad hold RB + D-pad ←/→ (build mode: LT + D-pad ←/→), touch/mouse the HUD buttons.
 * The view change is a 500 ms cross-fade: a screenshot of the old view is laid over the game canvas, the
 * renderer snaps to the new quarter underneath it at once, and the screenshot fades out while shrinking
 * uniformly to 0.95x, revealing the new view. The screen never goes black (the earlier fade-out did, which
 * read as a blink), and nothing is ever stretched: earlier versions spun with an anisotropic CSS matrix that
 * squashed tiles and sprites mid-turn, then faded the canvas to transparent. Uniform scale + opacity keep
 * every sprite's proportions intact, so the world looks normal throughout. Without a spin target, a usable
 * screenshot, or under prefers-reduced-motion, it snaps instantly as before. The server and simulation never
 * see the view.
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
  dispose(): void;
}
/**
 * Cross-fade state of the rotation transition at normalised time `t` (0..1): the old-view screenshot starts
 * opaque and full-size and fades to transparent while shrinking uniformly to `ROTATE_CROSSFADE_MIN_SCALE`.
 * The live canvas underneath already shows the new view, so the screen never goes black and no layer is ever
 * stretched: `scale` is the same on both axes at every `t`.
 */
export const ROTATE_CROSSFADE_MIN_SCALE = 0.95;
/** Ease in-out cubic for the rotation transition (0 -> 1). */
export const spinEase = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export function rotateCrossfadeAt(t: number): { opacity: number; scale: number } {
  const p = spinEase(Math.max(0, Math.min(1, t)));
  return { opacity: 1 - p, scale: 1 - (1 - ROTATE_CROSSFADE_MIN_SCALE) * p };
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
  let spin: { from: number; to: number; start: number | undefined; overlay: HTMLCanvasElement; raf: number } | undefined;
  const reducedMotion = typeof matchMedia !== "undefined" && (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();
  const finishSpin = (): void => {
    if (!spin) return; const s = spin; spin = undefined;
    try { cancelAnimationFrame(s.raf); } catch { /* no rAF */ }
    s.overlay.remove(); shown = s.to; sync();
  };
  /** Push the quarter actually on screen to the renderer + input (input follows what is actually on screen). */
  const sync = (): void => {
    const t = o.target();
    const q = t ? shown : 0;
    if (t && t.viewRotation !== q) t.setViewRotation(q, o.pivot());
    if (o.input.viewQuarter !== q) { o.input.viewQuarter = q; o.onChange?.(q); }
  };
  const set = (q: number): void => {
    const n = normView(q); if (n === view) { sync(); return; }
    const prev = view; view = n; if (st) saveView(view, st);
    const el = o.spinTarget?.();
    if (!el || reducedMotion || !o.target()) { if (spin) finishSpin(); shown = view; sync(); return; }
    if (spin) finishSpin();
    // Capture the old view BEFORE snapping: the live canvas shows the new view underneath the overlay.
    const overlay = (o.captureTarget ?? snapshotCanvas)(el);
    if (!overlay) { shown = view; sync(); return; }
    shown = view; sync();
    const r = el.getBoundingClientRect();
    overlay.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:2;pointer-events:none;transform-origin:50% 50%`;
    overlay.dataset["role"] = "rotate-fade";
    (el.parentElement ?? document.body).append(overlay);
    const ms = o.spinMs ?? 500; let start: number | undefined;
    const step = (now: number): void => {
      if (!spin) return;
      if (start === undefined) start = now;
      const t = Math.min(1, (now - start) / ms); const f = rotateCrossfadeAt(t);
      spin.overlay.style.opacity = String(f.opacity); spin.overlay.style.transform = `scale(${f.scale})`;
      if (t >= 1) finishSpin(); else spin.raf = requestAnimationFrame(step);
    };
    spin = { from: prev, to: n, start, overlay, raf: 0 };
    spin.raf = requestAnimationFrame(step);
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
  return { get view() { return view; }, rotate, set, poll,
    dispose: () => { if (spin) finishSpin(); if (raf) cancelAnimationFrame(raf); box?.remove(); style?.remove(); } };
}
