/**
 * ADR-240: player v2 character art behind the `charArt` setting (v1 stays the default).
 * The resolved v1 paper-doll layers are swapped sprite-for-sprite: a v2 twin (`v2s_` + v1 key) when the sample ships
 * one, else the slot's sample piece (V2S_ALIAS; any v1 key, not only `_male` ones), else the v1 layer (mixed doll).
 * The sample is greyscale + tintmask, so the v1 appearance colours still tint it (same look/tints as the v1 doll).
 */
import type { AppearanceBinding } from "./layers.js";

export type CharArt = "v1" | "v2s" | "v2s-all";
export const CHAR_ART_VALUES: readonly CharArt[] = ["v1", "v2s", "v2s-all"];
/** `?charArt=` wins, then the stored setting (localStorage `charArt`), else v1. */
export function parseCharArt(query?: string | null, stored?: string | null): CharArt {
  for (const v of [query, stored]) if (v && (CHAR_ART_VALUES as readonly string[]).includes(v)) return v as CharArt;
  return "v1";
}

/** Sample piece per doll slot (`slot:sleeves` = the sleeves layer of a top). */
export const V2S_ALIAS: Readonly<Record<string, string>> = {
  body: "v2s_body_male", top: "v2s_cz_top_scrap_male", "top:sleeves": "v2s_cz_top_scrap_male_sleeves", bottom: "v2s_cz_bottom_scrap_male",
  shoes: "v2s_cz_shoes_scrap_male", hat: "v2s_cz_hat_scrap_male", hair: "v2s_cz_hair_buzz_male_hathair", face: "v2s_cz_face_smile_male",
  eyes: "v2s_cz_eyes_round_male",
};
/** v2 sprite keys: body sheets join the body pool, `cz_` pieces the wear pool (never the stream pool). */
export const isV2BodyKey = (key: string): boolean => /^v2s?_body_/.test(key);
export const isV2WearKey = (key: string): boolean => /^v2s?_cz_/.test(key);

interface SpriteIds { key(id: number): string | undefined; tryId(key: string): number | undefined }
type Layer = { sprite: number; slot: string };

/** Maps resolved v1 layers to v2 sample sprites (memoised per v1 sprite id). */
export class CharArtMapper {
  readonly stats = { twin: 0, alias: 0, v1: 0 };
  private memo = new Map<number, [number, "twin" | "alias"] | null>();
  constructor(private readonly ids: SpriteIds) {}
  /** True when the registry ships the sample (else every map() is the identity). */
  get available(): boolean { return this.ids.tryId(V2S_ALIAS.body!) !== undefined; }
  map<L extends Layer>(ls: readonly L[]): L[] {
    return ls.map((l) => {
      let t = this.memo.get(l.sprite);
      if (t === undefined) {
        const key = this.ids.key(l.sprite) ?? "";
        const twin = key ? this.ids.tryId("v2s_" + key) : undefined;
        const ak = V2S_ALIAS[l.slot + (/_sleeves$/.test(key) ? ":sleeves" : "")];
        const alias = ak ? this.ids.tryId(ak) : undefined;
        t = twin !== undefined ? [twin, "twin"] : alias !== undefined ? [alias, "alias"] : null; this.memo.set(l.sprite, t);
      }
      if (!t) { this.stats.v1++; return l; }
      this.stats[t[1]]++; return { ...l, sprite: t[0] };
    });
  }
}

/** Binding whose resolve() already returns v2 layers (character creator: preview == in-game doll). */
export function withCharArt(binding: AppearanceBinding, art: CharArt, ids: SpriteIds): AppearanceBinding {
  if (art === "v1") return binding;
  const m = new CharArtMapper(ids); if (!m.available) return binding;
  return { ...binding, resolve: ((a, f, o) => m.map(binding.resolve(a, f, o))) as AppearanceBinding["resolve"] };
}
