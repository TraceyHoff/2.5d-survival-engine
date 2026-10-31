/**
 * ADR-253 camera rotation: four 90° isometric views. The renderer (WebGL2 IsoRenderer or the Canvas2D sprite renderer)
 * owns the projection; this module picks the quarter, keeps the player fixed on screen while it snaps, tells the input
 * layer (camera-relative movement / aim / pad cursor) and the audio pan, persists the choice in "engine-settings"
 * (key `view`), and shows a small ⟲ / ⟳ HUD pair for mouse and touch under the top-right menu bar.
 * Controls: KBM `[` / `]`, gamepad hold RB + D-pad ←/→ (build mode: LT + D-pad ←/→), touch/mouse the HUD buttons.
 * The snap is instant (one projection swap, no per-frame cost); the server and simulation never see the view.
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
export const CAM_ROTATE_CSS = `#cam-rotate{position:absolute;right:calc(6px + var(--sar,0px));top:calc(56px + var(--sat,0px));z-index:11;display:flex;gap:6px;pointer-events:auto}
#cam-rotate[hidden]{display:none}
#cam-rotate button{width:44px;height:44px;padding:0;font:700 22px/1 Fredoka,system-ui,sans-serif;color:#3B2433;background:rgba(246,234,210,.92);border:2px solid #74432C;border-radius:10px;box-shadow:0 2px 0 #432C24;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none}
#cam-rotate button:active{transform:translateY(1px);box-shadow:0 1px 0 #432C24}
#cam-rotate button:focus-visible{outline:3px solid #ffd45a;outline-offset:1px}`;

export function attachCameraRotate(o: CameraRotateOptions): CameraRotateControl {
  const st = o.storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  let view = st ? loadView(st) : 0;
  /** Push `view` to the renderer + input when a renderer exists (input follows what is actually on screen). */
  const sync = (): void => {
    const t = o.target();
    if (t && t.viewRotation !== view) t.setViewRotation(view, o.pivot());
    const shown = t ? view : 0;
    if (o.input.viewQuarter !== shown) { o.input.viewQuarter = shown; o.onChange?.(shown); }
  };
  const set = (q: number): void => { const n = normView(q); if (n === view) { sync(); return; } view = n; if (st) saveView(view, st); sync(); };
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
    dispose: () => { if (raf) cancelAnimationFrame(raf); box?.remove(); style?.remove(); } };
}
