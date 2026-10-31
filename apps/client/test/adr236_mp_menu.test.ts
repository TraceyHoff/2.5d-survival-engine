// @vitest-environment jsdom
// ADR-236: the multiplayer connect / P2P boxes no longer sit over the game. Everything moved to the start menu's
// Multiplayer page (gamepad-first), Pause → Session, and a tiny indicator that appears only on a problem.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { netProblem, mountNetStatus, pingLabel, HIGH_PING_MS, CONNECTING_GRACE_MS, HIGH_PING_SUSTAIN_MS } from "../src/net-status.js";
import { GameMenus, sessionBody } from "../src/game-menus.js";

(globalThis as { matchMedia?: unknown }).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const src = (f: string): string => resolve(__dirname, "../src", f);
const flush = async (n = 10): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 5)); };
const active = (): string => { const a = document.activeElement as HTMLElement | null; return a?.dataset["role"] ?? a?.dataset["action"] ?? a?.textContent ?? ""; };
const press = (key: string): void => { const t = document.activeElement ?? document.body; for (const type of ["keydown", "keyup"]) t.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true })); };

describe("in-game: no box over the game, problem-only indicator", () => {
  test("the old overlays are gone from the client", () => {
    expect(existsSync(src("connect.ts"))).toBe(false);
    expect(existsSync(src("p2p-overlay.ts"))).toBe(false);
    const main = readFileSync(src("main.ts"), "utf8");
    expect(existsSync(src("menu.ts"))).toBe(true);
    expect(main).not.toMatch(/mountConnectOverlay|mountP2POverlay|connect-overlay|p2p-overlay/);
  });
  test("netProblem: silent when healthy, short text on a problem", () => {
    expect(netProblem({ status: "connected", rttMs: 40 })).toBeUndefined();
    expect(netProblem({ status: "connected", rttMs: undefined })).toBeUndefined();
    expect(netProblem({ status: "connected", rttMs: HIGH_PING_MS })).toBeUndefined();
    expect(netProblem({ status: "connected", rttMs: 900 }, 0, 500)).toBeUndefined(); // one slow sample doesn't count
    expect(netProblem({ status: "connected", rttMs: HIGH_PING_MS + 1 })).toEqual({ level: "warn", text: `High ping · ${HIGH_PING_MS + 1} ms` });
    expect(netProblem({ status: "connecting", rttMs: undefined }, 500)).toBeUndefined();
    expect(netProblem({ status: "connecting", rttMs: undefined }, CONNECTING_GRACE_MS + 1)?.text).toBe("Connecting…");
    for (const s of ["disconnected", "error"]) expect(netProblem({ status: s, rttMs: 20 })?.level).toBe("bad");
    expect(netProblem({ status: "idle", rttMs: undefined })).toBeUndefined();
    expect(pingLabel(undefined)).toBe("measuring…"); expect(pingLabel(31)).toBe("31 ms"); expect(pingLabel(400)).toBe("400 ms (high)");
  });
  test("indicator: hidden while fine, tiny + non-interactive + under the vitals HUD on a problem", () => {
    document.body.innerHTML = ""; const root = document.createElement("div"); document.body.append(root);
    const hud = document.createElement("div"); hud.id = "hud"; root.append(hud);
    hud.getBoundingClientRect = () => ({ left: 6, top: 6, right: 136, bottom: 90, width: 130, height: 84, x: 6, y: 6, toJSON: () => ({}) });
    const src = { status: "connected", rttMs: 30 as number | undefined }; let t = 0;
    const ns = mountNetStatus(src, root, () => t);
    expect(ns.root.style.display).toBe("none");
    src.status = "disconnected"; ns.update();
    expect(ns.root.style.display).toBe("block"); expect(ns.root.dataset["level"]).toBe("bad"); expect(ns.root.textContent).toMatch(/Disconnected/);
    expect(ns.root.style.top).toBe("94px"); expect(ns.root.style.left).toBe("6px");
    expect(ns.root.querySelector("button,input,a")).toBeNull(); expect(ns.root.tabIndex).toBe(-1);
    const css = Array.from(document.querySelectorAll("style")).map((s) => s.textContent).join("");
    expect(css).toMatch(/#net-status\{position:absolute;z-index:5;pointer-events:none/);
    src.status = "connected"; src.rttMs = 600; ns.update(); expect(ns.root.style.display).toBe("none"); // a spike: not yet
    t += HIGH_PING_SUSTAIN_MS; ns.update(); expect(ns.root.textContent).toBe("High ping · 600 ms"); t = 0;
    src.rttMs = 50; ns.update(); expect(ns.root.style.display).toBe("none");
    src.status = "connecting"; ns.update(); expect(ns.root.style.display).toBe("none"); t = CONNECTING_GRACE_MS + 10; ns.update(); expect(ns.root.textContent).toBe("Connecting…");
    ns.destroy(); expect(document.getElementById("net-status")).toBeNull();
  });
});

describe("Pause → Session carries the old box's info", () => {
  test("rows, player list, Reconnect + Leave; Session sits right under Resume", async () => {
    document.body.innerHTML = ""; const root = document.createElement("div"); document.body.append(root);
    let left = 0, re = 0; let status = "disconnected";
    const menus = new GameMenus({ root, onQuit: () => {}, pollGamepads: false,
      session: () => ({ label: "Dedicated server.", leaveLabel: "Main menu", onLeave: () => { left++; },
        rows: () => [["Server", "ws://127.0.0.1:7777"], ["Status", status], ["Ping", "—"]], players: () => [{ name: "Ann", host: true }, { name: "Bo" }],
        actions: () => (status === "connected" ? [] : [["Reconnect", () => { re++; }]]) }) });
    menus.pause();
    const pauseLabels = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-menu=pause] .gm-grid button, [data-menu=pause] button")).map((b) => b.textContent);
    expect(pauseLabels.indexOf("Session")).toBe(pauseLabels.indexOf("Resume") + 1);
    menus.open("session");
    const p = root.querySelector("[data-menu=session]")!;
    expect(p.querySelector("[data-row=server]")?.textContent).toBe("ws://127.0.0.1:7777");
    expect(p.querySelector("[data-row=status]")?.textContent).toBe("disconnected");
    expect(Array.from(p.querySelectorAll("[data-role=player]")).map((l) => l.textContent)).toEqual(["Ann (host)", "Bo"]);
    status = "connected"; await new Promise((r) => setTimeout(r, 600));
    expect(p.querySelector("[data-row=status]")?.textContent).toBe("connected"); // live while open
    p.querySelector<HTMLButtonElement>("[data-action=Reconnect]")!.click(); expect(re).toBe(1);
    menus.open("session"); root.querySelector<HTMLButtonElement>("[data-menu=session] [data-action='Main menu']")!.click(); expect(left).toBe(1);
    menus.destroy();
  });
  test("sessionBody hides an empty player list", () => {
    const n = sessionBody({ label: "x", leaveLabel: "Leave", onLeave: () => {}, rows: () => [["Room code", "ABC-234"]] }, (t) => Object.assign(document.createElement("p"), { textContent: t }));
    expect((n[2] as HTMLUListElement).hidden).toBe(true); expect((n[1] as HTMLElement).textContent).toContain("ABC-234");
  });
});

describe("start menu → Multiplayer page", () => {
  const open = async (o: Record<string, unknown> = {}) => {
    document.body.innerHTML = ""; localStorage.clear();
    const { BootUI } = await import("../src/menu.js");
    const ui = new BootUI("/"); const choice = ui.menu({ hostedStatic: false, defaultUrl: "ws://127.0.0.1:7777", ...o });
    return { ui, choice };
  };
  test("main → Multiplayer: one page with host, join code, server address + live ping; gamepad / keyboard focus order", async () => {
    const urls: string[] = [];
    await open({ mp: { hostCap: "12", probe: (u: string) => { urls.push(u); return Promise.resolve(23.4); } } });
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Multiplayer")!.click();
    await flush();
    expect(document.querySelector(".boot")?.getAttribute("data-page")).toBe("multiplayer");
    expect(document.querySelector("h2")?.textContent).toBe("Multiplayer");
    expect(document.querySelector("[data-section=host] p")?.textContent).toContain("up to 12 players");
    expect(document.querySelector("[data-role=server-status]")?.textContent).toBe("● Online · 23 ms"); expect(urls).toEqual(["ws://127.0.0.1:7777"]);
    expect(active()).toBe("mp-host"); // first control, not Back
    const order: string[] = [];
    for (let i = 0; i < 6; i++) { order.push(active()); press("GamepadDPadDown"); }
    expect(order).toEqual(["mp-host", "room-code", "mp-join", "server-url", "mp-connect", "Back"]);
    expect(active()).toBe("mp-host"); // wraps
    press("ArrowDown"); expect(active()).toBe("room-code"); press("ArrowUp"); expect(active()).toBe("mp-host");
    press("GamepadB"); await flush(); // B = back to main
    expect(document.querySelector(".boot")?.hasAttribute("data-page")).toBe(false);
    expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Singleplayer")).toBe(true);
  });
  test("Enter in the room-code field joins (not Back); gamepad A on Host hosts", async () => {
    const { choice } = await open({ page: "multiplayer", mp: { probe: () => Promise.reject(new Error("timed out")) } });
    await flush();
    expect(document.querySelector("[data-role=server-status]")?.textContent).toBe("● Can't reach server (timed out)");
    const code = document.querySelector<HTMLInputElement>("[data-role=room-code]")!; code.focus(); code.value = "abc-234";
    code.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await expect(choice).resolves.toEqual({ kind: "join", code: "abc-234" });
    const b = await open({ page: "multiplayer", mp: { probe: () => Promise.resolve(5) } }); await flush();
    expect(active()).toBe("mp-host"); press("GamepadA");
    await expect(b.choice).resolves.toEqual({ kind: "host" });
  });
  test("Enter in the server field connects to that address (remembered); a session notice shows on the page", async () => {
    const { choice } = await open({ page: "multiplayer", notice: "Host ended the session.", mp: { probe: () => Promise.resolve(5) } });
    await flush();
    expect(document.querySelector("[data-role=notice]")?.textContent).toBe("Host ended the session.");
    const url = document.querySelector<HTMLInputElement>("[data-role=server-url]")!; url.value = "ws://example:7777";
    url.focus(); url.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await expect(choice).resolves.toEqual({ kind: "multiplayer", url: "ws://example:7777" });
    expect(localStorage.getItem("engine-server-url")).toBe("ws://example:7777");
  });
  test("layout CSS: single column that fits phones (no fixed widths wider than the screen), compact on short screens", async () => {
    await open();
    const css = Array.from(document.querySelectorAll("style")).map((s) => s.textContent).join("");
    expect(css).toContain(".boot[data-page=multiplayer] .panel{width:min(480px,94vw)");
    expect(css).toContain(".boot .mp-row input{flex:1 1 0;min-width:0");
    expect(css).toMatch(/@media \(max-height:860px\)\{\.boot\[data-page=multiplayer\]/);
  });
});

describe("probeServer", () => {
  class FakeWs { static mode: "open" | "error" | "hang" = "open"; onopen: (() => void) | null = null; onerror: (() => void) | null = null; closed = false;
    constructor(public url: string) { setTimeout(() => { if (FakeWs.mode === "open") this.onopen?.(); else if (FakeWs.mode === "error") this.onerror?.(); }, 5); }
    close(): void { this.closed = true; } }
  test("resolves with the open time, rejects on error / timeout / bad scheme", async () => {
    const { probeServer } = await import("../src/menu.js");
    const W = FakeWs as unknown as typeof WebSocket;
    FakeWs.mode = "open"; await expect(probeServer("ws://x:1", 200, W)).resolves.toBeGreaterThanOrEqual(0);
    FakeWs.mode = "error"; await expect(probeServer("ws://x:1", 200, W)).rejects.toThrow();
    FakeWs.mode = "hang"; await expect(probeServer("ws://x:1", 30, W)).rejects.toThrow("timed out");
    await expect(probeServer("http://x", 30, W)).rejects.toThrow("ws://");
  });
});
