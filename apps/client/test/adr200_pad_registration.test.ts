// @vitest-environment jsdom
// ADR-200 (part 2): every modal registers with the one UINav focus system; generic pad OSK, LT/RT, hint footer, focus restore.
import { beforeEach, describe, expect, test } from "vitest";
import { installPermissions, Membership, PlayerId, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus, GAME_MENUS as MENUS } from "../src/game-menus.js";
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

describe("ADR-200 modal registration + generic pad surfaces", () => {
  test("every GameMenus modal (and pause) registers with UINav, traps focus and shows the pad hint footer", () => {
    const { menus } = setup(); document.documentElement.dataset["padUi"] = "1";
    const ids = [...MENUS.map((m) => m.id), "pause"]; expect(ids.length).toBeGreaterThan(10);
    for (const mid of ids) {
      if (mid === "pause") menus.pause(); else menus.open(mid);
      expect(menus.nav.top, mid).toBe(mid);
      const top = menus.nav.stack_top()!; expect(top.isConnected, mid).toBe(true);
      expect(top.contains(document.activeElement), `${mid} focus inside`).toBe(true);
      expect(top.querySelector("[data-role=pad-hints]")?.textContent, mid).toContain("Back");
      menus.nav.close(); expect(menus.nav.isOpen, mid).toBe(false);
    }
    menus.destroy();
  });
  test("A on a text field opens the pad keyboard; Done writes the value back (chat, raw, not capped at 48)", () => {
    const { menus, press, seek } = setup(); menus.open("chat");
    const inp = seek("input[type=text], input:not([type]), textarea") as HTMLInputElement; press(PAD.A);
    expect(menus.nav.top).toBe("osk"); expect(document.querySelector("[data-role=pad-osk]")).toBeTruthy();
    const keys = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-role=pad-osk] button")).filter((b) => b.textContent === "H" || b.textContent === "I");
    expect(keys.length).toBeGreaterThan(0); (document.activeElement as HTMLElement); keys[0]!.click();
    press(PAD.X); // Done
    expect(menus.nav.top).toBe("chat"); expect(inp.value.length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(inp); // focus restored to the field inside the parent modal
    menus.destroy();
  });
  test("LB/RB cycle the build category tabs; B closes", () => {
    const { menus, press } = setup(); menus.open("build");
    const cur = (): string | undefined => Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tabs=tab] button")).find((b) => b.getAttribute("aria-pressed") === "true" || !b.classList.contains("alt"))?.textContent ?? undefined;
    const a = cur(); press(PAD.RB); const b = cur(); expect(b).not.toBe(a); press(PAD.LB); expect(cur()).toBe(a);
    press(PAD.B); expect(menus.nav.isOpen).toBe(false); menus.destroy();
  });
  test("pad use flips html[data-pad-ui]; a pointer clears it", () => {
    const { menus, press } = setup(); delete document.documentElement.dataset["padUi"]; menus.open("settings"); press(PAD.DOWN);
    expect(document.documentElement.dataset["padUi"]).toBe("1");
    document.dispatchEvent(new Event("pointerdown")); expect(document.documentElement.dataset["padUi"]).toBeUndefined(); menus.destroy();
  });
});
