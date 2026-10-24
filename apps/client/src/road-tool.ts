/**
 * ADR-122 road tool state machine (pure; DOM/input wiring lives in world-tools.ts).
 * - surface: 0 = off, 1..N = ROADS.surfaces index + 1. `cycle()` steps off -> path -> gravel -> paved -> off.
 * - Mouse/keyboard: drag (pointer down -> up) sends immediately (unchanged from ADR-119).
 * - Touch: a drag (or tap start, tap end) leaves a *pending* line with Confirm / Cancel; nothing is sent until Confirm.
 * - Gamepad: a tile cursor moved by the right stick (`nudge`); A marks the start, A again (or RT) marks the end and
 *   leaves a pending line; RT / A confirms, B cancels the pending line (B again leaves the tool), Y cycles the surface.
 */
import { roadLine } from "@engine/gameplay";

export interface Tile { x: number; y: number }
export interface RoadLine { a: Tile; b: Tile }
export type RoadDevice = "keyboardMouse" | "gamepad" | "touch";
/** Gamepad cursor speed in tiles / second at full stick deflection. */
export const ROAD_CURSOR_SPEED = 8;

export class RoadTool {
  surface = 0;
  /** Start tile of an in-progress mark/drag. */
  start: Tile | undefined;
  /** Line waiting for Confirm / Cancel (touch and gamepad). */
  pending: RoadLine | undefined;
  /** Gamepad cursor in world tiles (fractional); undefined until first placed. */
  cursor: { x: number; y: number } | undefined;
  constructor(readonly surfaces: number) {}
  get active(): boolean { return this.surface > 0; }
  cycle(): number { this.surface = (this.surface + 1) % (this.surfaces + 1); if (!this.surface) this.reset(); return this.surface; }
  select(surface: number): void { this.surface = Math.max(0, Math.min(this.surfaces, Math.floor(surface))); if (!this.surface) this.reset(); }
  off(): void { this.surface = 0; this.reset(); }
  reset(): void { this.start = undefined; this.pending = undefined; this.cursor = undefined; }
  /** Pointer down (mouse or touch). */
  down(t: Tile | undefined): void { if (!this.active || !t || this.pending) return; this.start = t; }
  /** Pointer up; returns a line to send now (mouse) or undefined (touch keeps it pending). */
  up(t: Tile | undefined, device: RoadDevice): RoadLine | undefined {
    const a = this.start; this.start = undefined; if (!this.active || !a || !t) return undefined;
    if (device === "touch") { this.pending = { a, b: t }; return undefined; }
    return { a, b: t };
  }
  /** Move the gamepad cursor by a stick vector over dt seconds; seeds at `seed` (player tile) when unset. */
  nudge(v: readonly [number, number], dt: number, seed: Tile): Tile {
    const c = this.cursor ?? { x: seed.x + 0.5, y: seed.y + 0.5 };
    // isometric: stick right = screen right = (+x, -y), stick down = screen down = (+x, +y)
    const sx = v[0], sy = v[1]; const k = ROAD_CURSOR_SPEED * dt / Math.SQRT2;
    c.x += (sx + sy) * k; c.y += (sy - sx) * k; this.cursor = c;
    return this.cursorTile()!;
  }
  cursorTile(): Tile | undefined { return this.cursor ? { x: Math.floor(this.cursor.x), y: Math.floor(this.cursor.y) } : undefined; }
  /** Gamepad A: mark start, then mark end (-> pending), then confirm. Returns a line to send when confirmed. */
  mark(): RoadLine | undefined {
    const t = this.cursorTile(); if (!this.active || !t) return undefined;
    if (this.pending) return this.confirm();
    if (!this.start) { this.start = t; return undefined; }
    this.pending = { a: this.start, b: t }; this.start = undefined; return undefined;
  }
  /** Confirm the pending line (or, on gamepad, the start -> cursor line). */
  confirm(): RoadLine | undefined {
    const p = this.pending ?? (this.start && this.cursorTile() ? { a: this.start, b: this.cursorTile()! } : undefined);
    this.pending = undefined; this.start = undefined; return this.active ? p : undefined;
  }
  /** Cancel: drops the pending line / start mark; with nothing pending turns the tool off. Returns true if the tool is now off. */
  cancel(): boolean { if (this.pending || this.start) { this.pending = undefined; this.start = undefined; return false; } this.off(); return true; }
  /** The line to preview: pending, else start -> live end. */
  preview(live: Tile | undefined): RoadLine | undefined { return this.pending ?? (this.start && live ? { a: this.start, b: live } : undefined); }
}
/** Preview tiles: exactly the server walk (@engine/gameplay roadLine, capped at maxDragTiles). */
export function lineTiles(l: RoadLine): Tile[] { return roadLine(l.a.x, l.a.y, l.b.x, l.b.y).map(([x, y]) => ({ x, y })); }
