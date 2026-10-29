// ADR-213: Xbox Edge / Windows gamepad normalisation (pad keys, mapping "" hat D-pad, multiple pads).
import { describe, expect, it } from "vitest";
import { gamepadKeyControl, hatDirs, mergePads, normalizePad, type RawPad } from "../src/index.js";

const btns = (n: number, on: number[] = []): { pressed: boolean; value: number }[] => Array.from({ length: n }, (_, i) => ({ pressed: on.includes(i), value: on.includes(i) ? 1 : 0 }));
const std = (on: number[] = [], axes = [0, 0, 0, 0]): RawPad => ({ id: "Xbox", mapping: "standard", connected: true, buttons: btns(17, on), axes });

describe("ADR-213 gamepadKeyControl (Edge keyboard emulation)", () => {
  it("maps EdgeHTML key names, Chromium 'Unidentified' / '' + VK_GAMEPAD keyCodes, and navigation keys", () => {
    expect(gamepadKeyControl({ key: "GamepadDPadUp", keyCode: 203 })).toBe("UP");
    expect(gamepadKeyControl({ key: "GamepadLeftThumbstickRight", keyCode: 213 })).toBe("RIGHT");
    expect(gamepadKeyControl({ key: "GamepadA" })).toBe("A");
    expect(gamepadKeyControl({ key: "GamepadMenu" })).toBe("START");
    expect(gamepadKeyControl({ key: "GamepadView" })).toBe("SELECT");
    for (const [code, c] of [[195, "A"], [196, "B"], [199, "RB"], [200, "LB"], [201, "LT"], [202, "RT"], [204, "DOWN"], [205, "LEFT"], [206, "RIGHT"], [207, "START"], [208, "SELECT"], [211, "UP"], [212, "DOWN"], [214, "LEFT"]] as const) {
      expect(gamepadKeyControl({ key: "Unidentified", code: "", keyCode: code }), String(code)).toBe(c);
      expect(gamepadKeyControl({ key: "", code: "", keyCode: code }), String(code)).toBe(c);
    }
    expect(gamepadKeyControl({ key: "NavigationDown", keyCode: 139 })).toBe("DOWN");
  });
  it("right stick keys are pad keys without a UI meaning; ordinary keys are not pad keys", () => {
    expect(gamepadKeyControl({ key: "GamepadRightThumbstickUp", keyCode: 215 })).toBeNull();
    expect(gamepadKeyControl({ key: "Unidentified", keyCode: 216 })).toBeNull();
    expect(gamepadKeyControl({ key: "ArrowDown", code: "ArrowDown", keyCode: 40 })).toBeUndefined();
    expect(gamepadKeyControl({ key: "a", code: "KeyA", keyCode: 65 })).toBeUndefined();
    expect(gamepadKeyControl({ key: "Ì", code: "", keyCode: 204 })).toBeUndefined(); // a typed character with an odd keyCode
  });
});

describe("ADR-213 normalizePad / mergePads", () => {
  it("decodes a POV hat (8 directions + centred)", () => {
    expect(hatDirs(-1)).toEqual({ up: true, down: false, left: false, right: false });
    expect(hatDirs(-1 + 4 / 7)).toEqual({ up: false, down: false, left: false, right: true });
    expect(hatDirs(1 / 7)).toEqual({ up: false, down: true, left: false, right: false });
    expect(hatDirs(5 / 7)).toEqual({ up: false, down: false, left: true, right: false });
    expect(hatDirs(-1 + 2 / 7)).toEqual({ up: true, down: false, left: false, right: true });
    expect(hatDirs(3.2857)).toEqual({ up: false, down: false, left: false, right: false });
    expect(hatDirs(0)).toEqual({ up: false, down: false, left: false, right: false });
  });
  it("mapping '' (DirectInput layout): hat axis 9 -> D-pad 12..15, View/Menu 6/7 -> 8/9, trigger axis -> 6/7", () => {
    const axes = [0, 0, 0, 0, 0, 0, 0, 0, 0, 3.2857];
    const raw = (on: number[], hat: number, trig = 0): RawPad => ({ mapping: "", connected: true, buttons: btns(10, on), axes: axes.map((v, i) => (i === 9 ? hat : i === 2 ? trig : v)) });
    expect(normalizePad(raw([], 1 / 7)).buttons[13]!.pressed).toBe(true);
    expect(normalizePad(raw([], 1 / 7)).buttons.filter((b) => b.pressed).length).toBe(1);
    expect(normalizePad(raw([], 3.2857)).buttons.some((b) => b.pressed)).toBe(false);
    expect(normalizePad(raw([7], 3.2857)).buttons[9]!.pressed).toBe(true); // Menu = START
    expect(normalizePad(raw([6], 3.2857)).buttons[8]!.pressed).toBe(true); // View = SELECT
    expect(normalizePad(raw([], 3.2857, 1)).buttons[6]!.pressed).toBe(true);
    expect(normalizePad(raw([], 3.2857, -1)).buttons[7]!.pressed).toBe(true);
  });
  it("standard mapping passes buttons through; trigger value without pressed counts", () => {
    const b = btns(17, [12]); b[7] = { pressed: false, value: 0.9 }; const p: RawPad = { mapping: "standard", connected: true, buttons: b, axes: [0, 0, 0, 0] };
    const n = normalizePad(p); expect(n.buttons[12]!.pressed).toBe(true); expect(n.buttons[7]!.pressed).toBe(true);
  });
  it("an idle pad at index 0 does not hide the live pad at index 1; sticks take the largest magnitude", () => {
    const m = mergePads([std(), { ...std([13], [0, 0.9, 0, 0]), index: 1 }])!;
    expect(m.buttons[13]!.pressed).toBe(true); expect(m.axes[1]).toBeCloseTo(0.9); expect(m.ids.length).toBe(2);
    expect(mergePads([null, undefined])).toBeUndefined();
    expect(mergePads([{ ...std([0]), connected: false }])).toBeUndefined();
  });
});
