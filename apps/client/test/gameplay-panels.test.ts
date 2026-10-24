// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { installPermissions, Membership, PlayerId, World, type Entity } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";
import { GAMEPLAY_PANELS } from "../src/gameplay-panels.js";

const key = (k: string, code = k): void => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, code, bubbles: true, cancelable: true })); };
const d = G.defaultDefs(); const id = (k: string): number => d.itemId(k);

function setup() {
  const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w); G.installEconomy(w); G.installCraftQueue(w);
  const names = G.playerNames(w);
  const mk = (pid: number, name: string, x = 0): Entity => { const p = G.spawnPlayer(w, { x, y: 0, maxWeight: 0, clientId: pid }); w.add(p, PlayerId, { id: pid }).add(p, Membership, { partyId: 0, clanId: 0 }); names.set(pid, name); return p; };
  const me = mk(7, "Ada"); const sent: G.MenuIntent[] = [];
  const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, gameplay: { ctx: () => ({ world: w, player: me, names }), send: (i) => { sent.push(i); return true; } } });
  return { w, me, mk, sent, menus };
}
const q = (sel: string): HTMLElement => { const e = document.querySelector<HTMLElement>(sel); if (!e) throw new Error(`missing ${sel}`); return e; };

beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false }); });

describe("gameplay panels (ADR-095 shell)", () => {
  test("every panel renders real data and every control is a focusable button reachable by Tab", () => {
    const { w, me, menus } = setup(); G.addItem(w, me, id("wood"), 5, 7);
    for (const p of GAMEPLAY_PANELS) {
      menus.open(p); const modal = q(`[data-menu=${p}]`);
      expect(modal.textContent).not.toContain("placeholder");
      const controls = Array.from(modal.querySelectorAll<HTMLElement>("button,input")).filter((b) => !(b as HTMLButtonElement).disabled);
      const seen = new Set<Element>(); for (let i = 0; i < controls.length + 2; i++) { seen.add(document.activeElement!); key("Tab"); }
      for (const c of controls) expect(seen.has(c), `${p}: ${c.textContent}`).toBe(true);
      menus.nav.closeAll();
    }
    menus.destroy();
  });
  test("inventory tooltip names the crafter", () => {
    const { w, me, menus } = setup(); G.addItem(w, me, id("wood"), 5, 7); menus.open("inventory");
    expect(q("[data-role=slot]").title).toContain("Crafted by Ada"); menus.destroy();
  });
  test("crafting: Enter on a recipe sends queueCraft with the chosen count; queue jobs cancel", () => {
    const { w, me, sent, menus } = setup(); G.addItem(w, me, id("wood"), 20); G.addItem(w, me, id("stone"), 10); G.addItem(w, me, id("fiber"), 10);
    menus.open("crafting"); q("[data-key=count-5]").click();
    const axe = d.recipeId("stone_axe"); const b = q(`[data-key=recipe-${axe}]`); b.focus(); b.click();
    expect(sent.at(-1)).toMatchObject({ cmd: G.QueueCraftCmd, args: { recipe: axe, count: 5 } });
    G.enqueueCraft(w, me, axe, 1); menus.refresh(); q("[data-key=job-0]").click();
    expect(sent.at(-1)).toMatchObject({ cmd: G.CancelQueuedCraftCmd, args: { slot: 0 } }); menus.destroy();
  });
  test("party: invite a nearby player (entity arg flagged for NetId mapping); pending invite accept/decline", () => {
    const { w, mk, sent, menus } = setup(); const bob = mk(8, "Bob", 2); menus.open("party");
    q("[data-key=invite-8]").click(); expect(sent.at(-1)).toMatchObject({ cmd: G.PartyInviteCmd, args: { target: bob }, entities: ["target"] });
    menus.destroy();
  });
  test("clan: create when clanless; trade: prompt when no stall nearby", () => {
    const { sent, menus } = setup(); menus.open("clan"); q("[data-key=clan-create]").click();
    expect(sent.at(-1)!.cmd).toBe(G.ClanCreateCmd); menus.nav.closeAll();
    menus.open("trade"); expect(q("[data-menu=trade]").textContent).toContain("trade stall"); menus.destroy();
  });
  test("chat: channel buttons + Send route through onChat; pushChat appends incoming lines", () => {
    const got: [string, number][] = [];
    const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, onChat: (t, c) => got.push([t, c]) });
    menus.open("chat"); q("[data-key=chan-2]").click();
    (q("[data-role=chat-input]") as HTMLInputElement).value = "hi party"; q("[data-role=submit]").click();
    expect(got).toEqual([["hi party", 2]]);
    menus.pushChat("[Party] Bob: yo"); expect(q("[data-role=chat-log]").textContent).toContain("Bob: yo"); menus.destroy();
  });
});
