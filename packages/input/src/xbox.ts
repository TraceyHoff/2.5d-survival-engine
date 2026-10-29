/**
 * ADR-213: real-device (Xbox Edge / Windows) gamepad normalisation, shared by gameplay (browser.ts) and menus (client ui-nav).
 *
 * 1. Keyboard emulation. Edge on Xbox delivers the controller as KEY events when the page's gamepadInputEmulation is
 *    "keyboard" (or the property is ignored / unsupported and the system maps the pad to keys): `key` is "GamepadDPadUp",
 *    "GamepadLeftThumbstickUp", "GamepadA" ... (EdgeHTML) or "Unidentified" (Chromium has no DOM key name for the
 *    VK_GAMEPAD_* virtual keys), `keyCode` 195..218; the UWP navigation keys VK_NAVIGATION_* (138..143 "NavigationUp"...)
 *    are the same thing for a TV remote. `gamepadKeyControl` maps all of them to one logical control.
 * 2. Gamepad API. `getGamepads()` can hold several entries (an idle duplicate / phantom pad at index 0 and the live pad at
 *    index 1, two controllers), `mapping` can be "" (no standard remap: D-pad as a hat on axis 9, View/Menu at 6/7,
 *    triggers on an axis) and triggers can report `value` without `pressed`. `normalizePad` maps one snapshot to the
 *    standard layout; `mergePads` ORs every connected pad so whichever controller the player holds drives the UI.
 */
export type PadControl = "A" | "B" | "X" | "Y" | "LB" | "RB" | "LT" | "RT" | "SELECT" | "START" | "LS" | "RS" | "UP" | "DOWN" | "LEFT" | "RIGHT" | "HOME";
/** Standard-mapping button index of each control (W3C standard gamepad). */
export const STD_INDEX: Record<PadControl, number> = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16 };
export const NAV_DIRS = ["UP", "DOWN", "LEFT", "RIGHT"] as const;
export type NavDirControl = (typeof NAV_DIRS)[number];

const KEY_NAMES: Record<string, PadControl> = {
  GamepadA: "A", GamepadB: "B", GamepadX: "X", GamepadY: "Y", GamepadLeftShoulder: "LB", GamepadRightShoulder: "RB", GamepadLeftTrigger: "LT", GamepadRightTrigger: "RT",
  GamepadDPadUp: "UP", GamepadDPadDown: "DOWN", GamepadDPadLeft: "LEFT", GamepadDPadRight: "RIGHT", GamepadMenu: "START", GamepadView: "SELECT",
  GamepadLeftThumbstick: "LS", GamepadLeftThumbstickButton: "LS", GamepadRightThumbstick: "RS", GamepadRightThumbstickButton: "RS",
  GamepadLeftThumbstickUp: "UP", GamepadLeftThumbstickDown: "DOWN", GamepadLeftThumbstickLeft: "LEFT", GamepadLeftThumbstickRight: "RIGHT",
  NavigationUp: "UP", NavigationDown: "DOWN", NavigationLeft: "LEFT", NavigationRight: "RIGHT", NavigationAccept: "A", NavigationCancel: "B", NavigationMenu: "START", NavigationView: "SELECT",
};
/** Windows VK_GAMEPAD_* (195..218) and VK_NAVIGATION_* (136..143). null = a pad key with no UI meaning (right stick). */
const KEY_CODES: Record<number, PadControl | null> = {
  195: "A", 196: "B", 197: "X", 198: "Y", 199: "RB", 200: "LB", 201: "LT", 202: "RT", 203: "UP", 204: "DOWN", 205: "LEFT", 206: "RIGHT", 207: "START", 208: "SELECT", 209: "LS", 210: "RS",
  211: "UP", 212: "DOWN", 213: "RIGHT", 214: "LEFT", 215: null, 216: null, 217: null, 218: null,
  136: "SELECT", 137: "START", 138: "UP", 139: "DOWN", 140: "LEFT", 141: "RIGHT", 142: "A", 143: "B",
};
export interface KeyLike { key?: string; code?: string; keyCode?: number; which?: number }
/** The logical pad control a key event stands for: a control, null (a gamepad key without a UI meaning, e.g. the right
 *  stick: still swallow it), or undefined (an ordinary keyboard key). */
export function gamepadKeyControl(e: KeyLike): PadControl | null | undefined {
  const k = e.key ?? "";
  if (k in KEY_NAMES) return KEY_NAMES[k]!;
  if (/^Gamepad/.test(k)) return null; // GamepadRightThumbstickUp ...
  if (k.length === 1) return undefined; // a printable character never is a pad key, whatever its keyCode
  const c = e.keyCode || e.which || 0;
  if (c in KEY_CODES && (k === "" || k === "Unidentified" || /^(Gamepad|Navigation)/.test(k) || !e.code)) return KEY_CODES[c] ?? null;
  return undefined;
}

export interface RawPad {
  id?: string; index?: number; mapping?: string; connected?: boolean; timestamp?: number;
  buttons: readonly ({ pressed?: boolean; value?: number } | null | undefined)[]; axes: readonly number[];
}
/** A pad in the standard layout: 17 buttons, axes [lx, ly, rx, ry]. */
export interface NormPad { buttons: { pressed: boolean; value: number }[]; axes: number[]; ids: string[] }
const on = (b: { pressed?: boolean; value?: number } | null | undefined): boolean => !!b && (!!b.pressed || (b.value ?? 0) > 0.5);
/** Decode a POV hat axis (-1 up, clockwise in 1/7 steps to +1 up-left; |v| > 1.05 = centred). */
export function hatDirs(v: number | undefined): { up: boolean; down: boolean; left: boolean; right: boolean } {
  const n = { up: false, down: false, left: false, right: false };
  if (v === undefined || !Number.isFinite(v) || Math.abs(v) > 1.05) return n;
  const r = Math.round(((v + 1) * 7) / 2); if (Math.abs(v - (-1 + (r * 2) / 7)) > 0.06) return n; // 0 / noise: not a hat step
  const i = r % 8; // 0 up, 1 up-right, 2 right, 3 down-right, 4 down, 5 down-left, 6 left, 7 up-left
  n.up = i === 7 || i === 0 || i === 1; n.right = i >= 1 && i <= 3; n.down = i >= 3 && i <= 5; n.left = i >= 5 && i <= 7; return n;
}
export function normalizePad(p: RawPad): NormPad {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  const setB = (i: number, b: { pressed?: boolean; value?: number } | null | undefined | boolean): void => {
    const pr = typeof b === "boolean" ? b : on(b); const v = typeof b === "boolean" ? (b ? 1 : 0) : Math.max(b?.value ?? 0, b?.pressed ? 1 : 0);
    const t = buttons[i]!; t.pressed ||= pr; t.value = Math.max(t.value, v);
  };
  const ax: readonly number[] = p.axes ?? []; const axes = [ax[0] ?? 0, ax[1] ?? 0, ax[2] ?? 0, ax[3] ?? 0];
  if (p.mapping === "standard" || p.buttons.length >= 16) {
    p.buttons.forEach((b, i) => { if (i < 17) setB(i, b); });
  } else {
    // non-standard (mapping ""): DirectInput-style Xbox layout — A B X Y LB RB View Menu LS RS; triggers on axis 2 (+LT / -RT)
    // or as buttons; right stick on axes 3/4; D-pad as a hat on axis 9 (Chromium) or axes 6/7 (Firefox-style).
    const map = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11];
    p.buttons.forEach((b, i) => { const t = map[i]; if (t !== undefined) setB(t, b); });
    if (ax.length >= 5) { axes[2] = ax[3] ?? 0; axes[3] = ax[4] ?? 0; const t = ax[2] ?? 0; if (t > 0.5) setB(6, true); if (t < -0.5) setB(7, true); }
  }
  // D-pad fallbacks for any mapping: a hat on axis 9, or digital axes 6/7 (only when exactly ±1 / 0: never a stick)
  const hat = hatDirs(p.mapping !== "standard" && ax.length >= 10 ? ax[9] : undefined);
  if (p.mapping !== "standard" && ax.length >= 8 && ax.length < 10 && [ax[6], ax[7]].every((v) => v === -1 || v === 0 || v === 1)) { hat.left ||= ax[6] === -1; hat.right ||= ax[6] === 1; hat.up ||= ax[7] === -1; hat.down ||= ax[7] === 1; }
  if (hat.up) setB(12, true); if (hat.down) setB(13, true); if (hat.left) setB(14, true); if (hat.right) setB(15, true);
  return { buttons, axes, ids: [p.id ?? ""] };
}
/** OR every connected pad into one standard-layout pad (the axis with the largest magnitude wins). undefined = no pad. */
export function mergePads(pads: readonly (RawPad | null | undefined)[] | null | undefined): NormPad | undefined {
  let m: NormPad | undefined;
  for (const p of pads ?? []) {
    if (!p || p.connected === false || !p.buttons) continue;
    const n = normalizePad(p);
    if (!m) { m = n; continue; }
    n.buttons.forEach((b, i) => { const t = m!.buttons[i]!; t.pressed ||= b.pressed; t.value = Math.max(t.value, b.value); });
    n.axes.forEach((v, i) => { if (Math.abs(v) > Math.abs(m!.axes[i] ?? 0)) m!.axes[i] = v; });
    m.ids.push(...n.ids);
  }
  return m;
}
/** Read navigator.getGamepads() defensively (throws on some embedded engines / insecure contexts). */
export function readNavigatorPads(): readonly (RawPad | null)[] {
  try { return typeof navigator !== "undefined" && typeof navigator.getGamepads === "function" ? [...(navigator.getGamepads() as unknown as (RawPad | null)[])] : []; } catch { return []; }
}
