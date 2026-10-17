import type { DeviceClass } from "./devices.js";
import type { InputSystem } from "./system.js";

export interface Rect { x: number; y: number; w: number; h: number }
export type Dir = "up" | "down" | "left" | "right";
export interface FocusNode {
  id: string; rect: Rect; group?: string; /** explicit neighbors override spatial search */ neighbors?: Partial<Record<Dir, string>>;
  disabled?: boolean; textField?: boolean; onSubmit?(): void; onFocus?(): void;
}
export interface FocusGroup { id: string; wrap?: boolean; /** tab order index (groups as tabs) */ order?: number }
export interface FocusHooks {
  scrollIntoView?(node: FocusNode): void;
  /** gamepad/touch on a text field: ask the platform/UI for a virtual keyboard */
  requestVirtualKeyboard?(node: FocusNode, device: DeviceClass): void;
  onFocusChange?(id: string | undefined, prev: string | undefined): void;
}
/**
 * Framework-agnostic focus graph: spatial navigation by rects (explicit neighbors win), groups with wrap, groups as tabs,
 * per-screen focus memory and modal traps. UI frameworks register nodes; drive it with UI.* actions via attach().
 */
export class FocusManager {
  private nodes = new Map<string, FocusNode>(); private groups = new Map<string, FocusGroup>();
  private screens: { id: string; modal: boolean; nodes: Set<string>; memory?: string }[] = [];
  focused: string | undefined;
  constructor(public hooks: FocusHooks = {}) {}
  /** Open a screen (modal = trap focus inside it). Restores remembered focus when reopened. */
  pushScreen(id: string, modal = false): void { const mem = this.memory.get(id); this.screens.push({ id, modal, nodes: new Set(), ...(mem ? { memory: mem } : {}) }); }
  private memory = new Map<string, string>();
  popScreen(): void { const s = this.screens.pop(); if (!s) return; if (this.focused && s.nodes.has(this.focused)) this.memory.set(s.id, this.focused); for (const n of s.nodes) this.nodes.delete(n); this.setFocus(this.firstAvailable()); }
  get screen(): string | undefined { return this.screens.at(-1)?.id; }
  add(node: FocusNode): void { this.nodes.set(node.id, node); this.screens.at(-1)?.nodes.add(node.id); const s = this.screens.at(-1); if (!this.focused || (s?.memory === node.id)) { if (!this.focused || s?.memory === node.id) this.setFocus(node.id); } }
  remove(id: string): void { this.nodes.delete(id); for (const s of this.screens) s.nodes.delete(id); if (this.focused === id) this.setFocus(this.firstAvailable()); }
  update(id: string, rect: Rect): void { const n = this.nodes.get(id); if (n) n.rect = rect; }
  defineGroup(g: FocusGroup): void { this.groups.set(g.id, g); }
  private reachable(): FocusNode[] {
    let scope: Set<string> | undefined; for (let i = this.screens.length - 1; i >= 0; i--) { const s = this.screens[i]!; if (s.modal || i === this.screens.length - 1) { scope = s.nodes; if (s.modal) break; break; } }
    return [...this.nodes.values()].filter((n) => !n.disabled && (!scope || scope.has(n.id)));
  }
  private firstAvailable(): string | undefined { const r = this.reachable(); return r.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)[0]?.id; }
  setFocus(id: string | undefined): void {
    if (id === this.focused) return; const prev = this.focused; this.focused = id; const n = id ? this.nodes.get(id) : undefined;
    if (n) { n.onFocus?.(); this.hooks.scrollIntoView?.(n); } this.hooks.onFocusChange?.(id, prev);
  }
  /** Spatial navigation from the focused node. */
  navigate(dir: Dir): string | undefined {
    const cur = this.focused ? this.nodes.get(this.focused) : undefined; const all = this.reachable();
    if (!cur) { this.setFocus(this.firstAvailable()); return this.focused; }
    const ex = cur.neighbors?.[dir]; if (ex && all.some((n) => n.id === ex)) { this.setFocus(ex); return ex; }
    const c = center(cur.rect); const pool = all.filter((n) => n.id !== cur.id && (!cur.group || !this.groups.get(cur.group)?.wrap || n.group === cur.group));
    let best: FocusNode | undefined, bestScore = Infinity;
    for (const n of pool) {
      const p = center(n.rect); const dx = p.x - c.x, dy = p.y - c.y;
      const primary = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy; if (primary <= 0.5) continue;
      const secondary = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx); const score = primary + secondary * 2;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (!best && cur.group && this.groups.get(cur.group)?.wrap) { // wrap to the far side within the group
      const same = pool.filter((n) => n.group === cur.group); const key = (n: FocusNode) => { const p = center(n.rect); return dir === "left" ? -p.x : dir === "right" ? p.x : dir === "up" ? -p.y : p.y; };
      best = same.sort((a, b) => key(a) - key(b) || Math.abs(center(a.rect).y - c.y) - Math.abs(center(b.rect).y - c.y))[0];
    }
    if (best) this.setFocus(best.id); return this.focused;
  }
  /** Tab order inside the current group (wraps). */
  next(delta = 1): string | undefined {
    const all = this.reachable(); const cur = this.focused ? this.nodes.get(this.focused) : undefined;
    const list = all.filter((n) => !cur?.group || n.group === cur.group).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    if (!list.length) return undefined; const i = cur ? list.findIndex((n) => n.id === cur.id) : -1; this.setFocus(list[(i + delta + list.length) % list.length]!.id); return this.focused;
  }
  /** Switch group tabs (UI.TabNext/Prev): focus the remembered or first node of the next group. */
  private groupMemory = new Map<string, string>();
  tab(delta: number): string | undefined {
    const gs = [...this.groups.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); if (!gs.length) return undefined;
    const cur = this.focused ? this.nodes.get(this.focused)?.group : undefined; if (cur && this.focused) this.groupMemory.set(cur, this.focused);
    const i = Math.max(0, gs.findIndex((g) => g.id === cur)); const g = gs[(i + delta + gs.length) % gs.length]!;
    const target = this.groupMemory.get(g.id) ?? this.reachable().filter((n) => n.group === g.id).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)[0]?.id;
    if (target) this.setFocus(target); return this.focused;
  }
  submit(device: DeviceClass = "keyboardMouse"): void {
    const n = this.focused ? this.nodes.get(this.focused) : undefined; if (!n) return;
    if (n.textField && device !== "keyboardMouse") this.hooks.requestVirtualKeyboard?.(n, device); n.onSubmit?.();
  }
  /** Touch/mouse: direct tap focuses and submits the node under the point. */
  tapAt(x: number, y: number, device: DeviceClass = "touch"): string | undefined {
    const n = this.reachable().find((m) => x >= m.rect.x && x <= m.rect.x + m.rect.w && y >= m.rect.y && y <= m.rect.y + m.rect.h);
    if (n) { this.setFocus(n.id); this.submit(device); } return n?.id;
  }
  /**
   * Drive from an InputSystem each update: navigate axis with repeat (delay/rate ms), submit/back/tab actions.
   * Returns a detach function. `onBack` lets the screen close itself.
   */
  attach(input: InputSystem, a: { navigate: string; submit: readonly string[]; back: readonly string[]; tabNext?: string; tabPrev?: string }, opts: { delayMs?: number; rateMs?: number; onBack?: () => void } = {}): () => void {
    let held: Dir | undefined; let nextAt = 0;
    const step = () => {
      const now = input.clock.now(); const [x, y] = input.vector(a.navigate); const m = Math.max(Math.abs(x), Math.abs(y));
      const dir: Dir | undefined = m < 0.5 ? undefined : Math.abs(x) > Math.abs(y) ? (x < 0 ? "left" : "right") : y < 0 ? "up" : "down";
      if (dir !== held) { held = dir; if (dir) { this.navigate(dir); nextAt = now + (opts.delayMs ?? 400); } }
      else if (dir && now >= nextAt) { this.navigate(dir); nextAt = now + (opts.rateMs ?? 90); }
      const dev = input.activeDevice?.deviceClass ?? "keyboardMouse";
      if (a.submit.some((s) => input.pressed(s))) this.submit(dev);
      if (a.back.some((s) => input.pressed(s))) opts.onBack?.();
      if (a.tabNext && input.pressed(a.tabNext)) this.tab(1); if (a.tabPrev && input.pressed(a.tabPrev)) this.tab(-1);
    };
    this.stepper = step; return () => { if (this.stepper === step) this.stepper = undefined; };
  }
  private stepper: (() => void) | undefined;
  /** Call after input.update() each frame/tick when attached. */
  tick(): void { this.stepper?.(); }
}
const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
