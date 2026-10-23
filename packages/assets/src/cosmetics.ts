import { BODY_TYPES, TINT_MODES, type TintMode, StableIdRegistry, WEARABLE_SLOTS, fnv1a, type BodyType, type CosmeticCatalogLike, type PaletteColor,
  type WearableDef, type WearableSlot } from "@engine/core";
import type { AssetRegistry, SpriteDef } from "./manifest.js";

/** Manifest JSON for character customization (see docs/CHARACTER_CUSTOMIZATION.md). */
export interface BodyArtJson { sprite: string; /** default "idle" (first anim if absent) */ anim?: string }
export interface WearableBodyJson extends BodyArtJson { /** hair only: art drawn under a hat with hatHair: true */ hatHair?: BodyArtJson }
export interface WearableJson {
  key: string; slot: WearableSlot; bodies: Partial<Record<BodyType, WearableBodyJson>>;
  layer: number; /** 4 entries E,S,W,N */ layerByDir?: number[]; z?: number;
  /** 0 untinted (default), 1 = tintmask R <- primary, 2 = + G <- secondary. Requires the atlas tintmask mask. */
  tintChannels?: 0 | 1 | 2; hidesSlots?: WearableSlot[]; hatHair?: boolean; unlockTags?: string[];
  /** Optional render hints: tint blend mode, strength 0..1, saturation 0..2; minor = droppable by crowd LOD; outline false = no outline. */
  tintMode?: TintMode; tintStrength?: number; tintSaturation?: number; minor?: boolean; outline?: boolean;
}
export interface PaletteColorJson { key: string; color: string }
export interface CosmeticsJson {
  bodyTypes?: Partial<Record<BodyType, BodyArtJson>>; wearables?: WearableJson[];
  skinTones?: PaletteColorJson[]; hairColors?: PaletteColorJson[]; clothingColors?: PaletteColorJson[];
}

/** Resolved cosmetics; implements the core CosmeticCatalogLike used by validateAppearance / resolveLayers. */
export class CosmeticCatalog implements CosmeticCatalogLike {
  constructor(readonly ids: StableIdRegistry, private readonly parts: Map<number, WearableDef>,
    private readonly bodies: Partial<Record<BodyType, { sprite: number; anim: string }>>,
    readonly skinTones: PaletteColor[], readonly hairColors: PaletteColor[], readonly clothingColors: PaletteColor[]) {}
  get size(): number { return this.parts.size; }
  get hash(): number {
    let h = fnv1a(`cosmetics:${this.ids.hash}`);
    for (const k of ["skinTones", "hairColors", "clothingColors"] as const) h = fnv1a(`${k}:${this[k].map((c) => c.key).join(",")};`, h);
    return h;
  }
  wearable(id: number): WearableDef | undefined { return this.parts.get(id); }
  byKey(key: string): WearableDef | undefined { const id = this.ids.tryId(key); return id === undefined ? undefined : this.parts.get(id); }
  bySlot(slot: WearableSlot, body?: BodyType): WearableDef[] { return [...this.parts.values()].filter((w) => w.slot === slot && (!body || !!w.bodies[body])).sort((a, b) => a.id - b.id); }
  bodySprite(b: BodyType): { sprite: number; anim: string } | undefined { return this.bodies[b]; }
}

const KEY = /^[a-z0-9_]+$/; const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Validate + build the cosmetics catalog against a loaded AssetRegistry. Pushes issues; ids honor `lock`. */
export function loadCosmetics(m: CosmeticsJson, reg: AssetRegistry, lock: Record<string, number> | undefined, issues: string[]): { catalog: CosmeticCatalog; lock: Record<string, number> } {
  const pal = (name: "skinTones" | "hairColors" | "clothingColors"): PaletteColor[] => {
    const list = m[name]; if (list === undefined) return [];
    if (!Array.isArray(list)) { issues.push(`${name} must be an array`); return []; }
    if (list.length > 256) issues.push(`${name}: at most 256 entries (u8 index)`);
    const seen = new Set<string>();
    return list.map((c, index) => {
      if (!KEY.test(c?.key ?? "")) issues.push(`${name}[${index}]: bad key`);
      if (seen.has(c.key)) issues.push(`${name}[${index}](${c.key}): duplicate key`); seen.add(c.key);
      if (!COLOR.test(c?.color ?? "")) issues.push(`${name}[${index}](${c.key}): color must be #rrggbb`);
      return { index, key: c.key, color: parseInt((c.color ?? "#000000").slice(1), 16) };
    });
  };
  const skinTones = pal("skinTones"), hairColors = pal("hairColors"), clothingColors = pal("clothingColors");
  const sprite = (key: string): SpriteDef | undefined => { const id = reg.ids.sprites.tryId(key); return id === undefined ? undefined : reg.sprite(id); };
  const art = (p: string, a: BodyArtJson | undefined, tint: number): { sprite: number; anim: string } | undefined => {
    const s = a && typeof a.sprite === "string" ? sprite(a.sprite) : undefined;
    if (!s) { issues.push(`${p}: unknown sprite "${a?.sprite}"`); return undefined; }
    const anim = a!.anim ?? (s.animations.has("idle") ? "idle" : s.animList[0]?.name);
    const an = anim !== undefined ? s.animations.get(anim) : undefined;
    if (!an) { issues.push(`${p}: sprite ${s.key} has no anim "${anim}"`); return undefined; }
    if (an.directions === 1 && !an.rotations) issues.push(`${p}: anim ${s.key}.${an.name} needs per-direction frames (directions 4|8 or rotations)`);
    if (tint > 0 && !s.atlas.masks.tintmask) issues.push(`${p}: tintChannels ${tint} but atlas ${s.atlas.key} has no tintmask`);
    return { sprite: s.id, anim: an.name };
  };
  const bodies: Partial<Record<BodyType, { sprite: number; anim: string }>> = {};
  for (const [b, a] of Object.entries(m.bodyTypes ?? {})) {
    if (!(BODY_TYPES as readonly string[]).includes(b)) { issues.push(`bodyTypes.${b}: unknown body type (male|female)`); continue; }
    const r = art(`bodyTypes.${b}`, a, 1); if (r) bodies[b as BodyType] = r;
  }
  const list = m.wearables ?? [];
  if (!Array.isArray(list)) issues.push("wearables must be an array");
  const wl = Array.isArray(list) ? list : [];
  if (wl.length && !skinTones.length) issues.push("skinTones: at least one entry required when wearables are defined");
  const seen = new Set<string>();
  wl.forEach((w, i) => { if (!KEY.test(w?.key ?? "")) issues.push(`wearables[${i}]: bad key`); if (seen.has(w.key)) issues.push(`wearables[${i}](${w.key}): duplicate key`); seen.add(w.key); });
  const ids = new StableIdRegistry("wearables");
  let outLock: Record<string, number> = {};
  try { outLock = ids.assign(wl.map((w) => w.key), lock ?? {}); } catch (e) { issues.push(String((e as Error).message)); }
  const parts = new Map<number, WearableDef>(); const hides = new Map<WearableSlot, Set<WearableSlot>>();
  wl.forEach((w, i) => {
    const p = `wearables[${i}](${w.key})`;
    if (!(WEARABLE_SLOTS as readonly string[]).includes(w.slot)) { issues.push(`${p}: unknown slot "${w.slot}"`); return; }
    if (!Number.isInteger(w.layer)) issues.push(`${p}: layer must be an integer`);
    if (w.layerByDir !== undefined && !(Array.isArray(w.layerByDir) && w.layerByDir.length === 4 && w.layerByDir.every(Number.isInteger))) issues.push(`${p}: layerByDir must be 4 integers (E,S,W,N)`);
    if (w.z !== undefined && typeof w.z !== "number") issues.push(`${p}: z must be a number`);
    const tint = w.tintChannels ?? 0; if (![0, 1, 2].includes(tint)) issues.push(`${p}: tintChannels must be 0|1|2`);
    if (w.tintMode !== undefined && !TINT_MODES.includes(w.tintMode)) issues.push(`${p}: tintMode must be one of ${TINT_MODES.join("|")}`);
    if (w.tintStrength !== undefined && !(typeof w.tintStrength === "number" && w.tintStrength >= 0 && w.tintStrength <= 1)) issues.push(`${p}: tintStrength must be a number in 0..1`);
    if (w.tintSaturation !== undefined && !(typeof w.tintSaturation === "number" && w.tintSaturation >= 0 && w.tintSaturation <= 2)) issues.push(`${p}: tintSaturation must be a number in 0..2`);
    if (w.minor !== undefined && typeof w.minor !== "boolean") issues.push(`${p}: minor must be a boolean`);
    if (w.outline !== undefined && typeof w.outline !== "boolean") issues.push(`${p}: outline must be a boolean`);
    if (tint > 0 && !(w.slot === "hair" || w.slot === "face" ? hairColors : clothingColors).length) issues.push(`${p}: tinted but its palette is empty`);
    for (const h of w.hidesSlots ?? []) {
      if (!(WEARABLE_SLOTS as readonly string[]).includes(h)) issues.push(`${p}: hidesSlots has unknown slot "${h}"`);
      else if (h === w.slot) issues.push(`${p}: cannot hide its own slot`);
      else { const s = hides.get(w.slot) ?? new Set(); s.add(h); hides.set(w.slot, s); }
    }
    if (w.hatHair && w.slot !== "hat") issues.push(`${p}: hatHair is only valid on hats`);
    if (w.hatHair && w.hidesSlots?.includes("hair")) issues.push(`${p}: hatHair conflicts with hidesSlots hair`);
    for (const t of w.unlockTags ?? []) if (!KEY.test(t)) issues.push(`${p}: bad unlock tag "${t}"`);
    const bt = Object.keys(w.bodies ?? {});
    if (!bt.length) issues.push(`${p}: bodies must list at least one body type`);
    const out: WearableDef["bodies"] = {};
    for (const b of bt) {
      if (!(BODY_TYPES as readonly string[]).includes(b)) { issues.push(`${p}: unknown body type "${b}"`); continue; }
      if (!bodies[b as BodyType]) issues.push(`${p}: body type ${b} has no bodyTypes.${b} base art`);
      const ba = w.bodies[b as BodyType]!; const r = art(`${p}.bodies.${b}`, ba, tint); if (!r) continue;
      if (ba.hatHair !== undefined && w.slot !== "hair") issues.push(`${p}.bodies.${b}: hatHair art is only valid on hair`);
      const hh = ba.hatHair !== undefined ? art(`${p}.bodies.${b}.hatHair`, ba.hatHair, tint) : undefined;
      out[b as BodyType] = { ...r, ...(hh ? { hatHair: hh } : {}) };
    }
    const id = ids.tryId(w.key); if (id === undefined) return;
    parts.set(id, { id, key: w.key, slot: w.slot, bodies: out, layer: w.layer, ...(w.layerByDir ? { layerByDir: w.layerByDir } : {}), z: w.z ?? 0,
      tintChannels: tint as 0 | 1 | 2, hidesSlots: [...(w.hidesSlots ?? [])], hatHair: !!w.hatHair, unlockTags: [...(w.unlockTags ?? [])],
      ...(w.tintMode !== undefined ? { tintMode: w.tintMode } : {}), ...(typeof w.tintStrength === "number" ? { tintStrength: w.tintStrength } : {}),
      ...(typeof w.tintSaturation === "number" ? { tintSaturation: w.tintSaturation } : {}), ...(typeof w.minor === "boolean" ? { minor: w.minor } : {}),
      ...(typeof w.outline === "boolean" ? { outline: w.outline } : {}) });
  });
  for (const [a, hs] of hides) for (const b of hs) if (hides.get(b)?.has(a)) { if (a < b) issues.push(`slot conflict: ${a} and ${b} wearables hide each other`); }
  return { catalog: new CosmeticCatalog(ids, parts, bodies, skinTones, hairColors, clothingColors), lock: outLock };
}
