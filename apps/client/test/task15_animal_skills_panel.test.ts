// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { installPermissions, Membership, PlayerId, World, type Entity } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";

const d = G.defaultDefs(); const id = (k: string): number => d.itemId(k);

function setup() {
  const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w); G.installEconomy(w); G.installCraftQueue(w);
  const names = G.playerNames(w);
  const mk = (pid: number, name: string, x = 0): Entity => { const p = G.spawnPlayer(w, { x, y: 0, maxWeight: 0, clientId: pid }); w.add(p, PlayerId, { id: pid }).add(p, Membership, { partyId: 0, clanId: 0 }); names.set(pid, name); return p; };
  const me = mk(7, "Ada"); const sent: G.MenuIntent[] = [];
  const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, gameplay: { ctx: () => ({ world: w, player: me, names }), send: (i) => { sent.push(i); return true; } } });
  return { w, me, mk, sent, menus };
}
const q = (sel: string): HTMLElement => { const e = document.querySelector<HTMLElement>(sel); if (!e) throw new Error(`missing ${sel}`); return e; };

beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false }); });

describe("animal skill panels (Task 15)", () => {
  test("a pet panel shows its skill tree and spending a node sends the animalSkill intent", () => {
    const { w, me, sent, menus } = setup();
    const dog = G.spawnAnimal(w, "animal_dog_dachshund", 1, 0);
    G.makePet(w, dog, me);
    menus.openPet(dog);
    const skills = q("[data-role=animal-skills]");
    expect(document.querySelector("[data-menu=pet]")!.textContent).toContain("Skills · Lv 1 · 1 point"); // heading above the grid
    expect(skills.textContent).toContain("Bite");
    const bite = q("[data-key=skill-0]");
    expect(bite.textContent).toContain("Bite");
    bite.click();
    expect(sent.at(-1)).toMatchObject({ cmd: G.AnimalSkillCmd, args: { animal: dog, node: 0 } });
    menus.destroy();
  });

  test("an owned farm animal panel shows only status + skills (no pet commands, no bag)", () => {
    const { w, me, menus } = setup();
    const cow = G.spawnAnimal(w, "animal_cow", 1, 0);
    const kind = w.get(cow, G.Animal)!.kind;
    w.add(cow, G.Tamed, { kind, owner: me, fedUntil: w.tick + 100000, produceAt: w.tick, breedAt: w.tick });
    G.ensureAnimalSkills(w, cow);
    menus.openPet(cow);
    expect(q("[data-role=animal-skills]").textContent).toContain("Milk Production");
    expect(document.querySelector("[data-key=pet-follow]")).toBeNull();
    expect(document.querySelector("[data-key=pet-guard-here]")).toBeNull();
    menus.destroy();
    void id;
  });
});
