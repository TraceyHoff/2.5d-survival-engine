// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { PlayerId, Transform, World, type Entity } from "@engine/core";
import * as G from "@engine/gameplay";
import { drawPetGlyph, petStatusPoints } from "../src/pet-status.js";
import { GameMenus } from "../src/game-menus.js";

const cam = { x: 0, y: 0, viewW: 1920, viewH: 1080, dpr: 1, drawZoom: 1, cssToWorld: (x: number, y: number) => ({ x, y }) };
const world = (): World => { const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); if (!w.isRegistered(PlayerId)) w.register(PlayerId); return w; };
const tame = (w: World, p: Entity, a: Entity, item: number): void => {
  G.addItem(w, p, item, 50);
  for (let i = 0; i < 40 && !w.has(a, G.Pet); i++) { G.offerTreat(w, p, a, item); w.step(1 / 20); }
};
const stubCtx = (): { calls: string[]; ctx: CanvasRenderingContext2D } => {
  const calls: string[] = [];
  const ctx = new Proxy({}, { get: (_t, prop: string) => { if (["beginPath", "moveTo", "lineTo", "quadraticCurveTo", "ellipse", "arc", "fill", "stroke", "closePath"].includes(prop)) return (..._a: unknown[]) => { calls.push(prop); }; return undefined; }, set: () => true }) as unknown as CanvasRenderingContext2D;
  return { calls, ctx };
};

describe("Task 14: pet status badges", () => {
  test("petStatusPoints: guarding pet gets a badge, idle and dead pets do not", () => {
    const w = world(); const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 7 }); w.add(p, PlayerId, { id: 7 });
    const a = G.spawnAnimal(w, "animal_dog_dachshund", 1, 0); tame(w, p, a, G.gameplayDefs(w).itemId("dog_biscuit"));
    expect(w.has(a, G.Pet)).toBe(true);
    let pts = petStatusPoints(w, cam);
    expect(pts).toEqual([]); // idle: no badge (status unset -> Idle)
    w.add(a, G.PetStatusComp, { status: G.PetStatus.Guard });
    pts = petStatusPoints(w, cam);
    expect(pts.length).toBe(1); expect(pts[0]!.status).toBe(3); expect(pts[0]!.label).toBe("Guarding");
    w.set(a, G.PetStatusComp, { status: G.PetStatus.Fight });
    expect(petStatusPoints(w, cam)[0]!.label).toBe("Fighting");
    w.add(a, G.Dead, {} as never);
    expect(petStatusPoints(w, cam)).toEqual([]);
  });

  test("drawPetGlyph draws a distinct path per status without throwing", () => {
    for (const s of [1, 2, 3, 4, 5, 6]) { const { calls, ctx } = stubCtx(); drawPetGlyph(ctx, s, 10); expect(calls.length).toBeGreaterThan(0); }
    const shield = stubCtx(); drawPetGlyph(shield.ctx, 3, 10); expect(shield.calls).toContain("closePath"); expect(shield.calls.at(-1)).toBe("fill");
    const swords = stubCtx(); drawPetGlyph(swords.ctx, 4, 10); expect(swords.calls.at(-1)).toBe("stroke");
  });
});

describe("Task 14: pet panel guard section", () => {
  beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false }); });
  test("Guard here / Guard me buttons send the petGuard intent; status line shows the activity", () => {
    const w = world(); const me = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 7 }); w.add(me, PlayerId, { id: 7 });
    const a = G.spawnAnimal(w, "animal_dog_dachshund", 1, 0); tame(w, me, a, G.gameplayDefs(w).itemId("dog_biscuit"));
    expect(w.has(a, G.Pet)).toBe(true);
    w.add(a, G.PetStatusComp, { status: G.PetStatus.Guard });
    const sent: G.MenuIntent[] = [];
    const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, gameplay: { ctx: () => ({ world: w, player: me, names: new Map() }), send: (i) => { sent.push(i); return true; } } });
    menus.openPet(a);
    const modal = document.querySelector("[data-menu=pet]")!;
    expect(modal.querySelector("[data-role=pet-doing]")?.textContent).toBe("Doing: Guarding");
    const here = modal.querySelector<HTMLButtonElement>("[data-key=pet-guard-here]")!;
    expect(here).toBeTruthy(); here.click();
    expect(sent.at(-1)).toMatchObject({ cmd: G.PetGuardCmd, args: { pet: a, kind: 1 } });
    const guardMe = modal.querySelector<HTMLButtonElement>("[data-key=pet-guard-me]")!;
    guardMe.click();
    expect(sent.at(-1)).toMatchObject({ cmd: G.PetGuardCmd, args: { pet: a, kind: 2, target: me } });
    menus.destroy();
  });
});
