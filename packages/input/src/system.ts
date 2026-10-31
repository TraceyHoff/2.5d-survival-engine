import { AimMode, type InputState } from "@engine/core";
import { DEVICE_CLASSES, type Device, type DeviceClass } from "./devices.js";
import { applyProcessors, type Vec2 } from "./processors.js";
import { bindingSignature, controlsOf, type ActionDef, type Binding, type BindingProfile, type ContextDef } from "./model.js";

export type ActionPhase = "started" | "performed" | "canceled";
export interface ActionEvent { action: string; phase: ActionPhase; context: string; device: DeviceClass; value: Vec2 }
export interface ActionValue { down: boolean; pressed: boolean; released: boolean; value: Vec2; context: string | undefined; device: DeviceClass | undefined }
interface BState { active: boolean; t0: number; lastTap: number; toggled: boolean; firedHold: boolean; nextRepeat: number }
export interface Clock { now(): number }
/** Maps actions onto core InputFrame fields (sim/netcode unchanged). */
export interface FrameMapping {
  /** held actions -> InputFrame.actions bits */
  holdBits: Record<string, number>;
  /** edge actions -> InputFrame.edges bits (pulsed on the update they fire) */
  edgeBits?: Record<string, number>;
  /** axis2D move action -> moveX/moveY + digital fallback bits */
  move?: { action: string; up: number; down: number; left: number; right: number };
  /** axis2D action -> ghostNudgeX/Y (building) */
  ghostNudge?: string;
  /** Bits set while a context is active (e.g. gameplay's Build bit while Building). */
  contextBits?: Record<string, number>;
}
export interface StorageAdapter { load(): string | null; save(data: string): void }
export interface Conflict { context: string; action: string; index: number; signature: string }

const EMPTY: Vec2 = [0, 0];
/**
 * Client-only input system: devices -> bindings (per device class profile, with user overrides) -> context stack ->
 * actions. Sampled once per sim tick into core's InputState/InputFrame; never runs inside the simulation.
 */
export class InputSystem {
  readonly actions = new Map<string, ActionDef>();
  private devices: Device[] = [];
  private profiles = new Map<DeviceClass, BindingProfile>();
  private overrides = new Map<string, Binding | null>();
  private contexts = new Map<string, ContextDef>();
  private enabled = new Set<string>();
  private stack: string[] = [];
  private states = new Map<string, BState>();
  private values = new Map<string, ActionValue>();
  private listeners = new Map<string, Set<(e: ActionEvent) => void>>();
  private contextHooks: ((stack: readonly string[]) => void)[] = [];
  private deviceHooks: ((d: DeviceClass, prev: DeviceClass | undefined) => void)[] = [];
  private autoRules: { context: string; when: () => boolean }[] = [];
  private captures: { cls?: DeviceClass; resolve: (r: { control: string; deviceClass: DeviceClass } | null) => void; cancel: string[] }[] = [];
  activeDevice: Device | undefined;
  lastUsedDeviceClass: DeviceClass | undefined;
  storage: StorageAdapter | undefined;
  /**
   * ADR-253 camera view quarter (0..3, the renderer's `viewRotation`). Move / ghost-nudge vectors are screen-relative;
   * writeFrame turns them back into the q0 screen frame the sim's `moveVector` expects, so movement stays camera-relative
   * in every view without any protocol or server change. 0 = unchanged.
   */
  viewQuarter = 0;
  constructor(readonly clock: Clock, opts: { actions?: readonly ActionDef[]; contexts?: readonly ContextDef[]; profiles?: readonly BindingProfile[] } = {}) {
    for (const a of opts.actions ?? []) this.defineAction(a);
    for (const c of opts.contexts ?? []) this.defineContext(c);
    for (const p of opts.profiles ?? []) this.setProfile(p);
  }
  // ---------- setup ----------
  defineAction(a: ActionDef): void { if (this.actions.has(a.name)) throw new Error(`duplicate action ${a.name}`); this.actions.set(a.name, a); }
  defineContext(c: ContextDef): void { this.contexts.set(c.name, c); this.enabled.add(c.name); }
  setProfile(p: BindingProfile): void {
    for (const [ctx, list] of Object.entries(p.bindings)) for (const b of list) if (!this.actions.has(b.action)) throw new Error(`profile ${p.id}: unknown action ${b.action} in ${ctx}`);
    this.profiles.set(p.deviceClass, p);
  }
  profile(cls: DeviceClass): BindingProfile | undefined { return this.profiles.get(cls); }
  addDevice(d: Device): void { if (!this.devices.includes(d)) this.devices.push(d); }
  removeDevice(d: Device): void { this.devices = this.devices.filter((x) => x !== d); if (this.activeDevice === d) this.activeDevice = undefined; }
  get deviceList(): readonly Device[] { return this.devices; }
  // ---------- contexts ----------
  push(name: string): void { if (!this.contexts.has(name)) throw new Error(`unknown context ${name}`); if (!this.stack.includes(name)) { this.stack.push(name); this.contextChanged(); } }
  pop(name?: string): void { const i = name ? this.stack.lastIndexOf(name) : this.stack.length - 1; if (i >= 0) { this.stack.splice(i, 1); this.contextChanged(); } }
  setEnabled(name: string, on: boolean): void { if (on) this.enabled.add(name); else this.enabled.delete(name); }
  isActive(name: string): boolean { return this.stack.includes(name) && this.enabled.has(name); }
  get contextStack(): readonly string[] { return this.stack; }
  onContextChange(fn: (stack: readonly string[]) => void): () => void { this.contextHooks.push(fn); return () => rm(this.contextHooks, fn); }
  /** Automatic switching: context is pushed while `when()` is true and popped when false (checked each update). */
  autoContext(context: string, when: () => boolean): void { this.autoRules.push({ context, when }); }
  private contextChanged(): void { for (const s of this.states.values()) s.active = false; for (const h of this.contextHooks) h(this.stack); }
  private ordered(): ContextDef[] { return this.stack.filter((n) => this.enabled.has(n)).map((n) => this.contexts.get(n)!).sort((a, b) => b.priority - a.priority); }
  // ---------- bindings / remapping ----------
  private key(cls: DeviceClass, ctx: string, action: string, index: number) { return `${cls}|${ctx}|${action}|${index}`; }
  /** Effective bindings for a device class + context (profile with user overrides applied). */
  bindings(cls: DeviceClass, ctx: string): { binding: Binding; index: number }[] {
    const base = this.profiles.get(cls)?.bindings[ctx] ?? []; const counts = new Map<string, number>(); const out: { binding: Binding; index: number }[] = [];
    for (const b of base) { const i = counts.get(b.action) ?? 0; counts.set(b.action, i + 1); const o = this.overrides.get(this.key(cls, ctx, b.action, i)); if (o !== null) out.push({ binding: o ?? b, index: i }); }
    for (const [k, o] of this.overrides) { const [c, cx, a, is] = k.split("|"); const i = Number(is); if (c === cls && cx === ctx && o && i >= (counts.get(a!) ?? 0)) out.push({ binding: o, index: i }); }
    return out;
  }
  /** Bindings of other actions in the same context sharing the signature (controls + modifiers + interaction). */
  conflicts(cls: DeviceClass, ctx: string, b: Binding, ignore?: { action: string; index: number }): Conflict[] {
    const sig = bindingSignature(b);
    return this.bindings(cls, ctx).filter(({ binding, index }) => !(ignore && binding.action === ignore.action && index === ignore.index) && bindingSignature(binding) === sig)
      .map(({ binding, index }) => ({ context: ctx, action: binding.action, index, signature: sig }));
  }
  /** Rebind action (context defaults to the first context that binds it). With swap, conflicting bindings take the old binding. */
  rebind(action: string, cls: DeviceClass, binding: Omit<Binding, "action">, opts: { context?: string; index?: number; swap?: boolean } = {}): { conflicts: Conflict[] } {
    const ctx = opts.context ?? this.contextOf(cls, action); if (!ctx) throw new Error(`no binding for ${action} on ${cls}`);
    const index = opts.index ?? 0; const nb: Binding = { ...binding, action };
    const old = this.bindings(cls, ctx).find((x) => x.binding.action === action && x.index === index)?.binding;
    const conflicts = this.conflicts(cls, ctx, nb, { action, index });
    if (opts.swap && old) for (const c of conflicts) this.overrides.set(this.key(cls, ctx, c.action, c.index), { ...old, action: c.action });
    this.overrides.set(this.key(cls, ctx, action, index), nb); this.persist();
    return { conflicts: opts.swap ? [] : conflicts };
  }
  unbind(action: string, cls: DeviceClass, opts: { context?: string; index?: number } = {}): void {
    const ctx = opts.context ?? this.contextOf(cls, action); if (ctx) { this.overrides.set(this.key(cls, ctx, action, opts.index ?? 0), null); this.persist(); }
  }
  /** Reset one action, one device class, or everything. */
  resetBindings(cls?: DeviceClass, action?: string): void {
    for (const k of [...this.overrides.keys()]) { const [c, , a] = k.split("|"); if ((!cls || c === cls) && (!action || a === action)) this.overrides.delete(k); }
    this.persist();
  }
  /** All same-context duplicate signatures across the effective bindings. */
  detectConflicts(cls: DeviceClass): Conflict[][] {
    const out: Conflict[][] = [];
    for (const ctx of this.contexts.keys()) {
      const groups = new Map<string, Conflict[]>();
      for (const { binding, index } of this.bindings(cls, ctx)) { const s = bindingSignature(binding); const g = groups.get(s) ?? []; g.push({ context: ctx, action: binding.action, index, signature: s }); groups.set(s, g); }
      for (const g of groups.values()) if (new Set(g.map((c) => c.action)).size > 1) out.push(g);
    }
    return out;
  }
  private contextOf(cls: DeviceClass, action: string): string | undefined {
    for (const [ctx, list] of Object.entries(this.profiles.get(cls)?.bindings ?? {})) if (list.some((b) => b.action === action)) return ctx; return undefined;
  }
  serializeOverrides(): string { return JSON.stringify({ version: 1, overrides: [...this.overrides] }); }
  loadOverrides(data: string | null | undefined): void {
    if (!data) return; const j = JSON.parse(data) as { version: number; overrides: [string, Binding | null][] };
    if (j.version !== 1) throw new Error(`unsupported overrides version ${j.version}`);
    this.overrides = new Map(j.overrides.filter(([k, b]) => b === null || this.actions.has(b.action) || !k));
  }
  /** Attach persistent storage (e.g. localStorage adapter): loads now, saves on every change. */
  useStorage(s: StorageAdapter): void { this.storage = s; this.loadOverrides(s.load()); }
  private persist(): void { this.storage?.save(this.serializeOverrides()); }
  /** Resolves with the next control that becomes active (interactive rebinding). Escape / Start cancel (null). */
  listenForNextInput(opts: { deviceClass?: DeviceClass; cancel?: string[] } = {}): Promise<{ control: string; deviceClass: DeviceClass } | null> {
    return new Promise((resolve) => this.captures.push({ ...(opts.deviceClass ? { cls: opts.deviceClass } : {}), resolve, cancel: opts.cancel ?? ["key.Escape", "pad.start"] }));
  }
  // ---------- events ----------
  on(action: string, fn: (e: ActionEvent) => void): () => void { let s = this.listeners.get(action); if (!s) this.listeners.set(action, (s = new Set())); s.add(fn); return () => s!.delete(fn); }
  onDeviceChange(fn: (cls: DeviceClass, prev: DeviceClass | undefined) => void): () => void { this.deviceHooks.push(fn); return () => rm(this.deviceHooks, fn); }
  private emit(e: ActionEvent): void { for (const f of this.listeners.get(e.action) ?? []) f(e); for (const f of this.listeners.get("*") ?? []) f(e); }
  // ---------- queries ----------
  get(action: string): ActionValue { return this.values.get(action) ?? { down: false, pressed: false, released: false, value: EMPTY, context: undefined, device: undefined }; }
  down(action: string): boolean { return this.get(action).down; }
  pressed(action: string): boolean { return this.get(action).pressed; }
  axis(action: string): number { return this.get(action).value[0]; }
  vector(action: string): Vec2 { return this.get(action).value; }
  // ---------- update ----------
  private readRaw(cls: DeviceClass, b: Binding): Vec2 {
    let best: Vec2 = [0, 0];
    for (const d of this.devices) {
      if (d.deviceClass !== cls || !d.connected) continue; const r = (c: string | undefined) => (c ? d.read(c) : 0); let v: Vec2;
      if (b.chord) v = [b.chord.every((c) => Math.abs(d.read(c)) >= (b.threshold ?? 0.5)) ? 1 : 0, 0];
      else if (b.composite && "up" in b.composite || b.composite && "left" in b.composite) { const c = b.composite as { up?: string; down?: string; left?: string; right?: string }; v = [r(c.right) - r(c.left), r(c.down) - r(c.up)]; }
      else if (b.composite && "x" in b.composite) v = [r(b.composite.x), r(b.composite.y)];
      else if (b.composite && "negative" in b.composite) v = [r(b.composite.positive) - r(b.composite.negative), 0];
      else v = [r(b.control), 0];
      if (b.modifiers && !b.modifiers.every((m) => d.read(m) >= 0.5)) v = [0, 0];
      v = applyProcessors(v, b.processors);
      if (Math.hypot(v[0], v[1]) > Math.hypot(best[0], best[1])) best = v;
    }
    return best;
  }
  /** Sample devices and resolve actions. Call once per sim tick (and optionally per frame for UI). */
  update(): void {
    const now = this.clock.now();
    for (const r of this.autoRules) { const on = r.when(); if (on && !this.stack.includes(r.context)) this.push(r.context); else if (!on && this.stack.includes(r.context)) this.pop(r.context); }
    // activity / active device / capture
    for (const d of this.devices) {
      const act = [...d.activeControls()]; if (!act.length && !d.moved?.()) continue;
      if (this.activeDevice !== d) { const prev = this.lastUsedDeviceClass; this.activeDevice = d; this.lastUsedDeviceClass = d.deviceClass; if (prev !== d.deviceClass) for (const h of this.deviceHooks) h(d.deviceClass, prev); }
      if (act.length) for (const c of [...this.captures]) if (!c.cls || c.cls === d.deviceClass) {
        this.captures.splice(this.captures.indexOf(c), 1); c.resolve(c.cancel.includes(act[0]!) ? null : { control: act[0]!, deviceClass: d.deviceClass });
      }
    }
    const prevValues = this.values; this.values = new Map();
    const result = (a: string) => { let v = this.values.get(a); if (!v) this.values.set(a, (v = { down: false, pressed: false, released: false, value: [0, 0], context: undefined, device: undefined })); return v; };
    for (const cls of DEVICE_CLASSES) {
      if (!this.devices.some((d) => d.deviceClass === cls)) continue;
      const claimed = new Set<string>(); let blocked = false; let pass: Set<string> | undefined; let keysBlocked = false; let keyPass: Set<string> | undefined;
      for (const ctx of this.ordered()) {
        const list = this.bindings(cls, ctx.name);
        // modifier shadowing within the context
        const satisfied = list.map(({ binding }) => Math.hypot(...this.readRaw(cls, binding)) >= (binding.threshold ?? 0.5));
        for (let i = 0; i < list.length; i++) {
          const { binding: b, index } = list[i]!; const ctrls = controlsOf(b);
          const allowedByBlock = !blocked || pass!.has(b.action); const allowedByKeys = !keysBlocked || keyPass!.has(b.action) || !ctrls.some((c) => c.startsWith("key."));
          const shadowedByHigher = ctrls.some((c) => claimed.has(c)) && !pass?.has(b.action);
          const shadowedByModifier = list.some((o, j) => j !== i && satisfied[j] && (o.binding.modifiers?.length ?? 0) > (b.modifiers?.length ?? 0) && controlsOf(o.binding).some((c) => ctrls.includes(c)));
          const sk = `${cls}|${ctx.name}|${b.action}|${index}`; const st = this.states.get(sk) ?? { active: false, t0: 0, lastTap: 0, toggled: false, firedHold: false, nextRepeat: 0 }; this.states.set(sk, st);
          let raw: Vec2 = allowedByBlock && allowedByKeys && !shadowedByHigher && !shadowedByModifier ? this.readRaw(cls, b) : [0, 0];
          const def = this.actions.get(b.action)!; const r = result(b.action);
          if (def.type !== "button") {
            if (Math.hypot(raw[0], raw[1]) > Math.hypot(r.value[0], r.value[1])) { r.value = raw; r.context = ctx.name; r.device = cls; }
            if (Math.hypot(raw[0], raw[1]) > 0) r.down = true;
            continue;
          }
          const active = Math.hypot(raw[0], raw[1]) >= (b.threshold ?? 0.5); const was = st.active; const it = b.interaction ?? { type: "press" };
          let down = false, fire = false, cancel = false;
          const canceledByDevice = !active && was && this.devices.some((d) => d.deviceClass === cls && (d as { wasCanceled?(c: string): boolean }).wasCanceled?.(b.control ?? ""));
          if (active && !was) { st.t0 = now; st.firedHold = false; st.nextRepeat = now + ((it.type === "repeat" ? it.delayMs : 0) ?? 400); }
          switch (it.type) {
            case "press": down = active; fire = active && !was; break;
            case "hold": case "longPress": if (active && !st.firedHold && now - st.t0 >= it.ms) { st.firedHold = true; fire = true; } down = it.type === "hold" && active && st.firedHold; if (!active && was && !st.firedHold) cancel = true; break;
            case "tap": if (!active && was) { if (!canceledByDevice && now - st.t0 <= (it.maxMs ?? 250)) fire = true; else cancel = true; } break;
            case "doubleTap": if (!active && was && !canceledByDevice && now - st.t0 <= (it.maxMs ?? 250)) { if (st.lastTap && now - st.lastTap <= (it.gapMs ?? 300)) { fire = true; st.lastTap = 0; } else st.lastTap = now; } break;
            case "toggle": if (active && !was) { st.toggled = !st.toggled; fire = st.toggled; } down = st.toggled; break;
            case "repeat": down = active; if (active && !was) fire = true; else if (active && now >= st.nextRepeat) { fire = true; st.nextRepeat = now + (it.rateMs ?? 80); } break;
          }
          if (canceledByDevice) { cancel = true; fire = it.type === "press" ? false : fire; }
          st.active = active;
          if (fire) { r.pressed = true; r.context = ctx.name; r.device = cls; this.emit({ action: b.action, phase: "performed", context: ctx.name, device: cls, value: raw }); }
          if (active && !was) this.emit({ action: b.action, phase: "started", context: ctx.name, device: cls, value: raw });
          if (cancel) this.emit({ action: b.action, phase: "canceled", context: ctx.name, device: cls, value: [0, 0] });
          if (down || fire) { r.down = r.down || down || (fire && it.type !== "press"); r.value = [1, 0]; r.context ??= ctx.name; r.device ??= cls; }
          raw = EMPTY;
        }
        for (const { binding } of list) for (const c of controlsOf(binding)) claimed.add(c);
        const pt = Array.isArray(ctx.passthrough) ? ctx.passthrough : (ctx.passthrough as Partial<Record<DeviceClass, readonly string[]>> | undefined)?.[cls] ?? [];
        if (ctx.consume) { pass = blocked ? new Set([...pass!].filter((a) => pt.includes(a))) : new Set(pt); blocked = true; }
        if (ctx.textEntry) { keyPass = keysBlocked ? new Set([...keyPass!].filter((a) => pt.includes(a))) : new Set(pt); keysBlocked = true; }
      }
    }
    for (const [a, v] of this.values) v.released = !v.down && !!prevValues.get(a)?.down;
    for (const [a, pv] of prevValues) if (pv.down && !this.values.has(a)) this.values.set(a, { down: false, pressed: false, released: true, value: [0, 0], context: pv.context, device: pv.device });
    for (const d of this.devices) d.endFrame();
  }
  /** Writes the current actions into core InputState (held bits, analog move, edges, ghost nudge). */
  writeFrame(state: InputState, map: FrameMapping, aim?: { x: number; y: number; mode: AimMode }): void {
    let bits = 0;
    for (const [a, m] of Object.entries(map.holdBits)) if (this.down(a)) bits |= m;
    if (map.move) {
      const [x, y] = rotateScreenVec(this.vector(map.move.action), this.viewQuarter); state.moveX = x; state.moveY = y;
      if (x < -0.5) bits |= map.move.left; if (x > 0.5) bits |= map.move.right; if (y < -0.5) bits |= map.move.up; if (y > 0.5) bits |= map.move.down;
    }
    for (const [c, m] of Object.entries(map.contextBits ?? {})) if (this.isActive(c)) bits |= m;
    state.setActions(bits >>> 0);
    for (const [a, m] of Object.entries(map.edgeBits ?? {})) if (this.pressed(a)) state.pulse(m);
    if (map.ghostNudge) { const [x, y] = rotateScreenVec(this.vector(map.ghostNudge), this.viewQuarter); state.ghostNudgeX = x; state.ghostNudgeY = y; }
    if (aim) { state.aimX = aim.x; state.aimY = aim.y; state.aimMode = aim.mode; }
  }
}
/**
 * ADR-253: a screen-space vector seen in camera view quarter `q` -> the same world direction expressed in the q0 screen
 * frame (the frame the sim's screen->iso map assumes). The q0 screen->world map is a pure 45° rotation, so a world
 * rotation by -q·90° (view -> world) is the same rotation of the screen vector: x' = c·x + s·y, y' = -s·x + c·y.
 * Exact for the integer quarter turns (no float drift; q0 returns the input unchanged).
 */
export function rotateScreenVec(v: Readonly<Vec2> | readonly [number, number], q: number): Vec2 {
  const k = ((Math.round(q) % 4) + 4) % 4; const x = v[0], y = v[1];
  return k === 0 ? [x, y] : k === 1 ? [y, 0 - x] : k === 2 ? [0 - x, 0 - y] : [0 - y, x];
}
function rm<T>(a: T[], v: T): void { const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); }
