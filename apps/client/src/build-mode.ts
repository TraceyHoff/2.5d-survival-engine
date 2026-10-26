/**
 * Client build mode: the Build panel's "Place" starts it; it pushes the input "Building" context so the Build.* bindings
 * apply on every device, and every frame turns the aim into `preview` via @engine/gameplay buildPreviewFor
 * (snap + reach clamp + validatePlacement). The Renderer draws the ghost from `buildPreview`.
 *
 * ADR-136 (building on every platform):
 *  - keyboard+mouse: cursor aims; LMB place, RMB / R / Q rotate, wheel piece, Shift+wheel tier, PgUp/PgDn floor,
 *    H repair / U upgrade / X demolish (press twice) on the targeted piece, Esc cancel.
 *  - gamepad: right stick moves a free build cursor (relative to the player, clamped to reach, follows the player);
 *    A / RT place, RB / LB rotate, D-pad left/right piece, up/down tier, LT + up/down floor, tap X repair,
 *    tap Y upgrade, hold X demolish, B cancel.
 *  - touch: tap the world to position the ghost, drag to adjust (lifted above the finger), Confirm places;
 *    the compact HUD carries floor ▲▼ and the contextual Repair / Upgrade / Demolish buttons.
 *  - a placed piece under the aim is the `target`; `context` lists its labelled actions (shown only when targeted).
 */
import { buildPreviewFor, buildView, demolishIntent, gameplayDefs, moveVector, pieceTargetAt, placementTarget, placePreviewIntent, repairIntent, rotateStep, upgradeIntent,
  type BuildPreview, type BuildSelection, type MenuCtx, type MenuIntent, type PieceTarget, type PlacementAim } from "@engine/gameplay";
import { Transform } from "@engine/core";

export type BuildDevice = "keyboardMouse" | "gamepad" | "touch";
export interface BuildModeInput { pressed(action: string): boolean; push(context: string): void; pop(context?: string): void; vector?(action: string): readonly number[] }
export interface BuildModeOptions {
  input: BuildModeInput;
  ctx(): MenuCtx | undefined;
  /** Current aim: AimResolver.resolve() (mode 1 world point, mode 0 direction incl. last move dir). */
  aim(): PlacementAim | undefined;
  send(i: MenuIntent): boolean;
  /** Active device class (defaults to keyboardMouse). */
  device?(): BuildDevice;
  now?(): number;
  /** Called on start/stop (e.g. swap the touch layout to the "building" one with the rotate button). */
  onActiveChange?(active: boolean): void;
  /** ToggleBuild while placing (pad LB+Y): back to the piece picker. */
  onPickPiece?(): void;
}
export type BuildActionId = "repair" | "upgrade" | "demolish";
export interface BuildContextAction { id: BuildActionId; label: string; hint: string; enabled: boolean; armed?: boolean }
export interface BuildContextView { target: PieceTarget; title: string; actions: BuildContextAction[] }
/** Gamepad cursor speed (tiles/s at full stick). */
export const PAD_CURSOR_SPEED = 5;
export const DEMOLISH_CONFIRM_MS = 3000;
const HINTS: Record<BuildDevice, Record<BuildActionId, string>> = {
  keyboardMouse: { repair: "H", upgrade: "U", demolish: "X" },
  gamepad: { repair: "X", upgrade: "Y", demolish: "hold X" },
  touch: { repair: "", upgrade: "", demolish: "" },
};
const label = (k: string): string => k.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase());

export class BuildMode {
  private sel: BuildSelection | undefined; rot = 0; level = 0;
  /** Renderer contract: undefined when not placing. */
  preview: BuildPreview | undefined;
  /** Placed piece under the aim (drives the contextual menu). */
  target: PieceTarget | undefined;
  /** Gamepad cursor offset from the player (world tiles); touch point (world). */
  padOffset: { x: number; y: number } | undefined; touchPoint: { x: number; y: number } | undefined;
  private demolishArmedAt = -Infinity; private lastT: number | undefined;
  /** ADR-169: grid snap assist (Build.ToggleSnap: G / R3 / HUD "Snap" chip). On = an invalid aim snaps to the nearest valid
   * grid cell around it (facing aim + gamepad cursor; a pointed mouse cell / touch tap stays exact so a red ghost says why); off = the ghost sits exactly on the aimed cell, red when it can't be placed. */
  snap = true;
  toggleSnap(): void { this.snap = !this.snap; this.toast = this.snap ? "Snap on" : "Snap off"; this.refresh(); }
  /** Last action feedback for the HUD ("Repaired", "Press X again to demolish", ...). */
  toast = "";
  constructor(private readonly o: BuildModeOptions) {}
  get active(): boolean { return this.sel !== undefined; }
  get selection(): BuildSelection | undefined { return this.sel; }
  private now(): number { return this.o.now?.() ?? (typeof performance !== "undefined" ? performance.now() : Date.now()); }
  private device(): BuildDevice { return this.o.device?.() ?? "keyboardMouse"; }
  start(sel: BuildSelection): void {
    const was = this.active; this.sel = { ...sel };
    if (!was) { this.rot = 0; this.level = 0; this.padOffset = undefined; this.touchPoint = undefined; this.disarm(); this.o.input.push("Building"); this.o.onActiveChange?.(true); }
    this.refresh();
  }
  stop(): void { if (!this.active) return; this.sel = undefined; this.preview = undefined; this.target = undefined; this.touchPoint = undefined; this.padOffset = undefined; this.disarm(); this.o.input.pop("Building"); this.o.onActiveChange?.(false); }
  rotate(dir: 1 | -1): void { const c = this.o.ctx(); if (!this.sel || !c) return; this.rot = rotateStep(c.world, this.sel.piece, this.rot, dir); this.refresh(); }
  setLevel(dir: 1 | -1): void { const c = this.o.ctx(); if (!this.sel || !c) return; const max = gameplayDefs(c.world).building.maxLevel; this.level = Math.max(0, Math.min(max, this.level + dir)); this.disarm(); this.refresh(); }
  /** Cycle the piece (all pieces, catalog order) keeping tier when the new piece has it. */
  cyclePiece(dir: 1 | -1): void {
    const c = this.o.ctx(); if (!this.sel || !c) return; const all = buildView(c); if (!all.length) return;
    const i = all.findIndex((p) => p.id === this.sel!.piece); const next = all[(((i + dir) % all.length) + all.length) % all.length]!;
    const tier = next.tiers.some((t) => t.tier === this.sel!.tier) ? this.sel.tier : next.tiers[0]!.tier;
    this.sel = { piece: next.id, tier, variant: 0, paint: this.sel.paint }; this.rot = 0; this.refresh();
  }
  cycleTier(dir: 1 | -1): void {
    const c = this.o.ctx(); if (!this.sel || !c) return; const p = buildView(c).find((x) => x.id === this.sel!.piece); if (!p || p.tiers.length < 2) return;
    const i = p.tiers.findIndex((t) => t.tier === this.sel!.tier); this.sel = { ...this.sel, tier: p.tiers[Math.max(0, Math.min(p.tiers.length - 1, i + dir))]!.tier }; this.refresh();
  }
  /** Touch: world point under the finger (tap positions, drag adjusts). */
  setTouchPoint(p: { x: number; y: number } | undefined): void { this.touchPoint = p; this.disarm(); this.refresh(); }
  /** Place at the current preview; false when invalid / not sent. */
  place(): boolean { this.refresh(); const p = this.preview; if (!p?.valid) return false; return this.o.send(placePreviewIntent(p)); }
  private disarm(): void { this.demolishArmedAt = -Infinity; }
  get demolishArmed(): boolean { return this.now() - this.demolishArmedAt < DEMOLISH_CONFIRM_MS; }
  /** Contextual Repair / Upgrade / Demolish on the targeted piece. Demolish needs a second press unless `confirmed`. */
  act(id: BuildActionId, confirmed = false): boolean {
    this.refresh(); const t = this.target; if (!t) return false;
    if (id === "repair") { if (!t.canRepair) { this.toast = "Nothing to repair"; return false; } if (!t.canAfford.repair) { this.toast = "Can't afford repair"; return false; } this.toast = "Repairing…"; return this.o.send(repairIntent(t.entity)); }
    if (id === "upgrade") { if (!t.canUpgrade || t.nextTier === undefined) { this.toast = "Already top tier"; return false; } if (!t.canAfford.upgrade) { this.toast = `Need materials for ${label(t.nextTierKey!)}`; return false; } this.toast = `Upgrading to ${label(t.nextTierKey!)}…`; return this.o.send(upgradeIntent(t.entity, t.nextTier)); }
    if (!confirmed && !this.demolishArmed) { this.demolishArmedAt = this.now(); this.toast = "Demolish? Press again to confirm"; return false; }
    this.disarm(); this.toast = "Demolishing…"; return this.o.send(demolishIntent(t.entity));
  }
  get context(): BuildContextView | undefined {
    const t = this.target; if (!t) return undefined; const h = HINTS[this.device()]; const armed = this.demolishArmed;
    return { target: t, title: `${label(t.pieceKey)} · ${label(t.tierKey)} · ${Math.round((100 * t.hp) / Math.max(1, t.maxHp))}%`, actions: [
      { id: "repair", label: "Repair", hint: h.repair, enabled: t.canRepair && t.canAfford.repair },
      { id: "upgrade", label: t.nextTierKey ? `Upgrade → ${label(t.nextTierKey)}` : "Upgrade", hint: h.upgrade, enabled: t.canUpgrade && t.canAfford.upgrade },
      { id: "demolish", label: armed ? "Confirm demolish" : "Demolish", hint: h.demolish, enabled: true, armed },
    ] };
  }
  /** Aim actually used: touch point / gamepad cursor override the resolver's aim. */
  private aim(c: MenuCtx): PlacementAim | undefined {
    const dev = this.device(); const pt = c.world.get(c.player, Transform);
    if (dev === "touch" && this.touchPoint) return { mode: 1, ...this.touchPoint };
    if (dev === "gamepad" && this.padOffset && pt) return { mode: 1, x: pt.x + this.padOffset.x, y: pt.y + this.padOffset.y };
    return this.o.aim();
  }
  private refresh(): void {
    const c = this.o.ctx(); if (!this.sel || !c) { this.preview = undefined; this.target = undefined; return; }
    const aim = this.aim(c);
    // ADR-169: off = never assist; on = the default (facing / pad-cursor aims snap, a pointed mouse / tap cell stays exact so a red ghost says why)
    const assist = !this.snap ? false : this.device() === "gamepad" ? true : undefined; // pad cursor is imprecise: snap it too
    this.preview = buildPreviewFor(c.world, c.player, this.sel, this.rot, aim, this.level, assist);
    const at = placementTarget(c.world, c.player, aim);
    const prev = this.target?.entity; this.target = pieceTargetAt(c.world, c.player, at, this.level);
    if (this.target?.entity !== prev) this.disarm();
  }
  private padCursor(c: MenuCtx): void {
    const v = this.o.input.vector?.("Build.Nudge"); const t = this.now(); const dt = this.lastT === undefined ? 0 : Math.min(0.1, (t - this.lastT) / 1000); this.lastT = t;
    if (!v || Math.hypot(v[0] ?? 0, v[1] ?? 0) < 0.2) return;
    if (!this.padOffset) { const pt = c.world.get(c.player, Transform); const at = placementTarget(c.world, c.player, this.o.aim()); this.padOffset = pt && at ? { x: at.x - pt.x, y: at.y - pt.y } : { x: 0, y: 0 }; }
    const m = moveVector(0, { x: v[0], y: v[1] }); const reach = gameplayDefs(c.world).building.buildReach;
    let x = this.padOffset.x + m.dx * PAD_CURSOR_SPEED * dt, y = this.padOffset.y + m.dy * PAD_CURSOR_SPEED * dt; const d = Math.hypot(x, y); if (d > reach) { x *= reach / d; y *= reach / d; }
    this.padOffset = { x, y };
  }
  /** Per frame, after input.update(). */
  update(): void {
    if (!this.sel) return; const i = this.o.input; const c = this.o.ctx(); const dev = this.device();
    if (i.pressed("ToggleBuild") && this.o.onPickPiece) { this.stop(); this.o.onPickPiece(); return; }
    if (i.pressed("Build.Cancel")) { if (this.demolishArmed) { this.disarm(); this.toast = ""; return; } this.stop(); return; }
    if (i.pressed("Build.ToggleSnap")) this.toggleSnap();
    if (c && dev === "gamepad") this.padCursor(c);
    // LevelUp/Down win over TierNext/Prev (pad: LT + D-pad up/down shares the D-pad with tier).
    const lvl = i.pressed("Build.LevelUp") ? 1 : i.pressed("Build.LevelDown") ? -1 : 0;
    if (lvl) this.setLevel(lvl);
    else if (i.pressed("Build.TierNext")) this.cycleTier(1); else if (i.pressed("Build.TierPrev")) this.cycleTier(-1);
    else if (i.pressed("Build.PieceNext")) this.cyclePiece(1); else if (i.pressed("Build.PiecePrev")) this.cyclePiece(-1);
    if (i.pressed("Build.RotateCW")) this.rotate(1); else if (i.pressed("Build.RotateCCW")) this.rotate(-1); else this.refresh();
    if (i.pressed("Build.RepairMode")) this.act("repair");
    else if (i.pressed("Build.UpgradeMode")) this.act("upgrade");
    else if (i.pressed("Build.DemolishMode")) this.act("demolish", dev === "gamepad"); // pad: the 500ms hold is the confirmation
    else if (i.pressed("Build.PlaceConfirm")) this.place();
  }
}
