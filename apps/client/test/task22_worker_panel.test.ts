// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { installPermissions, Membership, PlayerId, World, type Entity } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";

function setup() {
  const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w); G.installEconomy(w); G.installCraftQueue(w);
  const names = G.playerNames(w);
  const mk = (pid: number, name: string, x = 0): Entity => { const p = G.spawnPlayer(w, { x, y: 0, maxWeight: 0, clientId: pid }); w.add(p, PlayerId, { id: pid }).add(p, Membership, { partyId: 0, clanId: 0 }); names.set(pid, name); return p; };
  const me = mk(7, "Ada");
  const bot = mk(9, "Boris", 1); G.setAiHumanPredicate(w, (e) => e === bot); G.ensureWorker(w, bot);
  const sent: G.MenuIntent[] = [];
  const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, gameplay: { ctx: () => ({ world: w, player: me, names }), send: (i) => { sent.push(i); return true; } } });
  return { w, me, bot, sent, menus, mk };
}
const q = (sel: string): HTMLElement => { const e = document.querySelector<HTMLElement>(sel); if (!e) throw new Error(`missing ${sel}`); return e; };

beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false }); });

describe("worker panel (Task 22)", () => {
  test("for-hire panel shows the wanted item; Hire is disabled without it, enabled with it, and sends hireWorker", () => {
    const { w, me, bot, sent, menus } = setup();
    menus.openWorker(bot);
    const v = G.workerView(w, me, bot)!;
    expect(document.querySelector("[data-menu=worker]")!.textContent).toContain("Wants:");
    expect(document.querySelector("[data-menu=worker]")!.textContent).toContain(v.wantedName);
    const hire = q("[data-key=worker-hire]");
    expect(hire.textContent).toContain(v.wantedName);
    expect((hire as HTMLButtonElement).disabled).toBe(true);
    G.addItem(w, me, v.wantedItem, 1);
    menus.openWorker(bot);
    expect((q("[data-key=worker-hire]") as HTMLButtonElement).disabled).toBe(false);
    q("[data-key=worker-hire]").click();
    expect(sent.at(-1)).toMatchObject({ cmd: G.HireWorkerCmd, args: { target: bot } });
    menus.destroy();
  });
  test("hired worker panel shows job buttons; picking one sends setWorkerJob, Release sends dismissWorker", () => {
    const { w, me, bot, sent, menus } = setup();
    const v = G.workerView(w, me, bot)!;
    G.addItem(w, me, v.wantedItem, 1);
    expect(G.hireWorker(w, me, bot)).toBe(G.WorkerFail.None);
    menus.openWorker(bot);
    expect(document.querySelector("[data-menu=worker]")!.textContent).toContain("Job: Gathering");
    for (const job of G.WORKER_JOBS) expect(document.querySelector(`[data-key=worker-job-${job}]`)).not.toBeNull();
    q(`[data-key=worker-job-${G.WorkerJob.Farm}]`).click();
    expect(sent.at(-1)).toMatchObject({ cmd: G.SetWorkerJobCmd, args: { worker: bot, job: G.WorkerJob.Farm } });
    q("[data-key=worker-dismiss]").click();
    expect(sent.at(-1)).toMatchObject({ cmd: G.DismissWorkerCmd, args: { worker: bot } });
    menus.destroy();
  });
  test("another player's worker shows no hire or job controls", () => {
    const { w, me, bot, menus, mk } = setup();
    const other = mk(8, "Cy", 0);
    const v = G.workerView(w, me, bot)!;
    G.addItem(w, other, v.wantedItem, 1);
    expect(G.hireWorker(w, other, bot)).toBe(G.WorkerFail.None);
    menus.openWorker(bot);
    expect(document.querySelector("[data-key=worker-hire]")).toBeNull();
    expect(document.querySelector("[data-key=worker-job-1]")).toBeNull();
    expect(document.querySelector("[data-menu=worker]")!.textContent).toContain("Works for Player 8.");
    menus.destroy();
  });
  test("Interact offers the worker panel for the nearest AI human", () => {
    const { w, me, bot } = setup();
    expect(G.interactPanel({ world: w, player: me, names: new Map() })).toEqual({ panel: "worker", worker: bot });
  });
});
