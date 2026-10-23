/**
 * Burning building pieces -> fire / ember / smoke VFX (gameplay contract: Burning {lit u8, intensity u8 0-255, startTick u32}
 * on BuildPiece entities). Effect keys come from Art's manifest `vfx` entries (configurable, missing keys are skipped):
 *  - flames: `fire_big` for small pieces / low intensity, `fire_huge` for footprints >= hugeTiles or intensity >= hugeIntensity;
 *    one looping flame per footprint tile (capped), re-spawned when it expires;
 *  - embers: `campfire_sparks` particles (rate, speed, spread, gravity, fade, scaleCurve from the VfxDef), scaled by intensity;
 *  - smoke: `campfire_smoke` particles, same rules.
 */
import { entityIndex, Transform, type ComponentDef, type World } from "@engine/core";
import { floorToTerrainZ } from "@engine/world";
import type { AssetRegistry, VfxDef } from "@engine/assets";
import type { VfxLayer } from "./vfx.js";
import type { AtlasManager } from "./assets/atlasManager.js";

export type BurningDefT = ComponentDef<{ lit: "u8"; intensity: "u8"; startTick: "u32" }>;
export interface BurningFxConfig { fireBig: string; fireHuge: string; embers: string; smoke: string; hugeTiles: number; hugeIntensity: number; maxFlames: number }
export const DEFAULT_BURNING_FX: BurningFxConfig = { fireBig: "fire_big", fireHuge: "fire_huge", embers: "campfire_sparks", smoke: "campfire_smoke", hugeTiles: 4, hugeIntensity: 170, maxFlames: 4 };

interface Resolved { def: VfxDef; anim: number }

/** Pure choice of the flame effect (exported for tests). */
export function pickFlame(cfg: BurningFxConfig, tiles: number, intensity: number): string {
  return tiles >= cfg.hugeTiles || intensity >= cfg.hugeIntensity ? cfg.fireHuge : cfg.fireBig;
}

export class BurningFx {
  cfg: BurningFxConfig = { ...DEFAULT_BURNING_FX };
  private flameUntil = new Map<number, number>();
  private cache = new Map<string, Resolved | null>(); private reg: AssetRegistry | null = null;
  rnd: () => number = Math.random;

  private fx(reg: AssetRegistry, key: string): Resolved | null {
    if (reg !== this.reg) { this.cache.clear(); this.reg = reg; }
    let r = this.cache.get(key);
    if (r === undefined) {
      r = null;
      if (reg.ids.vfx.tryId(key) !== undefined) { const def = reg.effect(key); const sp = reg.sprite(def.sprite); r = { def, anim: Math.max(0, sp.animList.findIndex((a) => a.name === def.anim)) }; }
      this.cache.set(key, r);
    }
    return r;
  }

  update(world: World, burning: BurningDefT, buildPiece: ComponentDef<any> | undefined, atlas: AtlasManager, vfx: VfxLayer, now: number, dt: number): void {
    const reg = atlas.registry; if (!reg || !world.isRegistered(burning)) return;
    const bs = world.store(burning); const tr = world.store(Transform);
    const bp = buildPiece && world.isRegistered(buildPiece) ? world.store(buildPiece) : null;
    const bpd = bp?.data as Record<string, ArrayLike<number>> | undefined;
    const seen = new Set<number>();
    for (let k = 0; k < bs.size; k++) {
      if (!bs.data.lit[k]) continue;
      const e = bs.dense[k]!; const i = entityIndex(e); const ts = tr.slot(i); if (ts < 0) continue;
      seen.add(i);
      const inten = bs.data.intensity[k]! / 255;
      let fw = 1, fh = 1, level = 0;
      const ps = bp ? bp.slot(i) : -1;
      if (bp && ps >= 0 && bpd) { const info = atlas.pieceInfo(bpd.visualId![ps]!); const rot = bpd.rotation![ps]! & 1; if (info) { fw = rot ? info.fh : info.fw; fh = rot ? info.fw : info.fh; } level = bpd.level![ps]!; }
      const ax = Math.floor(tr.data.x[ts]!), ay = Math.floor(tr.data.y[ts]!);
      const z = floorToTerrainZ(level, tr.data.z[ts]!);
      const tiles = fw * fh;
      // flames: one per footprint tile (capped), kept alive
      if ((this.flameUntil.get(i) ?? -1) <= now) {
        const f = this.fx(reg, pickFlame(this.cfg, tiles, bs.data.intensity[k]!));
        if (f) {
          const n = Math.min(this.cfg.maxFlames, tiles); let life = f.def.lifetime;
          for (let q = 0; q < n; q++) {
            const tx = ax + (q % fw) + 0.5, ty = ay + Math.floor(q / fw) % fh + 0.5;
            vfx.spawn({ spriteId: f.def.sprite, anim: f.anim, x: tx, y: ty, z: z + 0.5, lifetime: life, scale: 0.75 + 0.5 * inten, emissive: true });
          }
          this.flameUntil.set(i, now + life * 0.98);
        }
      }
      // particles: embers + smoke
      for (const key of [this.cfg.embers, this.cfg.smoke]) {
        const p = this.fx(reg, key); const pj = p?.def.particles; if (!p || !pj) continue;
        let expect = pj.rate * dt * (0.25 + inten) * Math.min(3, tiles);
        while (expect > 0) {
          if (expect < 1 && this.rnd() > expect) break; expect -= 1;
          const sp = pj.speed[0] + (pj.speed[1] - pj.speed[0]) * this.rnd(); const a = this.rnd() * Math.PI * 2; const h = pj.spread * this.rnd();
          vfx.spawn({ spriteId: p.def.sprite, anim: p.anim, x: ax + fw * this.rnd(), y: ay + fh * this.rnd(), z: z + 1 + this.rnd(),
            lifetime: p.def.lifetime * (0.7 + 0.6 * this.rnd()), emissive: p.def.blend === "additive",
            vx: Math.cos(a) * h * sp, vy: Math.sin(a) * h * sp, vz: sp * 2, gravity: pj.gravity, fade: pj.fade,
            scaleCurve: [pj.scaleCurve[0] ?? 1, pj.scaleCurve[pj.scaleCurve.length - 1] ?? 1] });
        }
      }
    }
    for (const i of this.flameUntil.keys()) if (!seen.has(i)) this.flameUntil.delete(i);
  }
}
