import { AimMode } from "@engine/core";
import type { Device, DeviceClass } from "./devices.js";
import type { InputSystem } from "./system.js";

export interface AimTarget { x: number; y: number; mode: AimMode }
export interface HookContext { device: DeviceClass; activeDevice: Device | undefined }
/**
 * Gameplay-implemented, device-aware hooks (W = world type, E = entity type). All optional.
 *  - autoTarget: touch (and optionally gamepad) target selection near the aim.
 *  - aimAssist: gamepad only (never called for mouse): bend the stick direction toward targets.
 *  - contextAction: label for the single touch context button (what Interact would do now).
 *  - ghostSnap: snap a building ghost to a socket within a finger radius (tiles).
 *  - holdCancel: notified when a held touch button is dragged off (no action fires).
 */
export interface GameplayInputHooks<W = unknown, E = number> {
  autoTarget?(world: W, actor: E, aim: AimTarget, ctx: HookContext): { x: number; y: number } | undefined;
  aimAssist?(world: W, actor: E, dir: { x: number; y: number }, ctx: HookContext & { device: "gamepad" }): { x: number; y: number };
  contextAction?(world: W, actor: E, ctx: HookContext): { action: string; label: string; glyph?: string } | undefined;
  ghostSnap?(world: W, actor: E, pos: { x: number; y: number }, radiusTiles: number, ctx: HookContext): { x: number; y: number; rot?: number } | undefined;
  holdCancel?(action: string, ctx: HookContext): void;
}
export type ScreenToWorld = (sx: number, sy: number) => { x: number; y: number };

/**
 * Unifies aim into a world-space target. Mouse: cursor -> world point via injected iso screenToWorld.
 * Gamepad: right-stick direction (+ aimAssist), last direction kept when released. Touch: tap target or autoTarget.
 */
export class AimResolver<W = unknown, E = number> {
  private lastDir = { x: 1, y: 0 }; private touchTarget: { x: number; y: number } | undefined;
  /**
   * @param opts.dirToWorld ADR-253: maps a screen-space stick direction to a world direction (the client passes the
   * camera-view-aware iso map). Omitted: the direction is returned as read (legacy).
   */
  constructor(private input: InputSystem, private opts: { screenToWorld?: ScreenToWorld; hooks?: GameplayInputHooks<W, E>; aimAction?: string; moveAction?: string; dirToWorld?: (x: number, y: number) => { x: number; y: number } } = {}) {}
  /** Touch: tap-to-target (world point). */
  setTouchTarget(p: { x: number; y: number } | undefined): void { this.touchTarget = p; }
  resolve(world: W, actor: E, actorPos: { x: number; y: number }): AimTarget {
    const dev = this.input.activeDevice; const cls = dev?.deviceClass ?? "keyboardMouse"; const ctx: HookContext = { device: cls, activeDevice: dev };
    const aim = this.input.vector(this.opts.aimAction ?? "Aim"), move = this.input.vector(this.opts.moveAction ?? "Move");
    if (cls === "keyboardMouse" && dev && this.opts.screenToWorld) { const p = this.opts.screenToWorld(dev.read("mouse.x"), dev.read("mouse.y")); return { x: p.x, y: p.y, mode: AimMode.WorldPoint }; }
    if (cls === "touch") {
      if (this.touchTarget) return { ...this.touchTarget, mode: AimMode.WorldPoint };
      const dir = Math.hypot(aim[0], aim[1]) > 0.1 ? aim : move; if (Math.hypot(dir[0], dir[1]) > 0.1) this.lastDir = this.world(dir[0], dir[1]);
      const t = this.opts.hooks?.autoTarget?.(world, actor, { ...this.lastDir, mode: AimMode.Direction }, ctx);
      return t ? { ...t, mode: AimMode.WorldPoint } : { ...this.lastDir, mode: AimMode.Direction };
    }
    const dir = Math.hypot(aim[0], aim[1]) > 0.05 ? aim : Math.hypot(move[0], move[1]) > 0.05 ? move : undefined;
    if (dir) this.lastDir = this.world(dir[0], dir[1]);
    let d = this.lastDir; if (cls === "gamepad" && this.opts.hooks?.aimAssist) d = norm(...vec(this.opts.hooks.aimAssist(world, actor, d, { ...ctx, device: "gamepad" })));
    void actorPos; return { x: d.x, y: d.y, mode: AimMode.Direction };
  }
  private world(x: number, y: number): { x: number; y: number } { const f = this.opts.dirToWorld; if (!f) return norm(x, y); const w = f(x, y); return norm(w.x, w.y); }
  contextAction(world: W, actor: E): ReturnType<NonNullable<GameplayInputHooks<W, E>["contextAction"]>> {
    const dev = this.input.activeDevice; return this.opts.hooks?.contextAction?.(world, actor, { device: dev?.deviceClass ?? "keyboardMouse", activeDevice: dev });
  }
}
const vec = (p: { x: number; y: number }): [number, number] => [p.x, p.y];
const norm = (x: number, y: number) => { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; };

/**
 * Touch building placement: the ghost floats `liftPx` above the finger, snaps via ghostSnap within `snapRadius`
 * tiles, rotates with the rotate gesture/button, and is only placed on an explicit confirm (never on release).
 */
export class TouchGhostController<W = unknown, E = number> {
  ghost: { x: number; y: number; rot: number } | undefined; dragging = false;
  constructor(private screenToWorld: ScreenToWorld, private hooks: GameplayInputHooks<W, E> = {}, private opts: { liftPx?: number; snapRadius?: number } = {}) {}
  drag(world: W, actor: E, sx: number, sy: number, ctx: HookContext): void {
    this.dragging = true; const p = this.screenToWorld(sx, sy - (this.opts.liftPx ?? 64));
    const s = this.hooks.ghostSnap?.(world, actor, p, this.opts.snapRadius ?? 0.75, ctx);
    this.ghost = { x: s?.x ?? p.x, y: s?.y ?? p.y, rot: s?.rot ?? this.ghost?.rot ?? 0 };
  }
  release(): void { this.dragging = false; } // ghost stays; no placement
  rotate(steps: number): void { if (this.ghost) this.ghost.rot = (((this.ghost.rot + steps) % 4) + 4) % 4; }
  /** Returns the placement to send as a command (caller sends gameplay's PlaceCmd), or undefined if no ghost. */
  confirm(): { x: number; y: number; rot: number } | undefined { const g = this.ghost; return g ? { ...g } : undefined; }
  cancel(): void { this.ghost = undefined; this.dragging = false; }
}
