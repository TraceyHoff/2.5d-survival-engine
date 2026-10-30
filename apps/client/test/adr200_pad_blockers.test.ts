// @vitest-environment jsdom
// ADR-200: pad-only end-to-end for the worst blockers — equip, eat, craft, select + place a foundation —
// driven purely through a simulated navigator gamepad (no keyboard / mouse events).
import { beforeEach, describe, expect, test } from "vitest";
import { installPermissions, Membership, PlayerId, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus, padMenuAction } from "../src/game-menus.js";
import { PAD } from "../src/ui-nav.js";

type Pad = { buttons: { pressed: boolean; value?: number }[]; axes: number[] };
const pad = (): Pad => ({ buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] });
const d = G.defaultDefs(); const id = (k: string): number => d.itemId(k);

beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false }); });

function setup() {
  const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w); G.installEconomy(w); G.installCraftQueue(w);
  const names = G.playerNames(w); const me = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 7 }); w.add(me, PlayerId, { id: 7 }).add(me, Membership, { partyId: 0, clanId: 0 }); names.set(7, "Ada");
  const sent: G.MenuIntent[] = []; const placing: unknown[] = []; const pads: Pad[] = [pad()];
  const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, getGamepads: () => pads,
    gameplay: { ctx: () => ({ world: w, player: me, names }), send: (i: G.MenuIntent) => { sent.push(i); return true; }, startPlacing: (s: unknown) => { placing.push(s); } } as never });
  const press = (b: number): void => { const p = pad(); p.buttons[b]!.pressed = true; pads[0] = p; menus.nav.pollGamepad(); pads[0] = pad(); menus.nav.pollGamepad(); };
  /** D-pad until the focused element matches (bounded, like a player holding ↓/→). */
  const seek = (sel: string, txt?: string): HTMLElement => {
    for (const dir of [PAD.DOWN, PAD.RIGHT, PAD.UP]) for (let i = 0; i < 80; i++) {
      const a = document.activeElement as HTMLElement | null; if (a?.matches(sel) && (!txt || a.textContent!.includes(txt))) return a; press(dir);
    }
    throw new Error(`pad could not reach ${sel} ${txt ?? ""}`);
  };
  return { w, me, sent, placing, menus, press, seek };
}

describe("ADR-200 pad-only blockers", () => {
  test("Select (tap) maps to the inventory; LB+Select to crafting", () => {
    expect(padMenuAction({ pressed: (a) => a === "ToggleInventory" })).toBe("inventory");
    expect(padMenuAction({ pressed: (a) => a === "ToggleCrafting" })).toBe("crafting");
  });
  test("equip an item with the pad only", () => {
    const { w, me, sent, menus, press, seek } = setup(); G.addItem(w, me, id("stone_axe"), 1);
    menus.open("inventory"); seek("[data-role=slot][data-equip]"); press(PAD.A);
    expect(sent.some((i) => i.cmd === G.EquipCmd)).toBe(true);
    press(PAD.B); expect(menus.nav.isOpen).toBe(false); menus.destroy();
  });
  test("eat food with the pad only", () => {
    const { w, me, sent, menus, press, seek } = setup(); G.addItem(w, me, id("cooked_meat"), 2);
    menus.open("inventory"); seek("[data-role=use]:not(:disabled)"); press(PAD.A);
    expect(sent.some((i) => i.cmd === G.UseCmd)).toBe(true); menus.destroy();
  });
  test("drop a stack with the pad only (ADR-223: the details pane's Drop is pad-focusable)", () => {
    const { w, me, sent, menus, press, seek } = setup(); G.addItem(w, me, id("wood"), 5);
    menus.open("inventory"); seek("[data-role=slot][data-item]"); seek("[data-role=drop]"); press(PAD.A);
    expect(sent.some((i) => i.cmd === G.DropItemCmd)).toBe(true); menus.destroy();
  });
  test("craft an item with the pad only", () => {
    const { w, me, sent, menus, press, seek } = setup(); G.addItem(w, me, id("wood"), 20); G.addItem(w, me, id("stone"), 10); G.addItem(w, me, id("fiber"), 10);
    menus.open("crafting"); seek("[data-role=recipe]:not(.alt)"); press(PAD.A);
    expect(sent.some((i) => i.cmd === G.QueueCraftCmd)).toBe(true); menus.destroy();
  });
  test("select a foundation and start placing it with the pad only", () => {
    const { w, me, placing, menus, press, seek } = setup(); for (const k of ["wood", "stone", "fiber", "sticks"]) G.addItem(w, me, id(k), 200);
    menus.open("build"); seek("[data-role=piece]", "foundation"); press(PAD.A); // ADR-224: choosing the tile starts placing
    expect(placing).toHaveLength(1); expect(menus.nav.isOpen).toBe(false); menus.destroy();
  });
});

