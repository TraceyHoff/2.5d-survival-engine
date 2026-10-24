/**
 * Thin browser adapter (the only DOM-touching module). Wires keyboard, pointer events (mouse + touch + pen), wheel,
 * gamepad polling in rAF, blur/visibility release, pointer lock and default-prevention into an InputSystem.
 * CSS guidance: give the game element `touch-action: none; user-select: none; -webkit-touch-callout: none;`
 * so the browser doesn't pan/zoom/select during play (attach sets touch-action/user-select itself; without it Chrome
 * Android fires pointercancel as soon as a drag starts, which kills the joystick).
 */
import { GamepadDevice, KeyboardMouseDevice, TouchDevice, type GamepadLike } from "./devices.js";
import type { StorageAdapter, InputSystem } from "./system.js";
import { GestureRecognizer, VirtualControls, type Gesture, type Insets, type VirtualLayout } from "./touch.js";

export interface BrowserInputOptions {
  /** Keys whose default is prevented while the element is focused/active (Tab, Space, arrows...). */
  preventKeys?: readonly string[];
  virtualLayout?: VirtualLayout;
  leftHanded?: boolean;
  onGesture?: (g: Gesture) => void;
  /** Request pointer lock on click (FPS-style mouse look); off by default for iso. */
  pointerLock?: boolean;
  /** Persist binding overrides (default: localStorage under "engine.input.bindings"). Pass null to disable. */
  storage?: StorageAdapter | null;
  /** Safe-area insets in px for the virtual layout (default: `--sat/--sar/--sab/--sal` px values on :root). */
  insets?: () => Insets;
}
export interface BrowserInput { kbm: KeyboardMouseDevice; touch: TouchDevice; pads: Map<number, GamepadDevice>; controls?: VirtualControls; gestures: GestureRecognizer; detach(): void }

export function localStorageAdapter(key = "engine.input.bindings"): StorageAdapter {
  return { load: () => { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } }, save: (d) => { try { globalThis.localStorage?.setItem(key, d); } catch { /* quota/private mode */ } } };
}
const isTextTarget = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);

export function attachBrowserInput(el: HTMLElement, input: InputSystem, opts: BrowserInputOptions = {}): BrowserInput {
  const kbm = new KeyboardMouseDevice(); const touch = new TouchDevice(); const pads = new Map<number, GamepadDevice>();
  input.addDevice(kbm); input.addDevice(touch);
  el.style.touchAction = "none"; el.style.userSelect = "none";
  if (opts.storage !== null) input.useStorage(opts.storage ?? localStorageAdapter());
  const prevent = new Set(opts.preventKeys ?? ["Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Slash", "Quote"]);
  const controls = opts.virtualLayout ? new VirtualControls(opts.virtualLayout, touch) : undefined;
  if (controls) { controls.leftHanded = !!opts.leftHanded; }
  const gestures = new GestureRecognizer((g) => opts.onGesture?.(g), {}, touch);
  const offs: (() => void)[] = []; const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: never) => void, o?: AddEventListenerOptions) => { t.addEventListener(type, fn as EventListener, o); offs.push(() => t.removeEventListener(type, fn as EventListener, o)); };
  const cssInsets = (): Insets => { const cs = getComputedStyle(document.documentElement); const px = (v: string) => parseFloat(cs.getPropertyValue(v)) || 0; return { top: px("--sat"), right: px("--sar"), bottom: px("--sab"), left: px("--sal") }; };
  const resize = () => { const r = el.getBoundingClientRect();
    controls?.resize({ w: r.width, h: r.height, dpr: devicePixelRatio, insets: (opts.insets ?? cssInsets)() }); };
  // fullscreen enter/exit and rotation change the element's size without always firing a window resize first
  resize(); on(window, "resize", resize); on(document, "fullscreenchange", () => { controls?.reset(); resize(); }); on(document, "webkitfullscreenchange", resize);
  on(window, "orientationchange", () => { controls?.reset(); resize(); });
  on(window, "keydown", (e: KeyboardEvent) => { if (isTextTarget(e.target)) return; kbm.press(`key.${e.code}`); if (prevent.has(e.code)) e.preventDefault(); });
  on(window, "keyup", (e: KeyboardEvent) => kbm.release(`key.${e.code}`));
  const btn = ["mouse.left", "mouse.middle", "mouse.right", "mouse.back", "mouse.forward"];
  const rel = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  on(el, "pointerdown", (e: PointerEvent) => {
    const p = rel(e);
    if (e.pointerType === "touch" || e.pointerType === "pen") { el.setPointerCapture?.(e.pointerId); if (!controls?.pointerDown(e.pointerId, p.x, p.y)) gestures.down(e.pointerId, p.x, p.y, e.timeStamp); e.preventDefault(); return; }
    kbm.set("mouse.x", p.x); kbm.set("mouse.y", p.y); const b = btn[e.button]; if (b) kbm.press(b);
    if (opts.pointerLock && !document.pointerLockElement) el.requestPointerLock?.();
  });
  on(el, "pointermove", (e: PointerEvent) => {
    const p = rel(e);
    if (e.pointerType === "touch" || e.pointerType === "pen") { if (!controls?.pointerMove(e.pointerId, p.x, p.y)) gestures.move(e.pointerId, p.x, p.y, e.timeStamp); return; }
    if (document.pointerLockElement === el) { kbm.pulse("mouse.dx", e.movementX); kbm.pulse("mouse.dy", e.movementY); } else { kbm.set("mouse.x", p.x); kbm.set("mouse.y", p.y); }
  });
  const up = (e: PointerEvent) => {
    const p = rel(e);
    if (e.pointerType === "touch" || e.pointerType === "pen") { if (!controls?.pointerUp(e.pointerId)) gestures.up(e.pointerId, p.x, p.y, e.timeStamp); return; }
    const b = btn[e.button]; if (b) kbm.release(b);
  };
  on(el, "pointerup", up); on(el, "pointercancel", (e: PointerEvent) => { controls?.pointerUp(e.pointerId); gestures.cancel(e.pointerId); });
  on(el, "contextmenu", (e: Event) => e.preventDefault());
  on(el, "wheel", (e: WheelEvent) => { kbm.pulse("mouse.wheelY", Math.sign(e.deltaY)); kbm.pulse(e.deltaY > 0 ? "mouse.wheelDown" : "mouse.wheelUp", 1); e.preventDefault(); }, { passive: false });
  const releaseAll = () => { kbm.releaseAll(); touch.releaseAll(); controls?.reset(); for (const p of pads.values()) p.releaseAll(); };
  on(window, "blur", releaseAll); on(document, "visibilitychange", () => { if (document.hidden) releaseAll(); });
  on(window, "gamepadconnected", (e: GamepadEvent) => { const d = new GamepadDevice(e.gamepad.index, e.gamepad.id); pads.set(e.gamepad.index, d); input.addDevice(d); });
  on(window, "gamepaddisconnected", (e: GamepadEvent) => { const d = pads.get(e.gamepad.index); if (d) { d.releaseAll(); d.connected = false; input.removeDevice(d); pads.delete(e.gamepad.index); } });
  let raf = 0; const poll = (t: number) => {
    for (const gp of navigator.getGamepads?.() ?? []) { if (!gp) continue; let d = pads.get(gp.index); if (!d) { d = new GamepadDevice(gp.index, gp.id); pads.set(gp.index, d); input.addDevice(d); } d.poll(gp as unknown as GamepadLike); }
    gestures.update(t); raf = requestAnimationFrame(poll);
  };
  raf = requestAnimationFrame(poll);
  return { kbm, touch, pads, ...(controls ? { controls } : {}), gestures, detach: () => { cancelAnimationFrame(raf); for (const o of offs) o(); releaseAll(); } };
}
