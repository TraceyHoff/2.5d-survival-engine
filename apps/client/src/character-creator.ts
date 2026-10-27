/**
 * ADR-114 character creator: shown after the main-menu mode choice and before entering the world.
 * Fields: name, body, skin, hair (+colour), face / beard, eyes, clothes (top / bottom / shoes, + colours); a rotating
 * preview (auto-turn + ⟲/⟳) and Randomize. The result is stored per save (mode + slot) and sent on join as the
 * normal SetAppearance command, so the server's checkAppearance (catalog + unlock + first-join gate) validates it.
 * A stored character skips the screen (Edit character on the main-menu flow / ?editchar=1 re-opens it).
 * Input: touch / mouse (buttons, ≥44px), keyboard (Tab / arrows, Enter, Esc = Back), gamepad (d-pad / stick, A, B = Back).
 * Preview: the real paper-doll (body + wear sprites, idle anim, 8 facings, live) through @engine/render's WebGL2
 * createCharacterPreview (same layer resolve / anchors / tint as in-game), else the Canvas2D compositor from the PNG sheets
 * (CharacterPreview2D; force with ?creator=2d), else the sketch below when no art registry is loaded. Drag to turn (touch /
 * mouse), ⟲/⟳, LB/RB on a gamepad. Rendered at the device DPR (integer pixel scale in 2D: no blur).
 * The panel scrolls (overflow:auto, touch pan) and fits fullscreen phones (dvh units).
 */
import type { AssetRegistry } from "@engine/assets";
import { buildSignEditor } from "./sign-editor.js";
import { UINav } from "./ui-nav.js";
import { CharacterPreview2D, coreAppearanceBinding, createCharacterPreview, type AtlasSource, type CharacterPreview } from "@engine/render";
import { BODY_TYPES, SLOT_COUNT, WEARABLE_SLOTS, defaultAppearance, slotIndex, type AppearanceValue, type CosmeticCatalogLike, type WearableDef, type WearableSlot } from "@engine/core";

export type CharacterSaveKind = "singleplayer" | "hosted" | "remote";
export interface StoredCharacter { v: 1; name: string; appearance: AppearanceValue }
export const characterKey = (kind: CharacterSaveKind, slot: string): string => `survivaz.character.${kind}.${slot}`;
export const NAME_MAX = 20;
export const EDIT_CHAR_KEY = "survivaz.editchar";
/** Character panel → "Edit character": the creator opens on the next world entry (name always applies; a look change
 * on an already-created character is still subject to the server's wardrobe gate). */
export function requestCharacterEdit(): void { try { sessionStorage.setItem(EDIT_CHAR_KEY, "1"); } catch { /* ignore */ } }
/** Same rule the server applies to hello names (printable, trimmed, ≤ NAME_MAX). */
export function cleanName(s: string): string { return s.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX); }

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const defStore = (): Store | undefined => { try { return localStorage; } catch { return undefined; } };
export function loadCharacter(kind: CharacterSaveKind, slot: string, st: Store | undefined = defStore()): StoredCharacter | undefined {
  try { const r = JSON.parse(st?.getItem(characterKey(kind, slot)) ?? "null") as StoredCharacter | null;
    return r && r.v === 1 && typeof r.name === "string" && Array.isArray(r.appearance?.parts) && r.appearance.parts.length === SLOT_COUNT ? r : undefined; } catch { return undefined; }
}
export function saveCharacter(kind: CharacterSaveKind, slot: string, c: StoredCharacter, st: Store | undefined = defStore()): void { try { st?.setItem(characterKey(kind, slot), JSON.stringify(c)); } catch { /* private mode */ } }
export function deleteCharacter(kind: CharacterSaveKind, slot: string, st: Store | undefined = defStore()): void { try { st?.removeItem(characterKey(kind, slot)); } catch { /* ignore */ } }

/** Creator-visible slots (hat/accessory are wardrobe unlocks, not starter choices). */
export const CREATOR_SLOTS: readonly WearableSlot[] = ["hair", "face", "eyes", "top", "bottom", "shoes"];
const OPTIONAL: ReadonlySet<WearableSlot> = new Set(["hair", "face"]); // bald / clean-shaven allowed
/** Starter wearables per slot for a body: compatible and not unlock-gated (the server would reject those). */
export function creatorOptions(cat: CosmeticCatalogLike, bodyType: number): Record<WearableSlot, WearableDef[]> {
  const body = BODY_TYPES[bodyType] ?? "male"; const out = Object.fromEntries(WEARABLE_SLOTS.map((s) => [s, [] as WearableDef[]])) as Record<WearableSlot, WearableDef[]>;
  for (let id = 1, miss = 0; miss < 256; id++) { const w = cat.wearable(id); if (!w) { miss++; continue; } miss = 0; if (w.bodies[body] && !w.unlockTags.length) out[w.slot].push(w); }
  return out;
}
export interface CreatorPalettes { skin: number; hair: number; clothing: number }
const pal = (cat: CosmeticCatalogLike): CreatorPalettes => ({ skin: Math.max(1, cat.skinTones.length), hair: Math.max(1, cat.hairColors.length), clothing: Math.max(1, cat.clothingColors.length) });
const isHairish = (s: WearableSlot): boolean => s === "hair" || s === "face";
/** Curated clothingColors keys offered for eyes (the eyes slot tints from clothingColors, so the server's range check is
 * unchanged); natural browns / hazels / greens / blues / greys first, then a few fun ones. Missing keys are skipped. */
export const EYE_COLOR_KEYS: readonly string[] = ["cocoa", "tan", "olive", "forest", "sage", "teal", "sky", "denim", "navy", "slate", "charcoal", "lavender", "plum", "berry", "gold"];
/** Palette indices the creator cycles for a field: eyes use the curated list, hair/face the hair palette, else clothing. */
export function colorChoices(cat: CosmeticCatalogLike, s: WearableSlot): number[] {
  if (s === "eyes") { const ix = EYE_COLOR_KEYS.map((k) => cat.clothingColors.findIndex((c) => c.key === k)).filter((i) => i >= 0); if (ix.length) return ix; }
  const n = Math.max(1, (isHairish(s) ? cat.hairColors : cat.clothingColors).length); return Array.from({ length: n }, (_, i) => i);
}
/** Slots whose G (secondary) channel the single "Secondary colour" row drives (all 2-channel clothing in the creator). */
export const SECONDARY_SLOTS: readonly WearableSlot[] = ["top", "bottom", "shoes"];
export type CreatorField = "body" | "skin" | "secondary" | `${WearableSlot}` | `${WearableSlot}:color` | `${WearableSlot}:color2`;
/** Slots with their own "<slot> secondary colour" row: shown only once a starter wearable in the slot has a G (color2) tint channel. */
export const COLOR2_ROW_SLOTS: readonly WearableSlot[] = ["hair", "eyes", "face"];
/** True when any wearable in `s` (or one of its layers) tints G from the secondary palette (tintChannels 2). */
export function slotHasColor2(cat: CosmeticCatalogLike, s: WearableSlot): boolean {
  for (let id = 1, miss = 0; miss < 256; id++) { const w = cat.wearable(id); if (!w) { miss++; continue; } miss = 0;
    if (w.slot === s && (w.tintChannels >= 2 || (w.layers ?? []).some((l) => l.tintChannels >= 2))) return true; }
  return false;
}

/** Uniform random starter look (Randomize); `rnd` is injectable for tests. */
export function randomLook(cat: CosmeticCatalogLike, rnd: () => number = Math.random, body?: number): AppearanceValue {
  const pick = (n: number): number => Math.min(n - 1, Math.floor(rnd() * n));
  // `body` overrides the body roll; the roll is still consumed so the rest of a seed stream keeps its place
  const rolled = pick(BODY_TYPES.length); const bodyType = body !== undefined && body >= 0 && body < BODY_TYPES.length ? body : rolled; const v = defaultAppearance(cat, bodyType); const o = creatorOptions(cat, bodyType); const p = pal(cat);
  v.skinTone = pick(p.skin); const hairCol = pick(p.hair);
  for (const s of CREATOR_SLOTS) { const opts = o[s]; const i = slotIndex(s); if (!opts.length) continue;
    const none = OPTIONAL.has(s) ? 1 : 0; const k = pick(opts.length + none); v.parts[i] = k < opts.length ? opts[k]!.id : 0;
    v.primary[i] = isHairish(s) ? hairCol : s === "eyes" ? (() => { const c = colorChoices(cat, "eyes"); return c[pick(c.length)]!; })() : pick(p.clothing); }
  const sec = pick(p.clothing); for (const s of SECONDARY_SLOTS) v.secondary[slotIndex(s)] = sec;
  return v;
}
/** Deterministic PRNG (mulberry32) for the screenshot preset. */
export function seededRandom(seed: number): () => number {
  let t = seed >>> 0; return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
/**
 * ?creator=shot&seed=N[&facing=0..7][&body=0|1|male|female][&sex=m|f][&freeze=1][&timeout=ms]: the fixed preset look for
 * headless creator captures (same seed + pack = same look). body/sex override the seed's body roll (other rolls keep their
 * place in the seed stream). freeze=1: no auto-turn, frozen anim/shader clock, no adaptive quality, DPR 1 (pixel-stable).
 * timeout (default 20000 ms): window.__creatorReady = { ok:false, error:"timeout", stage } if not ready by then.
 */
export interface CreatorShotParams { seed: number; facing: number; body?: number; freeze: boolean; timeoutMs: number }
export function parseBodyParam(v: string | null): number | undefined {
  if (v === null || v === "") return undefined; const t = v.trim().toLowerCase();
  if (/^\d+$/.test(t)) { const n = Number(t); return n < BODY_TYPES.length ? n : undefined; }
  const k = t === "m" ? "male" : t === "f" ? "female" : t; const i = (BODY_TYPES as readonly string[]).indexOf(k); return i >= 0 ? i : undefined;
}
export function creatorShotFromQuery(q: URLSearchParams): CreatorShotParams | undefined {
  if (q.get("creator") !== "shot") return undefined; const n = (k: string, d: number): number => { const v = Number(q.get(k) ?? d); return Number.isFinite(v) ? Math.trunc(v) : d; };
  const body = parseBodyParam(q.get("body")) ?? parseBodyParam(q.get("sex"));
  return { seed: n("seed", 1), facing: ((n("facing", 1) % 8) + 8) % 8, ...(body !== undefined ? { body } : {}), freeze: /^(1|true|yes)$/i.test(q.get("freeze") ?? ""), timeoutMs: Math.max(1000, n("timeout", 20000)) };
}
export const creatorShotLook = (cat: CosmeticCatalogLike, seed: number, body?: number): AppearanceValue => randomLook(cat, seededRandom(seed), body);
/** Steps one field (cycle with wrap); returns a new value. */
export function stepLook(cat: CosmeticCatalogLike, v: AppearanceValue, field: CreatorField, d: number): AppearanceValue {
  const n: AppearanceValue = { bodyType: v.bodyType, skinTone: v.skinTone, parts: [...v.parts], primary: [...v.primary], secondary: [...v.secondary] }; const p = pal(cat);
  const wrap = (x: number, m: number): number => ((x % m) + m) % m;
  if (field === "body") { const b = wrap(v.bodyType + d, BODY_TYPES.length); const o = creatorOptions(cat, b); const def = defaultAppearance(cat, b);
    n.bodyType = b; for (const s of CREATOR_SLOTS) { const i = slotIndex(s); if (n.parts[i] && !o[s].some((w) => w.id === n.parts[i])) n.parts[i] = def.parts[i] ?? 0; } return n; }
  if (field === "skin") { n.skinTone = wrap(v.skinTone + d, p.skin); return n; }
  if (field === "secondary") { const c = wrap((v.secondary[slotIndex("top")] ?? 0) + d, p.clothing); for (const s of SECONDARY_SLOTS) n.secondary[slotIndex(s)] = c; return n; }
  if (field.endsWith(":color2")) { const s = field.slice(0, -7) as WearableSlot; const i = slotIndex(s); const m = isHairish(s) ? p.hair : p.clothing; n.secondary[i] = wrap((v.secondary[i] ?? 0) + d, m); return n; }
  if (field.endsWith(":color")) { const s = field.slice(0, -6) as WearableSlot; const i = slotIndex(s); const ch = colorChoices(cat, s); const k = ch.indexOf(v.primary[i] ?? 0);
    n.primary[i] = ch[wrap((k < 0 ? (d > 0 ? -1 : 0) : k) + d, ch.length)] ?? 0;
    if (s === "hair") n.primary[slotIndex("face")] = n.primary[i]!; return n; } // beard follows hair colour
  const s = field as WearableSlot; const i = slotIndex(s); const ids = [...(OPTIONAL.has(s) ? [0] : []), ...creatorOptions(cat, v.bodyType)[s].map((w) => w.id)];
  if (ids.length) n.parts[i] = ids[wrap(ids.indexOf(v.parts[i] ?? 0) + d, ids.length)] ?? 0; return n;
}
const partName = (cat: CosmeticCatalogLike, id: number): string => { if (!id) return "None"; const w = cat.wearable(id); return w ? (w.displayName ?? w.key.replace(/^[a-z]+_/, "").replace(/_/g, " ")) : `#${id}`; };
const hex = (c: number | undefined, f: string): string => c === undefined ? f : `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;

/**
 * Preview (sprite fallback): a paper-doll drawn with Canvas2D in the chosen palette colours, turning through the four
 * facings (E,S,W,N). When the real layered character sprites ship, `drawLayers` can swap in resolveLayers output.
 */
export function drawPreview(g: CanvasRenderingContext2D, cat: CosmeticCatalogLike, v: AppearanceValue, dir: number): void {
  const W = g.canvas.width, H = g.canvas.height; g.clearRect(0, 0, W, H);
  const skin = hex(cat.skinTones[v.skinTone]?.color, "#E0B08A"); const col = (s: WearableSlot, f: string): string => { const i = slotIndex(s); if (!v.parts[i]) return ""; const pc = isHairish(s) ? cat.hairColors : cat.clothingColors; return hex(pc[v.primary[i] ?? 0]?.color, f); };
  const top = col("top", "#5A7AB0") || skin, bottom = col("bottom", "#4A4A5A") || skin, shoes = col("shoes", "#3B2433") || skin, hair = col("hair", "#5A3A22"), beard = col("face", "#5A3A22");
  const side = dir === 0 || dir === 2, back = dir === 3, flip = dir === 2 ? -1 : 1, cx = W / 2, s = H / 200, fem = v.bodyType === 1;
  g.save(); g.translate(cx, 0); g.scale(flip, 1);
  const r = (x: number, y: number, w: number, h: number, c: string): void => { g.fillStyle = c; g.fillRect(x * s, y * s, w * s, h * s); };
  g.fillStyle = "rgba(0,0,0,.18)"; g.beginPath(); g.ellipse(0, 190 * s, 40 * s, 8 * s, 0, 0, Math.PI * 2); g.fill();
  const bw = side ? 26 : fem ? 40 : 46;
  r(-bw / 2, 150, bw / 2 - 2, 36, bottom); r(2, 150, bw / 2 - 2, 36, bottom); r(-bw / 2 - 2, 182, bw / 2 + 2, 8, shoes); r(0, 182, bw / 2 + 2, 8, shoes);
  r(-bw / 2, 90, bw, 64, top); if (!side) { r(-bw / 2 - 10, 94, 10, 50, top); r(bw / 2, 94, 10, 50, top); r(-bw / 2 - 10, 142, 10, 8, skin); r(bw / 2, 142, 10, 8, skin); } else r(-5, 96, 12, 48, top);
  r(-18, 46, 36, 44, skin);
  if (hair) { r(-20, 38, 40, 14, hair); if (back) r(-20, 46, 40, fem ? 40 : 26, hair); else if (side) r(-20, 46, 14, fem ? 34 : 18, hair); else if (fem) { r(-22, 46, 8, 36, hair); r(14, 46, 8, 36, hair); } }
  if (!back) { const ex = side ? [8] : [-9, 9]; const eye = v.parts[slotIndex("eyes")] ? hex(cat.clothingColors[v.primary[slotIndex("eyes")] ?? 0]?.color, "#3B2433") : "#3B2433"; for (const x of ex) r(x - 2, 62, 5, 5, eye); if (beard) r(side ? 0 : -14, 76, side ? 18 : 28, 14, beard); }
  g.restore();
}

export interface CreatorOptions {
  root: HTMLElement; catalog: CosmeticCatalogLike | undefined; initial?: StoredCharacter | undefined; title?: string;
  /** Gamepad poll (tests pass a stub); default navigator.getGamepads. */ pads?: () => readonly (Gamepad | null)[];
  /** Real sprite preview (the loaded art registry + atlas sources). mode: auto = WebGL2 then Canvas2D; "canvas2d" forces 2D. */
  preview?: CreatorPreviewSource | undefined;
  /** ADR-115: Art's creator UI folder (`<base>art/ui/creator/`): preview_bg + ic_randomize / ic_rotate_left / ic_rotate_right (1x + @2x). Text glyphs when absent. */
  artBase?: string | undefined;
  /** Screenshot mode (?creator=shot): no auto-turn / animation clock, fixed facing; onReady fires once the preview has drawn. */
  shot?: { facing?: number; /** pixel-stable WebGL2 frames (frozen clock, DPR 1) */ freeze?: boolean; onStage?: (stage: string) => void; onReady: (info: { renderer: PreviewDriver["kind"] }) => void } | undefined;
}
/** preview_bg.png is 160x200 with the character's feet at (80,172); centred in the PREVIEW_CSS host. */
export const PREVIEW_BG = { w: 160, h: 200, feetX: 80, feetY: 172 } as const;
/** Glyph-only icon button art (like ic_menu_*): 40px + @2x; falls back to the text glyph on error. */
function iconInto(b: HTMLButtonElement, base: string | undefined, name: string, label: string): void {
  b.setAttribute("aria-label", label); b.title = label; if (!base) return;
  const doc = b.ownerDocument; const img = doc.createElement("img"); img.alt = ""; img.width = 40; img.height = 40; img.dataset["icon"] = name;
  img.src = `${base}${name}.png`; img.srcset = `${base}${name}.png 1x, ${base}${name}@2x.png 2x`; img.style.cssText = "width:40px;height:40px;display:block;pointer-events:none";
  const text = b.textContent; b.textContent = ""; b.append(img); img.addEventListener("error", () => { img.remove(); b.textContent = text; });
}
export interface CreatorPreviewSource { registry: AssetRegistry; sources: ReadonlyMap<string, AtlasSource>; mode?: CreatorPreviewMode;
  /** test hooks */ createGl?: typeof createCharacterPreview; create2d?: (cv: HTMLCanvasElement, o: ConstructorParameters<typeof CharacterPreview2D>[1]) => Pick<CharacterPreview2D, "setAppearance" | "setFacing" | "resize" | "renderNow" | "facing"> }
export type CreatorPreviewMode = "auto" | "webgl2" | "canvas2d";
/** ?creator=2d (or ?creator=canvas2d) forces the Canvas2D preview. */
export const previewModeFromQuery = (q: URLSearchParams): CreatorPreviewMode => (/^(2d|canvas2d)$/.test(q.get("creator") ?? "") ? "canvas2d" : "auto");
/** One preview backend: the creator only talks to this. */
export interface PreviewDriver { kind: "webgl2" | "canvas2d" | "sketch"; /** resolves when the initial look's art has loaded */ loaded?: Promise<void>; set(a: AppearanceValue): void; facing(k: number): void; frame(tSec: number): void; dispose(): void }
export const PREVIEW_CSS = { w: 168, h: 216 } as const;
/** WebGL2 (render package) -> Canvas2D sheets -> undefined (caller keeps the sketch). Mounts into `host`. */
export async function createPreviewDriver(host: HTMLElement, src: CreatorPreviewSource, look: AppearanceValue, facing: number, backdrop = "#EAD9B8", freeze = false): Promise<PreviewDriver | undefined> {
  const doc = host.ownerDocument; const dpr = freeze ? 1 : Math.min(3, doc.defaultView?.devicePixelRatio || 1); const cat = src.registry.cosmetics as unknown as CosmeticCatalogLike | undefined;
  if (src.mode !== "canvas2d") {
    const cv = doc.createElement("canvas"); cv.dataset["role"] = "creator-preview"; cv.dataset["renderer"] = "webgl2"; cv.style.cssText = `width:${PREVIEW_CSS.w}px;height:${PREVIEW_CSS.h}px;border-radius:12px;display:block`;
    host.append(cv);
    try {
      const pv: CharacterPreview = await (src.createGl ?? createCharacterPreview)(cv, { registry: src.registry, sources: new Map(src.sources), appearance: look, facing, anim: "idle", backdrop, pollGamepad: false, ...(freeze ? { freeze: true } : {}) });
      pv.resize(PREVIEW_CSS.w, PREVIEW_CSS.h, dpr);
      return { kind: "webgl2", set: (a) => { void pv.setAppearance(a); }, facing: (k) => pv.setFacing(k), frame: () => undefined, dispose: () => { pv.dispose(); cv.remove(); } };
    } catch (e) { cv.remove(); if (src.mode === "webgl2") return undefined; console.info("[creator] WebGL2 preview unavailable, Canvas2D:", e); }
  }
  if (!cat) return undefined;
  const cv = doc.createElement("canvas"); cv.dataset["role"] = "creator-preview"; cv.dataset["renderer"] = "canvas2d"; cv.style.cssText = "border-radius:12px;display:block;image-rendering:pixelated;touch-action:none";
  try {
    const o = { registry: src.registry, binding: coreAppearanceBinding(cat), appearance: look, sources: src.sources, facing, backdrop };
    const pv = src.create2d ? src.create2d(cv, o) : new CharacterPreview2D(cv, o); pv.resize(PREVIEW_CSS.w, PREVIEW_CSS.h, dpr); host.append(cv);
    let cur = look; const loaded = pv.setAppearance(look);
    return { kind: "canvas2d", loaded, set: (a) => { cur = a; void pv.setAppearance(cur); }, facing: (k) => pv.setFacing(k), frame: (t) => pv.renderNow(t), dispose: () => cv.remove() };
  } catch (e) { console.warn("[creator] Canvas2D preview failed:", e); cv.remove(); return undefined; }
}
/** Opens the creator; resolves with the character, or undefined on Back. */
export function showCharacterCreator(o: CreatorOptions): Promise<StoredCharacter | undefined> {
  const cat = o.catalog; const doc = o.root.ownerDocument;
  let look: AppearanceValue = o.initial?.appearance ?? (cat ? randomLook(cat) : defaultAppearance(undefined, 0));
  let name = o.initial?.name ?? ""; let dir = o.shot?.facing ?? 1, auto = !o.shot; let drv: PreviewDriver | undefined; let disposed = false;
  const wrap = doc.createElement("div"); wrap.dataset["boot"] = "creator"; wrap.className = "boot creator"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-label", "Create your character");
  wrap.setAttribute("style", "position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(30,20,28,.72);padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)");
  const panel = doc.createElement("div"); panel.className = "panel ui-scroll";
  panel.setAttribute("style", "max-height:calc(100dvh - 24px);box-sizing:border-box;width:min(760px,calc(100vw - 16px));max-width:100%;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior:contain;display:flex;flex-direction:row;flex-wrap:wrap;align-content:flex-start;gap:12px;background:#FFF3DC;border:3px solid #3B2433;border-radius:16px;padding:14px");
  const h = doc.createElement("h2"); h.textContent = o.title ?? (o.initial ? "Edit character" : "Create your character"); h.style.cssText = "flex:1 1 100%;margin:0";
  const left = doc.createElement("div"); left.style.cssText = "flex:1 1 220px;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px";
  // preview host: sketch canvas until the sprite preview (WebGL2 / Canvas2D) is up; drag on it turns the character
  const host = doc.createElement("div"); host.dataset["role"] = "creator-preview-host"; host.style.cssText = `position:relative;width:${PREVIEW_CSS.w}px;height:${PREVIEW_CSS.h}px;background:#EAD9B8;border-radius:12px;touch-action:none;user-select:none`;
  if (o.artBase) { const b = o.artBase; host.dataset["bg"] = "preview_bg"; // 1x/2x by DPR; centred so the feet anchor sits mid-host
    host.style.backgroundImage = `image-set(url("${b}preview_bg.png") 1x, url("${b}preview_bg@2x.png") 2x)`; if (!host.style.backgroundImage) host.style.backgroundImage = `url("${b}preview_bg.png")`;
    host.style.backgroundSize = `${PREVIEW_BG.w}px ${PREVIEW_BG.h}px`; host.style.backgroundPosition = "center"; host.style.backgroundRepeat = "no-repeat"; }
  const cv = doc.createElement("canvas"); cv.width = 160; cv.height = 200; cv.dataset["role"] = "creator-preview"; cv.dataset["renderer"] = "sketch"; cv.style.cssText = `width:${PREVIEW_CSS.w}px;height:${PREVIEW_CSS.h}px;border-radius:12px`; host.append(cv);
  let g: CanvasRenderingContext2D | null = null; try { g = cv.getContext("2d"); } catch { /* no 2D canvas (tests) */ }
  const t0 = Date.now(); const draw = (): void => { if (drv) { drv.facing(dir); drv.frame(o.shot ? 0 : (Date.now() - t0) / 1000); } else if (g && cat) drawPreview(g, cat, look, ([0, 1, 1, 2, 2, 3, 3, 0] as const)[dir]!); };
  const turn = (d: number): void => { dir = (dir + d + 8) % 8; draw(); };
  { let px = 0, down = false, acc = 0; host.addEventListener("pointerdown", (ev) => { down = true; px = ev.clientX; acc = 0; auto = false; host.setPointerCapture?.(ev.pointerId); });
    host.addEventListener("pointermove", (ev) => { if (!down) return; acc += ev.clientX - px; px = ev.clientX; while (Math.abs(acc) >= 32) { const s = Math.sign(acc); turn(-s); acc -= s * 32; } });
    const up = (): void => { down = false; }; host.addEventListener("pointerup", up); host.addEventListener("pointercancel", up); }
  const win0 = doc.defaultView; // rAF is paused in hidden / occluded (background headless) tabs: each wait also resolves on a 100 ms timer
  const frames = (n: number): Promise<void> => new Promise((r) => { const f = (): void => { if (n-- <= 0 || !win0?.requestAnimationFrame) { r(); return; }
    let done = false; const go = (): void => { if (!done) { done = true; f(); } }; win0.requestAnimationFrame(go); win0.setTimeout?.(go, 100); }; f(); });
  const stage = (s: string): void => { o.shot?.onStage?.(s); };
  const ready = (kind: PreviewDriver["kind"]): void => { if (!o.shot || disposed) return; stage(`frames:${kind}`); draw(); void frames(2).then(() => { if (!disposed) { draw(); wrap.dataset["ready"] = "1"; o.shot?.onReady({ renderer: kind }); } }); };
  stage("preview"); if (o.preview) void createPreviewDriver(host, o.preview, look, dir, o.artBase && o.preview.mode === "canvas2d" ? "" : undefined, !!o.shot?.freeze).then(async (d) => { if (!d) { ready("sketch"); return; } if (disposed) { d.dispose(); return; } drv = d; cv.remove(); wrap.dataset["preview"] = d.kind; if (!o.shot) d.set(look); draw(); stage(`loading:${d.kind}`); await d.loaded?.catch(() => undefined); ready(d.kind); });
  else queueMicrotask(() => ready("sketch"));
  const right = doc.createElement("div"); right.style.cssText = "flex:2 1 240px;min-width:0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 8px;align-items:center";
  const mk = (t: string, act: string, fn: () => void, cls = "alt"): HTMLButtonElement => { const b = doc.createElement("button"); b.type = "button"; b.textContent = t; b.className = cls; b.dataset["action"] = act; b.style.minHeight = "44px"; b.addEventListener("click", fn); return b; };
  const rot = doc.createElement("div"); rot.style.cssText = "display:flex;gap:6px";
  const rl = mk("⟲", "rotate-left", () => { auto = false; turn(-1); }), rr = mk("⟳", "rotate-right", () => { auto = false; turn(1); });
  const rnd = mk("🎲", "randomize", () => { if (cat) { look = randomLook(cat); refresh(); } });
  iconInto(rl, o.artBase, "ic_rotate_left", "Rotate left"); iconInto(rr, o.artBase, "ic_rotate_right", "Rotate right"); iconInto(rnd, o.artBase, "ic_randomize", "Randomize");
  rot.append(rl, rnd, rr); left.append(host, rot);
  const nameIn = doc.createElement("input"); nameIn.type = "text"; nameIn.maxLength = NAME_MAX; nameIn.placeholder = "Survivor name"; nameIn.value = name; nameIn.dataset["role"] = "creator-name"; nameIn.setAttribute("autocomplete", "nickname");
  nameIn.style.cssText = "min-height:44px;font:600 18px system-ui;padding:4px 8px;box-sizing:border-box;width:100%;min-width:0"; nameIn.addEventListener("input", () => { name = nameIn.value; });
  const nl = doc.createElement("label"); nl.textContent = "Name"; right.append(nl, nameIn);
  const vals = new Map<string, HTMLElement>();
  const row = (label: string, field: Parameters<typeof stepLook>[2]): void => {
    const l = doc.createElement("span"); l.textContent = label; const box = doc.createElement("div"); box.style.cssText = "display:flex;gap:6px;align-items:center;min-width:0";
    const val = doc.createElement("span"); val.dataset["role"] = `creator-${field}`; val.style.cssText = "flex:1;text-align:center;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"; vals.set(field, val);
    const step = (d: number): void => { if (cat) { look = stepLook(cat, look, field, d); refresh(); } };
    box.append(mk("◀", `prev-${field}`, () => step(-1)), val, mk("▶", `next-${field}`, () => step(1))); right.append(l, box);
  };
  row("Body", "body"); row("Skin", "skin"); const c2 = (s: WearableSlot, label: string): void => { if (cat && slotHasColor2(cat, s)) row(label, `${s}:color2`); };
  row("Hair", "hair"); row("Hair colour", "hair:color"); c2("hair", "Hair secondary colour"); row("Face / beard", "face"); c2("face", "Face secondary colour"); row("Eyes", "eyes");
  row("Top", "top"); row("Top colour", "top:color"); row("Bottom", "bottom"); row("Bottom colour", "bottom:color"); row("Shoes", "shoes"); row("Shoe colour", "shoes:color");
  row("Secondary colour", "secondary"); row("Eye colour", "eyes:color"); c2("eyes", "Eye secondary colour");
  const msg = doc.createElement("p"); msg.dataset["role"] = "creator-msg"; msg.style.cssText = "flex:1 1 100%;margin:0;min-height:1.2em";
  const foot = doc.createElement("div"); foot.className = "sticky-footer"; foot.style.cssText = "flex:1 1 100%;display:flex;flex-wrap:wrap;gap:8px;position:sticky;bottom:-14px;margin-bottom:-14px;padding-bottom:14px;background:#FFF3DC;padding-top:6px";
  let done: (v: StoredCharacter | undefined) => void = () => undefined;
  // Gamepad (Xbox Edge has no usable system keyboard): A on the name field / Enter world with no name opens the shared
  // on-screen keyboard editor on its own UINav (the creator's pad loop pauses while it is open).
  let oskNav: UINav | undefined;
  const openNameOsk = (): void => {
    if (oskNav) return;
    const nav = new UINav({ root: wrap, history: false, ignoreBoot: true, ...(o.pads ? { getGamepads: o.pads as never } : {}) }); oskNav = nav;
    const ed = buildSignEditor({ kindName: "survivor name", saveLabel: "Use name", maxLen: NAME_MAX, initial: name, keyboard: true,
      close: () => nav.close(), onSave: (t) => { if (t) { name = t; nameIn.value = t; msg.textContent = ""; } } });
    ed.dataset["role"] = "creator-osk";
    nav.open("creator-name", ed, () => { setTimeout(() => nav.destroy(), 0); oskNav = undefined; padHold = true; (cleanName(name) ? ok : nameIn).focus(); });
  };
  let padHold = false;
  const ok = mk("Enter world", "creator-done", () => { const n = cleanName(name); if (!n) { msg.textContent = "Pick a name for your survivor."; nameIn.focus(); if (padActive) openNameOsk(); return; } done({ v: 1, name: n, appearance: look }); }, "");
  foot.append(mk("Back", "creator-back", () => done(undefined)), ok);
  panel.append(h, left, right, msg, foot); wrap.append(panel);
  function refresh(): void {
    const label = (f: string): string => {
      if (f === "body") return (BODY_TYPES[look.bodyType] ?? "male").replace(/^./, (c) => c.toUpperCase());
      if (f === "skin") return cat?.skinTones[look.skinTone]?.key?.replace(/_/g, " ") ?? `Tone ${look.skinTone + 1}`;
      if (f === "secondary") { const i = look.secondary[slotIndex("top")] ?? 0; return cat?.clothingColors[i]?.key?.replace(/_/g, " ") ?? `Colour ${i + 1}`; }
      if (f.endsWith(":color2")) { const s = f.slice(0, -7) as WearableSlot; const i = look.secondary[slotIndex(s)] ?? 0; const pc = isHairish(s) ? cat?.hairColors : cat?.clothingColors; return pc?.[i]?.key?.replace(/_/g, " ") ?? `Colour ${i + 1}`; }
      if (f.endsWith(":color")) { const s = f.slice(0, -6) as WearableSlot; const i = look.primary[slotIndex(s)] ?? 0; const pc = isHairish(s) ? cat?.hairColors : cat?.clothingColors; return pc?.[i]?.key?.replace(/_/g, " ") ?? `Colour ${i + 1}`; }
      return cat ? partName(cat, look.parts[slotIndex(f as WearableSlot)] ?? 0) : "—";
    };
    const swatch = (f: string): number | undefined => { if (!cat) return undefined; if (f === "skin") return cat.skinTones[look.skinTone]?.color;
      if (f === "secondary") return cat.clothingColors[look.secondary[slotIndex("top")] ?? 0]?.color;
      if (f.endsWith(":color2")) { const s = f.slice(0, -7) as WearableSlot; return (isHairish(s) ? cat.hairColors : cat.clothingColors)[look.secondary[slotIndex(s)] ?? 0]?.color; }
      if (f.endsWith(":color")) { const s = f.slice(0, -6) as WearableSlot; return (isHairish(s) ? cat.hairColors : cat.clothingColors)[look.primary[slotIndex(s)] ?? 0]?.color; } return undefined; };
    for (const [f, el] of vals) { el.textContent = label(f); const c = swatch(f); if (c !== undefined) { el.style.borderBottom = `6px solid ${hex(c, "#000")}`; el.dataset["swatch"] = hex(c, ""); } } drv?.set(look); draw();
  }
  refresh();
  // keyboard / gamepad focus navigation over the dialog's controls
  const focusables = (): HTMLElement[] => Array.from(panel.querySelectorAll<HTMLElement>("input,button:not(:disabled)"));
  const move = (d: number): void => { const f = focusables(); const i = f.indexOf(doc.activeElement as HTMLElement); const n = f[(i + d + f.length) % f.length]; n?.focus(); n?.scrollIntoView?.({ block: "nearest" }); };
  const onKey = (e: KeyboardEvent): void => {
    const typing = doc.activeElement === nameIn;
    if (!typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { const bs = (doc.activeElement as HTMLElement | null)?.parentElement?.querySelectorAll<HTMLButtonElement>("button"); if (bs && bs.length === 2) { bs[e.key === "ArrowLeft" ? 0 : 1]!.click(); e.preventDefault(); return; } }
    if (e.key === "Escape") { done(undefined); e.preventDefault(); }
    else if (e.key === "ArrowDown") { move(1); e.preventDefault(); }
    else if (e.key === "ArrowUp") { move(-1); e.preventDefault(); }
    else if (e.key === "Enter" && typing) { ok.click(); e.preventDefault(); }
  };
  doc.addEventListener("keydown", onKey);
  const pads = o.pads ?? (() => (typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : []));
  let prev = { up: false, down: false, left: false, right: false, a: false, b: false, y: false, lb: false, rb: false, start: false }; let raf = 0, last = 0, padActive = false; const win = doc.defaultView;
  const tick = (t: number): void => {
    if (disposed) return; // ok.click() inside this tick resolves the dialog: never re-arm (a zombie loop kept clicking in-game menus)
    if (auto && t - last > 900) { last = t; turn(1); } else if (drv?.kind === "canvas2d") draw(); // 2D: idle anim frames
    let gp = Array.from(pads()).find((p) => p) ?? undefined;
    if (gp && padHold) { if (gp.buttons.some((x) => x?.pressed)) gp = undefined; else padHold = false; } // buttons from the OSK editor: wait for release
    if (gp && oskNav) gp = undefined;
    if (gp) { if (gp.buttons.some((x) => x?.pressed)) padActive = true; const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0, B = (i: number): boolean => !!gp.buttons[i]?.pressed;
      const cur = { up: B(12) || ay < -0.5, down: B(13) || ay > 0.5, left: B(14) || ax < -0.5, right: B(15) || ax > 0.5, a: B(0), b: B(1), y: B(3), lb: B(4), rb: B(5), start: B(9) };
      if (cur.lb && !prev.lb) { auto = false; turn(-1); } if (cur.rb && !prev.rb) { auto = false; turn(1); }
      if (cur.down && !prev.down) move(1); if (cur.up && !prev.up) move(-1);
      // left/right on a ◀ ▶ row steps the value directly
      const a = doc.activeElement as HTMLElement | null; const rowBox = a?.parentElement;
      if ((cur.left && !prev.left) || (cur.right && !prev.right)) { const bs = rowBox?.querySelectorAll<HTMLButtonElement>("button"); if (bs && bs.length === 2) bs[cur.left ? 0 : 1]!.click(); }
      if (cur.a && !prev.a && a) { if (a === nameIn) openNameOsk(); else a.click(); } if (cur.b && !prev.b) done(undefined); if (cur.y && !prev.y && cat) { look = randomLook(cat); refresh(); }
      if (cur.start && !prev.start) ok.click(); // TV: Start = Enter world without D-padding past ~30 rows
      prev = cur; }
    if (disposed) return;
    raf = win?.requestAnimationFrame?.(tick) ?? 0;
  };
  raf = win?.requestAnimationFrame?.(tick) ?? 0;
  o.root.append(wrap); (o.initial ? ok : nameIn).focus();
  return new Promise((resolve) => { done = (v) => { disposed = true; oskNav?.destroy(); oskNav = undefined; drv?.dispose(); drv = undefined; doc.removeEventListener("keydown", onKey); if (raf) win?.cancelAnimationFrame?.(raf); wrap.remove(); resolve(v); }; });
}
