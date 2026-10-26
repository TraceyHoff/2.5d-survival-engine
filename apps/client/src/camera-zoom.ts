/**
 * Gameplay camera zoom (ADR-100). The default view shows ~30% more world area than the old fixed zoom 1.6
 * (1.6 / sqrt(1.3) ≈ 1.4) at 1920x1080; ADR-175 scales it with the viewport so phones see the same world, and the
 * player's own zoom multiplier (mouse wheel, two-finger pinch, +/- keys) is clamped and persisted in "engine-settings".
 */
export const LEGACY_ZOOM = 1.6;
export const AREA_GAIN = 1.3;
export const DESKTOP_ZOOM = LEGACY_ZOOM / Math.sqrt(AREA_GAIN); // ≈ 1.403
/** ADR-175: reference viewport (CSS px) at which DESKTOP_ZOOM applies; every other viewport is scaled to show the same world. */
export const REF_LONG = 1920, REF_SHORT = 1080;
export const ZOOM_FLOOR = 0.3, ZOOM_CEIL = 4;
export const USER_ZOOM_MIN = 0.75, USER_ZOOM_MAX = 1.6;
const KEY = "engine-settings";

/**
 * Default camera zoom (CSS px per iso px) for a CSS viewport (ADR-175). Zoom is resolution-relative, not a fixed
 * pixels-per-tile: the viewport is "contained" against the orientation-matched 1920x1080 reference, so a phone shows
 * at least as much world as PC along both axes of its own orientation (landscape: same vertical span as PC, wider if
 * the screen is wider; portrait: same span across the short side as PC's short side). DPR is not involved here:
 * the renderer multiplies by devicePixelRatio itself, so render resolution and sprite sharpness are unchanged.
 */
export function defaultZoom(cssW: number, cssH: number): number {
  if (!(cssW > 0 && cssH > 0)) return DESKTOP_ZOOM;
  const f = Math.min(Math.max(cssW, cssH) / REF_LONG, Math.min(cssW, cssH) / REF_SHORT);
  return Math.min(ZOOM_CEIL, Math.max(ZOOM_FLOOR, DESKTOP_ZOOM * f));
}
/** World extent in iso px visible at a zoom (for tests/QA). */
export const visibleIso = (cssW: number, cssH: number, zoom = defaultZoom(cssW, cssH)): { w: number; h: number } => ({ w: cssW / zoom, h: cssH / zoom });
export const clampUserZoom = (z: number): number => (Number.isFinite(z) ? Math.min(USER_ZOOM_MAX, Math.max(USER_ZOOM_MIN, z)) : 1);
type KV = Pick<Storage, "getItem" | "setItem">;
export function loadUserZoom(st: KV = localStorage): number {
  try { return clampUserZoom(Number((JSON.parse(st.getItem(KEY) ?? "{}") as { zoom?: unknown }).zoom ?? 1)); } catch { return 1; }
}
export function saveUserZoom(z: number, st: KV = localStorage): void {
  try { const cur = JSON.parse(st.getItem(KEY) ?? "{}") as Record<string, unknown>; st.setItem(KEY, JSON.stringify({ ...cur, zoom: Math.round(clampUserZoom(z) * 100) / 100 })); } catch { /* private mode */ }
}

export interface ZoomControl { readonly user: number; zoom(): number; setUser(z: number): void; apply(): void; dispose(): void }
/** Drives `camera.zoom` = defaultZoom(viewport) × user multiplier, with wheel / pinch / +- input on `el`. */
export function attachZoom(camera: { zoom: number }, el: HTMLElement, opts: { storage?: KV; viewport?: () => { w: number; h: number }; enabled?: () => boolean } = {}): ZoomControl {
  const vp = opts.viewport ?? (() => ({ w: innerWidth, h: innerHeight }));
  const on = opts.enabled ?? (() => true);
  let user = loadUserZoom(opts.storage); let saveT: ReturnType<typeof setTimeout> | undefined;
  const zoom = (): number => { const v = vp(); return defaultZoom(v.w, v.h) * user; };
  const apply = (): void => { camera.zoom = zoom(); };
  const setUser = (z: number): void => { user = clampUserZoom(z); apply(); clearTimeout(saveT); saveT = setTimeout(() => saveUserZoom(user, opts.storage), 300); };
  const wheel = (e: WheelEvent): void => { if (!on() || e.ctrlKey) return; e.preventDefault(); setUser(user * Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.0015)); };
  const pts = new Map<number, { x: number; y: number }>(); let pinch0 = 0, user0 = 1;
  const dist = (): number => { const [a, b] = [...pts.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const down = (e: PointerEvent): void => { if (e.pointerType !== "touch") return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { pinch0 = dist(); user0 = user; } };
  const move = (e: PointerEvent): void => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2 && pinch0 > 40 && on()) setUser(user0 * dist() / pinch0); };
  const up = (e: PointerEvent): void => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0; };
  const key = (e: KeyboardEvent): void => {
    if (!on() || (e.target as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable]")) return;
    if (e.key === "=" || e.key === "+") setUser(user * 1.1); else if (e.key === "-" || e.key === "_") setUser(user / 1.1);
  };
  el.addEventListener("wheel", wheel, { passive: false });
  el.addEventListener("pointerdown", down); addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  addEventListener("keydown", key); addEventListener("resize", apply); apply();
  return { get user() { return user; }, zoom, setUser, apply,
    dispose: () => { el.removeEventListener("wheel", wheel); el.removeEventListener("pointerdown", down); removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); removeEventListener("keydown", key); removeEventListener("resize", apply); clearTimeout(saveT); } };
}
