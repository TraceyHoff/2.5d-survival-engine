/** ADR-117 keeps a set of looping voices in sync with a desired list (start new, update live, fade out stale). */
import type { LoopSpec } from "./events.js";
import type { Vec2 } from "./spatial.js";
export interface LoopPlayer {
  play(key: string, o: { pos?: Vec2; indoors?: boolean; gain?: number; pitch?: number }): number;
  update(id: number, o: { pos?: Vec2; gain?: number; pitch?: number; indoors?: boolean }): void;
  stop(id: number, fade?: number): void;
  voice?(id: number): unknown;
}
export class LoopSet {
  private live = new Map<string, { key: string; id: number }>();
  constructor(private p: LoopPlayer, private fade = 0.6) {}
  sync(desired: readonly LoopSpec[]): void {
    const want = new Map(desired.map((d) => [d.id, d]));
    for (const [id, l] of this.live) { const d = want.get(id); if (!d || d.key !== l.key) { this.p.stop(l.id, this.fade); this.live.delete(id); } }
    for (const d of want.values()) {
      const o = { ...(d.pos ? { pos: d.pos } : {}), ...(d.indoors !== undefined ? { indoors: d.indoors } : {}), gain: d.gain, ...(d.pitch !== undefined ? { pitch: d.pitch } : {}) };
      const l = this.live.get(d.id);
      if (l && (!this.p.voice || this.p.voice(l.id))) this.p.update(l.id, o);
      else { const id = this.p.play(d.key, o); if (id) this.live.set(d.id, { key: d.key, id }); else this.live.delete(d.id); } // 0 = still loading / inaudible: retry next frame
    }
  }
  clear(): void { for (const l of this.live.values()) this.p.stop(l.id, this.fade); this.live.clear(); }
  get size(): number { return this.live.size; }
}
