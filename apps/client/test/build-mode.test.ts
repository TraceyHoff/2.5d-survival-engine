// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { installPermissions, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { BuildMode } from "../src/build-mode.js";
import { morph } from "../src/ui-diff.js";

describe("BuildMode", () => {
  test("start pushes Building, rotates, previews at aim, places only when valid, cancels", () => {
    const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w);
    const me = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 1 }); const d = G.gameplayDefs(w);
    const piece = [...d.pieces.values()].find((x) => x.placement === G.Placement.Cell && !x.tiered) ?? [...d.pieces.values()].find((x) => x.placement === G.Placement.Cell)!;
    const down = new Set<string>(); const stack: string[] = []; const sent: G.MenuIntent[] = []; const active: boolean[] = [];
    const bm = new BuildMode({ input: { pressed: (a) => down.has(a), push: (c) => stack.push(c), pop: () => void stack.pop() },
      ctx: () => ({ world: w, player: me, names: new Map() }), aim: () => ({ x: 2, y: 1, mode: 1 }), send: (i) => { sent.push(i); return true; }, onActiveChange: (a) => active.push(a) });
    bm.start({ piece: piece.id, tier: 0, variant: 0, paint: 0 });
    expect(stack).toEqual(["Building"]); expect(active).toEqual([true]); expect(bm.preview?.pieceKey).toBe(piece.key);
    expect(bm.preview?.request).toMatchObject({ x: 2, y: 1, rot: 0 }); expect(typeof bm.preview?.z).toBe("number");
    down.add("Build.RotateCW"); bm.update(); down.clear(); expect(bm.preview?.request.rot).toBe(1);
    down.add("Build.RotateCCW"); bm.update(); bm.update(); down.clear(); expect(bm.preview?.request.rot).toBe(3);
    down.add("Build.PlaceConfirm"); bm.update(); down.clear();
    expect(sent.length).toBe(bm.preview!.valid ? 1 : 0);
    down.add("Build.Cancel"); bm.update(); expect(bm.active).toBe(false); expect(bm.preview).toBeUndefined(); expect(stack).toEqual([]); expect(active).toEqual([true, false]);
  });
});

describe("morph (panel diff refresh)", () => {
  test("unchanged → 0 mutations; changes patch in place and keep focus and input values", () => {
    const mk = (t: string) => { const d = document.createElement("div"); d.innerHTML = `<button data-key="a">${t}</button><input data-key="i">`; return d; };
    const dst = mk("one"); document.body.append(dst); const btn = dst.querySelector("button")!; const inp = dst.querySelector("input")!;
    inp.value = "typed"; inp.focus();
    expect(morph(dst, mk("one"))).toBe(0);
    expect(morph(dst, mk("two"))).toBeGreaterThan(0);
    expect(dst.querySelector("button")).toBe(btn); expect(btn.textContent).toBe("two");
    expect(document.activeElement).toBe(inp); expect(inp.value).toBe("typed");
  });
});
