/**
 * ADR-253 camera rotation: four 90° isometric views. The renderer (WebGL2 IsoRenderer or the Canvas2D sprite renderer)
 * owns the projection; this module picks the quarter, keeps the player fixed on screen while it snaps, tells the input
 * layer (camera-relative movement / aim / pad cursor) and the audio pan, persists the choice in "engine-settings"
 * (key `view`), and shows a small ⟲ / ⟳ HUD pair for mouse and touch under the top-right menu bar.
 * Controls: KBM `[` / `]`, gamepad hold RB + D-pad ←/→ (build mode: LT + D-pad ←/→), touch/mouse the HUD buttons.
 * The view change is a 450 ms spin transition (CSS matrix on the game canvas, snapping the renderer at the end, so
 * the end frame is identical to the snapped view); without a spin target, or under prefers-reduced-motion, it snaps
 * instantly as before. The server and simulation never see the view.
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
  /** Canvas to spin during a rotation (omit: the view snaps instantly, as before). The canvas is player-centred
   * (the camera follows the player), so a centre-origin spin keeps the player fixed while the world turns. */
  spinTarget?(): HTMLElement | undefined;
  /** Rotation transition length in ms (default 450). */
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
 * CSS transform matrix for a rotation transition: the screen-space map from the old view to a view rotated by
 * `theta` radians in view space. The iso projection P maps view (u, v) to screen ((u-v)*32, (u+v)*16) for 64x32
 * tiles, so the map is P * R(theta) * P^-1, a continuous 2x2 matrix: identity at 0, and exactly the quarter-turn
 * map at ±90° (CW: screen (x, y) -> (-2y, x/2)), so snapping the renderer at the end of the spin and clearing the
 * transform lands on the identical image, with no jump. The rendered frame itself is spun (sprites stay upright
 * billboards, depth order stays the old view's for the 450 ms), which is what a spin of an isometric view looks
 * like without touching the renderer's discrete quarter-turn projection.
 * Returns [a, b, c, d] for CSS `matrix(a, b, c, d, 0, 0)` (x' = a*x + c*y, y' = b*x + d*y).
 */
export function rotateTransitionMatrix(theta: number): [number, number, number, number] {
  const hw = 32, hh = 16, c = Math.cos(theta), s = Math.sin(theta);
  // P = [[hw, -hw], [hh, hh]]; P^-1 = [[1/(2hw), 1/(2hh)], [-1/(2hw), 1/(2hh)]]
  const m00 = hw * c + (-hw) * s, m01 = hw * (-s) + (-hw) * c;
  const m10 = hh * c + hh * s, m11 = hh * (-s) + hh * c;
  const a = m00 / (2 * hw) + m01 * (-1 / (2 * hw));
  const cc = m00 / (2 * hh) + m01 / (2 * hh);
  const b = m10 / (2 * hw) + m11 * (-1 / (2 * hw));
  const d = m10 / (2 * hh) + m11 / (2 * hh);
  return [a, b, cc, d];
}
/** Ease in-out cubic for the rotation transition (0 -> 1). */
export const spinEase = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const CAM_ROTATE_CSS = `#cam-rotate{position:absolute;right:calc(6px + var(--sar,0px));top:calc(56px + var(--sat,0px));z-index:11;display:flex;gap:6px;pointer-events:auto}
#cam-rotate[hidden]{display:none}
#cam-rotate button{width:44px;height:44px;padding:0;font:700 22px/1 Fredoka,system-ui,sans-serif;color:#3B2433;background:rgba(246,234,210,.92);border:2px solid #74432C;border-radius:10px;box-shadow:0 2px 0 #432C24;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none}
#cam-rotate button:active{transform:translateY(1px);box-shadow:0 1px 0 #432C24}
#cam-rotate button:focus-visible{outline:3px solid #ffd45a;outline-offset:1px}`;

export function attachCameraRotate(o: CameraRotateOptions): CameraRotateControl {
  const st = o.storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  let view = st ? loadView(st) : 0;
  /** Quarter actually on the renderer (lags `view` while a spin transition runs). */
  let shown = view;
  /** In-flight spin: renderer still shows `from`, canvas transform spins toward `to` by `dir` quarter turns. */
  let spin: { from: number; to: number; dir: number; start: number | undefined; el: HTMLElement; raf: number } | undefined;
  const reducedMotion = typeof matchMedia !== "undefined" && (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();
  const finishSpin = (): void => {
    if (!spin) return; const s = spin; spin = undefined;
    try { cancelAnimationFrame(s.raf); } catch { /* no rAF */ }
    s.el.style.transform = ""; s.el.style.transformOrigin = "";
    shown = s.to; sync();
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
    const dir = stepView(prev, 1) === n ? 1 : stepView(prev, -1) === n ? -1 : 1;
    const ms = o.spinMs ?? 450; let start: number | undefined;
    el.style.transformOrigin = "50% 50%";
    const step = (now: number): void => {
      if (!spin) return;
      if (start === undefined) start = now;
      const t = Math.min(1, (now - start) / ms); const th = spinEase(t) * dir * (Math.PI / 2);
      const [a, b, c, d] = rotateTransitionMatrix(th);
      el.style.transform = `matrix(${a},${b},${c},${d},0,0)`;
      if (t >= 1) finishSpin(); else spin.raf = requestAnimationFrame(step);
    };
    spin = { from: prev, to: n, dir, start, el, raf: 0 };
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
