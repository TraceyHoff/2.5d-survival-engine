/**
 * ADR-242: Art's pvp_clan raid effects on build pieces (WebGL2 sprite VFX; the Canvas2D fallback has no VFX layer).
 *  - a piece losing replicated BuildPiece.hp -> `raid_hit_wood` (twig/wood tiers) or `raid_hit_stone` (stone and up) chips
 *    plus one `raid_hit_dust` puff; a piece gaining hp (repair) -> `raid_repair` sparkle;
 *  - a piece that vanishes within RAID_FX.collapseWindow s of a hit -> `raid_collapse` poof + a `raid_rubble_smolder` that
 *    fades out (pieces that leave interest range or are demolished unhurt get nothing);
 *  - burning pieces (replicated Burning, BurningFx) use `raid_fire_small|large` flames with `raid_embers` / `raid_smoke`
 *    when the pack serves all four (useRaidBurning).
 * Missing vfx keys are skipped, so an art pack without pvp_clan changes nothing.
 */
import type { VfxSpawn } from "@engine/render";

export const RAID_FX = { collapseWindow: 4, smolderSeconds: 6, stoneTier: 2, maxPieces: 20000 } as const;
export const RAID_BURNING = { fireBig: "raid_fire_small", fireHuge: "raid_fire_large", embers: "raid_embers", smoke: "raid_smoke" } as const;

interface ParticlesLike { count: number; speed: readonly number[]; spread: number; gravity: number; fade: boolean; scaleCurve: readonly number[] }
interface EffectLike { sprite: number; anim: string; lifetime: number; blend: string; particles?: ParticlesLike | undefined }
/** The AssetRegistry slice RaidFx reads (tests pass a fake). */
export interface RaidArt {
  ids: { vfx: { tryId(key: string): number | undefined } };
  effect(key: string): EffectLike;
  sprite(id: number): { animList: readonly { name: string }[] };
}
export interface VfxSink { spawn(s: VfxSpawn): unknown }
/** One replicated piece this frame: net entity, world position (tiles / terrain levels), BuildPiece hp and tier. */
export interface RaidPiece { e: number; x: number; y: number; z: number; hp: number; tier: number }

/** Point BurningFx at the raid flames when all four keys are served (returns whether it switched). */
export function useRaidBurning(burning: { cfg: { fireBig: string; fireHuge: string; embers: string; smoke: string } } | undefined, art: RaidArt): boolean {
  if (!burning) return false; // Canvas2D has no BurningFx
  if (!Object.values(RAID_BURNING).every((k) => art.ids.vfx.tryId(k) !== undefined)) return false;
  burning.cfg = { ...burning.cfg, ...RAID_BURNING }; return true;
}

export class RaidFx {
  rnd: () => number = Math.random;
  /** Effects spawned per key (tests / diagnostics). */
  readonly counts = new Map<string, number>();
  private last = new Map<number, { hp: number; x: number; y: number; z: number; tier: number; hitAt: number }>();
  private cache = new Map<string, { def: EffectLike; anim: number } | null>(); private art: RaidArt | null = null;
  constructor(private readonly cfg = RAID_FX) {}

  private fx(art: RaidArt, key: string): { def: EffectLike; anim: number } | null {
    if (art !== this.art) { this.cache.clear(); this.art = art; }
    let r = this.cache.get(key);
    if (r === undefined) {
      r = null;
      if (art.ids.vfx.tryId(key) !== undefined) { const def = art.effect(key); r = { def, anim: Math.max(0, art.sprite(def.sprite).animList.findIndex((a) => a.name === def.anim)) }; }
      this.cache.set(key, r);
    }
    return r;
  }

  /** Spawn `key` at a point: a particle burst of `particles.count` (>= 1), else one instance. */
  emit(art: RaidArt, vfx: VfxSink, key: string, x: number, y: number, z: number, opts: { lifetime?: number; fade?: boolean } = {}): number {
    const f = this.fx(art, key); if (!f) return 0;
    const pj = f.def.particles; const n = Math.max(1, pj?.count ?? 1); const emissive = f.def.blend === "additive";
    for (let i = 0; i < n; i++) {
      const s: VfxSpawn = { spriteId: f.def.sprite, anim: f.anim, x, y, z, lifetime: opts.lifetime ?? f.def.lifetime, emissive, ...(opts.fade ? { fade: true } : {}) };
      if (pj && pj.count > 0) {
        const sp = (pj.speed[0] ?? 1) + ((pj.speed[1] ?? 1) - (pj.speed[0] ?? 1)) * this.rnd(); const a = this.rnd() * Math.PI * 2;
        const h = Math.min(1, pj.spread / Math.PI) * (0.4 + 0.6 * this.rnd());
        Object.assign(s, { x: x + (this.rnd() - 0.5) * 0.3, y: y + (this.rnd() - 0.5) * 0.3, vx: Math.cos(a) * h * sp, vy: Math.sin(a) * h * sp, vz: sp, gravity: pj.gravity, fade: pj.fade,
          lifetime: f.def.lifetime * (0.7 + 0.6 * this.rnd()), scaleCurve: [pj.scaleCurve[0] ?? 1, pj.scaleCurve[pj.scaleCurve.length - 1] ?? 1] });
      }
      vfx.spawn(s);
    }
    this.counts.set(key, (this.counts.get(key) ?? 0) + n); return n;
  }

  /** Feed every replicated piece once per frame (`now` in seconds). */
  step(art: RaidArt | undefined, vfx: VfxSink, pieces: Iterable<RaidPiece>, now: number): void {
    const seen = new Set<number>();
    for (const p of pieces) {
      seen.add(p.e); const was = this.last.get(p.e);
      if (!was) { if (this.last.size < this.cfg.maxPieces) this.last.set(p.e, { hp: p.hp, x: p.x, y: p.y, z: p.z, tier: p.tier, hitAt: -1e9 }); continue; }
      if (art && p.hp < was.hp) {
        this.emit(art, vfx, p.tier >= this.cfg.stoneTier ? "raid_hit_stone" : "raid_hit_wood", p.x, p.y, p.z + 0.6);
        this.emit(art, vfx, "raid_hit_dust", p.x, p.y, p.z + 0.4); was.hitAt = now;
      } else if (art && p.hp > was.hp) this.emit(art, vfx, "raid_repair", p.x, p.y, p.z + 0.8);
      was.hp = p.hp; was.x = p.x; was.y = p.y; was.z = p.z; was.tier = p.tier;
    }
    for (const [e, w] of this.last) if (!seen.has(e)) {
      this.last.delete(e);
      if (art && now - w.hitAt <= this.cfg.collapseWindow) {
        this.emit(art, vfx, "raid_collapse", w.x, w.y, w.z + 0.5);
        this.emit(art, vfx, "raid_rubble_smolder", w.x, w.y, w.z, { lifetime: this.cfg.smolderSeconds, fade: true });
      }
    }
  }
}
