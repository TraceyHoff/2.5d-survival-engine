/**
 * ADR-246: Art & Assets' weather sprites spawned from the ADR-239 weather (WeatherKindId + smoothed WeatherLevels):
 * fx_snowflake (snow / blizzard: drifting flakes), fx_blizzard (Blizzard: wind-driven gusts), fx_heat_haze (Heat, by
 * day: shimmer rising off the ground). Pure rate/cap logic on top of VfxLayer (WebGL2 sprite batch; Canvas2D draws
 * the same instances). Complements the procedural screen-space WeatherPass, never replaces it.
 */
import { WeatherKindId, type WeatherLevels } from "./weather.js";
import type { VfxLayer, VfxInstance } from "./vfx.js";

export interface WeatherFxKind { key: string; /** spawns per second per 100 visible tiles at full level */ rate: number; cap: number }
export const WEATHER_FX: Readonly<Record<"snow" | "blizzard" | "haze", WeatherFxKind>> = {
  snow: { key: "fx_snowflake", rate: 5, cap: 90 },
  blizzard: { key: "fx_blizzard", rate: 0.9, cap: 14 },
  haze: { key: "fx_heat_haze", rate: 0.35, cap: 10 },
};
/** Target level 0..1 per effect for the current weather (snow follows the smoothed snow level so it fades in/out). */
export function weatherFxLevels(kind: number, ws: Pick<WeatherLevels, "snow" | "wind">, daylight: number): { snow: number; blizzard: number; haze: number } {
  const bliz = kind === WeatherKindId.Blizzard ? Math.max(0.35, ws.snow) : 0;
  return { snow: Math.min(1, ws.snow), blizzard: bliz, haze: kind === WeatherKindId.Heat ? Math.max(0, Math.min(1, (daylight - 0.35) / 0.4)) : 0 };
}
export interface WeatherFxView { /** visible tile-space box */ x0: number; y0: number; x1: number; y1: number; tiles: number }

export class WeatherFx {
  private live: Record<string, VfxInstance[]> = { snow: [], blizzard: [], haze: [] };
  private acc: Record<string, number> = { snow: 0, blizzard: 0, haze: 0 };
  /** 0..1 quality scale on rates and caps (QualityTier.particles). */
  scale = 1;
  /** Live instance counts (diag / tests). */
  counts(): { snow: number; blizzard: number; haze: number } { this.prune(); return { snow: this.live.snow!.length, blizzard: this.live.blizzard!.length, haze: this.live.haze!.length }; }
  private prune(): void { for (const k in this.live) { const a = this.live[k]!; let w = 0; for (const v of a) if (!v.dead) a[w++] = v; a.length = w; } }

  update(vfx: VfxLayer, idOf: (key: string) => number | undefined, kind: number, ws: Pick<WeatherLevels, "snow" | "wind">, daylight: number,
    wind: { x: number; y: number }, view: WeatherFxView, dt: number, rnd: () => number = Math.random): void {
    this.prune(); const lv = weatherFxLevels(kind, ws, daylight); const area = Math.max(1, view.tiles) / 100;
    for (const name of ["snow", "blizzard", "haze"] as const) {
      const k = WEATHER_FX[name]; const level = lv[name]; const live = this.live[name]!;
      if (level <= 0.02) { this.acc[name] = 0; continue; }
      const id = idOf(k.key); if (id === undefined) continue;
      const cap = Math.round(k.cap * this.scale * level); this.acc[name]! += k.rate * this.scale * level * area * Math.min(0.1, dt);
      while (this.acc[name]! >= 1) {
        this.acc[name]! -= 1; if (live.length >= cap) { this.acc[name] = 0; break; }
        const x = view.x0 + rnd() * (view.x1 - view.x0), y = view.y0 + rnd() * (view.y1 - view.y0);
        if (name === "snow") live.push(vfx.spawn({ spriteId: id, x, y, z: 6 + rnd() * 6, vz: -(1.6 + rnd()), vx: wind.x * (0.6 + rnd() * 0.6), vy: wind.y * (0.6 + rnd() * 0.6),
          lifetime: 3 + rnd() * 1.5, age: rnd(), scale: 0.5 + rnd() * 0.5, emissive: false, fade: true, alpha: 0.9 }));
        else if (name === "blizzard") live.push(vfx.spawn({ spriteId: id, x, y, z: 1 + rnd() * 3, vx: wind.x * 3.5, vy: wind.y * 3.5, lifetime: 1.4 + rnd() * 0.8, age: rnd(),
          scale: 1.2 + rnd() * 0.8, emissive: false, fade: true, alpha: 0.55 }));
        else live.push(vfx.spawn({ spriteId: id, x, y, z: 0, vz: 0.15, lifetime: 2.2 + rnd(), age: rnd(), scale: 1.2 + rnd() * 0.6, emissive: false, fade: true, alpha: 0.35 + 0.25 * level }));
      }
    }
  }
}
