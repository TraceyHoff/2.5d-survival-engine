/**
 * Slice 7: input hooks and touch helpers (browser-safe, no @engine/input import; bit orders mirror its defaults and are
 * asserted in tests). Tuning: data/input.json.
 *  - GameplayHoldBits = GameplayActions + Crouch, Charge (input DefaultHoldBits); GameplayEdgeBits = input EDGE_ACTIONS order.
 *  - applyGameplayInput: analog move (|moveX,moveY| > moveDeadzone) also counts as moving; Hotbar1..N edges queue EquipCmd(slot).
 *  - addInputHook(world, hook): extra per-frame handlers (mods / new actions via extendGameplayActions), run on both peers
 *    in the input phase after the defaults; they should only queue commands (queueCommand), not write components.
 *  - Touch: contextCommandFor (what the context button does for a target), pickContextTarget (nearest actionable entity
 *    around a world point via SpatialIndex), touchPickRadiusTiles, touchGhostPoint (ghost offset away from the finger).
 */
import { defineActions, defineResource, extendActions, Transform, type CommandDef, type CommandRegistry, type Entity, type InputFrame, type World } from "@engine/core";
import { installSpatialIndex } from "@engine/world";
import inputRaw from "../data/input.json";
import { BuildPiece, Container, Dead, DoorState, Fuel, Health, LootBag, ResourceNode } from "./components.js";

export interface InputTuning { moveDeadzone: number; hotbarSlots: number; touchPickRadiusDp: number; touchGhostOffsetTiles: number }
export const INPUT: Readonly<InputTuning> = inputRaw;

const HOLD = ["MoveUp", "MoveDown", "MoveLeft", "MoveRight", "Sprint", "Primary", "Secondary", "Interact", "Build"] as const;
export const GameplayHoldBits = extendActions(defineActions(HOLD), ["Crouch", "Charge"] as const);
export const GAMEPLAY_EDGES = ["Jump", "Reload", "Hotbar1", "Hotbar2", "Hotbar3", "Hotbar4", "Hotbar5", "Hotbar6", "Hotbar7", "Hotbar8",
  "HotbarNext", "HotbarPrev", "QuickUse", "ToggleInventory", "ToggleCrafting", "ToggleMap", "OpenChat", "OpenSocial", "Cancel",
  "Carry", "Rest"] as const; // ADR-244 (append-only): pick up / drop, sleep / wake (server stance hook, no input-queue command)
export const GameplayEdgeBits = defineActions(GAMEPLAY_EDGES);
/** Append-only extension for new hold actions (keeps existing bits). */
export const extendGameplayActions = <const K extends string>(names: readonly K[]) => extendActions(GameplayHoldBits, names);

export const analogMoving = (f: InputFrame | null): boolean =>
  !!f && f.moveX !== undefined && f.moveY !== undefined && Math.hypot(f.moveX, f.moveY) > INPUT.moveDeadzone;
/** Hotbar slot (0-based) for an edge mask, or -1. Lowest pressed hotbar wins. */
export function hotbarSlotFromEdges(edges: number): number {
  for (let i = 0; i < Math.min(8, INPUT.hotbarSlots); i++) if (edges & GameplayEdgeBits[`Hotbar${i + 1}` as "Hotbar1"]) return i;
  return -1;
}

export interface GameplayInputHook { readonly name: string; onFrame(world: World, e: Entity, frame: InputFrame, reg: CommandRegistry): void }
export const InputHooksRes = defineResource<GameplayInputHook[]>("gameplay.InputHooks");
export function addInputHook(world: World, hook: GameplayInputHook): void {
  let hs = world.getResource(InputHooksRes); if (!hs) world.setResource(InputHooksRes, (hs = []));
  if (hs.some((h) => h.name === hook.name)) throw new Error(`duplicate input hook ${hook.name}`); hs.push(hook);
}
export function runInputHooks(world: World, e: Entity, frame: InputFrame, reg: CommandRegistry): void {
  for (const h of world.getResource(InputHooksRes) ?? []) h.onFrame(world, e, frame, reg);
}

/** Command names the context (tap / Interact) button issues for a target; caller builds it with its registry. */
export interface ContextCommand { def: CommandDef; values: Record<string, number> }
export function contextCommandFor(world: World, player: Entity, target: Entity, defs: { open: CommandDef; gather: CommandDef; door: CommandDef; fire: CommandDef; attack: CommandDef }): ContextCommand | undefined {
  if (!world.isAlive(target) || target === player) return undefined;
  const t = { target };
  if (world.has(target, LootBag) || world.has(target, Container)) return { def: defs.open, values: t };
  if (world.has(target, ResourceNode)) return { def: defs.gather, values: t };
  if (world.has(target, DoorState)) return { def: defs.door, values: t };
  if (world.has(target, Fuel)) return { def: defs.fire, values: t };
  if (world.has(target, Health) && !world.has(target, Dead) && !world.has(target, BuildPiece)) return { def: defs.attack, values: t };
  return undefined;
}
/** Nearest entity within r of (x, y) satisfying `actionable` (ties by entity id). */
export function pickContextTarget(world: World, x: number, y: number, r: number, actionable: (e: Entity) => boolean): Entity | undefined {
  const idx = installSpatialIndex(world); idx.update();
  let best: Entity | undefined; let bd = Infinity;
  for (const e of idx.queryRadius(x, y, r)) {
    if (!actionable(e)) continue; const p = world.get(e, Transform)!; const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd || (d === bd && e < best!)) { bd = d; best = e; }
  }
  return best;
}
/** Touch pick radius in tiles (>= 48dp target => radius touchPickRadiusDp). */
export const touchPickRadiusTiles = (dpr: number, tilePx: number, zoom = 1): number => (INPUT.touchPickRadiusDp * Math.max(1, dpr)) / Math.max(1e-6, tilePx * zoom);
/** Placement ghost point: offset from the finger along the aim direction (default "up" = -y) so it stays visible. */
export function touchGhostPoint(x: number, y: number, dirX = 0, dirY = -1): { x: number; y: number } {
  const m = Math.hypot(dirX, dirY) || 1; return { x: x + (dirX / m) * INPUT.touchGhostOffsetTiles, y: y + (dirY / m) * INPUT.touchGhostOffsetTiles };
}
