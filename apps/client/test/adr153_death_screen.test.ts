// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { PlayerId, Transform, World } from "@engine/core";
import { Dead, LootBag } from "@engine/gameplay";
import { installDemoWorld } from "@engine/server/protocol";
import { bagBearing, deathUiState, mountDeathScreen, RESPAWN_UNLOCK_S, RESPAWN_RETRY_MS } from "../src/death-screen.js";
import { TUTORIAL_STEPS, TutorialProgress } from "../src/tutorial/steps.js";

const mem = (): { data: Record<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void } => ({ data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } });
function rig() {
  const w = new World({ seed: 1 }); installDemoWorld(w, "client");
  const p = w.create(); w.add(p, Transform, { x: 10, y: 10, z: 0 }).add(p, PlayerId, { id: 7 });
  let t = 0; const sent: number[] = []; let pad = false; let deaths = 0;
  const gp = (): readonly (Gamepad | null)[] => [{ buttons: [{ pressed: pad }] } as unknown as Gamepad];
  document.body.innerHTML = ""; const root = document.createElement("div"); document.body.append(root);
  const ui = mountDeathScreen(root, { world: () => w, player: () => p, respawn: () => { sent.push(t); return true; }, now: () => t, getGamepads: gp, onDeath: () => { deaths++; } });
  return { w, p, ui, sent, adv: (s: number) => { t += s * 1000; ui.frame(); }, setPad: (v: boolean) => { pad = v; ui.frame(); }, deaths: () => deaths };
}
const kill = (r: ReturnType<typeof rig>) => { r.w.add(r.p, Dead, { cause: 1, tick: 1 }); r.ui.frame(); };
const revive = (r: ReturnType<typeof rig>) => { r.w.remove(r.p, Dead); r.ui.frame(); };
const key = (code: string) => dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));

describe("ADR-153 death screen", () => {
  test("pure state: countdown, ready, pending retry", () => {
    expect(deathUiState(false, 0, 0, undefined).ready).toBe(false);
    expect(deathUiState(true, 0, 1000, undefined)).toMatchObject({ ready: false, secondsLeft: Math.ceil(RESPAWN_UNLOCK_S - 1) });
    expect(deathUiState(true, 0, RESPAWN_UNLOCK_S * 1000, undefined).ready).toBe(true);
    const t = RESPAWN_UNLOCK_S * 1000; expect(deathUiState(true, 0, t + 10, t).pending).toBe(true); expect(deathUiState(true, 0, t + RESPAWN_RETRY_MS, t).ready).toBe(true);
    expect(bagBearing({ x: 0, y: 0 }, { x: 3, y: 4 }).dist).toBeCloseTo(5);
  });
  test("hidden while alive; shows on death with a disabled countdown, then mouse click respawns", () => {
    const r = rig(); r.ui.frame(); expect(r.ui.el.hidden).toBe(true);
    kill(r); expect(r.ui.el.hidden).toBe(false); expect(r.deaths()).toBe(1);
    const btn = r.ui.el.querySelector<HTMLButtonElement>("#death-respawn")!; expect(btn.disabled).toBe(true); expect(btn.textContent).toMatch(/Respawn in \d+/);
    btn.click(); expect(r.sent).toHaveLength(0);
    r.adv(RESPAWN_UNLOCK_S); expect(btn.disabled).toBe(false); expect(r.ui.el.dataset["ready"]).toBe("1");
    btn.click(); expect(r.sent).toHaveLength(1); expect(btn.disabled).toBe(true);
    r.adv(RESPAWN_RETRY_MS / 1000); expect(btn.disabled).toBe(false); // still dead (packet lost): re-armed
    revive(r); expect(r.ui.el.hidden).toBe(true);
  });
  test("keyboard (Enter / R) and gamepad A respawn", () => {
    const r = rig(); kill(r); key("Enter"); expect(r.sent).toHaveLength(0);
    r.adv(RESPAWN_UNLOCK_S); key("KeyR"); expect(r.sent).toHaveLength(1); revive(r);
    kill(r); r.adv(RESPAWN_UNLOCK_S); r.setPad(true); expect(r.sent).toHaveLength(2);
    r.adv(RESPAWN_RETRY_MS / 1000); expect(r.sent).toHaveLength(2); // held A is an edge, not a repeat
    r.setPad(false); r.setPad(true); expect(r.sent).toHaveLength(3);
  });
  test("bag compass points at the player's own death bag and stays after respawn", () => {
    const r = rig(); const bag = r.w.create(); r.w.add(bag, Transform, { x: 30, y: 10, z: 0 }).add(bag, LootBag, { owner: 7, despawnAtTick: 99999 });
    kill(r); revive(r); expect(r.ui.compass.hidden).toBe(false); expect(r.ui.compass.dataset["dist"]).toBe("20");
    r.w.destroy(bag); r.ui.frame(); expect(r.ui.compass.hidden).toBe(true);
  });
  test("tutorial: dying and respawning keeps the current step (resume), and the death card sits above the tutorial card", () => {
    const tp = new TutorialProgress(TUTORIAL_STEPS, mem(), "tut-x"); tp.start(true); tp.next(); tp.next(); const at = tp.index;
    const r = rig(); kill(r); r.adv(RESPAWN_UNLOCK_S); r.ui.press(); revive(r);
    expect(tp.active).toBe(true); expect(tp.index).toBe(at);
    const z = Number(getComputedStyle(r.ui.el).zIndex || "90"); expect(z).toBeGreaterThan(45);
  });
});
describe("ADR-153 compass out of bag range", () => {
  test("aims at the remembered death spot when the bag is not replicated, and clears once we are back there", () => {
    const r = rig(); kill(r); r.w.set(r.p, Transform, { x: 110, y: 10, z: 0 }); revive(r);
    expect(r.ui.compass.hidden).toBe(false); expect(r.ui.compass.dataset["dist"]).toBe("100"); expect(r.ui.compass.textContent).toMatch(/Where you fell/);
    r.w.set(r.p, Transform, { x: 15, y: 10, z: 0 }); r.ui.frame(); expect(r.ui.compass.hidden).toBe(true);
  });
});
