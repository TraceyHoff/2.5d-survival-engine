// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { installPermissions, Membership, PlayerId, World, type Entity } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";

const d = G.defaultDefs(); const id = (k: string): number => d.itemId(k);
const axe = d.recipeId("stone_axe");

function setup() {
  const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w); G.installEconomy(w); G.installCraftQueue(w);
  const names = G.playerNames(w);
  const mk = (pid: number, name: string, x = 0): Entity => { const p = G.spawnPlayer(w, { x, y: 0, maxWeight: 0, clientId: pid }); w.add(p, PlayerId, { id: pid }).add(p, Membership, { partyId: 0, clanId: 0 }); names.set(pid, name); return p; };
  const me = mk(7, "Ada"); const sent: G.MenuIntent[] = [];
  const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, gameplay: { ctx: () => ({ world: w, player: me, names }), send: (i) => { sent.push(i); return true; } } });
  return { w, me, sent, menus };
}
const q = (sel: string): HTMLElement => { const e = document.querySelector<HTMLElement>(sel); if (!e) throw new Error(`missing ${sel}`); return e; };
const steps = (w: World, n: number): void => { for (let i = 0; i < n; i++) w.step(1 / 20); };

beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false }); });

describe("Task 33: Recently Crafted panels", () => {
  test("crafting: no recent section before anything is crafted; it appears after a craft and queues from it", () => {
    const { w, me, sent, menus } = setup();
    menus.open("crafting");
    expect(document.querySelector("[data-role=recent-crafts]")).toBeNull();
    expect(q("[data-menu=crafting]").textContent).not.toContain("Recently Crafted");
    menus.nav.closeAll();
    // Craft a stone axe, then reopen: the section lists it and clicking queues it again.
    G.addItem(w, me, id("wood"), 10); G.addItem(w, me, id("stone"), 4); G.addItem(w, me, id("fiber"), 4);
    expect(G.enqueueCraft(w, me, axe, 1)).toBe(0); steps(w, 45);
    expect(G.countItem(w, me, id("stone_axe"))).toBe(1);
    menus.open("crafting");
    expect(q("[data-menu=crafting]").textContent).toContain("Recently Crafted");
    const recent = q("[data-role=recent-crafts]");
    expect(recent.querySelector(`[data-key=recent-recipe-${axe}]`)).toBeTruthy();
    (recent.querySelector(`[data-key=recent-recipe-${axe}]`) as HTMLElement).click();
    expect(sent.at(-1)).toMatchObject({ cmd: G.QueueCraftCmd, args: { recipe: axe, count: 1 } });
    menus.destroy();
  });
  test("crafting: craftable recipes come before uncraftable ones in the main grid", () => {
    const { w, me, menus } = setup();
    // Materials for the axe only: dye (needs berries) stays uncraftable.
    G.addItem(w, me, id("wood"), 10); G.addItem(w, me, id("stone"), 4); G.addItem(w, me, id("fiber"), 4);
    menus.open("crafting");
    const grid = q("[data-role=recipe-grid]");
    const keys = Array.from(grid.querySelectorAll("[data-key]")).map((b) => b.getAttribute("data-key"));
    const dye = d.recipeId("dye");
    expect(keys).toContain(`recipe-${axe}`);
    expect(keys).toContain(`recipe-${dye}`);
    expect(keys.indexOf(`recipe-${axe}`)).toBeLessThan(keys.indexOf(`recipe-${dye}`));
    menus.destroy();
  });
  test("build: placing a piece adds it to Recently Crafted; clicking it selects it for placement", () => {
    const { w, me, menus } = setup();
    menus.open("build");
    expect(document.querySelector("[data-role=recent-builds]")).toBeNull();
    menus.nav.closeAll();
    const wall = d.pieceId("wall");
    const sn = G.snapPlacement(w, { piece: wall, x: 1, y: 0, level: 0, rot: 0, tier: 1, variant: 0 });
    if (typeof sn === "number") throw new Error(`snap failed ${sn}`);
    G.placePiece(w, me, sn, { pay: false });
    expect(G.recentBuilds(w, me)).toEqual([wall]);
    menus.open("build");
    expect(q("[data-menu=build]").textContent).toContain("Recently Crafted");
    const recent = q("[data-role=recent-builds]");
    const b = recent.querySelector(`[data-key=recent-piece-${wall}]`) as HTMLElement;
    expect(b).toBeTruthy();
    b.click();
    // choose() selects the piece (same flow as the main grid): the recent button shows pressed.
    expect(q(`[data-key=recent-piece-${wall}]`).getAttribute("aria-pressed")).toBe("true");
    expect(q(`[data-key=piece-${wall}]`).getAttribute("aria-pressed")).toBe("true");
    menus.destroy();
  });
});
