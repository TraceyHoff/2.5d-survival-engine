/**
 * ADR-213: menu-side gamepad plumbing for real devices (Xbox Edge): one merged pad over every connected controller,
 * keyboard-emulated pad keys, a source arbiter so one physical press never moves focus twice, and the ?padDebug=1 readout.
 */
import { gamepadKeyControl, mergePads, readNavigatorPads, type NormPad, type PadControl, type RawPad } from "@engine/input";
export { gamepadKeyControl, type PadControl };

/** Merged standard-layout pad from `get` (default navigator.getGamepads()); undefined = no controller visible. */
export function navPad(get?: () => readonly (RawPad | null | undefined)[] | null | undefined): NormPad | undefined {
  let pads: readonly (RawPad | null | undefined)[] | null | undefined;
  try { pads = get ? get() : readNavigatorPads(); } catch { return undefined; }
  return mergePads(pads);
}
export type PadSource = "api" | "key" | "arrow";
/**
 * One physical press can arrive twice on Edge: as a Gamepad API button AND as a keyboard-emulated key (GamepadDPadDown /
 * keyCode 204 / ArrowDown). The first source to report a control owns it until that source lets go (+ a grace window);
 * the other source's reports of the same control are dropped meanwhile, so focus moves exactly once (and repeats once).
 */
export class PadArbiter {
  private own = new Map<string, { src: PadSource; until: number }>();
  /** `src` reports `ctl` held at `t` (for `holdMs` more). Returns whether `src` owns it (may act). */
  claim(ctl: string, src: PadSource, t: number, holdMs = 150): boolean {
    const o = this.own.get(ctl); if (o && o.src !== src && t < o.until) return false;
    this.own.set(ctl, { src, until: t + holdMs }); return true;
  }
  /** `src` let go of `ctl` at `t`: the other source may take over after a short grace (its own report of the same press may lag). */
  release(ctl: string, src: PadSource, t: number, graceMs = 120): void { const o = this.own.get(ctl); if (o && o.src === src) o.until = Math.min(o.until, t + graceMs); }
  owner(ctl: string, t: number): PadSource | undefined { const o = this.own.get(ctl); return o && t < o.until ? o.src : undefined; }
  reset(): void { this.own.clear(); }
}
/** Shared by every menu surface (UINav, boot menu, character creator, death screen): the devices are global. */
export const padArbiter = new PadArbiter();

/** ADR-213 debug trace: the last pad key events and nav actions (shown by ?padDebug=1, readable in tests). */
export const padTrace = { keys: [] as string[], actions: [] as string[] };
const push = (a: string[], s: string): void => { a.unshift(s); if (a.length > 8) a.length = 8; };
export function traceKey(e: KeyboardEvent, ctl: PadControl | null | undefined, note = ""): void { push(padTrace.keys, `${e.type} key=${e.key || "''"} code=${e.code || "''"} keyCode=${e.keyCode}${e.repeat ? " repeat" : ""} -> ${ctl === undefined ? "-" : ctl ?? "ignored"}${note ? ` ${note}` : ""}`); }
export function traceAction(s: string): void { push(padTrace.actions, `${Math.round(performance.now())} ${s}`); }

/** ADR-213: `?padDebug=1` — a click-through readout of what the browser really delivers (raw pads + pad key events). */
export function mountPadDebug(doc: Document = document): () => void {
  const el = doc.createElement("pre"); el.id = "pad-debug"; el.setAttribute("aria-hidden", "true");
  el.style.cssText = "position:fixed;left:4px;top:4px;z-index:2147483647;margin:0;max-width:min(760px,calc(100vw - 8px));max-height:calc(100vh - 8px);overflow:hidden;padding:6px 8px;background:rgba(0,0,0,.78);color:#9f9;font:12px/1.3 ui-monospace,Consolas,monospace;white-space:pre-wrap;pointer-events:none;border-radius:6px";
  doc.body.append(el);
  const events: string[] = [];
  const onConn = (e: Event): void => { const g = (e as GamepadEvent).gamepad; push(events, `${e.type} #${g?.index} ${g?.id ?? ""} mapping='${g?.mapping ?? ""}'`); };
  const onKey = (e: KeyboardEvent): void => { const c = gamepadKeyControl(e); if (c !== undefined || /^Arrow|^Enter$|^Escape$|^ $/.test(e.key)) traceKey(e, c); };
  addEventListener("gamepadconnected", onConn); addEventListener("gamepaddisconnected", onConn); addEventListener("keydown", onKey, true); addEventListener("keyup", onKey, true);
  let raf = 0, last = "";
  const tick = (): void => {
    const nv = navigator as Navigator & { gamepadInputEmulation?: string };
    const L: string[] = [`padDebug  gamepadInputEmulation: ${"gamepadInputEmulation" in nv ? `'${String(nv.gamepadInputEmulation)}'` : "(not supported)"}  getGamepads: ${typeof navigator.getGamepads === "function" ? "yes" : "NO"}`];
    let raw: readonly (Gamepad | null)[] = []; try { raw = navigator.getGamepads?.() ?? []; } catch (e) { L.push(`getGamepads threw ${String(e)}`); }
    if (![...raw].some((g) => g)) L.push("no pads visible (press a button on the controller)");
    [...raw].forEach((g, i) => { if (!g) { L.push(`[${i}] null`); return; }
      const pressed = g.buttons.map((b, j) => (b.pressed || b.value > 0.05 ? `${j}${b.value > 0 && b.value < 1 ? `=${b.value.toFixed(2)}` : ""}` : "")).filter(Boolean).join(" ");
      L.push(`[${i}] index=${g.index} connected=${g.connected} mapping='${g.mapping}' id=${g.id}`, `     buttons(${g.buttons.length}): ${pressed || "-"}`, `     axes(${g.axes.length}): ${g.axes.map((a) => a.toFixed(2)).join(" ")}`); });
    const m = mergePads(raw as unknown as RawPad[]);
    if (m) { const names = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "Up", "Down", "Left", "Right", "Home"]; L.push(`merged: ${m.buttons.map((b, i) => (b.pressed ? names[i] : "")).filter(Boolean).join(" ") || "-"}  stick ${m.axes[0]!.toFixed(2)},${m.axes[1]!.toFixed(2)}`); }
    const a = doc.activeElement as HTMLElement | null;
    L.push(`focus: ${a ? `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ""} "${(a.getAttribute("aria-label") ?? a.textContent ?? "").trim().slice(0, 40)}"` : "-"}  menu: ${Array.from(doc.querySelectorAll("[data-menu]")).pop()?.getAttribute("data-menu") ?? "-"}  padUi: ${doc.documentElement.dataset["padUi"] ? "on" : "off"}`);
    if (events.length) L.push("events:", ...events.map((s) => `  ${s}`));
    L.push("pad keys (Edge keyboard emulation):", ...(padTrace.keys.length ? padTrace.keys.map((s) => `  ${s}`) : ["  none"]));
    L.push("nav actions:", ...(padTrace.actions.length ? padTrace.actions.map((s) => `  ${s}`) : ["  none"]));
    const t = L.join("\n"); if (t !== last) { el.textContent = t; last = t; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(raf); el.remove(); removeEventListener("gamepadconnected", onConn); removeEventListener("gamepaddisconnected", onConn); removeEventListener("keydown", onKey, true); removeEventListener("keyup", onKey, true); };
}

const STD: Record<PadControl, number> = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as unknown as Record<PadControl, number>;
/** Whether `c` is held on a merged pad (directions include the left stick past 0.5). */
export function padHeld(p: NormPad | undefined, c: PadControl): boolean {
  if (!p) return false; const i = STD[c]; if (i !== undefined && p.buttons[i]?.pressed) return true;
  const x = p.axes[0] ?? 0, y = p.axes[1] ?? 0; if (Math.max(Math.abs(x), Math.abs(y)) < 0.5) return false;
  const h = Math.abs(x) > Math.abs(y);
  return c === "LEFT" ? h && x < 0 : c === "RIGHT" ? h && x > 0 : c === "UP" ? !h && y < 0 : c === "DOWN" ? !h && y > 0 : false;
}
/** ADR-213: edge (+ direction repeat 400/110 ms) detection over the merged pad for the simple screens (boot menu,
 *  character creator, death screen), sharing ownership with the pad-key path through padArbiter. */
export class PadEdges {
  private prev = new Map<PadControl, boolean>(); private next = new Map<PadControl, number>();
  /** repeat clock: real time with each step capped at 120 ms (a long frame never makes a tap repeat) */
  private v = 0; private last: number | undefined;
  constructor(private readonly ctls: readonly PadControl[], private readonly repeat = true) {}
  /** Controls that should act this frame. */
  step(p: NormPad | undefined, now: number): PadControl[] {
    const out: PadControl[] = []; this.v += this.last === undefined ? 16 : Math.min(Math.max(now - this.last, 0), 120); this.last = now; const vt = this.v;
    for (const c of this.ctls) {
      const v = padHeld(p, c), was = this.prev.get(c) ?? false; this.prev.set(c, v);
      if (!v) { if (was) padArbiter.release(c, "api", now); continue; }
      const own = padArbiter.claim(c, "api", now);
      if (!was) { this.next.set(c, vt + 400); if (own) out.push(c); }
      else if (this.repeat && DIRS.has(c) && vt >= (this.next.get(c) ?? Infinity)) { this.next.set(c, vt + 110); if (own) out.push(c); }
    }
    return out;
  }
  /** Mark every currently held control as already seen (no edge on the next step). */
  hold(p: NormPad | undefined): void { for (const c of this.ctls) this.prev.set(c, padHeld(p, c)); }
}
const DIRS = new Set<PadControl>(["UP", "DOWN", "LEFT", "RIGHT"]);
/** ADR-213 pad key (Edge keyboard emulation) for the simple screens: `undefined` = not a pad key (handle as keyboard);
 *  `null` = a pad key to swallow without acting (key-up, auto-repeat, or the Gamepad API already handled the press). */
export function padKeyEdge(e: KeyboardEvent, now = performance.now()): PadControl | null | undefined {
  const c = gamepadKeyControl(e); if (c === undefined) return undefined;
  if (c === null) return null;
  if (e.type !== "keydown") { padArbiter.release(c, "key", now); return null; }
  if (!padArbiter.claim(c, "key", now, 1000) || e.repeat) return null;
  return c;
}
