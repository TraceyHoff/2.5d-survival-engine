// @vitest-environment jsdom
/** ADR-219: the skill description panel follows gamepad (D-pad) focus, shows generated effect text with values, sits
 *  outside the clipped tree viewport and never truncates (no fixed height / overflow hidden / nowrap / clipped tooltip). */
import { beforeEach, describe, expect, test } from "vitest";
import { installPermissions, Membership, PlayerId, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";
import { PAD } from "../src/ui-nav.js";
import { morph } from "../src/ui-diff.js";

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

const desc = (): HTMLElement => document.querySelector<HTMLElement>("[data-role=skill-desc]")!;

describe("ADR-219 skill description panel", () => {
  test("D-pad focus shows the focused skill's generated description and it survives a re-render", () => {
    const { w, me, menus, press } = setup(); G.grantTreePoints(w, me, "combat", 5); menus.open("skills");
    for (let i = 0; i < G.SKILLS.categories.length && tree() !== "combat"; i++) press(PAD.RB);
    for (let i = 0; i < 20 && focused().dataset["role"] !== "skill-node"; i++) press(PAD.DOWN);
    expect(focused().dataset["role"]).toBe("skill-node");
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const key = focused().dataset["key"]!.replace(/^skill-/, ""); const idx = G.skillNodeIndex(key); const info = G.skillDescription(idx);
      expect(desc().dataset["key"]).toBe(key);
      expect(desc().textContent).toContain(G.skillNode(idx)!.name);
      for (const l of info.effects) expect(desc().textContent).toContain(l);
      expect(desc().textContent).toMatch(/\d+%|level|Unlocks|Eat|breed/);
      seen.add(key); press(i % 2 ? PAD.DOWN : PAD.RIGHT);
    }
    expect(seen.size).toBeGreaterThan(1);
    const k = focused().dataset["key"]!.replace(/^skill-/, ""); menus.refresh();
    expect(desc().dataset["key"]).toBe(k); menus.destroy();
  });
  test("panel is outside the scrolling tree, linked by aria-describedby, and styled to wrap without clipping", () => {
    const { menus } = setup(); menus.open("skills");
    const tv = document.querySelector<HTMLElement>("[data-role=skill-tree]")!; const d = desc();
    expect(tv.contains(d)).toBe(false);
    expect(d.compareDocumentPosition(tv) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // above the tree, never covering it
    const s = d.style; expect(s.whiteSpace).toBe("normal"); expect(s.height).toBe(""); expect(s.maxHeight).toBe(""); expect(s.overflow).not.toBe("hidden"); expect(s.textOverflow).toBe("");
    for (const b of Array.from(document.querySelectorAll<HTMLElement>("[data-role=skill-node]"))) {
      expect(b.getAttribute("aria-describedby")).toBe(d.id);
      expect(b.dataset["tip"]).toBeUndefined(); // the old [data-tip] bubble was clipped by the tree viewport and covered other nodes
      expect(b.style.whiteSpace).toBe("normal"); expect(b.style.height).toBe("");
      expect(b.getAttribute("aria-label")).toContain(G.skillDescription(G.skillNodeIndex(b.dataset["key"]!.slice(6))).effects[0]!);
    }
    menus.destroy();
  });
  test("every node of every tree gets a non-empty description in the panel", () => {
    const { menus } = setup(); menus.open("skills"); let n = 0;
    for (const c of G.SKILLS.categories) {
      document.querySelector<HTMLElement>(`[data-key=skill-tab-${c.key}]`)!.click();
      for (const b of Array.from(document.querySelectorAll<HTMLElement>("[data-role=skill-node]"))) {
        const key = b.dataset["key"]!; document.querySelector<HTMLElement>(`[data-key=${key}]`)!.focus();
        expect(desc().dataset["key"]).toBe(key.slice(6));
        expect(desc().querySelectorAll("[data-role=skill-desc-effects] li").length, key).toBeGreaterThan(0); n++;
      }
    }
    expect(n).toBe(G.SKILLS.nodes.filter((x) => !x.retired).length); menus.destroy();
  });
  test("morph carries focus / hover handlers onto reused elements (re-rendered panels stay live)", () => {
    const a = document.createElement("button"), b = document.createElement("button"); const f = (): void => {}; b.onfocus = f; b.onmouseenter = f;
    const pa = document.createElement("div"), pb = document.createElement("div"); pa.append(a); pb.append(b); morph(pa, pb);
    expect(pa.firstChild).toBe(a); expect(a.onfocus).toBe(f); expect(a.onmouseenter).toBe(f);
  });
});
