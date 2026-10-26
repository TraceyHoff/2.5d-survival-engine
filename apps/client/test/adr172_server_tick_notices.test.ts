// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { installPermissions, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";

describe("ADR-172: replica timers use the server tick; chat / invite notices", () => {
  test("partyView expiry and seconds left follow MenuCtx.tick, not the replica's world.tick", () => {
    const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w);
    const me = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 1 });
    w.add(me, G.PartyInvitePending, { party: 7, from: 2, expiresTick: 50_000 + 1200 });
    expect(G.partyView({ world: w, player: me, tick: 50_000 }).invite?.secondsLeft).toBe(60); // replica world.tick is ~0: would read ~2560 s
    expect(G.partyView({ world: w, player: me, tick: 51_300 }).invite).toBeUndefined(); // expired on the server: hidden
    expect(G.ctxTick({ world: w, player: me })).toBe(w.tick);
  });
  test("chat lines from others badge the chat button until it opens; party badge set/cleared", () => {
    const root = document.createElement("div"); document.body.append(root);
    const m = new GameMenus({ root } as never);
    m.pushChat("[Local] Eve: hi", 1, true); m.pushChat("[Local] me: yo", 1, false); m.pushChat("[Local] Eve: again", 1, true);
    expect(root.querySelector<HTMLElement>('[data-open="chat"]')?.dataset["badge"]).toBe("2");
    expect(root.querySelector<HTMLElement>('[data-open="more"]')?.dataset["badge"]).toBe("•");
    m.open("chat"); expect(root.querySelector<HTMLElement>('[data-open="chat"]')?.dataset["badge"]).toBeUndefined();
    m.setBadge("party", 1); expect(root.querySelector<HTMLElement>('[data-open="party"]')?.dataset["badge"]).toBe("1");
    m.setBadge("party", 0); expect(root.querySelector<HTMLElement>('[data-open="party"]')?.dataset["badge"]).toBeUndefined();
  });
});
