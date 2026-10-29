// Xbox Edge emulation for Playwright (ADR-213). Injected with page.addInitScript BEFORE the app loads:
//  - navigator.getGamepads(): scripted pads (any index, mapping "standard" or "", D-pad as buttons 12-15 or as a hat on axis 9),
//    snapshot objects like Chromium's; gamepadconnected only after the first press (Chromium/Edge privacy rule).
//  - navigator.gamepadInputEmulation: absent (Chromium Edge on Xbox) or present (legacy EdgeHTML) per option.
// Keyboard emulation (Edge sends the pad as keys: key "GamepadDPadUp" / keyCode 203 ...) is sent through CDP
// Input.dispatchKeyEvent so the events are trusted and carry real keyCodes (see sendPadKey).
export function xboxInitScript(opts) {
  const o = opts || {};
  const S = (window.__xb = { pads: [], connectedFired: new Set(), log: [] });
  if (o.emulationProp) { let v = "mouse"; Object.defineProperty(Navigator.prototype, "gamepadInputEmulation", { configurable: true, get: () => v, set: (x) => { S.log.push(`gamepadInputEmulation=${x}`); v = x; } }); }
  const snap = (p) => p && ({ id: p.id, index: p.index, mapping: p.mapping, connected: true, timestamp: p.timestamp, axes: p.axes.slice(), buttons: p.buttons.map((b) => ({ pressed: b.pressed, touched: b.pressed, value: b.value })), vibrationActuator: null });
  Object.defineProperty(Navigator.prototype, "getGamepads", { configurable: true, value: function () { return S.pads.map((p) => (p && p.visible ? snap(p) : null)); } });
  S.make = (index, mapping, layout) => {
    const nb = layout === "hat" ? 11 : 17, na = layout === "hat" ? 10 : 4;
    const p = { id: mapping === "standard" ? "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)" : "045e-0b13-Xbox Wireless Controller", index, mapping, layout, visible: false, timestamp: 0,
      axes: Array.from({ length: na }, (_, i) => (layout === "hat" && i === 9 ? 3.2857 : 0)), buttons: Array.from({ length: nb }, () => ({ pressed: false, value: 0 })) };
    while (S.pads.length <= index) S.pads.push(null); S.pads[index] = p; return p;
  };
  const HAT = { up: -1, "up-right": -0.714, right: -0.428, "down-right": -0.142, down: 0.142, "down-left": 0.428, left: 0.714, "up-left": 1 };
  const BTN = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };
  // hat layout (DirectInput-style, mapping ""): View=6 Menu=7, triggers on axis 2, D-pad on axis 9
  const BTN_HAT = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, select: 6, start: 7 };
  S.set = (index, ctl, on) => {
    const p = S.pads[index]; p.timestamp = performance.now();
    if (!p.visible && on) { p.visible = true; if (!S.connectedFired.has(index)) { S.connectedFired.add(index); const e = new Event("gamepadconnected"); Object.defineProperty(e, "gamepad", { value: snap(p) }); window.dispatchEvent(e); } }
    if (["up", "down", "left", "right"].includes(ctl) && p.layout === "hat") { p.axes[9] = on ? HAT[ctl] : 3.2857; return; }
    if (ctl === "lsx" || ctl === "lsy") { p.axes[ctl === "lsx" ? 0 : 1] = on; return; }
    const i = p.layout === "hat" ? BTN_HAT[ctl] : BTN[ctl]; if (i === undefined) { if (p.layout === "hat" && (ctl === "lt" || ctl === "rt")) p.axes[2] = on ? (ctl === "lt" ? 1 : -1) : 0; return; }
    p.buttons[i] = { pressed: !!on, value: on ? 1 : 0 };
  };
}
/** Edge keyboard emulation key names + Windows virtual-key codes (VK_GAMEPAD_*). */
export const PAD_KEYS = {
  a: ["GamepadA", 195], b: ["GamepadB", 196], x: ["GamepadX", 197], y: ["GamepadY", 198], rb: ["GamepadRightShoulder", 199], lb: ["GamepadLeftShoulder", 200], lt: ["GamepadLeftTrigger", 201], rt: ["GamepadRightTrigger", 202],
  up: ["GamepadDPadUp", 203], down: ["GamepadDPadDown", 204], left: ["GamepadDPadLeft", 205], right: ["GamepadDPadRight", 206], start: ["GamepadMenu", 207], select: ["GamepadView", 208],
  lsup: ["GamepadLeftThumbstickUp", 211], lsdown: ["GamepadLeftThumbstickDown", 212], lsright: ["GamepadLeftThumbstickRight", 213], lsleft: ["GamepadLeftThumbstickLeft", 214],
};
/** Trusted keydown/keyup with Edge's gamepad key name (or "Unidentified", as Chromium reports unknown VKs) and its keyCode. */
export async function sendPadKey(cdp, ctl, { type = "both", unidentified = false, autoRepeat = false } = {}) {
  const [name, vk] = PAD_KEYS[ctl]; const key = unidentified ? "Unidentified" : name;
  if (type !== "up") await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: "", windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, autoRepeat });
  if (type !== "down") await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: "", windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}
