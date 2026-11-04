// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BootUI } from "../src/menu.js";
import { BUILD_HASH } from "../src/error-log.js";

describe("main-menu version marker", () => {
  it("shows the build version top-left on the main menu", () => {
    document.body.innerHTML = "";
    const ui = new BootUI("/");
    ui.menu({ hostedStatic: true, defaultUrl: "" });
    const ver = document.querySelector<HTMLElement>('[data-role="version"]');
    expect(ver).not.toBeNull();
    expect(ver!.textContent).toBe(`v${BUILD_HASH}`);
    expect(ver!.className).toBe("version");
    const css = Array.from(document.querySelectorAll("style")).map((s) => s.textContent ?? "").join("\n");
    expect(css).toContain(".boot .version");
    expect(css).toContain("left:");
    expect(css).toContain(".boot[data-boot=menu] .version");
  });
});
