import { describe, it, expect } from "vitest";
import { World, InputState } from "@engine/core";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { InputSystem, KeyboardMouseDevice, GamepadDevice, DEFAULT_ACTIONS, DEFAULT_CONTEXTS, DEFAULT_PROFILES, EDGE_ACTIONS } from "@engine/input";
import { GAMEPLAY_EDGES, GameplayEdgeBits, SIM_EDGE_ACTIONS, edgeCommands, EquipCmd, ReloadCmd, Equipment, WeaponState, addItem, itemIdSafe, listSlots } from "@engine/gameplay";
import { createGameServer } from "@engine/server";
import { applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "@engine/server/protocol";
import { CLIENT_FRAME_MAPPING, gateEdges, SIM_EDGE_MASK } from "../src/frame-mapping.js";

const edgeSet = new Set<string>(EDGE_ACTIONS);
const boundEdges = (): string[] => [...new Set(DEFAULT_PROFILES.flatMap((p) => Object.values(p.bindings).flat().map((b) => (b as { action: string }).action).filter((a) => edgeSet.has(a))))];

describe("ADR-180: every edge action in the profiles reaches the sim", () => {
  it("input EDGE_ACTIONS and gameplay GAMEPLAY_EDGES agree (same bits on both ends)", () => { expect([...GAMEPLAY_EDGES]).toEqual([...EDGE_ACTIONS]); });
  it("every bound edge action has an edge bit in the client frame mapping, equal to the sim's", () => {
    const bound = boundEdges(); expect(bound.length).toBeGreaterThanOrEqual(19);
    for (const a of bound) expect([a, CLIENT_FRAME_MAPPING.edgeBits?.[a]]).toEqual([a, GameplayEdgeBits[a as "Reload"]]);
  });
  it("sim edges map to commands; the rest are documented client-only", () => {
    for (const a of SIM_EDGE_ACTIONS) expect(edgeCommands(GameplayEdgeBits[a]).length, a).toBe(1);
    expect(edgeCommands(GameplayEdgeBits.Hotbar3)).toEqual([{ def: EquipCmd, values: { slot: 2 } }]);
    expect(edgeCommands(GameplayEdgeBits.Reload)).toEqual([{ def: ReloadCmd, values: {} }]);
    for (const a of GAMEPLAY_EDGES.filter((x) => !(SIM_EDGE_ACTIONS as readonly string[]).includes(x))) expect(edgeCommands(GameplayEdgeBits[a]), a).toEqual([]);
  });
  it("sim edges are stripped outside plain gameplay (menus / build / tools), UI edges kept", () => {
    const r = GameplayEdgeBits.Reload | GameplayEdgeBits.ToggleMap;
    expect(gateEdges(r, true)).toBe(r); expect(gateEdges(r, false)).toBe(GameplayEdgeBits.ToggleMap); expect(gateEdges(GameplayEdgeBits.Hotbar1, false)).toBeUndefined();
    expect(SIM_EDGE_MASK & GameplayEdgeBits.Jump).toBe(0);
  });

  it("end to end: keyboard 1-8 / R and gamepad D-pad / Y equip and reload on the authoritative server", async () => {
    let now = 0; const sys = new InputSystem({ now: () => now } as never, { actions: DEFAULT_ACTIONS, contexts: DEFAULT_CONTEXTS, profiles: DEFAULT_PROFILES });
    const kbm = new KeyboardMouseDevice(); const pad = new GamepadDevice(0); sys.addDevice(kbm); sys.addDevice(pad); sys.push("Gameplay");
    const st = new InputState();
    const net = new LoopbackNetwork(5);
    const gs = createGameServer({ transport: net.createServer(), seed: 77 });
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS,
      sampleInput: () => { now += 50; sys.update(); sys.writeFrame(st, CLIENT_FRAME_MAPPING); const { tick: _t, commands: _c, actions, ...rest } = st.sample(world.tick); return { buttons: actions, ...rest }; },
      applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd, 1 / 20) });
    const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); c.world.step(1 / 20); c.pollEvents(Infinity); } };
    const tap = (down: () => void, up: () => void): void => { down(); tick(2); up(); tick(6); };
    const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; tick(4);
    const e = gs.players.get(c.clientId)!.entity; const gun = itemIdSafe(gs.world, "semi_auto_pistol")!;
    addItem(gs.world, e, gun, 1); addItem(gs.world, e, itemIdSafe(gs.world, "pistol_round")!, 24);
    const slots = listSlots(gs.world, e); const gunSlot = slots.find((s) => s.item === gun)!.slot; const other = slots.find((s) => s.slot < 4 && s.item !== gun)!.slot;
    expect(gunSlot).toBeLessThan(8);
    // keyboard: digit equips the gun, R reloads it
    tap(() => kbm.press(`key.Digit${gunSlot + 1}`), () => kbm.release(`key.Digit${gunSlot + 1}`));
    expect(gs.world.get(e, Equipment)!.mainHandSlot).toBe(gunSlot);
    tap(() => kbm.press("key.KeyR"), () => kbm.release("key.KeyR")); tick(60);
    expect(gs.world.get(e, WeaponState)!.loaded).toBe(12);
    // gamepad: D-pad equips another slot (exactly once: no toggle back), then back to the gun and Y reloads after a shot-free unload
    const dpad = ["pad.dup", "pad.dright", "pad.ddown", "pad.dleft"][other]!;
    tap(() => pad.set(dpad, 1), () => pad.set(dpad, 0)); expect(gs.world.get(e, Equipment)!.mainHandSlot).toBe(other);
    const gdp = gunSlot < 4 ? ["pad.dup", "pad.dright", "pad.ddown", "pad.dleft"][gunSlot]! : undefined;
    if (gdp) { tap(() => pad.set(gdp, 1), () => pad.set(gdp, 0)); } else { pad.set("pad.lb", 1); tick(1); const d = ["pad.dup", "pad.dright", "pad.ddown", "pad.dleft"][gunSlot - 4]!; tap(() => pad.set(d, 1), () => pad.set(d, 0)); pad.set("pad.lb", 0); tick(2); }
    expect(gs.world.get(e, Equipment)!.mainHandSlot).toBe(gunSlot);
    expect(gs.world.get(e, WeaponState)!.loaded).toBe(0); // switching returned the rounds
    tap(() => pad.set("pad.y", 1), () => pad.set("pad.y", 0)); tick(60);
    expect(gs.world.get(e, WeaponState)!.loaded).toBe(12);
  }, 30_000);
});
