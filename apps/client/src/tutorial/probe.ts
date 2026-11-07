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
  /** Of those pieces: campfires (for the cooking-guide checkpoint) and pieces with a station (any station checkpoint). */
  campfires?: number | undefined; stations?: number | undefined;
  /** ADR-275 contextual-tip triggers (all optional; each latches a "has ever happened" flag). */
  nearNode?: boolean; hp?: number | undefined; hpMax?: number | undefined; stamina?: number | undefined;
  /** Hours 0-24 and whole world days since the start. */
  hours?: number | undefined; day?: number | undefined;
  /** Nearest zombie distance in tiles (undefined = none loaded). */
  zombieDist?: number | undefined; brokenLeg?: boolean; skillPoints?: number | undefined; skillNodes?: number | undefined;
  nearBed?: boolean; nearBag?: boolean; dead?: boolean;
}
/** ADR-275 trigger thresholds. */
export const TIP_LOW = 60; export const ZOMBIE_NEAR = 14; export const ZOMBIE_CLOSE = 5;
export class TutorialProber {
  private c: Record<string, number> = {};
  private last?: ProbeSample;
  private add(k: string, n = 1): void { this.c[k] = (this.c[k] ?? 0) + n; }
  /** A panel / build command went out (sendIntent). */
  command(name: string): void {
    if (name === "gameplay.queueCraft" || name === "gameplay.craft") this.add("craft");
    else if (name === "gameplay.use" || name === "gameplay.consume" || name === "gameplay.eat") this.add("eat");
  }
  /** Latch a "has ever happened" flag (1). */
  private flag(k: string, on: boolean | undefined): void { if (on) this.c[k] = Math.max(1, this.c[k] ?? 0); }
  sample(s: ProbeSample): void {
    const l = this.last;
    // ADR-275 contextual-tip triggers
    this.flag("nearNode", s.nearNode);
    this.flag("hungry", s.hunger !== undefined && s.hunger < TIP_LOW); this.flag("thirsty", s.thirst !== undefined && s.thirst < TIP_LOW);
    this.flag("hurt", !s.dead && s.hp !== undefined && s.hpMax !== undefined && s.hpMax > 0 && s.hp < s.hpMax - 0.5);
    this.flag("tired", s.stamina !== undefined && s.stamina < 50);
    if (s.hours !== undefined) { this.flag("dusk", s.hours >= 18 || s.hours < 5); this.flag("night", s.hours >= 20.4 || s.hours < 4.8); }
    if (s.day !== undefined) this.c["day"] = Math.max(this.c["day"] ?? 0, Math.floor(s.day));
    this.flag("zombieNear", s.zombieDist !== undefined && s.zombieDist < ZOMBIE_NEAR); this.flag("zombieClose", s.zombieDist !== undefined && s.zombieDist < ZOMBIE_CLOSE);
    this.flag("brokenLeg", s.brokenLeg); this.flag("skillPoint", (s.skillPoints ?? 0) > 0); this.flag("skillNode", (s.skillNodes ?? 0) > 0);
    this.flag("nearBed", s.nearBed); this.flag("nearBag", s.nearBag);
    if (l?.dead && !s.dead) this.add("respawned");
    if (l?.pos && s.pos) { const d = Math.hypot(s.pos.x - l.pos.x, s.pos.y - l.pos.y); if (d > 0.01 && d < 8) { this.add("moved", d); if (s.sprinting || l.sprinting) this.add("sprint", d); } }
    if (l?.zoom !== undefined && s.zoom !== undefined && Math.abs(s.zoom - l.zoom) > 1e-3) this.add("zoom");
    if (s.aiming) this.add("aim");
    if (l?.items && s.items && !s.menuOpen && !l.menuOpen) for (const [k, n] of s.items) { const g = n - (l.items.get(k) ?? 0); if (g > 0) { this.add("gain", g); if (/log/i.test(k)) this.add("gainLog", g); } }
    if (l && ((s.hunger ?? 0) > (l.hunger ?? 0) + 0.5 || (s.thirst ?? 0) > (l.thirst ?? 0) + 0.5) && l.hunger !== undefined && s.hunger !== undefined) this.add("eat");
    this.c["tool"] = s.toolKind > 0 ? 1 : 0; this.flag("hadTool", s.toolKind > 0);
    if (s.buildActive && !l?.buildActive) this.add("build");
    if (l && s.buildActive && s.buildRot !== l.buildRot) this.add("rotate");
    if (s.menuTop && s.menuTop !== l?.menuTop) this.add(`menu:${s.menuTop === "camper" ? "station" : s.menuTop}`);
    if ((s.buildActive || l?.buildActive) && l?.pieces !== undefined && s.pieces !== undefined && s.pieces > l.pieces) this.add("place", s.pieces - l.pieces);
    // Checkpoint events (Task 10): fire once when the first nearby campfire / station appears.
    if (s.campfires !== undefined && s.campfires > 0 && !(l?.campfires)) this.add("campfire");
    if (s.stations !== undefined && s.stations > 0 && !(l?.stations)) this.add("stationBuilt");
    this.last = s;
  }
  probe(): Probe { return { ...this.c }; }
}
