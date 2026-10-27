// @vitest-environment jsdom
// ADR-205: pad-only split / to-hotbar from an OPEN CONTAINER (where = 1), friendly reject text, and the hint footer never covering focus.
// The fake server applies each intent with the real authoritative op so the panel re-renders the result.
import { beforeEach, describe, expect, test } from "vitest";
import { installPermissions, Membership, PlayerId, Transform, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus, padMenuAction } from "../src/game-menus.js";
import { PAD } from "../src/ui-nav.js";
import { inventoryOpRejectText } from "../src/inventory-reject.js";
import { revealAboveFooter } from "../src/back-history.js";

type Pad = { buttons: { pressed: boolean; value?: number }[]; axes: number[] };
const pad = (): Pad => ({ buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] });
const d = G.defaultDefs(); const id = (k: string): number => d.itemId(k);

beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false }); });

function setup() {
  const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w); G.installEconomy(w); G.installCraftQueue(w);
  const names = G.playerNames(w); const me = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 7 }); w.add(me, PlayerId, { id: 7 }).add(me, Membership, { partyId: 0, clanId: 0 }); names.set(7, "Ada");
  const sent: G.MenuIntent[] = []; const placing: unknown[] = []; const pads: Pad[] = [pad()];
  const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, getGamepads: () => pads,
    gameplay: { ctx: () => ({ world: w, player: me, names }), send: (i: G.MenuIntent) => { sent.push(i); const a = i.args as Record<string, number>; const f = i.cmd === G.SplitStackCmd ? G.splitStack(w, me, a["where"]!, a["slot"]!, a["count"]!) : i.cmd === G.MoveSlotCmd ? G.moveSlot(w, me, a["where"]!, a["slot"]!, a["to"]!) : i.cmd === G.ContainerToSlotCmd ? G.containerToSlot(w, me, a["slot"]!, a["to"]!) : 0; return f === 0; }, startPlacing: (s: unknown) => { placing.push(s); } } as never });
  const press = (b: number): void => { const p = pad(); p.buttons[b]!.pressed = true; pads[0] = p; menus.nav.pollGamepad(); pads[0] = pad(); menus.nav.pollGamepad(); };
  /** D-pad until the focused element matches (bounded, like a player holding ↓/→). */
  const seek = (sel: string, txt?: string): HTMLElement => {
    for (const dir of [PAD.DOWN, PAD.RIGHT, PAD.UP]) for (let i = 0; i < 80; i++) {
      const a = document.activeElement as HTMLElement | null; if (a?.matches(sel) && (!txt || a.textContent!.includes(txt))) return a; press(dir);
    }
    throw new Error(`pad could not reach ${sel} ${txt ?? ""}`);
  };
  const crate = w.create(); w.add(crate, Transform, { x: 0.5, y: 0 }).add(crate, G.Container, { slotCount: 8 }).add(crate, G.ContainerViewers); w.add(me, G.Viewing, { container: crate });
  return { w, me, crate, sent, placing, menus, press, seek };
}

const inv = (w: World, me: number) => G.readSlots(w, me as never);
const focused = (): HTMLElement => document.activeElement as HTMLElement;

describe("ADR-205 pad-only container split / to hotbar", () => {
  test("X on a storage stack splits inside the container; footer shows Split + To hotbar", () => {
    const { w, crate, sent, menus, press, seek } = setup(); G.addItem(w, crate, id("wood"), 10);
    menus.open("inventory"); seek("[data-key=cslot-0]");
    const hints = document.querySelector<HTMLElement>("[data-role=pad-hints]"); expect(hints).not.toBeNull(); expect(hints!.textContent).toContain("Split"); expect(hints!.textContent).toContain("To hotbar");
    press(PAD.X); expect(document.querySelector("[data-role=split-count]")!.textContent).toBe("5 / 10"); press(PAD.RT); press(PAD.A);
    expect(sent.at(-1)).toMatchObject({ cmd: G.SplitStackCmd, args: { where: 1, slot: 0, count: 6 } });
    const v = G.readSlots(w, crate); expect([v.count(0), v.count(1)]).toEqual([4, 6]); menus.destroy();
  });
  test("Y on a storage item, D-pad to hotbar slot 6, A moves it into the pack and swaps the old item back", () => {
    const { w, me, crate, sent, menus, press, seek } = setup(); G.addItem(w, crate, id("stone_axe"), 1);
    G.addItem(w, me, id("wood"), 5); G.moveSlot(w, me, 0, 0, 6); const old = id("wood");
    menus.open("inventory"); seek("[data-key=cslot-0]"); press(PAD.Y);
    expect(document.querySelectorAll("[data-role=hotbar-picker] [data-key^=hb-to-]")).toHaveLength(G.HOTBAR_SIZE);
    seek("[data-key=hb-to-6]"); press(PAD.A);
    expect(sent.at(-1)).toMatchObject({ cmd: G.ContainerToSlotCmd, args: { slot: 0, to: 6 } });
    expect(G.readSlots(w, me).item(6)).toBe(id("stone_axe")); expect([G.readSlots(w, crate).item(0), G.readSlots(w, crate).count(0)]).toEqual([old, 5]); menus.destroy();
  });
  test("rejections show specific friendly text in the panel status line", () => {
    const { menus } = setup(); menus.open("inventory");
    const t = inventoryOpRejectText(G.ContainerToSlotCmd, "too_heavy")!; expect(t).toBe(G.INVENTORY_OP_REJECT_TEXT.too_heavy);
    expect(inventoryOpRejectText(G.SplitStackCmd, "no_space")).toBe(G.INVENTORY_OP_REJECT_TEXT.no_space);
    expect(inventoryOpRejectText(G.CraftCmd, "too_heavy")).toBeUndefined();
    menus.notice(t); expect(document.querySelector("[data-role=status]")!.textContent).toContain(t); menus.destroy();
  });
  test("the sticky hint footer never covers the focused control (panel scrolls it clear)", () => {
    const panel = document.createElement("div"); panel.className = "gm-panel"; panel.style.overflowY = "auto"; document.body.append(panel);
    const btn = document.createElement("button"); const foot = document.createElement("div"); foot.className = "pad-hints"; panel.append(btn, foot);
    const rect = (top: number, h: number) => () => ({ top, bottom: top + h, left: 0, right: 10, width: 10, height: h, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(foot, "offsetHeight", { value: 40 }); foot.getBoundingClientRect = rect(560, 40); btn.getBoundingClientRect = rect(540, 40);
    Object.defineProperty(panel, "scrollHeight", { value: 2000 }); Object.defineProperty(panel, "clientHeight", { value: 600 });
    revealAboveFooter(btn); expect(panel.scrollTop).toBe(26); // 580 - (560 - 6)
    panel.scrollTop = 0; btn.getBoundingClientRect = rect(100, 40); revealAboveFooter(btn); expect(panel.scrollTop).toBe(0);
  });
});
