/**
 * Trade stalls (Art & Assets `stalls` fragment + render_tuning.stalls.json): pure, GL-free logic shared by StallLayer and
 * tests. Gameplay contract (packages/gameplay/src/components.ts): StallHeader {ownerKind, ownerId, open, listingCount} lives
 * on the stall's STOCK attachment (Container = stock, Listings), not on the BuildPiece; BuildPiece.tint is a u8 clan palette
 * index (0 = untinted, clanTintIndex = 1..255) and BuildPiece.paint overrides it when != 0.
 */
import { AssetRegistry, type AttachPoint, type ClanPalette, type FrameRef } from "@engine/assets";
import { computeDayLighting } from "../timeOfDay.js";

// ---------------------------------------------------------------------------------------------- tuning
/** Font reference: Art's MTSDF atlas (BMFont JSON path under the art root) or a legacy TTF path. */
export interface StallFontRef { atlas: string; atlasRegular?: string; fieldType: string; pxRange: number; emPx: number; fallbackTtf?: string }
export type StallFont = string | StallFontRef;
/** Font atlas JSON path (art-relative) of a tuning font, undefined for legacy TTF-only refs. */
export const stallFontAtlas = (f: StallFont): string | undefined => (typeof f === "string" ? (f.endsWith(".json") ? f : undefined) : f.atlas);
export interface StallTuning {
  sign: { font: StallFont; weight: number; color: string; minSizePx: number; maxSizePx: number };
  priceTag: { font: StallFont; weight: number; color: string; sizePx: number; iconSizePx: number; format: string; iconFromPriceItem: boolean };
  slots: { iconScale: number; bobPx: number; hideWhenClosed: boolean; dimWhenOutOfStock: number; soldOutStamp: string };
  worldPrompt: { open: string; soldOut: string; closed: string; offsetZ: number; fadeDistanceTiles: [number, number];
    /** String keys of the badge labels (stalls/strings/<locale>.json). */ labelKeys: { open: string; soldOut: string; closed: string; clan?: string }; strings?: string };
  lanterns: { emissiveColor: string; bloom: number; nightOnly: boolean; flicker: { amp: number; freq: number } };
  sway: { maskChannel: string };
  tint: { R: string; G: string; mode: string };
}
export const DEFAULT_STALL_TUNING: StallTuning = {
  sign: { font: "stalls/fonts/fredoka_bold_mtsdf.json", weight: 700, color: "#3B2433", minSizePx: 6, maxSizePx: 12 },
  priceTag: { font: "stalls/fonts/fredoka_bold_mtsdf.json", weight: 700, color: "#3B2433", sizePx: 6, iconSizePx: 7, format: "{count}", iconFromPriceItem: true },
  slots: { iconScale: 1, bobPx: 0, hideWhenClosed: true, dimWhenOutOfStock: 0.45, soldOutStamp: "stall_badge_sold_out" },
  worldPrompt: { open: "stall_prompt_open", soldOut: "stall_badge_sold_out", closed: "stall_badge_closed", offsetZ: 1.2, fadeDistanceTiles: [6, 9],
    labelKeys: { open: "stall.badge.open", soldOut: "stall.badge.soldout", closed: "stall.badge.closed", clan: "stall.badge.clan" }, strings: "stalls/strings/en.json" },
  lanterns: { emissiveColor: "#FFD04A", bloom: 0.6, nightOnly: true, flicker: { amp: 0.08, freq: 3 } },
  sway: { maskChannel: "R" },
  tint: { R: "clan_primary", G: "clan_secondary", mode: "multiply" },
};
/** Merge render_tuning.stalls.json over the defaults (unknown keys ignored; `$comment`/notes dropped). */
export function parseStallTuning(json: unknown): { tuning: StallTuning; warnings: string[] } {
  const warnings: string[] = []; const t = structuredClone(DEFAULT_STALL_TUNING) as unknown as Record<string, Record<string, unknown>>;
  if (!json || typeof json !== "object") return { tuning: t as unknown as StallTuning, warnings: ["render_tuning.stalls: not an object"] };
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (k.startsWith("$")) continue;
    const dst = t[k]; if (!dst) { warnings.push(`render_tuning.stalls: unknown section ${k}`); continue; }
    if (!v || typeof v !== "object") continue;
    for (const [f, fv] of Object.entries(v as Record<string, unknown>)) {
      if (!(f in dst) || fv === null) continue;
      if (f === "font" && (typeof fv === "string" || (typeof fv === "object" && typeof (fv as StallFontRef).atlas === "string"))) { dst[f] = fv; continue; }
      if (typeof fv === typeof dst[f]) dst[f] = f === "labelKeys" ? { ...(dst[f] as object), ...(fv as object) } : fv;
    }
  }
  if (t.sway!.maskChannel !== "R") warnings.push(`render_tuning.stalls: sway.maskChannel ${String(t.sway!.maskChannel)} unsupported (shader reads R)`);
  if (t.tint!.mode !== "multiply") warnings.push(`render_tuning.stalls: tint.mode ${String(t.tint!.mode)} unsupported (sprite shader multiplies)`);
  for (const k of ["sign", "priceTag"] as const) { const f = t[k]!.font as StallFont; if (typeof f === "object" && f.fieldType !== "mtsdf" && f.fieldType !== "msdf") warnings.push(`render_tuning.stalls: ${k}.font.fieldType ${f.fieldType} unsupported`); }
  return { tuning: t as unknown as StallTuning, warnings };
}
/** Badge labels from a strings table (stalls/strings/<locale>.json) through worldPrompt.labelKeys; missing keys fall back to the key. */
export function stallStrings(t: StallTuning, table: Record<string, unknown> | null | undefined): { open: string; soldOut: string; closed: string; clan: string } {
  const k = t.worldPrompt.labelKeys; const get = (key: string | undefined): string => { const v = key ? table?.[key] : undefined; return typeof v === "string" ? v : key ?? ""; };
  return { open: get(k.open), soldOut: get(k.soldOut), closed: get(k.closed), clan: get(k.clan) };
}

// ---------------------------------------------------------------------------------------------- attach points
export interface StallAttach { name: string; index: number; p: AttachPoint }
export interface StallPoints { frame: FrameRef; flipX: boolean; slots: StallAttach[]; tags: StallAttach[]; sign?: AttachPoint; emblem?: AttachPoint }
/**
 * Effective attach points of a stall piece for rotation/damage/state, through the typed engine plumbing:
 * AssetRegistry.buildingFrame (frame keys override sprite keys) + AssetRegistry.attachPoint (x mirrored when flipX).
 * slotN/tagN are returned sorted by N (listing slot index).
 */
export function stallPoints(reg: AssetRegistry, spriteId: number, rotation: number, damage: number, state: number): StallPoints {
  const frame = reg.buildingFrame(spriteId, rotation, damage, state);
  const slots: StallAttach[] = [], tags: StallAttach[] = [];
  for (const name of Object.keys(frame.attach ?? {})) {
    const m = /^(slot|tag)(\d+)$/.exec(name); if (!m) continue;
    const p = AssetRegistry.attachPoint(frame, name)!; (m[1] === "slot" ? slots : tags).push({ name, index: Number(m[2]), p });
  }
  slots.sort((a, b) => a.index - b.index); tags.sort((a, b) => a.index - b.index);
  const sign = AssetRegistry.attachPoint(frame, "sign"), emblem = AssetRegistry.attachPoint(frame, "emblem");
  return { frame, flipX: !!frame.flipX, slots, tags, ...(sign ? { sign } : {}), ...(emblem ? { emblem } : {}) };
}
/** Piece state index from StallHeader.open: states are declared closed (0), open (1) in the fragment. -1 = default frames. */
export function stallStateIndex(reg: AssetRegistry, spriteId: number, open: number): number {
  const names = reg.sprite(spriteId).building?.stateNames ?? []; const i = names.indexOf(open ? "open" : "closed");
  return i >= 0 ? i : -1;
}

// ---------------------------------------------------------------------------------------------- state / prompt
export type StallVisual = "open" | "soldOut" | "closed";
export interface ListingView { item: number; stock: number; qty: number; enabled: boolean; priceItem: number; priceCount: number }
/** soldOut = stock < qty (README data paths). Disabled listings don't count. */
export const listingSoldOut = (l: ListingView): boolean => l.stock < Math.max(1, l.qty);
/**
 * World prompt state. `allSoldOut` comes from a header bit when gameplay adds one; until then it is derived from the
 * listings when this peer has them (Listings/stock are "viewers" scoped) and is false otherwise.
 */
export function stallVisual(open: number, listingCount: number, listings: readonly ListingView[] | null, allSoldOutBit?: boolean): StallVisual {
  if (!open) return "closed";
  if (allSoldOutBit !== undefined) return allSoldOutBit ? "soldOut" : "open";
  if (!listings || listingCount === 0) return "open";
  const live = listings.filter((l) => l.enabled);
  return live.length > 0 && live.every(listingSoldOut) ? "soldOut" : "open";
}
/** Prompt alpha from the focus distance (tiles): 1 inside fade[0], 0 beyond fade[1]. */
export function promptAlpha(distTiles: number, fade: readonly [number, number]): number {
  if (distTiles <= fade[0]) return 1; if (distTiles >= fade[1]) return 0; return 1 - (distTiles - fade[0]) / Math.max(1e-6, fade[1] - fade[0]);
}

// ---------------------------------------------------------------------------------------------- lanterns
/**
 * Lantern emissive gate 0..1 for a day fraction (core timeOfDay(world).t) and renderer clock: 0 in daylight when nightOnly,
 * ramping in through dusk (1 - daylight), times a smooth two-sine flicker of ±amp at ~freq Hz.
 */
export function lanternGate(dayT: number, timeSec: number, cfg: StallTuning["lanterns"]): number {
  const night = cfg.nightOnly ? 1 - computeDayLighting(dayT).daylight : 1;
  if (night <= 0.001) return 0;
  const f = cfg.flicker; const w = 2 * Math.PI * f.freq;
  const flick = 1 + f.amp * (0.7 * Math.sin(w * timeSec) + 0.3 * Math.sin(w * 2.37 * timeSec + 1.3));
  return Math.max(0, Math.min(1.5, night * flick));
}

// ---------------------------------------------------------------------------------------------- clan tint
/**
 * BuildPiece tint index (u8, gameplay paint || tint) -> clan palette via AssetRegistry.clanPaletteForTint (ADR-081):
 * 0 = none, 1..N = clanPalettes[tint - 1], out of range = none (no modulo).
 */
export function clanPaletteFor(reg: Pick<AssetRegistry, "clanPaletteForTint">, tint: number): ClanPalette | undefined { return reg.clanPaletteForTint(tint); }
/** Registry colours are 0xRRGGBB; sprite tints are RGBA8 (0 = none). */
export const clanRgbToRgba8 = (rgb: number): number => (((rgb & 0xffffff) << 8) | 0xff) >>> 0;
export function clanTintPair(reg: Pick<AssetRegistry, "clanPaletteForTint">, tint: number): { primary: number; secondary: number } {
  const p = clanPaletteFor(reg, tint); return p ? { primary: clanRgbToRgba8(p.primary), secondary: clanRgbToRgba8(p.secondary) } : { primary: 0, secondary: 0 };
}

// ---------------------------------------------------------------------------------------------- text fit
/** Shrink-then-ellipsis fit (tuning sign.fit): largest size in [min,max] whose width fits; at min, truncate with "…". */
export function fitText(text: string, boxW: number, measure: (s: string, sizePx: number) => number, minPx: number, maxPx: number): { text: string; sizePx: number } {
  for (let s = maxPx; s >= minPx; s -= 0.5) if (measure(text, s) <= boxW) return { text, sizePx: s };
  let t = text; while (t.length > 0 && measure(t + "…", minPx) > boxW) t = t.slice(0, -1);
  return { text: t.length ? t + "…" : "", sizePx: minPx };
}
export const formatPrice = (fmt: string, count: number): string => fmt.replace("{count}", String(count));

// ---------------------------------------------------------------------------------------------- iso placement
/**
 * World position (tiles x,y and z levels) that projects to screen point (sx, sy) with depth key `key`
 * (sprite batch key = x + y + z * zFactor), for drawing overlays at a pivot-relative attach point.
 */
export function isoPlace(sx: number, sy: number, key: number, hw: number, hh: number, zs: number, zf: number): { x: number; y: number; z: number } {
  const d = sx / hw; // x - y
  const z = (key * hh - sy) / (zf * hh + zs); const s = key - z * zf; // x + y
  return { x: (s + d) / 2, y: (s - d) / 2, z };
}
