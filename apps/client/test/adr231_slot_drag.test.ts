// @vitest-environment jsdom
// ADR-231: pointer drag-and-drop for item slots (mouse threshold, touch long-press, ghost, cancel outside, click swallow),
// the container grid view (pack + storage grids, no split / to-hotbar list), drop mappings to the existing server commands,
// pad / keyboard pick + A, and the HUD hotbar.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installPermissions, Membership, PlayerId, Transform, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";
import { PAD } from "../src/ui-nav.js";
import { resetSlotDrag } from "../src/gameplay-panels.js";
import { DRAG_HOLD_MS, installSlotDrag, parseSlotRef } from "../src/slot-drag.js";
import { mountHotbar } from "../src/hotbar.js";

type Pad = { buttons: { pressed: boolean; value?: number }[]; axes: number[] };
const pad = (): Pad => ({ buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] });
const d = G.defaultDefs(); const id = (k: string): number => d.itemId(k);
let at: Element | null = null;
beforeEach(() => { resetSlotDrag(); at = null; document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear();
  (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false }); (document as { elementFromPoint?: unknown }).elementFromPoint = () => at; });
afterEach(() => { vi.useRealTimers(); resetSlotDrag(); });

function setup(container = false) {
  const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w); G.installEconomy(w); G.installCraftQueue(w);
  const names = G.playerNames(w); const me = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 7 }); w.add(me, PlayerId, { id: 7 }).add(me, Membership, { partyId: 0, clanId: 0 }); names.set(7, "Ada");
  const sent: G.MenuIntent[] = []; const pads: Pad[] = [pad()];
  const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, getGamepads: () => pads,
    gameplay: { ctx: () => ({ world: w, player: me, names }), send: (i: G.MenuIntent) => { sent.push(i); const a = i.args as Record<string, number>;
      const f = i.cmd === G.MoveSlotCmd ? G.moveSlot(w, me, a["where"]!, a["slot"]!, a["to"]!) : i.cmd === G.ContainerToSlotCmd ? G.containerToSlot(w, me, a["slot"]!, a["to"]!, a["dir"] ?? 0) : undefined; return f === undefined; }, startPlacing: () => {} } as never });
  const press = (b: number): void => { const p = pad(); p.buttons[b]!.pressed = true; pads[0] = p; menus.nav.pollGamepad(); pads[0] = pad(); menus.nav.pollGamepad(); };
  let crate = 0;
  if (container) { crate = w.create(); w.add(crate, Transform, { x: 0.5, y: 0 }).add(crate, G.Container, { slotCount: 8 }).add(crate, G.ContainerViewers); w.add(me, G.Viewing, { container: crate }); }
  return { w, me, crate, sent, menus, press };
}
const q = (s: string): HTMLElement => { const e = document.querySelector<HTMLElement>(s); if (!e) throw new Error(`missing ${s}`); return e; };
function pe(type: string, t: EventTarget, x: number, y: number, o: { id?: number; type?: string } = {}): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, "pointerId", { value: o.id ?? 1 }); Object.defineProperty(e, "pointerType", { value: o.type ?? "mouse" }); t.dispatchEvent(e); return e;
}
/** Mouse drag from one element to another (6 px threshold, then move over the target and release). */
function drag(from: HTMLElement, to: Element | null): { ghost: HTMLElement | null; over: boolean } {
  pe("pointerdown", from, 10, 10); at = to; pe("pointermove", from, 30, 30);
  const ghost = document.querySelector<HTMLElement>("[data-ghost]"); const over = !!to && (to as HTMLElement).hasAttribute?.("data-drop-over");
  pe("pointerup", from, 30, 30); return { ghost, over };
}

describe("ADR-231 slot drag core", () => {
  test("refs parse; mouse needs the move threshold; ghost follows; drop outside cancels; click after a drag is swallowed", () => {
    expect(parseSlotRef("c:12")).toEqual({ kind: "c", slot: 12 }); expect(parseSlotRef("e:-1")).toEqual({ kind: "e", slot: -1 }); expect(parseSlotRef("x:1")).toBeUndefined();
    document.body.innerHTML = `<div id=r><button id=a data-drag="p:1" data-drop="p:1">A</button><button id=b data-drop="p:2">B</button></div><div id=out></div>`;
    const drops: string[] = []; const clicks: string[] = []; const r = document.getElementById("r")!; const a = document.getElementById("a")!; const b = document.getElementById("b")!;
    a.addEventListener("click", () => clicks.push("a"));
    const sd = installSlotDrag(r, { onDrop: () => (f, t) => drops.push(`${f.kind}${f.slot}>${t.kind}${t.slot}`) });
    pe("pointerdown", a, 10, 10); pe("pointermove", a, 13, 12); expect(sd.active).toBe(false); pe("pointerup", a, 13, 12); a.click(); expect(clicks).toEqual(["a"]); // small wobble = still a tap
    const g = drag(a, b); expect(g.ghost).not.toBeNull(); expect(g.ghost!.style.position).toBe("fixed"); expect(g.ghost!.style.pointerEvents).toBe("none"); expect(g.over).toBe(true);
    expect(drops).toEqual(["p1>p2"]); expect(document.querySelector("[data-ghost]")).toBeNull(); a.click(); expect(clicks).toEqual(["a"]); // swallowed
    drag(a, document.getElementById("out")); expect(drops).toEqual(["p1>p2"]); // outside any slot = cancel
    drag(a, a); expect(drops).toEqual(["p1>p2"]); // same slot = cancel
    pe("pointerdown", a, 10, 10); pe("pointermove", a, 30, 30); expect(sd.active).toBe(true); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); expect(sd.active).toBe(false);
    sd.destroy();
  });
  test("touch: long-press starts the drag (finger still); a quick tap stays a tap; moving in a scrollable grid scrolls instead", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id=r><button id=a data-drag="p:1">A</button><button id=b data-drop="p:2">B</button></div>`;
    const drops: string[] = []; const r = document.getElementById("r")!; const a = document.getElementById("a")!; const b = document.getElementById("b")!;
    const sd = installSlotDrag(r, { onDrop: () => (f, t) => drops.push(`${f.slot}>${t.slot}`) });
    pe("pointerdown", a, 10, 10, { type: "touch" }); vi.advanceTimersByTime(DRAG_HOLD_MS - 50); pe("pointerup", a, 10, 10, { type: "touch" }); vi.advanceTimersByTime(500); expect(sd.active).toBe(false);
    pe("pointerdown", a, 10, 10, { type: "touch" }); vi.advanceTimersByTime(DRAG_HOLD_MS + 5); expect(sd.active).toBe(true); expect(document.querySelector("[data-ghost]")).not.toBeNull();
    const tm = new Event("touchmove", { bubbles: true, cancelable: true }); a.dispatchEvent(tm); expect(tm.defaultPrevented).toBe(true); // page / grid does not scroll mid-drag
    at = b; pe("pointermove", a, 50, 10, { type: "touch" }); pe("pointerup", a, 50, 10, { type: "touch" }); expect(drops).toEqual(["1>2"]);
    // scrollable ancestor: a quick swipe is a scroll, not a drag
    Object.defineProperty(r, "scrollHeight", { value: 500, configurable: true }); Object.defineProperty(r, "clientHeight", { value: 100, configurable: true }); r.style.overflowY = "auto";
    pe("pointerdown", a, 10, 10, { type: "touch" }); pe("pointermove", a, 10, 40, { type: "touch" }); vi.advanceTimersByTime(DRAG_HOLD_MS + 50); expect(sd.active).toBe(false);
    sd.destroy();
  });
});

describe("ADR-231 inventory panel drag-and-drop", () => {
  test("pack tile -> hotbar slot = MoveSlot; same item merges; onto equipment equips; outside the panel cancels", () => {
    const { w, me, sent, menus } = setup(); G.addItem(w, me, id("wood"), 5); G.addItem(w, me, id("stone_axe"), 1); menus.open("inventory");
    const H = G.HOTBAR_SIZE;
    drag(q("[data-key=slot-0]"), q(`[data-key=slot-${H + 2}]`)); expect(sent.at(-1)).toMatchObject({ cmd: G.MoveSlotCmd, args: { where: 0, slot: 0, to: H + 2 } });
    expect(G.readSlots(w, me as never).item(H + 2)).toBe(id("wood")); expect(document.body.textContent).toContain("Moved Pine Log");
    G.splitStack(w, me, 0, H + 2, 2); const v = G.readSlots(w, me as never); let s2 = -1; for (let i = 0; i < v.slotCount; i++) if (i !== H + 2 && v.item(i) === id("wood")) s2 = i;
    menus.open("inventory"); drag(q(`[data-key=slot-${s2}]`), q(`[data-key=slot-${H + 2}]`)); expect(G.readSlots(w, me as never).count(H + 2)).toBe(5); expect(document.body.textContent).toContain("Stacked");
    const n = sent.length; drag(q(`[data-key=slot-${H + 2}]`), document.getElementById("game")); expect(sent.length).toBe(n); // dropped on the world = cancel
    drag(q("[data-key=slot-1]"), q("[data-role=equipment] [data-role=equip]")); expect(sent.at(-1)!.cmd).toBe(G.EquipCmd);
    menus.destroy();
  });
  test("container view: pack + storage grids side by side, no split / to-hotbar list; drags map to ContainerToSlot / MoveSlot", () => {
    const { w, me, crate, sent, menus } = setup(true); G.addItem(w, crate, id("stone_axe"), 1); G.addItem(w, me, id("wood"), 4); G.addItem(w, crate, id("wood"), 2); menus.open("inventory");
    expect(q("[data-role=inv-layout]").dataset["mode"]).toBe("container"); expect(document.querySelector("[data-role=arrange-section]")).toBeNull(); expect(document.querySelector("[data-role=equipment]")).toBeNull();
    expect(document.querySelectorAll("[data-role=container-grid] [data-role=cslot]").length).toBe(8); expect(document.querySelectorAll("[data-role=inv-grid] [data-role=slot]").length).toBeGreaterThan(0);
    drag(q("[data-key=cslot-0]"), q("[data-key=slot-3]")); expect(sent.at(-1)).toMatchObject({ cmd: G.ContainerToSlotCmd, args: { slot: 0, to: 3, dir: 0 } }); expect(G.readSlots(w, me as never).item(3)).toBe(id("stone_axe"));
    drag(q("[data-key=slot-0]"), q("[data-key=cslot-5]")); expect(sent.at(-1)).toMatchObject({ cmd: G.ContainerToSlotCmd, args: { slot: 5, to: 0, dir: 1 } }); expect(G.readSlots(w, crate as never).item(5)).toBe(id("wood"));
    drag(q("[data-key=cslot-5]"), q("[data-key=cslot-1]")); expect(sent.at(-1)).toMatchObject({ cmd: G.MoveSlotCmd, args: { where: 1, slot: 5, to: 1 } });
    expect(G.readSlots(w, crate as never).count(1)).toBe(6); // wood 4 merged onto wood 2
    menus.destroy();
  });
  test("pad: Move in the details pane, D-pad to a storage slot, A puts it there; tap on a storage tile selects, double-tap takes", () => {
    const { w, me, crate, sent, menus, press } = setup(true); G.addItem(w, me, id("wood"), 4); G.addItem(w, crate, id("stone"), 3); menus.open("inventory");
    q("[data-key=slot-0]").focus(); q("[data-key=slot-0]").dispatchEvent(new FocusEvent("focus")); q("[data-key=move-0]").click();
    expect(q("[data-key=slot-0]").hasAttribute("data-picked")).toBe(true); expect(q("[data-role=inv-details]").textContent).toContain("Moving Pine Log");
    q("[data-key=cslot-4]").focus(); press(PAD.A); expect(sent.at(-1)).toMatchObject({ cmd: G.ContainerToSlotCmd, args: { slot: 4, to: 0, dir: 1 } });
    expect(document.querySelector("[data-picked]")).toBeNull();
    const t = q("[data-key=cslot-0]"); t.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); expect(q("[data-key=cslot-0]").hasAttribute("data-sel")).toBe(true);
    expect(q("[data-role=inv-details]").textContent).toContain("Stone"); expect(document.querySelector("[data-key=take-0]")).not.toBeNull();
    q("[data-key=cslot-0]").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 })); expect(sent.at(-1)!.cmd).toBe(G.WithdrawCmd);
    menus.destroy();
  });
});

describe("ADR-231 HUD hotbar drag", () => {
  test("dragging one HUD slot onto another calls move(from, to); a tap still equips", () => {
    const moves: number[][] = []; const eq: number[] = [];
    const hb = mountHotbar({ device: () => "touch", equip: (s) => eq.push(s), move: (f, t) => moves.push([f, t]), view: () => [{ slot: 0, item: 1, icon: "wood", name: "Wood", count: 3 }] });
    hb.update(true); const b0 = hb.el.querySelector<HTMLElement>("[data-slot='0']")!; const b4 = hb.el.querySelector<HTMLElement>("[data-slot='4']")!;
    expect(b0.dataset["drag"]).toBe("h:0"); expect(b4.dataset["drag"]).toBeUndefined(); expect(b4.dataset["drop"]).toBe("h:4");
    b0.click(); expect(eq).toEqual([0]);
    drag(b0, b4); expect(moves).toEqual([[0, 4]]); b0.click(); expect(eq).toEqual([0]); // the click after the drag is swallowed
    hb.destroy();
  });
});
