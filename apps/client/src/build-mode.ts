/**
 * Client build mode: the Build panel's "Place" starts it; it pushes the input "Building" context (so the existing
 * Build.* bindings apply on every device: R / pad RB / touch rotate = Build.RotateCW, Q / LB = Build.RotateCCW,
 * mouse-left / pad RT / touch place = Build.PlaceConfirm, Esc / B / touch cancel = Build.Cancel) and every frame turns
 * the aim (cursor/touch world point, else stick/last move direction) into `preview` via @engine/gameplay
 * buildPreviewFor (snap + reach clamp + validatePlacement). The Renderer draws the ghost from `buildPreview`.
 */
import { buildPreviewFor, placePreviewIntent, rotateStep, type BuildPreview, type BuildSelection, type MenuCtx, type MenuIntent, type PlacementAim } from "@engine/gameplay";

export interface BuildModeInput { pressed(action: string): boolean; push(context: string): void; pop(context?: string): void }
export interface BuildModeOptions {
  input: BuildModeInput;
  ctx(): MenuCtx | undefined;
  /** Current aim: AimResolver.resolve() (mode 1 world point, mode 0 direction incl. last move dir). */
  aim(): PlacementAim | undefined;
  send(i: MenuIntent): boolean;
  /** Called on start/stop (e.g. swap the touch layout to the "building" one with the rotate button). */
  onActiveChange?(active: boolean): void;
}
export class BuildMode {
  private sel: BuildSelection | undefined; rot = 0; level = 0;
  /** Renderer contract: undefined when not placing. */
  preview: BuildPreview | undefined;
  constructor(private readonly o: BuildModeOptions) {}
  get active(): boolean { return this.sel !== undefined; }
  start(sel: BuildSelection): void {
    const was = this.active; this.sel = { ...sel }; if (!was) { this.rot = 0; this.o.input.push("Building"); this.o.onActiveChange?.(true); }
    this.refresh();
  }
  stop(): void { if (!this.active) return; this.sel = undefined; this.preview = undefined; this.o.input.pop("Building"); this.o.onActiveChange?.(false); }
  rotate(dir: 1 | -1): void { const c = this.o.ctx(); if (!this.sel || !c) return; this.rot = rotateStep(c.world, this.sel.piece, this.rot, dir); this.refresh(); }
  /** Place at the current preview; false when invalid / not sent. */
  place(): boolean { this.refresh(); const p = this.preview; if (!p?.valid) return false; return this.o.send(placePreviewIntent(p)); }
  private refresh(): void { const c = this.o.ctx(); this.preview = this.sel && c ? buildPreviewFor(c.world, c.player, this.sel, this.rot, this.o.aim(), this.level) : undefined; }
  /** Per frame, after input.update(). */
  update(): void {
    if (!this.sel) return; const i = this.o.input;
    if (i.pressed("Build.Cancel")) { this.stop(); return; }
    if (i.pressed("Build.RotateCW")) this.rotate(1); else if (i.pressed("Build.RotateCCW")) this.rotate(-1); else this.refresh();
    if (i.pressed("Build.PlaceConfirm")) this.place();
  }
}
