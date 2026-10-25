/** ADR-144: turns live game state into tutorial probe counters (monotonic; steps compare against a per-step baseline). */
import type { Probe } from "./steps.js";

export interface ProbeSample {
  pos?: { x: number; y: number } | undefined; sprinting: boolean; zoom?: number | undefined; aiming: boolean;
  /** item name -> count in the player's inventory (undefined while no player) */
  items?: ReadonlyMap<string, number> | undefined; menuOpen: boolean;
  hunger?: number | undefined; thirst?: number | undefined; toolKind: number;
  buildActive: boolean; buildRot: number; menuTop?: string | undefined;
  /** build pieces within ~12 tiles of the player: "place" counts only a piece that really appeared (a refused place, e.g. "Spot taken", does not) */
  pieces?: number | undefined;
}
export class TutorialProber {
  private c: Record<string, number> = {};
  private last?: ProbeSample;
  private add(k: string, n = 1): void { this.c[k] = (this.c[k] ?? 0) + n; }
  /** A panel / build command went out (sendIntent). */
  command(name: string): void {
    if (name === "gameplay.queueCraft" || name === "gameplay.craft") this.add("craft");
    else if (name === "gameplay.use" || name === "gameplay.consume" || name === "gameplay.eat") this.add("eat");
  }
  sample(s: ProbeSample): void {
    const l = this.last;
    if (l?.pos && s.pos) { const d = Math.hypot(s.pos.x - l.pos.x, s.pos.y - l.pos.y); if (d > 0.01 && d < 8) { this.add("moved", d); if (s.sprinting || l.sprinting) this.add("sprint", d); } }
    if (l?.zoom !== undefined && s.zoom !== undefined && Math.abs(s.zoom - l.zoom) > 1e-3) this.add("zoom");
    if (s.aiming) this.add("aim");
    if (l?.items && s.items && !s.menuOpen && !l.menuOpen) for (const [k, n] of s.items) { const g = n - (l.items.get(k) ?? 0); if (g > 0) { this.add("gain", g); if (/log/i.test(k)) this.add("gainLog", g); } }
    if (l && ((s.hunger ?? 0) > (l.hunger ?? 0) + 0.5 || (s.thirst ?? 0) > (l.thirst ?? 0) + 0.5) && l.hunger !== undefined && s.hunger !== undefined) this.add("eat");
    this.c["tool"] = s.toolKind > 0 ? 1 : 0;
    if (s.buildActive && !l?.buildActive) this.add("build");
    if (l && s.buildActive && s.buildRot !== l.buildRot) this.add("rotate");
    if (s.menuTop && s.menuTop !== l?.menuTop) this.add(`menu:${s.menuTop === "camper" ? "station" : s.menuTop}`);
    if ((s.buildActive || l?.buildActive) && l?.pieces !== undefined && s.pieces !== undefined && s.pieces > l.pieces) this.add("place", s.pieces - l.pieces);
    this.last = s;
  }
  probe(): Probe { return { ...this.c }; }
}
