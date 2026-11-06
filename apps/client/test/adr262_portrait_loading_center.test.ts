// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { BootUI } from "../src/menu.js";

beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); });

describe("ADR-262: portrait loading bar + label are centred", () => {
  test("stylesheet centres .lane and .lbl in portrait only, and both loading screens keep lane then lbl", () => {
    const ui = new BootUI("/");
    const css = document.head.innerHTML;
    const m = css.match(/@media \(orientation:portrait\),\(max-width:480px\)\{([^@]*?)\}\s*\n/);
    expect(m).toBeTruthy();
    const rule = m![1]!;
    expect(rule).toMatch(/\.boot \.lane\{margin-left:auto;margin-right:auto\}/);
    expect(rule).toMatch(/\.boot \.lbl\{[^}]*text-align:center/);
    expect(rule).toMatch(/\.boot \.lbl\{[^}]*width:min\(420px,76vw\)/); // same width as the bar, so the text centres under it
    // landscape base rule is unchanged (no text-align on the base .lbl)
    expect(css).toMatch(/\.boot \.lbl\{font-size:13px;color:#E6C47E;min-height:1em\}/);
    const order = () => Array.from(ui.root.querySelector(".lane")!.parentElement!.children).map((e) => e.className);
    expect(order().slice(0, 2)).toEqual(["lane", "lbl"]);
    ui.showLoading("Loading world…");
    expect(order().slice(0, 2)).toEqual(["lane", "lbl"]);
    expect(ui.root.querySelector(".lane [data-role=loading-zombie]")).toBeTruthy();
    ui.hide();
  });
});
