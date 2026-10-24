/**
 * Chimney smoke: every building piece whose sprite declares a `smoke` attach point (Art: bld_roof_chimney_t1..t4,
 * attach.smoke {x:0, y:-46}) emits `campfire_smoke` particles (VfxDef particles: rate/speed/spread/gravity/fade/
 * scaleCurve) from that point. Mirrored art (rotationArt "mirror", rows 2/3 flipX) negates the attach x.
 */
import { entityIndex, Transform, type ComponentDef, type World } from "@engine/core";
import { floorToTerrainZ } from "@engine/world";
import type { AssetRegistry, VfxDef } from "@engine/assets";
import type { VfxLayer } from "../vfx.js";
import type { AtlasManager } from "../assets/atlasManager.js";
import { attachToWorld, ROT_EXACT_PIVOT } from "./modular.js";

export interface ChimneySmokeConfig { vfx: string; attach: string; rateScale: number; maxPerFrame: number }
export const DEFAULT_CHIMNEY_SMOKE: ChimneySmokeConfig = { vfx: "campfire_smoke", attach: "smoke", rateScale: 0.6, maxPerFrame: 24 };

/** World position of a piece's smoke attach point (exported for tests). */
export function chimneySmokePoint(px: number, py: number, exact: boolean, rot: number, fw: number, fh: number, z: number,
  at: { x: number; y: number }, flipX: boolean, iso: { tileW: number; zStep: number }): { x: number; y: number; z: number } {
  const w = rot & 1 ? fh : fw, h = rot & 1 ? fw : fh;
  const cx = exact ? px : Math.floor(px) + w / 2, cy = exact ? py : Math.floor(py) + h / 2;
  const o = attachToWorld(at.x, at.y, flipX, iso);
  return { x: cx + o.x, y: cy + o.y, z: z + o.z };
}

export class ChimneySmoke {
  cfg: ChimneySmokeConfig = { ...DEFAULT_CHIMNEY_SMOKE };
  rnd: () => number = Math.random;
  /** particles spawned last update (diagnostics / tests) */ spawned = 0; chimneys = 0;
  private attach = new Map<number, { x: number; y: number } | null>(); private reg: AssetRegistry | null = null;
  private fx: { def: VfxDef; anim: number } | null | undefined;
  update(world: World, bpDef: ComponentDef<any> | undefined, atlas: AtlasManager, vfx: VfxLayer, dt: number, iso: { tileW: number; zStep: number }): void {
    const reg = atlas.registry; this.spawned = 0; this.chimneys = 0;
    if (!reg || !bpDef || !world.isRegistered(bpDef)) return;
    if (reg !== this.reg) { this.reg = reg; this.attach.clear(); this.fx = undefined; }
    if (this.fx === undefined) {
      this.fx = null;
      if (reg.ids.vfx.tryId(this.cfg.vfx) !== undefined) { const def = reg.effect(this.cfg.vfx); const sp = reg.sprite(def.sprite); this.fx = { def, anim: Math.max(0, sp.animList.findIndex((a) => a.name === def.anim)) }; }
    }
    const fx = this.fx; const pj = fx?.def.particles; if (!fx || !pj) return;
    const bp = world.store(bpDef); const d = bp.data as Record<string, ArrayLike<number>>; const tr = world.store(Transform);
    for (let k = 0; k < bp.size; k++) {
      const vis = d.visualId![k]!; let at = this.attach.get(vis);
      if (at === undefined) { at = atlas.attachOf(vis, this.cfg.attach) ?? null; this.attach.set(vis, at); }
      if (!at || d.ghost![k]!) continue;
      const ts = tr.slot(entityIndex(bp.dense[k]!)); if (ts < 0) continue;
      this.chimneys++;
      const raw = d.rotation![k]!; const rot = raw & 3; const info = atlas.pieceInfo(vis);
      const flip = reg.buildingFrame(vis, rot, 0).flipX === true;
      const p = chimneySmokePoint(tr.data.x[ts]!, tr.data.y[ts]!, (raw & ROT_EXACT_PIVOT) !== 0, rot, info?.fw ?? 1, info?.fh ?? 1, floorToTerrainZ(d.level![k]!, tr.data.z[ts]!), at, flip, iso);
      let expect = pj.rate * this.cfg.rateScale * dt;
      while (expect > 0 && this.spawned < this.cfg.maxPerFrame) {
        if (expect < 1 && this.rnd() > expect) break; expect -= 1;
        const sp = pj.speed[0] + (pj.speed[1] - pj.speed[0]) * this.rnd(); const a = this.rnd() * Math.PI * 2; const hs = pj.spread * this.rnd();
        vfx.spawn({ spriteId: fx.def.sprite, anim: fx.anim, x: p.x + (this.rnd() - 0.5) * 0.1, y: p.y + (this.rnd() - 0.5) * 0.1, z: p.z,
          lifetime: fx.def.lifetime * (0.8 + 0.5 * this.rnd()), emissive: fx.def.blend === "additive",
          vx: Math.cos(a) * hs * sp * 0.5, vy: Math.sin(a) * hs * sp * 0.5, vz: sp * 2, gravity: pj.gravity, fade: pj.fade,
          scaleCurve: [pj.scaleCurve[0] ?? 1, pj.scaleCurve[pj.scaleCurve.length - 1] ?? 1] });
        this.spawned++;
      }
    }
  }
}
