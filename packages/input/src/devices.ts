/**
 * DOM-free device model. Controls are string paths read as numbers (buttons 0/1, axes -1..1, triggers 0..1):
 *   keyboard: "key.<KeyboardEvent.code>"            e.g. key.KeyW, key.ShiftLeft, key.Space
 *   mouse:    "mouse.left|right|middle|back|forward", "mouse.wheelY" (pulse per update), "mouse.x|y" (screen px)
 *   gamepad:  "pad.<button>" (standard mapping names below), "pad.lx|ly|rx|ry" axes, "pad.lt|rt" analog triggers
 *   touch:    "touch.<virtual control id>" written by VirtualControls (e.g. touch.move.x, touch.btn.attack)
 * Browser adapters (browser.ts) translate DOM events into these devices; tests use FakeDevice.
 */
export type DeviceClass = "keyboardMouse" | "gamepad" | "touch";
export const DEVICE_CLASSES: readonly DeviceClass[] = ["keyboardMouse", "gamepad", "touch"];
export interface Device {
  readonly id: string;
  readonly deviceClass: DeviceClass;
  read(control: string): number;
  /** Controls that changed to a non-zero value since the last endFrame() (for activity + listenForNextInput). */
  activeControls(): Iterable<string>;
  /** Called once per InputSystem.update after reading (clears pulses like wheel). */
  endFrame(): void;
  connected: boolean;
}

/** Generic map-backed device; base for keyboard/mouse/gamepad/touch and for tests. */
export class MapDevice implements Device {
  protected values = new Map<string, number>(); protected pulses = new Set<string>(); protected fresh = new Set<string>();
  connected = true;
  constructor(readonly id: string, readonly deviceClass: DeviceClass) {}
  read(control: string): number { return this.values.get(control) ?? 0; }
  set(control: string, v: number): void { const old = this.values.get(control) ?? 0; if (v === 0) this.values.delete(control); else this.values.set(control, v); if ((v !== 0 && old === 0) || (Math.abs(v) >= 0.5 && Math.abs(old) < 0.5)) this.fresh.add(control); }
  /** Non-zero for exactly one update (e.g. wheel ticks). */
  pulse(control: string, v: number): void { this.set(control, (this.values.get(control) ?? 0) + v); this.pulses.add(control); }
  press(control: string): void { this.set(control, 1); }
  release(control: string): void { this.set(control, 0); }
  /** Release everything (blur / visibility hidden / disconnect). */
  releaseAll(): void { this.values.clear(); this.pulses.clear(); }
  protected canceled = new Set<string>();
  /** Release a control as canceled (finger dragged off a touch button): taps/holds don't fire. */
  cancel(control: string): void { this.set(control, 0); this.canceled.add(control); }
  wasCanceled(control: string): boolean { return this.canceled.has(control); }
  activeControls(): Iterable<string> { return this.fresh; }
  endFrame(): void { for (const p of this.pulses) this.values.delete(p); this.pulses.clear(); this.fresh.clear(); this.canceled.clear(); }
  snapshot(): Record<string, number> { return Object.fromEntries(this.values); }
}
export class KeyboardMouseDevice extends MapDevice {
  pointerLocked = false;
  constructor(id = "kbm") { super(id, "keyboardMouse"); }
  override activeControls(): Iterable<string> { return [...this.fresh].filter((c) => c !== "mouse.x" && c !== "mouse.y"); }
}

/** W3C standard gamepad mapping button order. */
export const PAD_BUTTONS = ["a", "b", "x", "y", "lb", "rb", "lt", "rt", "select", "start", "ls", "rs", "dup", "ddown", "dleft", "dright", "home"] as const;
export type PadButton = (typeof PAD_BUTTONS)[number];
export const PAD_AXES = ["lx", "ly", "rx", "ry"] as const;
/** Minimal Gamepad API shape (so tests and Node don't need DOM types). */
export interface GamepadLike {
  index: number; id: string; connected: boolean; mapping: string;
  buttons: readonly { pressed: boolean; value: number }[]; axes: readonly number[];
  vibrationActuator?: { playEffect?(type: string, p: Record<string, number>): Promise<unknown> } | null;
  hapticActuators?: readonly { pulse?(value: number, ms: number): Promise<unknown> }[];
}
/** Rumble behind feature detection. */
export interface Haptics { readonly supported: boolean; rumble(strong: number, weak: number, ms: number): Promise<boolean> }
export function gamepadHaptics(pad: GamepadLike): Haptics {
  const va = pad.vibrationActuator; const ha = pad.hapticActuators?.[0];
  if (va?.playEffect) return { supported: true, rumble: (s, w, ms) => va.playEffect!("dual-rumble", { duration: ms, strongMagnitude: clamp01(s), weakMagnitude: clamp01(w) }).then(() => true, () => false) };
  if (ha?.pulse) return { supported: true, rumble: (s, w, ms) => ha.pulse!(Math.max(clamp01(s), clamp01(w)), ms).then(() => true, () => false) };
  return { supported: false, rumble: async () => false };
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export class GamepadDevice extends MapDevice {
  haptics: Haptics = { supported: false, rumble: async () => false };
  constructor(readonly index: number, readonly padId = "") { super(`pad${index}`, "gamepad"); }
  /** Poll one Gamepad snapshot (called each rAF by the browser adapter, or by tests). Triggers stay analog. */
  poll(p: GamepadLike): void {
    this.connected = p.connected;
    p.buttons.forEach((b, i) => { const n = PAD_BUTTONS[i]; if (n) this.set(`pad.${n}`, n === "lt" || n === "rt" ? b.value : b.pressed ? 1 : 0); });
    p.axes.forEach((v, i) => { const n = PAD_AXES[i]; if (n) this.set(`pad.${n}`, Math.abs(v) < 0.02 ? 0 : v); }); // raw; deadzones are processors
    if (p.vibrationActuator || p.hapticActuators) this.haptics = gamepadHaptics(p);
  }
  override activeControls(): Iterable<string> { return [...this.fresh].filter((c) => !/^pad\.[lr][xy]$/.test(c) || Math.abs(this.read(c)) > 0.5); }
}
export class TouchDevice extends MapDevice { constructor(id = "touch") { super(id, "touch"); } }
/** Test device: any class, scripted values. */
export class FakeDevice extends MapDevice {}
