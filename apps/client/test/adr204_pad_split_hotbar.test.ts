// @vitest-environment jsdom
// ADR-204: pad-only end-to-end for split stack and move-to-hotbar — X/Y on a pack slot, LT/RT amount, D-pad hotbar slot, A confirm.
// The fake server applies each intent with the real authoritative op so the panel re-renders the result.
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
    gameplay: { ctx: () => ({ world: w, player: me, names }), send: (i: G.MenuIntent) => { sent.push(i); const a = i.args as Record<string, number>; const f = i.cmd === G.SplitStackCmd ? G.splitStack(w, me, a["where"]!, a["slot"]!, a["count"]!) : i.cmd === G.MoveSlotCmd ? G.moveSlot(w, me, a["where"]!, a["slot"]!, a["to"]!) : 0; return f === 0; }, startPlacing: (s: unknown) => { placing.push(s); } } as never });
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

const inv = (w: World, me: number) => G.readSlots(w, me as never);
const focused = (): HTMLElement => document.activeElement as HTMLElement;

describe("ADR-204 pad-only split / to hotbar", () => {
  test("split: X on a stack opens the picker at half, RT/LT adjust, A confirms", () => {
    const { w, me, sent, menus, press, seek } = setup(); G.addItem(w, me, id("wood"), 10);
    menus.open("inventory"); seek("[data-key=slot-0]");
    expect(document.querySelector("[data-role=pad-hints]")?.textContent ?? document.body.textContent).toContain("Split");
    press(PAD.X); expect(document.querySelector("[data-role=split-count]")!.textContent).toBe("5 / 10"); expect(focused().dataset["key"]).toBe("split-go");
    press(PAD.RT); press(PAD.RT); press(PAD.LT); expect(document.querySelector("[data-role=split-count]")!.textContent).toBe("6 / 10");
    press(PAD.A); const last = sent.at(-1)!; expect(last.cmd).toBe(G.SplitStackCmd); expect(last.args).toMatchObject({ where: 0, slot: 0, count: 6 });
    const v = inv(w, me); expect([v.count(0), v.count(1)]).toEqual([4, 6]); expect(document.querySelector("[data-role=split-picker]")).toBeNull();
    expect(menus.nav.isOpen).toBe(true); menus.destroy();
  });
  test("split clamps to 1..n-1 and B/Cancel backs out without sending", () => {
    const { w, me, sent, menus, press, seek } = setup(); G.addItem(w, me, id("wood"), 3);
    menus.open("inventory"); seek("[data-key=slot-0]"); press(PAD.X);
    for (let i = 0; i < 5; i++) press(PAD.RT); expect(document.querySelector("[data-role=split-count]")!.textContent).toBe("2 / 3");
    for (let i = 0; i < 5; i++) press(PAD.LT); expect(document.querySelector("[data-role=split-count]")!.textContent).toBe("1 / 3");
    seek("[data-key=arrange-cancel]"); press(PAD.A); expect(sent.filter((i) => i.cmd === G.SplitStackCmd)).toHaveLength(0); menus.destroy();
  });
  test("to hotbar: Y on a pack item, D-pad to a hotbar slot, A swaps it in", () => {
    const { w, me, sent, menus, press, seek } = setup(); G.addItem(w, me, id("wood"), 10); G.addItem(w, me, id("stone"), 4); G.addItem(w, me, id("stone_axe"), 1);
    G.moveSlot(w, me, 0, 2, 12); expect(inv(w, me).item(12)).toBe(id("stone_axe"));
    menus.open("inventory"); seek("[data-key=slot-12]"); press(PAD.Y);
    expect(document.querySelectorAll("[data-role=hotbar-picker] [data-key^=hb-to-]")).toHaveLength(G.HOTBAR_SIZE);
    seek("[data-key=hb-to-1]"); press(PAD.A);
    expect(sent.at(-1)).toMatchObject({ cmd: G.MoveSlotCmd, args: { where: 0, slot: 12, to: 1 } });
    const v = inv(w, me); expect([v.item(1), v.item(12), v.count(12)]).toEqual([id("stone_axe"), id("stone"), 4]); menus.destroy();
  });
  test("pickers and start buttons never overlap: one arrange row at a time, unique keys", () => {
    const { w, me, menus, press, seek } = setup(); G.addItem(w, me, id("wood"), 10);
    menus.open("inventory"); seek("[data-key=slot-0]"); press(PAD.Y);
    expect(document.querySelector("[data-role=split-picker]")).toBeNull(); expect(document.querySelector("[data-role=arrange-section]")).toBeNull();
    const keys = Array.from(document.querySelectorAll<HTMLElement>("[data-menu=inventory] [data-key]")).map((e) => e.dataset["key"]); expect(new Set(keys).size).toBe(keys.length);
    menus.destroy();
  });
});
