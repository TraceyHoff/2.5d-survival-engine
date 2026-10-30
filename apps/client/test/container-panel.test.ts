// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { installPermissions, Membership, PlayerId, Transform, World, type Entity } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";
import { containerPageIndex, pageContainer } from "../src/gameplay-panels.js";
import { PAD, type GamepadLikeNav } from "../src/ui-nav.js";

/** ADR-098: paged 96-slot container grid in the inventory panel, on touch, keyboard and gamepad, refreshed by diffing. */
const key = (k: string, code = k): void => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, code, bubbles: true, cancelable: true })); };
const d = G.defaultDefs();
const q = (sel: string): HTMLElement => { const e = document.querySelector<HTMLElement>(sel); if (!e) throw new Error(`missing ${sel}`); return e; };
const all = (sel: string): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(sel));
const pad = (pressed: number[] = []): GamepadLikeNav => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })), axes: [0, 0] });

function setup(slots = 96) {
  const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w);
  const me = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 7 }); w.add(me, PlayerId, { id: 7 }).add(me, Membership, { partyId: 0, clanId: 0 });
  const box: Entity = w.create(); w.add(box, Transform, { x: 1, y: 0 }).add(box, G.Container, { slotCount: slots, maxWeight: 100000 });
  const pads: (GamepadLikeNav | null)[] = [pad()]; const sent: G.MenuIntent[] = [];
  const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, getGamepads: () => pads, gameplay: { ctx: () => ({ world: w, player: me }), send: (i) => { sent.push(i); return true; } } });
  const press = (b: number): void => { pads[0] = pad([b]); menus.nav.pollGamepad(); pads[0] = pad(); menus.nav.pollGamepad(); };
  return { w, me, box, menus, sent, press };
}
beforeEach(() => {
  document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear();
  (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false });
  while (containerPageIndex() > 0) pageContainer(-containerPageIndex());
});

describe("paged container panel (ADR-098)", () => {
  test("96 slots render as 4 pages of 24 focusable slots; touch ◀ ▶ page; take sends withdraw", () => {
    const { w, box, menus, sent } = setup(); const axe = d.itemId("stone_axe"); G.addItem(w, box, axe, 96);
    menus.open("inventory");
    expect(all("[data-role=cslot]").length).toBe(G.CONTAINER_PAGE_SIZE);
    expect(q("[data-role=page-label]").textContent).toContain("Page 1/4");
    expect((q("[data-key=page-prev]") as HTMLButtonElement).disabled).toBe(true);
    q("[data-key=page-next]").click(); q("[data-key=page-next]").click(); q("[data-key=page-next]").click();
    expect(q("[data-role=page-label]").textContent).toContain("Page 4/4");
    expect(q("[data-key=cslot-95]")).toBeTruthy(); expect(document.querySelector("[data-key=cslot-0]")).toBeNull();
    expect((q("[data-key=page-next]") as HTMLButtonElement).disabled).toBe(true);
    q("[data-key=cslot-95]").click();
    expect(sent.at(-1)).toMatchObject({ cmd: G.WithdrawCmd, args: { item: axe, count: 1 }, entities: ["target"] });
    menus.destroy();
  });
  test("keyboard PgDn/PgUp and gamepad RB/LB page; arrows/D-pad reach the slots", () => {
    const { menus, press } = setup(); menus.open("inventory");
    key("PageDown"); expect(q("[data-role=container-grid]").dataset["page"]).toBe("1");
    press(PAD.RB); expect(q("[data-role=container-grid]").dataset["page"]).toBe("2");
    press(PAD.LB); key("PageUp"); expect(q("[data-role=container-grid]").dataset["page"]).toBe("0");
    key("PageUp"); expect(q("[data-role=container-grid]").dataset["page"]).toBe("0"); // clamped
    const seen = new Set<string>(); for (let i = 0; i < 60; i++) { key("Tab"); const k = (document.activeElement as HTMLElement | null)?.dataset["key"]; if (k) seen.add(k); }
    expect(seen.has("cslot-0") && seen.has("cslot-23") && seen.has("page-next")).toBe(true);
    menus.destroy();
  });
  test("diff refresh patches only the changed slot (focus kept); small boxes have no pager", () => {
    const { w, box, menus } = setup(); const wood = d.itemId("wood"); menus.open("inventory");
    const s5 = q("[data-key=cslot-5]"); s5.focus();
    G.addItem(w, box, wood, 3);
    const muts = menus.refresh(); expect(muts).toBeGreaterThan(0); expect(muts).toBeLessThan(20); // ADR-205: the slot now also carries its X/Y shortcut attrs + the arrange details list
    expect(q("[data-key=cslot-0]").textContent).toContain("×3"); expect(document.activeElement).toBe(s5);
    menus.destroy(); document.body.innerHTML = `<div id="game-root"></div>`;
    const small = setup(12); small.menus.open("inventory");
    expect(all("[data-role=cslot]").length).toBe(12); expect(document.querySelector("[data-role=container-pager]")).toBeNull(); small.menus.destroy();
  });
});
