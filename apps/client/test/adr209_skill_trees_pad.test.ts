// @vitest-environment jsdom
/** ADR-209: per-tree skill points spent with the gamepad only (RB tab, D-pad focus, A select + A learn), and the
 *  panel refuses a skill whose tree has no points even when another tree has plenty. */
import { beforeEach, describe, expect, test } from "vitest";
import { installPermissions, Membership, PlayerId, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";
import { PAD } from "../src/ui-nav.js";

type Pad = { buttons: { pressed: boolean }[]; axes: number[] };
const pad = (): Pad => ({ buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] });
beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false }); });

function setup() {
  const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w); G.installEconomy(w);
  const names = G.playerNames(w); const me = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 7 }); w.add(me, PlayerId, { id: 7 }).add(me, Membership, { partyId: 0, clanId: 0 }); names.set(7, "Ada");
  G.migrateProgression(w, me); const sent: G.MenuIntent[] = []; let pads = [pad()];
  const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, getGamepads: () => pads,
    gameplay: { ctx: () => ({ world: w, player: me, names }), send: (i) => { sent.push(i); if (i.cmd === G.UnlockSkillCmd) G.unlockSkill(w, me, (i.args as { node: number }).node); menus.refresh(); return true; } } });
  const press = (btn: number): void => { const p = pad(); p.buttons[btn]!.pressed = true; pads = [p]; menus.nav.pollGamepad(); pads = [pad()]; menus.nav.pollGamepad(); };
  return { w, me, sent, menus, press };
}
const tree = (): string => document.querySelector<HTMLElement>("[data-role=skill-tree]")!.dataset["category"]!;
const focused = (): HTMLElement => document.activeElement as HTMLElement;

describe("ADR-209 pad-only per-tree spend", () => {
  test("RB to Combat, D-pad onto a root skill, A + A learns it from Combat points only", () => {
    const { w, me, sent, menus, press } = setup(); G.grantTreePoints(w, me, "combat", 5); G.grantTreePoints(w, me, "survival", 9);
    menus.open("skills");
    for (let i = 0; i < G.SKILLS.categories.length && tree() !== "combat"; i++) press(PAD.RB);
    expect(tree()).toBe("combat");
    for (let i = 0; i < 20 && focused().dataset["role"] !== "skill-node"; i++) press(PAD.DOWN);
    expect(focused().dataset["role"]).toBe("skill-node"); expect(focused().dataset["category"]).toBe("combat");
    let k = focused().dataset["key"]!; // walk right until an available (root) node
    for (let i = 0; i < 12 && focused().dataset["state"] !== "available"; i++) { press(PAD.RIGHT); k = focused().dataset["key"]!; }
    expect(focused().dataset["state"]).toBe("available");
    const node = G.skillNodeIndex(k.replace(/^skill-/, "")); const cost = G.skillNode(node)!.cost;
    press(PAD.A); press(PAD.A);
    expect(sent.at(-1)).toMatchObject({ cmd: G.UnlockSkillCmd, args: { node } });
    expect(G.hasNode(w, me, node)).toBe(true); expect(G.treePoints(w, me, "combat")).toBe(5 - cost); expect(G.treePoints(w, me, "survival")).toBe(9);
    expect(document.querySelector("[data-role=skill-summary]")!.textContent).toContain(`${5 - cost} point`);
    press(PAD.B); expect(menus.nav.isOpen).toBe(false); menus.destroy();
  });
  test("a tree with no points refuses (no command) even when another tree has points", () => {
    const { w, me, sent, menus } = setup(); G.grantTreePoints(w, me, "combat", 20); menus.open("skills");
    document.querySelector<HTMLElement>("[data-key=skill-tab-survival]")!.click();
    const b = (): HTMLElement => document.querySelector<HTMLElement>("[data-key=skill-forager]")!; b().click(); b().click();
    expect(sent.some((i) => i.cmd === G.UnlockSkillCmd)).toBe(false); expect(G.canUnlock(w, me, G.skillNodeIndex("forager"))).toBe("points");
    expect(document.querySelector("[data-role=skill-detail]")!.textContent).toContain("Not enough points in this tree"); menus.destroy();
  });
});
