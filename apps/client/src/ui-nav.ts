/**
 * Shared in-game focus/navigation layer for every menu and modal (inventory, crafting, build, character, party, clan,
 * trade, chat, settings, session/#p2p-overlay, pause). One modal stack, portaled into the UI root (./ui-root.ts) so it
 * renders and takes input in fullscreen. Devices:
 * - touch / mouse: modals are plain DOM with >= 44px tap targets; the menu bar (./game-menus.ts) opens each one.
 * - keyboard: Tab / Shift+Tab cycle (trapped in the top modal), arrows move spatially, Enter / Space activate,
 *   Esc closes the top modal (opens the pause menu when none is open), plus per-menu hotkeys when no text field is focused.
 * - gamepad: D-pad / left stick move focus (with repeat), A activates, B closes / goes back, Start toggles the pause menu,
 *   Select opens the pause menu (hub listing every menu).
 * While a modal is open the "Dialog" input context is pushed so gameplay actions (move/attack) are consumed.
 * Spatial moves use @engine/input's FocusManager over element rects; with no layout (all rects empty) they fall back to DOM order.
 */
import { FocusManager, type Dir } from "@engine/input";

export interface ContextStack { push(name: string): void; pop(name?: string): void; isActive?(name: string): boolean }
/** Input contexts in which Esc belongs to the game (Build.Cancel), not the pause menu. */
export const ESC_OWNING_CONTEXTS = ["Building"] as const;
export interface ModalHandle { id: string; el: HTMLElement; close(): void }
export interface UINavOptions {
  root: HTMLElement;
  /** Opens the pause menu (Esc / Start / Select with nothing open). */
  onPause?: () => void;
  /** Gameplay input stack: "Dialog" is pushed while any modal is open. */
  input?: ContextStack;
  /** code (KeyboardEvent.code) -> handler, active when no text field has focus. */
  hotkeys?: Record<string, () => void>;
  /** Page the open menu (PgUp/PgDn, gamepad LB/RB) while a modal is open; e.g. the paged container grid (ADR-098). */
  onPage?: (dir: -1 | 1) => void;
  getGamepads?: () => readonly (GamepadLikeNav | null)[];
  /** default true: poll gamepads every animation frame */
  pollGamepads?: boolean;
  now?: () => number;
}
export interface GamepadLikeNav { buttons: readonly { pressed: boolean }[]; axes: readonly number[] }
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
/** Face/shoulder shortcuts inside an open modal: clicks its enabled `[data-pad=<name>]` control (e.g. camper Y = add fuel, LB/RB = tabs). */
export const PAD_SHORTCUTS = ["X", "Y", "LB", "RB"] as const;
const FOCUSABLE = "button,input,select,textarea,a[href],[tabindex]:not([tabindex='-1'])";
const isText = (el: Element | null): boolean => (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "range"].includes(el.type)) || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);

export class UINav {
  private stack: { id: string; el: HTMLElement; onClose?: (() => void) | undefined; restore: Element | null }[] = [];
  private prevPad: Record<string, boolean> = {};
  private held: Dir | undefined; private nextAt = 0; private raf = 0;
  private readonly onKey = (e: KeyboardEvent): void => this.key(e);
  constructor(readonly o: UINavOptions) {
    addEventListener("keydown", this.onKey, true);
    if (o.pollGamepads !== false && typeof requestAnimationFrame === "function") { const loop = (): void => { this.pollGamepad(); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); }
  }
  destroy(): void { removeEventListener("keydown", this.onKey, true); if (this.raf) cancelAnimationFrame(this.raf); this.closeAll(); }

  get isOpen(): boolean { return this.stack.length > 0; }
  get top(): string | undefined { return this.stack.at(-1)?.id; }
  isOpenId(id: string): boolean { return this.stack.some((s) => s.id === id); }

  /** Open (portal) a modal into the UI root and focus its first control (or `[autofocus]`). */
  open(id: string, el: HTMLElement, onClose?: () => void): ModalHandle {
    if (this.isOpenId(id)) this.closeTo(id);
    el.dataset["modal"] = id; el.setAttribute("role", el.getAttribute("role") ?? "dialog"); el.setAttribute("aria-modal", "true");
    const restore = document.activeElement;
    this.o.root.append(el);
    if (!this.stack.length) this.o.input?.push("Dialog");
    this.stack.push({ id, el, onClose, restore });
    const first = el.querySelector<HTMLElement>("[autofocus]") ?? this.focusables()[0]; first?.focus();
    return { id, el, close: () => this.closeId(id) };
  }
  /** Close the top modal (B / Esc / Back button). */
  close(): void {
    const s = this.stack.pop(); if (!s) return;
    s.el.remove(); s.onClose?.();
    if (!this.stack.length) this.o.input?.pop("Dialog");
    const t = this.stack.at(-1); if (t) (this.focusables()[0])?.focus(); else if (s.restore instanceof HTMLElement && s.restore.isConnected) s.restore.focus();
  }
  closeId(id: string): void { while (this.isOpenId(id)) this.close(); }
  private closeTo(id: string): void { while (this.top && this.top !== id) this.close(); this.close(); }
  closeAll(): void { while (this.stack.length) this.close(); }
  /** Toggle: hotkey / menu-bar button for a menu that may already be on top. */
  toggle(id: string, build: () => HTMLElement, onClose?: () => void): void { if (this.top === id) this.close(); else { if (this.isOpenId(id)) this.closeId(id); this.open(id, build(), onClose); } }

  focusables(): HTMLElement[] {
    const t = this.stack.at(-1)?.el; if (!t) return [];
    return Array.from(t.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((e) => !(e as HTMLButtonElement).disabled && !e.hidden && e.closest("[hidden]") === null && e.getAttribute("aria-hidden") !== "true");
  }
  get focused(): HTMLElement | undefined { const a = document.activeElement; return a instanceof HTMLElement && this.focusables().includes(a) ? a : undefined; }

  /** Linear (Tab order) move, wrapping inside the top modal. */
  step(delta: number): HTMLElement | undefined {
    const f = this.focusables(); if (!f.length) return undefined;
    const i = this.focused ? f.indexOf(this.focused) : -1; const n = f[i < 0 ? (delta > 0 ? 0 : f.length - 1) : (i + delta + f.length) % f.length]!; n.focus(); return n;
  }
  /** Spatial move (arrows / D-pad / stick). */
  move(dir: Dir): HTMLElement | undefined {
    const f = this.focusables(); if (!f.length) return undefined;
    const cur = this.focused; if (!cur) { f[0]!.focus(); return f[0]; }
    const rects = f.map((e) => e.getBoundingClientRect());
    if (rects.every((r) => r.width === 0 && r.height === 0)) return this.step(dir === "up" || dir === "left" ? -1 : 1);
    const fm = new FocusManager(); fm.pushScreen("modal", true);
    f.forEach((e, i) => { const r = rects[i]!; fm.add({ id: String(i), rect: { x: r.left, y: r.top, w: r.width, h: r.height } }); });
    fm.setFocus(String(f.indexOf(cur)));
    const next = fm.navigate(dir);
    if (next === undefined || next === String(f.indexOf(cur))) return this.step(dir === "up" || dir === "left" ? -1 : 1); // edge: wrap in DOM order
    const n = f[Number(next)]!; n.focus(); return n;
  }
  /** A / Enter / Space on the focused control. */
  activate(): void {
    const f = this.focused ?? this.focusables()[0]; if (!f) return;
    if (isText(f)) { f.focus(); const submit = f.closest("[data-modal]")?.querySelector<HTMLElement>("[data-role=submit]"); if (submit && document.activeElement === f && (f as HTMLInputElement).value) submit.click(); return; }
    f.click();
  }
  /** Click the open modal's enabled `[data-pad=name]` control (gamepad X/Y/LB/RB). Returns whether one fired. */
  padShortcut(name: string): boolean {
    const t = this.stack.at(-1)?.el;
    const c = t?.querySelector<HTMLButtonElement>(`[data-pad="${name}"]`); if (!c || c.disabled || c.closest("[hidden]")) return false; c.click(); return true;
  }
  private pause(): void { this.o.onPause?.(); }

  private key(e: KeyboardEvent): void {
    const typing = isText(document.activeElement);
    if (!this.isOpen) {
      if (typing) return;
      if (e.key === "Escape" && ESC_OWNING_CONTEXTS.some((c) => this.o.input?.isActive?.(c))) return; // Build.Cancel via the input system
      if (e.key === "Escape") { this.pause(); e.preventDefault(); e.stopPropagation(); return; }
      const h = this.o.hotkeys?.[e.code]; if (h && !e.ctrlKey && !e.metaKey && !e.altKey) { h(); e.preventDefault(); e.stopPropagation(); }
      return;
    }
    // a modal is open: it owns the keyboard
    if (e.key === "Escape") { this.close(); e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === "Tab") { this.step(e.shiftKey ? -1 : 1); e.preventDefault(); e.stopPropagation(); return; }
    if (typing) { if (e.key === "Enter") { this.activate(); e.preventDefault(); } return; }
    const dirs: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    const d = dirs[e.key]; if (d) { this.move(d); e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === "Enter" || e.key === " ") { this.activate(); e.preventDefault(); e.stopPropagation(); return; }
    if ((e.key === "PageUp" || e.key === "PageDown") && this.o.onPage) { this.o.onPage(e.key === "PageUp" ? -1 : 1); e.preventDefault(); e.stopPropagation(); return; }
    const h = this.o.hotkeys?.[e.code]; if (h && !e.ctrlKey && !e.metaKey && !e.altKey) { h(); e.preventDefault(); e.stopPropagation(); }
  }

  /** One gamepad sample (edge-detected; stick/D-pad repeat 400ms then 110ms). Called per frame; exposed for tests. */
  pollGamepad(): void {
    const pads = this.o.getGamepads?.() ?? (typeof navigator !== "undefined" ? [...(navigator.getGamepads?.() ?? [])] : []);
    const gp = pads.find((g): g is GamepadLikeNav => !!g); if (!gp) return;
    const b = (i: number): boolean => !!gp.buttons[i]?.pressed;
    const edge = (k: string, v: boolean): boolean => { const was = this.prevPad[k]; this.prevPad[k] = v; return v && !was; };
    const start = edge("start", b(PAD.START)), select = edge("select", b(PAD.SELECT)), a = edge("a", b(PAD.A)), bb = edge("b", b(PAD.B));
    const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
    const dir: Dir | undefined = b(PAD.UP) ? "up" : b(PAD.DOWN) ? "down" : b(PAD.LEFT) ? "left" : b(PAD.RIGHT) ? "right"
      : Math.max(Math.abs(ax), Math.abs(ay)) < 0.5 ? undefined : Math.abs(ax) > Math.abs(ay) ? (ax < 0 ? "left" : "right") : ay < 0 ? "up" : "down";
    const now = this.o.now?.() ?? performance.now();
    if (start) { if (this.top === "pause") this.close(); else this.pause(); return; }
    if (!this.isOpen) { if (select) this.pause(); this.held = dir; return; }
    if (dir !== this.held) { this.held = dir; if (dir) { this.move(dir); this.nextAt = now + 400; } }
    else if (dir && now >= this.nextAt) { this.move(dir); this.nextAt = now + 110; }
    const lb = edge("lb", b(PAD.LB)), rb = edge("rb", b(PAD.RB));
    if (lb || rb) this.o.onPage?.(lb ? -1 : 1);
    if (a) this.activate();
    if (bb) { this.close(); return; }
    for (const n of PAD_SHORTCUTS) if (edge(n, b(PAD[n]))) this.padShortcut(n);
  }
}
