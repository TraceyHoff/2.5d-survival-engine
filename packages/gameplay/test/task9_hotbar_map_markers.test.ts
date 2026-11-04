// Separate hotbar (16 pack + 8 hotbar), world-map markers, and the compass.
import { describe, it, expect } from "vitest";
import { CommandRegistry, GroupKind, GroupRole, installCommandHandlers, installPermissions, Membership, Owner, Permissions, PlayerId, Transform } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

const d = G.defaultDefs(); const id = (k: string) => d.itemId(k);
const player = (w: ReturnType<typeof makeWorld>, pid: number, clientId: number): number => {
  const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId });
  w.add(p, PlayerId, { id: pid }); return p as unknown as number;
};

describe("separate hotbar", () => {
  it("inventory is 24 slots: 16 pack + 8 hotbar, and gathering lands in the pack, never the hotbar", () => {
    const w = makeWorld(); installPermissions(w); const p = player(w, 1, 1);
    expect(G.INVENTORY_SLOTS).toBe(24); expect(G.PACK_SLOTS).toBe(16); expect(G.HOTBAR_OFFSET).toBe(16);
    const v = G.readSlots(w, p as never); expect(v.slotCount).toBe(24); expect(v.addLimit).toBe(16);
    G.addItem(w, p as never, id("wood"), 10);
    const v2 = G.readSlots(w, p as never); expect(v2.item(0)).toBe(id("wood")); expect(v2.item(16)).toBe(0);
    // fill the whole pack with non-stackable axes, then a new item must fail even though the hotbar is empty
    for (let i = 0; i < 15; i++) G.addItem(w, p as never, id("iron_axe"), 1);
    expect(G.canAddItem(w, p as never, id("stone"), 1)).toBe(0);
    expect(G.readSlots(w, p as never).item(16)).toBe(0);
  });
  it("a split lands in the pack, not the hotbar", () => {
    const w = makeWorld(); installPermissions(w); const p = player(w, 1, 1);
    G.addItem(w, p as never, id("wood"), 10);
    const v = G.readSlots(w, p as never); const to = G.checkSplit(v, 0, 4); expect("to" in to && to.to).toBeLessThan(16);
  });
  it("hotbar keys equip hotbar slots (16..23)", () => {
    const w = makeWorld(); installPermissions(w); const p = player(w, 1, 1);
    const cmds = G.edgeCommands(G.GameplayEdgeBits.Hotbar1);
    expect(cmds[0]!.values.slot).toBe(16);
    expect(G.edgeCommands(G.GameplayEdgeBits.Hotbar8)[0]!.values.slot).toBe(23);
  });
});

describe("world-map markers", () => {
  function setup() {
    const w = makeWorld(); installPermissions(w);
    const reg = G.registerGameplayCommands(new CommandRegistry()); const h = installCommandHandlers(w, reg); G.installMapMarkerCommands(w, h);
    const p1 = player(w, 1, 11), p2 = player(w, 2, 12), p3 = player(w, 3, 13);
    return { w, h, reg, p1, p2, p3 };
  }
  it("private markers are visible only to their owner", () => {
    const { w, p1, p2 } = setup();
    const m = G.placeMarker(w, p1 as never, 10, 20, 0, "Home");
    expect(typeof m).not.toBe("string");
    expect(G.visibleMarkers(w, p1 as never).map((x) => x.label)).toEqual(["Home"]);
    expect(G.visibleMarkers(w, p2 as never)).toEqual([]);
    expect(G.markerScope(w, m as never, 12)).toBe(false); // a non-owner client never passes the scope for a private marker
  });
  it("party markers show to current and future party members, and stop showing after leaving", () => {
    const { w, p1, p2, p3 } = setup();
    // p1 places a party marker while in no party -> rejected
    expect(G.placeMarker(w, p1 as never, 1, 1, 1, "Camp")).toBe("no_party");
    const groups = w.resource(Permissions).groups;
    const party = groups.create(GroupKind.Party, 1); groups.addMember(party.id, 2, GroupRole.Member);
    const m = G.placeMarker(w, p1 as never, 5, 6, 1, "Camp");
    expect(typeof m).not.toBe("string");
    expect(G.visibleMarkers(w, p2 as never).map((x) => x.label)).toEqual(["Camp"]);
    expect(G.visibleMarkers(w, p3 as never)).toEqual([]);
    // future member: p3 joins the party and sees the existing marker
    groups.addMember(party.id, 3, GroupRole.Member);
    expect(G.visibleMarkers(w, p3 as never).map((x) => x.label)).toEqual(["Camp"]);
    // leaving hides it again
    groups.removeMember(party.id, 3);
    expect(G.visibleMarkers(w, p3 as never)).toEqual([]);
  });
  it("clan markers show only to same-clan members", () => {
    const { w, p1, p2 } = setup();
    expect(G.placeMarker(w, p1 as never, 1, 1, 2, "Base")).toBe("no_clan");
    const groups = w.resource(Permissions).groups;
    const clan = groups.create(GroupKind.Clan, 1); groups.addMember(clan.id, 2, GroupRole.Member);
    G.placeMarker(w, p1 as never, 7, 8, 2, "Base");
    expect(G.visibleMarkers(w, p2 as never).map((x) => x.label)).toEqual(["Base"]);
  });
  it("only the owner can remove a marker, and bad visibility / coords are rejected", () => {
    const { w, p1, p2 } = setup();
    const m = G.placeMarker(w, p1 as never, 2, 3, 0, "Spot");
    expect(G.removeMarker(w, p2 as never, m as never)).toBe("not_owner");
    expect(G.removeMarker(w, p1 as never, m as never)).toBeUndefined();
    expect(G.visibleMarkers(w, p1 as never)).toEqual([]);
    expect(G.placeMarker(w, p1 as never, 1, 1, 9, "X")).toBe("bad_visibility");
    expect(G.placeMarker(w, p1 as never, NaN, 1, 0, "X")).toBe("bad_coords");
  });
  it("marker labels are sanitized and capped", () => {
    const { w, p1 } = setup();
    const m = G.placeMarker(w, p1 as never, 1, 2, 0, "  A very long marker name that keeps going and going  ");
    expect(G.markerLabel(w, m as never).length).toBeLessThanOrEqual(G.MAP_MARKER_LABEL_MAX);
    expect(G.markerLabel(w, m as never)).toBe("A very long marker name");
  });
});

describe("compass", () => {
  it("maps world facing to north-up headings", () => {
    expect(G.compassHeading(0)).toBeCloseTo(90, 5); // east
    expect(G.compassHeading(Math.PI / 2)).toBeCloseTo(180, 5); // south
    expect(G.compassHeading(-Math.PI / 2)).toBeCloseTo(0, 5); // north
    expect(G.compassHeading(Math.PI)).toBeCloseTo(270, 5); // west
    expect(G.compassDir(0)).toBe("N"); expect(G.compassDir(45)).toBe("NE"); expect(G.compassDir(180)).toBe("S"); expect(G.compassDir(315)).toBe("NW");
  });
});
