// @vitest-environment jsdom
import { expect, test } from "vitest";
import { World, type Entity } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";

test("ADR-143: opening a stall asks the server to add this client as a viewer (buyer needs Listings + stock)", () => {
  document.body.innerHTML = `<div id="game-root"></div>`;
  const w = new World(); const sent: G.MenuIntent[] = [];
  const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, gameplay: { ctx: () => ({ world: w, player: 1 as Entity, names: new Map() }) as never, send: (i) => { sent.push(i); return true; } } });
  menus.openStall(42);
  expect(sent.some((i) => i.cmd === G.OpenStallCmd && i.args["stall"] === 42)).toBe(true);
});
