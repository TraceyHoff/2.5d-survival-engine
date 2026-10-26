// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { installPermissions, Membership, PlayerId, World, type Entity } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";
import { NAME_TAG, nameTagPoints } from "../src/name-tags.js";

const cam = { x: 0, y: 0, viewW: 1920, viewH: 1080, dpr: 1, drawZoom: 1, cssToWorld: (x: number, y: number) => ({ x, y }) };
const setM = (w: World, e: Entity, partyId: number, clanId: number): void => { if (w.has(e, Membership)) { w.setField(e, Membership, "partyId", partyId); w.setField(e, Membership, "clanId", clanId); } else w.add(e, Membership, { partyId, clanId }); };

describe("ADR-173: name tags over other players", () => {
  const setup = () => {
    const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w);
    const mk = (id: number, x: number, y: number) => { const e = G.spawnPlayer(w, { x, y, maxWeight: 0, clientId: id }); if (!w.has(e, PlayerId)) w.add(e, PlayerId, { id }); return e; }; // the server stamps PlayerId
    const me = mk(1, 0, 0), near = mk(2, 2, 0), mid = mk(3, 15, 0), far = mk(4, NAME_TAG.range + 3, 0), clan = mk(5, 0, 3);
    const ids = new Map<number, string>(); for (const e of [me, near, mid, far, clan]) { const id = w.getField(e, PlayerId, "id")!; ids.set(id, `P${id}`); }
    return { w, me, near, mid, far, clan, names: { get: (id: number) => ids.get(id) } };
  };
  test("self hidden, range cut-off, distance fade, screen-depth order (ADR-185)", () => {
    const { w, me, names } = setup(); const pts = nameTagPoints(w, me, cam, names);
    expect(pts.map((p) => p.y)).toEqual([...pts.map((p) => p.y)].sort((a, b) => a - b));
    expect(pts.some((p) => p.e === me)).toBe(false); expect(pts.length).toBe(3); // far one culled
    const byDist = [...pts].sort((a, b) => a.dist - b.dist); expect(byDist[0]!.alpha).toBe(1); expect(byDist.at(-1)!.alpha).toBeLessThan(1); expect(byDist.at(-1)!.alpha).toBeGreaterThanOrEqual(NAME_TAG.minAlpha);
  });
  test("party green, clan blue, dead and nameless hidden", () => {
    const { w, me, near, mid, clan, names } = setup();
    setM(w, me, 9, 4); setM(w, near, 9, 0); setM(w, clan, 0, 4); setM(w, mid, 0, 0);
    const kinds = new Map(nameTagPoints(w, me, cam, names).map((p) => [p.e, p.kind]));
    expect(kinds.get(near)).toBe("party"); expect(kinds.get(clan)).toBe("clan"); expect(kinds.get(mid)).toBe("other");
    w.add(mid, G.Dead, {} as never); expect(nameTagPoints(w, me, cam, names).some((p) => p.e === mid)).toBe(false);
    expect(nameTagPoints(w, me, cam, { get: () => undefined })).toEqual([]);
  });
  test("settings toggle 'Show player names' saves nameTags", () => {
    const root = document.createElement("div"); document.body.append(root); const m = new GameMenus({ root } as never); m.open("settings");
    const box = root.querySelector<HTMLInputElement>('[data-key="name-tags"]'); expect(box).toBeTruthy(); expect(box!.checked).toBe(true);
  });
});
