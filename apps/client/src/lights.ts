/**
 * Light table for the client view: every light-emitting thing maps to a renderer light (radius tiles, colour, flicker).
 * Primary source: Art's survival_fx/render_tuning.json `heatSources.light` (keyed by piece/sprite key, wildcards `*`);
 * client defaults fill gaps (furnace, stations without a piece key, emissive props, held torches).
 */
export interface LightSpec { radius: number; intensity: number; r: number; g: number; b: number; flicker: number }

const hex = (c: string): [number, number, number] => { const n = parseInt(c.replace("#", ""), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mk = (radius: number, intensity: number, color: string, flicker: number): LightSpec => { const [r, g, b] = hex(color); return { radius, intensity, r, g, b, flicker }; };

/** Fallbacks (used when render_tuning lacks the key). */
export const DEFAULT_LIGHTS: Record<string, LightSpec> = {
  campfire: mk(4.5, 1.3, "#ff9a4a", 0.55), bonfire: mk(6, 1.5, "#ff8f40", 0.6),
  torch_stand: mk(3.5, 1.0, "#ffa54f", 0.7), torch: mk(3.5, 1.0, "#ffa54f", 0.7), held_torch: mk(3, 0.95, "#ffa54f", 0.7),
  lantern: mk(2.5, 0.85, "#ffb060", 0.25), fireplace: mk(4, 1.2, "#ff8f40", 0.45), wood_stove: mk(3, 0.9, "#ff8238", 0.35),
  furnace: mk(3.5, 1.1, "#ff7a30", 0.4), heat_brazier: mk(4, 1.2, "#ff9a4a", 0.5),
  glow_mushrooms: mk(1.6, 0.55, "#7ff0d8", 0.1), "prop_glow_mushroom_*": mk(1.6, 0.55, "#7ff0d8", 0.1),
  mirror: mk(1.2, 0.4, "#cfe8ff", 0.05),
};

export class LightTable {
  private t: Record<string, LightSpec> = { ...DEFAULT_LIGHTS };
  /** Merge render_tuning.json heatSources.light (base entry; byAnim variants are visual sizes, not used here). */
  load(tuning: unknown): number {
    const l = (tuning as { heatSources?: { light?: Record<string, { radiusTiles?: number; intensity?: number; color?: string; flicker?: number }> } })?.heatSources?.light;
    if (!l) return 0; let n = 0;
    for (const [k, v] of Object.entries(l)) {
      if (!v || typeof v.radiusTiles !== "number") continue;
      const d = this.t[k]; this.t[k] = mk(v.radiusTiles, v.intensity ?? d?.intensity ?? 1, v.color ?? "#ffa54f", v.flicker ?? d?.flicker ?? 0.3); n++;
    }
    return n;
  }
  get(key: string | undefined): LightSpec | undefined {
    if (!key) return undefined; const hit = this.t[key]; if (hit) return hit;
    for (const [k, v] of Object.entries(this.t)) if (k.includes("*") && new RegExp(`^${k.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(key)) return v;
    return undefined;
  }
}
