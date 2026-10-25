// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { uiRoot } from "../src/ui-root.js";
import { UINav } from "../src/ui-nav.js";

beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; });
const panel = (html: string): HTMLElement => { const m = document.createElement("div"); m.className = "gm-modal"; m.innerHTML = `<div class="gm-panel">${html}</div>`; return m; };

describe("ADR-107 menus: scroll, Back button, Android back", () => {
  test("panels get dvh/safe-area max-height, overflow-y auto and pan-y", () => {
    uiRoot(); const css = document.getElementById("game-root-style")!.textContent!;
    expect(css).toContain("100dvh"); expect(css).toContain("var(--sab"); expect(css).toContain("overflow-y:auto"); expect(css).toContain("touch-action:pan-y"); expect(css).toContain("-webkit-overflow-scrolling:touch");
  });
  test("QA2: game canvas + HUD set -webkit-touch-callout:none and user-select:none", () => {
    uiRoot(); const css = document.getElementById("game-root-style")!.textContent!;
    const rule = css.split("\n").find((l) => l.startsWith("canvas,#hud"))!; expect(rule).toBeTruthy();
    for (const d of ["-webkit-touch-callout:none", "user-select:none", "-webkit-user-select:none"]) expect(rule).toContain(d);
    expect(rule).toContain("#touch-overlay");
  });
  test("a modal without its own close gets a visible Back button; focus moves scroll into view", () => {
    const root = uiRoot(); const nav = new UINav({ root, pollGamepads: false, history: false });
    const seen: Element[] = []; (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = function (this: Element) { seen.push(this); };
    nav.open("x", panel(`<button>A</button><button>B</button>`));
    const back = root.querySelector<HTMLButtonElement>("[data-role=back]")!; expect(back.textContent).toContain("Back");
    nav.step(1); expect(seen.length).toBeGreaterThan(0);
    back.click(); expect(nav.isOpen).toBe(false); nav.destroy();
  });
  test("popstate (Android back) closes the top modal like Esc / B", () => {
    const root = uiRoot(); const nav = new UINav({ root, pollGamepads: false });
    nav.open("a", panel(`<button data-role="close">x</button>`)); nav.open("b", panel(`<button data-role="close">x</button>`));
    dispatchEvent(new PopStateEvent("popstate")); expect(nav.top).toBe("a");
    dispatchEvent(new PopStateEvent("popstate")); expect(nav.isOpen).toBe(false); nav.destroy();
  });
});
