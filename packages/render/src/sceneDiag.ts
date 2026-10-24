/**
 * Scene-level diagnostics + camera target guard. The renderer cannot tell "GPU broken" from "nothing to draw": a healthy
 * GPU with no replicated entities (e.g. the singleplayer local server never started) shows a flat clear colour with
 * instances=0. The client feeds SceneDiag (entities, player, camera target, local-server state, snapshots, last error)
 * so `diagReport()` names the cause, and CameraTargetGuard re-centres the camera when it has had no valid target.
 */
export type CameraTargetKind = "player" | "follow" | "fallback" | "none";
export interface CameraTarget { x: number; y: number; z: number; kind: CameraTargetKind }
export interface SceneDiag {
  entities: number;
  playerEid?: number | undefined;
  cameraTarget?: CameraTarget | undefined;
  /** e.g. "idle" | "opening-store" | "starting" | "connecting" | "running" | "failed" | "n/a (remote)". */
  localServer?: string | undefined;
  snapshots?: number | undefined;
  lastError?: string | undefined;
}

const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : String(v));
export function formatSceneDiag(s: SceneDiag | undefined): string {
  if (!s) return "scene: (no client scene info)";
  const t = s.cameraTarget;
  return `scene: entities=${s.entities} player=${s.playerEid ?? "none"} camTarget=${t ? `${t.kind}@${f1(t.x)},${f1(t.y)},${f1(t.z)}` : "none"}` +
    ` localServer=${s.localServer ?? "?"} snapshots=${s.snapshots ?? "?"} lastError=${s.lastError || "none"}`;
}

export const validTarget = (p: { x: number; y: number; z?: number } | undefined): boolean =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.z === undefined || Number.isFinite(p.z)) && Math.abs(p.x) < 1e6 && Math.abs(p.y) < 1e6;

/**
 * Picks the camera target each frame: the wanted target when valid; otherwise the last valid one; after `graceFrames`
 * frames without any valid target, `fallback` (spawn / camp) with a one-time error describing why.
 */
export class CameraTargetGuard {
  private missing = 0; private last: CameraTarget | undefined;
  /** Set once when the fallback engages (cleared when a real target returns). */
  error: string | undefined;
  constructor(public fallback: { x: number; y: number; z: number }, readonly graceFrames = 120) {}
  get missingFrames(): number { return this.missing; }
  resolve(want: { x: number; y: number; z: number } | undefined, kind: CameraTargetKind = "player", why = "no player entity"): CameraTarget {
    if (validTarget(want)) { this.missing = 0; this.error = undefined; return (this.last = { x: want!.x, y: want!.y, z: want!.z, kind }); }
    this.missing++;
    if (this.last && this.missing < this.graceFrames) return this.last;
    if (this.missing >= this.graceFrames && !this.error) this.error = `camera has no valid target after ${this.missing} frames (${want ? `invalid ${want.x},${want.y}` : why}); centred on fallback ${this.fallback.x},${this.fallback.y}`;
    this.last = undefined;
    return { ...this.fallback, kind: "fallback" };
  }
}
