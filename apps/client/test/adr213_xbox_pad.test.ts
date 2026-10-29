// @vitest-environment jsdom
// ADR-213: menus on a real Xbox (Edge): keyboard-emulated pad keys, mapping "" hat pads, pad not at index 0, no double moves.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installPermissions, Membership, PlayerId, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";
import { padArbiter, padKeyEdge, PadEdges, navPad } from "../src/pad-input.js";

type Btn = { pressed: boolean; value?: number }; type Pad = { id?: string; index?: number; mapping?: string; connected?: boolean; buttons: Btn[]; axes: number[] };
const stdPad = (index = 0): Pad => ({ index, mapping: "standard", connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] });
const HAT_C = 3.2857, HAT: Record<string, number> = { up: -1, right: -1 + 4 / 7, down: 1 / 7, left: 5 / 7 };
const hatPad = (dir?: string, on: number[] = []): Pad => ({ index: 0, mapping: "", connected: true, buttons: Array.from({ length: 10 }, (_, i) => ({ pressed: on.includes(i) })), axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, dir ? HAT[dir]! : HAT_C] });
const VK: Record<string, [string, number]> = { a: ["GamepadA", 195], b: ["GamepadB", 196], up: ["GamepadDPadUp", 203], down: ["GamepadDPadDown", 204], left: ["GamepadDPadLeft", 205], right: ["GamepadDPadRight", 206], start: ["GamepadMenu", 207], lsdown: ["GamepadLeftThumbstickDown", 212] };

let now = 1000;
beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); delete document.documentElement.dataset["padUi"]; (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false }); now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now); });
afterEach(() => { vi.restoreAllMocks(); padArbiter.reset(); });

function key(ctl: string, o: { type?: "keydown" | "keyup"; unid?: boolean; repeat?: boolean } = {}): KeyboardEvent {
  const [name, code] = VK[ctl]!; const e = new KeyboardEvent(o.type ?? "keydown", { key: o.unid ? "Unidentified" : name, code: "", repeat: !!o.repeat, bubbles: true, cancelable: true });
  Object.defineProperty(e, "keyCode", { value: code }); Object.defineProperty(e, "which", { value: code });
  (document.activeElement ?? document.body).dispatchEvent(e); return e;
}
function setup(pads: Pad[] = []) {
  const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w); G.installEconomy(w); G.installCraftQueue(w);
  const names = G.playerNames(w); const me = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 7 }); w.add(me, PlayerId, { id: 7 }).add(me, Membership, { partyId: 0, clanId: 0 }); names.set(7, "Ada");
  const sent: G.MenuIntent[] = [];
  const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, getGamepads: () => pads,
    gameplay: { ctx: () => ({ world: w, player: me, names }), send: (i: G.MenuIntent) => { sent.push(i); return true; }, startPlacing: () => {} } as never });
  let moves = 0; document.addEventListener("focusin", () => { moves++; });
  const frame = (ms = 16): void => { now += ms; menus.nav.pollGamepad(); };
  return { menus, sent, frame, moves: () => moves, pads };
}
const focused = (): string => (document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "").trim();

describe("ADR-213 Edge keyboard-emulated pad keys", () => {
  test("Menu opens pause; GamepadDPadDown / keyCode 204 'Unidentified' / left-stick keys each move focus exactly once", () => {
    const { menus, frame, moves } = setup();
    key("start"); key("start", { type: "keyup" }); expect(menus.nav.top).toBe("pause");
    expect(document.documentElement.dataset["padUi"]).toBe("1");
    for (const [ctl, unid] of [["down", false], ["down", true], ["lsdown", false], ["up", true], ["right", false], ["left", true]] as const) {
      const f0 = focused(), m0 = moves(); const e = key(ctl, { unid }); expect(e.defaultPrevented, ctl).toBe(true);
      frame(); key(ctl, { type: "keyup", unid }); frame();
      expect(moves() - m0, `${ctl} unid=${unid}`).toBe(1); expect(focused()).not.toBe(f0);
      expect(document.documentElement.dataset["padUi"], "pad UI stays on after a pad key").toBe("1");
    }
    menus.destroy();
  });
  test("a held pad key repeats on our timer (400 ms then 110 ms); OS auto-repeat events never add moves", () => {
    const { menus, frame, moves } = setup(); menus.pause();
    const m0 = moves(); key("down");
    for (let t = 0; t < 1000; t += 16) { frame(16); if (t % 33 < 16) key("down", { repeat: true }); }
    key("down", { type: "keyup" }); const n = moves() - m0;
    expect(n).toBeGreaterThanOrEqual(1 + 5); expect(n).toBeLessThanOrEqual(1 + 7);
    const m1 = moves(); for (let i = 0; i < 40; i++) frame(16); expect(moves()).toBe(m1); // released: no more moves
    menus.destroy();
  });
  test("A activates, B closes; while no menu is open D-pad keys are left to gameplay (not prevented)", () => {
    const { menus } = setup();
    const e = key("down"); key("down", { type: "keyup" }); expect(e.defaultPrevented).toBe(false); expect(menus.nav.isOpen).toBe(false);
    menus.open("inventory"); key("b"); key("b", { type: "keyup" }); expect(menus.nav.isOpen).toBe(false);
    menus.pause(); const resume = document.activeElement as HTMLElement; let clicked = 0; resume.addEventListener("click", () => clicked++);
    key("a"); key("a", { type: "keyup" }); expect(clicked).toBe(1);
    menus.destroy();
  });
});

describe("ADR-213 Gamepad API on real devices", () => {
  test("live pad at index 1 behind an idle pad at index 0 navigates", () => {
    const live = stdPad(1); const { menus, frame, moves } = setup([stdPad(0), live]); menus.pause();
    const m0 = moves(); live.buttons[13] = { pressed: true }; frame(); live.buttons[13] = { pressed: false }; frame();
    expect(moves() - m0).toBe(1);
    live.axes[1] = 0.9; frame(); live.axes[1] = 0; frame(); expect(moves() - m0).toBe(2); // left stick
    menus.destroy();
  });
  test("mapping '' pad: hat D-pad moves, Menu (button 7) opens pause, A (0) activates", () => {
    const pads = [hatPad()]; const { menus, frame, moves } = setup(pads);
    pads[0] = hatPad(undefined, [7]); frame(); pads[0] = hatPad(); frame(); expect(menus.nav.top).toBe("pause");
    const m0 = moves(); pads[0] = hatPad("down"); frame(); pads[0] = hatPad(); frame(); expect(moves() - m0).toBe(1);
    pads[0] = hatPad("right"); frame(); pads[0] = hatPad(); frame(); expect(moves() - m0).toBe(2);
    menus.destroy();
  });
  test("one physical press reported by BOTH the Gamepad API and a pad key moves once (either order), and once more as ArrowDown", () => {
    const live = stdPad(0); const { menus, frame, moves } = setup([live]); menus.pause();
    let m0 = moves(); live.buttons[13] = { pressed: true }; frame(); key("down"); frame(); live.buttons[13] = { pressed: false }; key("down", { type: "keyup" }); frame();
    expect(moves() - m0).toBe(1);
    now += 500; m0 = moves(); key("down"); live.buttons[13] = { pressed: true }; frame(); frame(); key("down", { type: "keyup" }); live.buttons[13] = { pressed: false }; frame();
    expect(moves() - m0).toBe(1);
    now += 500; m0 = moves(); live.buttons[13] = { pressed: true }; frame();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true }));
    live.buttons[13] = { pressed: false }; frame(); expect(moves() - m0).toBe(1);
    menus.destroy();
  });
});

describe("ADR-213 frame hitches", () => {
  test("a tap that spans one 600 ms frame moves once (no repeat); a real hold still repeats", () => {
    const live = stdPad(0); const { menus, frame, moves } = setup([live]); menus.pause(); frame();
    let m0 = moves(); live.buttons[13] = { pressed: true }; frame(16); frame(600); live.buttons[13] = { pressed: false }; frame(16);
    expect(moves() - m0).toBe(1);
    m0 = moves(); live.buttons[13] = { pressed: true }; for (let i = 0; i < 40; i++) frame(16); live.buttons[13] = { pressed: false }; frame();
    expect(moves() - m0).toBeGreaterThanOrEqual(3);
    menus.destroy();
  });
});

describe("ADR-213 simple-screen helpers (boot menu, creator, death screen)", () => {
  test("padKeyEdge: keydown acts once, repeat / keyup swallowed, ordinary keys pass", () => {
    const mk = (type: string, k: string, code: number, repeat = false): KeyboardEvent => { const e = new KeyboardEvent(type, { key: k, repeat }); Object.defineProperty(e, "keyCode", { value: code }); return e; };
    expect(padKeyEdge(mk("keydown", "Unidentified", 204), 0)).toBe("DOWN");
    expect(padKeyEdge(mk("keydown", "Unidentified", 204, true), 30)).toBeNull();
    expect(padKeyEdge(mk("keyup", "Unidentified", 204), 60)).toBeNull();
    expect(padKeyEdge(mk("keydown", "ArrowDown", 40), 90)).toBeUndefined();
  });
  test("PadEdges over a merged pad: edge, repeat, and no double with a pad key", () => {
    const p = stdPad(1); const e = new PadEdges(["DOWN", "A"]);
    expect(e.step(navPad(() => [stdPad(0), p]), 0)).toEqual([]);
    p.buttons[13] = { pressed: true }; expect(e.step(navPad(() => [stdPad(0), p]), 16)).toEqual(["DOWN"]);
    const seen: string[] = []; for (let t = 32; t <= 432; t += 16) seen.push(...e.step(navPad(() => [p]), t));
    expect(seen).toEqual(["DOWN"]); // first repeat after ~400 ms of frames
    expect(new PadEdges(["DOWN"]).step(navPad(() => [p]), 0)).toEqual(["DOWN"]);
    p.buttons[13] = { pressed: false }; e.step(navPad(() => [p]), 440);
    const k = new KeyboardEvent("keydown", { key: "GamepadA" }); expect(padKeyEdge(k, 1000)).toBe("A");
    p.buttons[0] = { pressed: true }; expect(e.step(navPad(() => [p]), 1010)).toEqual([]); // the key already did it
  });
});
