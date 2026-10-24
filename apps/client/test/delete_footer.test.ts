// @vitest-environment jsdom
// Regression: main-menu "Delete progress" lost its Delete button after ADR-107 added Back (nested max-height scroll
// box clipped it below the fold). Delete + Hold now live in a sticky footer next to Back, enabled only with a selection.
import { describe, expect, test, vi } from "vitest";
// @ts-expect-error untyped relative path into persist's dev dependency
import { IDBFactory } from "../../../packages/persist/node_modules/fake-indexeddb/build/esm/index.js";
import { deleteConfirm } from "../src/delete-progress.js";

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5)); };

describe("Delete progress sticky footer", () => {
  for (const [name, w, h] of [["mobile", 390, 640], ["desktop", 1920, 1080]] as const) test(name, async () => {
    Object.assign(window, { innerWidth: w, innerHeight: h }); (globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory();
    document.body.innerHTML = ""; localStorage.clear();
    const { BootUI } = await import("../src/menu.js");
    const ui = new BootUI("/"); void ui.menu({ hostedStatic: true, defaultUrl: "" });
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Delete progress")!.click();
    await flush();
    const footer = document.querySelector<HTMLElement>("[data-role=sticky-footer]")!;
    expect(footer).toBeTruthy(); expect(footer.closest(".panel")?.classList.contains("has-footer")).toBe(true);
    const css = Array.from(document.querySelectorAll("style")).map((s) => s.textContent).join("");
    expect(css).toMatch(/\.sticky-footer\{position:sticky;bottom:0/);
    const labels = Array.from(footer.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["Back", "Delete", "Hold to delete"]);
    const del = footer.querySelector<HTMLButtonElement>("[data-action=confirm-delete]")!;
    const hold = footer.querySelector<HTMLButtonElement>("[data-action=hold-delete]")!;
    const confirmBox = document.querySelector<HTMLElement>("[data-role=delete-confirm]")!;
    expect(confirmBox.contains(del)).toBe(false); expect(confirmBox.style.maxHeight).toBe("none");
    expect(del.disabled).toBe(true); expect(hold.disabled).toBe(true); // nothing selected
    const cb = document.querySelector<HTMLInputElement>("input[data-save=settings]")!; expect(cb).toBeTruthy();
    cb.click(); expect(del.disabled).toBe(false); expect(hold.disabled).toBe(false);
    del.focus(); expect(document.activeElement).toBe(del); // keyboard / gamepad focus
    // keyboard: ArrowDown cycles through to the footer buttons
    const seen = new Set<Element | null>(); for (let i = 0; i < 12; i++) { dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" })); seen.add(document.activeElement); }
    expect(seen.has(del)).toBe(true); expect(seen.has(hold)).toBe(true);
    // type DELETE and confirm
    localStorage.setItem("engine-settings", "{}");
    const word = document.querySelector<HTMLInputElement>("[data-role=confirm-word]")!; word.value = "delete"; word.dispatchEvent(new Event("input"));
    expect(del.getAttribute("aria-disabled")).toBe("false");
    del.click(); await flush();
    expect(document.querySelector("[data-role=delete-status]")!.textContent).toContain("Deleted: settings");
    expect(localStorage.getItem("engine-settings")).toBeNull();
    cb.click(); expect(del.disabled).toBe(true); ui.hide();
  });

  test("in-game Delete save / Delete hosted world dialog keeps its own enabled Delete + Hold", async () => {
    const onConfirm = vi.fn(() => "ok");
    const c = deleteConfirm({ message: "x", settingsOption: true, onConfirm, onCancel: () => {}, manualTick: true });
    document.body.append(c.el);
    const del = c.el.querySelector<HTMLButtonElement>("[data-action=confirm-delete]")!;
    expect(del.disabled).toBe(false); expect(c.el.querySelector<HTMLButtonElement>("[data-action=hold-delete]")!.disabled).toBe(false);
    const word = c.el.querySelector<HTMLInputElement>("[data-role=confirm-word]")!; word.value = "DELETE"; word.dispatchEvent(new Event("input"));
    del.click(); await flush(); expect(onConfirm).toHaveBeenCalled(); c.destroy();
  });
});
