import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { World, Transform, TimeOfDay, defineComponent, setTimeOfDay, TradeStall, StallDisplay, addStallDisplay, STALL_LISTINGS } from "@engine/core";
import { loadManifest, AssetRegistry, mergeManifests, type ManifestJson } from "@engine/assets";
import {
  stallPoints, stallStateIndex, stallVisual, parseStallTuning, lanternGate, clanTintPair, fitText, isoPlace, promptAlpha, stallStrings, parseBmFont, measureText, fontText, applyBuildPieceVisual,
  sdfFromAlpha, StallLayer, VfxLayer, DEFAULT_STALL_TUNING, type IsoRenderer, type GameplayBindings,
} from "../src/index.js";

const ART = join(__dirname, "../../../assets");
const j = <T>(p: string): T => JSON.parse(readFileSync(join(ART, p), "utf8")) as T;
const stalls = j<ManifestJson>("stalls/manifest.fragment.json");
const pvp = j<ManifestJson>("pvp_clan/manifest.fragment.json");
const fx = j<ManifestJson>("survival_fx/manifest.fragment.json");
const merged = mergeManifests([{ name: "stalls", manifest: stalls }, { name: "pvp_clan", manifest: pvp }, { name: "survival_fx", manifest: fx }], { resolve: (p) => "/@art/" + p });
const { registry: reg } = loadManifest(merged.manifest);
const LISTINGS: Record<string, number> = { stall_blanket: 4, stall_cart: 8, stall_booth: 12, clan_pavilion: 24, /* art has 24 attach slots; StallDisplay carries STALL_LISTINGS = 8 */ market_counter: 6 };
const stallSprites = [...reg.allSprites()].filter((s) => s.building && s.attach?.slot0);

describe("stall art + attach plumbing", () => {
  it("fragments merge via mergeManifests (stalls + pvp_clan + survival_fx) without collisions", () => {
    expect(merged.collisions).toEqual([]); expect(merged.warnings).toEqual([]); expect(stallSprites.length).toBe(11); expect(reg.clanPalettes.length).toBe(16);
    expect(reg.atlases.get("stall_booth_thatch")!.image).toBe("/@art/stalls/atlases/stall_booth_thatch.png");
  });
  it("every stall has slotN/tagN for each listing at every rotation, open and closed", () => {
    for (const s of stallSprites) for (let rot = 0; rot < 4; rot++) for (const open of [0, 1]) {
      const p = stallPoints(reg, s.id, rot, 0, stallStateIndex(reg, s.id, open));
      const n = LISTINGS[s.building!.piece]!;
      expect(p.slots.map((x) => x.index), `${s.key} r${rot}`).toEqual([...Array(n).keys()]);
      expect(p.tags.length).toBe(n); expect(p.sign).toBeDefined();
    }
  });
  it("odd rotations use the mirrored frames' attach overrides (frame keys override sprite keys)", () => {
    const s = reg.byKey("stall_cart_pine_red");
    const r0 = stallPoints(reg, s.id, 0, 0, 1), r1 = stallPoints(reg, s.id, 1, 0, 1);
    expect(r0.frame.frame).not.toBe(r1.frame.frame);
    for (let i = 0; i < r0.slots.length; i++) expect(r1.slots[i]!.p.x).toBeCloseTo(-r0.slots[i]!.p.x, 5);
    expect(r1.sign!.x).toBeCloseTo(-r0.sign!.x, 5);
  });
  it("x mirrors on flipX (2-row mirror art) with frame overrides winning", () => {
    const m: ManifestJson = { version: 1, atlases: [{ key: "a", image: "a.png", frameW: 32, frameH: 32, columns: 4, rows: 4 }], sprites: [{
      key: "st", category: "building", atlas: "a", rotationArt: "mirror", animations: { idle: { frames: [0], fps: 1 } },
      attach: { slot0: { x: 5, y: -4, w: 8, h: 8 }, tag0: { x: 6, y: -6, w: 4, h: 3 } }, frameAttach: { "1": { slot0: { x: 9, y: -4, w: 8, h: 8 } } },
      building: { piece: "p", footprint: { w: 1, h: 1 }, layer: 2, frames: [[0, 0, 0, 0], [1, 1, 1, 1]], states: { closed: [[0, 0, 0, 0], [1, 1, 1, 1]], open: [[0, 0, 0, 0], [1, 1, 1, 1]] } } }] } as ManifestJson;
    const r = loadManifest(m).registry; const id = r.byKey("st").id;
    const x = (rot: number) => stallPoints(r, id, rot, 0, 1);
    expect(x(0).slots[0]!.p.x).toBe(5); expect(x(1).slots[0]!.p.x).toBe(9);
    expect(x(2).flipX).toBe(true); expect(x(2).slots[0]!.p.x).toBe(-5); expect(x(3).slots[0]!.p.x).toBe(-9); expect(x(3).tags[0]!.p.x).toBe(-6);
  });
  it("states: closed = 0, open = 1 (StallHeader.open)", () => {
    const s = reg.byKey("stall_booth_redroof"); expect(stallStateIndex(reg, s.id, 0)).toBe(0); expect(stallStateIndex(reg, s.id, 1)).toBe(1);
    expect(reg.buildingFrame(s.id, 0, 0, 0).frame).not.toBe(reg.buildingFrame(s.id, 0, 0, 1).frame);
  });
});

describe("stall logic", () => {
  it("parses render_tuning.stalls.json", () => {
    const { tuning, warnings } = parseStallTuning(j("stalls/render_tuning.stalls.json"));
    expect(warnings).toEqual([]); expect(tuning.lanterns.flicker.freq).toBe(3); expect(tuning.worldPrompt.fadeDistanceTiles).toEqual([6, 9]); expect(tuning.slots.dimWhenOutOfStock).toBe(0.45);
  });
  it("visual state: closed / sold out / open", () => {
    const l = (stock: number, qty = 1, enabled = true) => ({ item: 1, stock, qty, enabled, priceItem: 2, priceCount: 3 });
    expect(stallVisual(0, 2, [l(5)])).toBe("closed");
    expect(stallVisual(1, 2, [l(0), l(1, 2), l(9, 1, false)])).toBe("soldOut");
    expect(stallVisual(1, 2, [l(0), l(3)])).toBe("open");
    expect(stallVisual(1, 2, null)).toBe("open"); expect(stallVisual(1, 2, null, true)).toBe("soldOut");
  });
  it("lanterns: off by day, on with flicker at night", () => {
    const c = DEFAULT_STALL_TUNING.lanterns;
    expect(lanternGate(12 / 24, 1, c)).toBe(0);
    const n = [0, 0.1, 0.2, 0.3].map((t) => lanternGate(23 / 24, t, c));
    for (const v of n) { expect(v).toBeGreaterThan(0.85); expect(v).toBeLessThan(1.1); }
    expect(new Set(n.map((v) => v.toFixed(4))).size).toBeGreaterThan(1);
    expect(lanternGate(12 / 24, 1, { ...c, nightOnly: false })).toBeGreaterThan(0.8);
  });
  it("clan tint via registry.clanPaletteForTint: 1..n -> palette, 0 / out of range -> no tint", () => {
    expect(clanTintPair(reg, 0)).toEqual({ primary: 0, secondary: 0 });
    const p = clanTintPair(reg, 1); expect(p.primary).toBe(0xe8475fff); expect(p.secondary).toBe(0xf6ead2ff);
    expect(clanTintPair(reg, reg.clanPalettes.length + 1)).toEqual({ primary: 0, secondary: 0 });
    expect(clanTintPair(reg, 999)).toEqual({ primary: 0, secondary: 0 });
  });
  it("rotation art: 2-row mirror flips rotations 2/3 with attach x negated; 4-row (unique4) never flips", () => {
    const s = stallSprites[0]!; const fr = s.building!.frames;
    for (let r = 0; r < 4; r++) {
      const p = stallPoints(reg, s.id, r, 0, stallStateIndex(reg, s.id, 1));
      if (fr.length === 2) { expect(p.flipX).toBe(r >= 2); const q = stallPoints(reg, s.id, r - (r >= 2 ? 2 : 0), 0, stallStateIndex(reg, s.id, 1)); expect(p.slots[0]!.p.x).toBeCloseTo(r >= 2 ? -q.slots[0]!.p.x : q.slots[0]!.p.x); }
      if (fr.length === 4) expect(p.flipX).toBe(false);
    }
    // synthetic unique4: same art row count 4 -> no flip at any rotation
    const u = structuredClone(stalls) as unknown as { sprites: { key: string; building?: { frames: unknown[]; states?: Record<string, unknown[]> } }[] };
    const four = (rows: unknown[]) => (rows.length === 2 ? [rows[0], rows[1], rows[0], rows[1]] : rows);
    for (const sp of u.sprites) if (sp.building) { sp.building.frames = four(sp.building.frames); for (const k in sp.building.states ?? {}) sp.building.states![k] = four(sp.building.states![k]!); }
    const r4 = loadManifest(mergeManifests([{ name: "u4", manifest: u as unknown as ManifestJson }, { name: "pvp_clan", manifest: pvp }]).manifest).registry;
    const s4 = [...r4.allSprites()].find((x) => x.building && x.attach?.slot0)!;
    for (let r = 0; r < 4; r++) expect(stallPoints(r4, s4.id, r, 0, stallStateIndex(r4, s4.id, 1)).flipX).toBe(false);
  });
  it("tuning: MTSDF font refs + badge labels from strings via labelKeys", () => {
    const t = parseStallTuning({ sign: { font: { atlas: "stalls/fonts/fredoka_bold_mtsdf.json", fieldType: "mtsdf", pxRange: 4, emPx: 48 } }, worldPrompt: { labelKeys: { closed: "x.closed" } } });
    expect(t.warnings).toEqual([]); expect((t.tuning.sign.font as { atlas: string }).atlas).toBe("stalls/fonts/fredoka_bold_mtsdf.json");
    expect(t.tuning.worldPrompt.labelKeys.open).toBe("stall.badge.open");
    expect(stallStrings(t.tuning, { "stall.badge.open": "Open", "stall.badge.soldout": "Sold out", "x.closed": "Shut" })).toEqual({ open: "Open", soldOut: "Sold out", closed: "Shut", clan: "stall.badge.clan" });
  });
  it("BMFont MTSDF parse: uv/metrics, mtsdf flag, ellipsis fallback", () => {
    const f = parseBmFont({ info: { size: 48 }, common: { lineHeight: 58, base: 46, scaleW: 256, scaleH: 128 }, distanceField: { fieldType: "mtsdf", distanceRange: 4 },
      chars: [{ id: 65, x: 10, y: 20, width: 30, height: 40, xoffset: 1, yoffset: 2, xadvance: 28 }, { id: 46, x: 0, y: 0, width: 8, height: 8, xoffset: 0, yoffset: 38, xadvance: 10 }] }, null);
    expect(f.msdf).toBe(true); expect(f.mtsdf).toBe(true); expect(f.pxRange).toBe(4); expect(f.px).toBe(48);
    expect(f.glyphs.get(65)).toMatchObject({ u0: 10 / 256, v0: 20 / 128, u1: 40 / 256, v1: 60 / 128, adv: 28 });
    expect(measureText(f, "A", 24)).toBeCloseTo(14); expect(fontText(f, "A\u2026")).toBe("A...");
  });
  it("fit text: shrink then ellipsis", () => {
    const m = (s: string, px: number) => s.length * px * 0.5;
    expect(fitText("Bo", 24, m, 6, 12)).toEqual({ text: "Bo", sizePx: 12 });
    expect(fitText("Tilda's Pantry", 52, m, 6, 12).sizePx).toBeLessThan(12);
    const e = fitText("A very long shop sign name", 24, m, 6, 12); expect(e.sizePx).toBe(6); expect(e.text.endsWith("…")).toBe(true); expect(m(e.text, 6)).toBeLessThanOrEqual(24);
  });
  it("iso placement round-trips screen point and depth key", () => {
    const p = isoPlace(37, -12, 20.3, 32, 16, 16, 1 / 3);
    expect((p.x - p.y) * 32).toBeCloseTo(37, 6); expect((p.x + p.y) * 16 - p.z * 16).toBeCloseTo(-12, 6); expect(p.x + p.y + p.z / 3).toBeCloseTo(20.3, 6);
  });
  it("prompt fade by distance", () => { expect(promptAlpha(3, [6, 9])).toBe(1); expect(promptAlpha(7.5, [6, 9])).toBeCloseTo(0.5); expect(promptAlpha(10, [6, 9])).toBe(0); });
  it("SDF: inside > 0.5 > outside", () => {
    const w = 16, a = new Uint8Array(w * w); for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) a[y * w + x] = 255;
    const d = sdfFromAlpha(a, w, w, 4); expect(d[8 * w + 8]!).toBeGreaterThan(200); expect(d[0]!).toBeLessThan(40); expect(Math.abs(d[8 * w + 4]! - 128)).toBeLessThan(40);
  });
  it("VfxLayer overlays live exactly one frame", () => {
    const v = new VfxLayer(); v.overlay = [{ spriteId: 1, x: 0, y: 0, alpha: 0.5 }]; v.update(1);
    expect(v.active.length).toBe(1); expect(v.active[0]!.alpha).toBe(0.5);
    v.overlay = []; v.update(1.016); expect(v.active.length).toBe(0);
  });
});

// ---- StallLayer against a GL-free renderer stub ------------------------------------------------------------
const BP = defineComponent("BuildPiece", { visualId: "u16", variant: "u8", tint: "u32", damageStage: "u8", rotation: "u8", level: "u8", layer: "u8", ghost: "u8" });
const Header = defineComponent("StallHeader", { ownerKind: "u8", ownerId: "u32", open: "u8", listingCount: "u8" });
const Stock = defineComponent("Container", { items: { type: "u16", length: 24 }, counts: { type: "u16", length: 24 } });

function setup(key: string, o: { open: number; rot?: number; tint?: number; stock?: number; ownerKind?: number; hour?: number }) {
  const w = new World(); for (const c of [Transform, BP, Header, TradeStall, StallDisplay, Stock]) w.register(c);
  w.env(TimeOfDay).dayLengthTicks = 2400; setTimeOfDay(w, o.hour ?? 12, 0);
  const s = reg.byKey(key); const e = w.create(); const n = LISTINGS[s.building!.piece]!;
  w.add(e, Transform, { x: 10, y: 10, z: 0, facing: 0 });
  applyBuildPieceVisual(w, e, BP as never, reg, { type: 1, rot: o.rot ?? 0, tint: o.tint ?? 0, paint: 0 }, { pieceKey: (t) => (t === 1 ? s.building!.piece : undefined) });
  w.add(e, Header, { ownerKind: o.ownerKind ?? 1, ownerId: 3, open: o.open, listingCount: n });
  w.add(e, TradeStall, {}); w.add(e, Stock, {});
  const coin = reg.byKey("coin").id;
  for (let i = 0; i < n; i++) {
    if (i < 8) { w.getArray(e, TradeStall, "listItem")![i] = 2; w.getArray(e, TradeStall, "listQty")![i] = 1; w.getArray(e, TradeStall, "listPrice")![i] = i + 1; w.getArray(e, TradeStall, "listCurrency")![i] = 1; }
    w.getArray(e, Stock, "items")![i] = 2; w.getArray(e, Stock, "counts")![i] = o.stock ?? 5;
  }
  addStallDisplay(w, e);
  const bindings: GameplayBindings = { buildPiece: BP as never };
  const vfx = new VfxLayer();
  const fake = {
    bindings, vfx, iso: { tileW: 64, tileH: 32, zStep: 16 }, zFactor: 1 / 3, pieceAnchor: "center",
    atlas: { pieceInfo: (id: number) => { const b = reg.sprite(id).building; return b ? { fw: b.footprint.w, fh: b.footprint.h, layer: b.layer } : null; } },
    bindGameplay(b: GameplayBindings) { Object.assign(bindings, b); },
  } as unknown as IsoRenderer;
  const layer = new StallLayer(fake, reg, { stallHeader: Header, stock: Stock, itemSprite: () => coin, signText: () => "Pip's Cart" });
  return { w, e, layer, bindings, vfx };
}

describe("StallLayer", () => {
  it("open stall: icons + tags at every listing, open prompt; closed: hidden + closed badge", () => {
    for (const rot of [0, 1, 2, 3]) {
      const a = setup("stall_cart_sunny", { open: 1, rot }); a.layer.prepare(a.w);
      expect(a.layer.stats.icons).toBe(8); expect(a.layer.stats.tags).toBe(8); expect(a.layer.stats.prompts.open).toBe(1);
      expect(a.bindings.pieceState!(a.e)).toBe(1);
    }
    const c = setup("stall_cart_sunny", { open: 0 }); c.layer.prepare(c.w);
    expect(c.layer.stats.icons).toBe(0); expect(c.layer.stats.tags).toBe(0); expect(c.layer.stats.prompts.closed).toBe(1); expect(c.bindings.pieceState!(c.e)).toBe(0);
    expect(c.vfx.overlay.length).toBe(1); // only the badge
  });
  it("stall_price_tag sprite per enabled listing at tagN - (1.5,-9) (x negated when flipped); badge at pivot + attach.badge", () => {
    for (const rot of [0, 2]) {
      const a = setup("stall_cart_sunny", { open: 1, rot }); a.layer.prepare(a.w);
      const reg = (a.layer as unknown as { reg: AssetRegistry }).reg; const tagId = reg.byKey("stall_price_tag").id;
      const tags = a.vfx.overlay.filter((o) => o.spriteId === tagId) as unknown as { px: number; py: number }[]; expect(tags).toHaveLength(8);
      const s = reg.byKey("stall_cart_sunny"); const pts = stallPoints(reg, s.id, rot, 0, stallStateIndex(reg, s.id, 1));
      const pi = (a.layer as unknown as { pieceInfo(w: World, e: number): { sx: number; sy: number } }).pieceInfo(a.w, a.e)!;
      const t0 = pts.tags[0]!.p; const dx = pts.flipX ? -1.5 : 1.5;
      expect(tags.some((o) => Math.abs(o.px - (pi.sx + t0.x - dx)) < 1e-6 && Math.abs(o.py - (pi.sy + t0.y + 9)) < 1e-6)).toBe(true);
      expect(pts.badge).toBeDefined();
      const badge = a.vfx.overlay.find((o) => o.spriteId === reg.byKey("stall_prompt_open").id) as unknown as { px: number; py: number };
      expect(badge.px).toBeCloseTo(pi.sx + pts.badge!.x); expect(badge.py).toBeCloseTo(pi.sy + pts.badge!.y);
    }
  });
  it("sold out: dimmed icons + stamps, sold-out badge", () => {
    const s = setup("stall_booth_thatch", { open: 1, stock: 0 }); s.layer.prepare(s.w);
    expect(s.layer.stats.prompts.soldOut).toBe(1); expect(s.vfx.overlay.filter((o) => o.alpha === 0.45).length).toBe(Math.min(12, STALL_LISTINGS)); // booth has 12 listings; StallDisplay holds 24 rows, core TradeStall fills STALL_LISTINGS
  });
  it("clan tint + emblem on clan pavilion", () => {
    const s = setup("clan_pavilion", { open: 1, tint: 2, ownerKind: 2 }); s.layer.prepare(s.w);
    expect(s.bindings.pieceTints!(s.e)).toEqual([0x4f8fd6ff, 0xffd45aff]); expect(s.layer.stats.emblems).toBe(1);
  });
  it("lantern gate: 0 at noon, > 0 at night; booth sprites are night-emissive", () => {
    const d = setup("stall_booth_redroof", { open: 1, hour: 12 }); d.layer.prepare(d.w); expect(d.bindings.nightEmissive!.gate).toBe(0);
    const n = setup("stall_booth_redroof", { open: 1, hour: 23 }); n.layer.prepare(n.w); expect(n.bindings.nightEmissive!.gate).toBeGreaterThan(0.8);
    expect(n.bindings.nightEmissive!.sprites.has(reg.byKey("stall_booth_redroof").id)).toBe(true);
    expect(n.bindings.nightEmissive!.sprites.has(reg.byKey("stall_cart_sunny").id)).toBe(false);
  });
  it("stall_sale event -> stall_sale_coins particles", () => {
    const s = setup("stall_cart_pine_red", { open: 1 }); s.layer.prepare(s.w); s.vfx.update(0); const before = s.vfx.active.length;
    s.vfx.handle({ tick: 1, def: { name: "gameplay.stall_sale" }, payload: { stall: s.e, listingSlot: 3, item: 1, count: 1 } });
    expect(s.vfx.active.length - before).toBe(5); expect(s.vfx.active.at(-1)!.spriteId).toBe(reg.byKey("coin").id);
  });
});
void AssetRegistry;

describe("StallLayer + gameplay StallSign", () => {
  it("reads sign text and the soldOut bit from StallSign", () => {
    const Sign = defineComponent("StallSign", { soldOut: "u8", nameLen: "u8", name: { type: "u8", length: 24 } });
    const s = setup("stall_blanket_gingham", { open: 1 }); s.w.register(Sign); s.w.add(s.e, Sign, { soldOut: 1, nameLen: 3 });
    s.w.getArray(s.e, Sign, "name")!.set([66, 111, 33]);
    s.layer.b = { ...s.layer.b, stallSign: Sign }; delete (s.layer.b as { signText?: unknown }).signText;
    s.layer.prepare(s.w); expect(s.layer.stats.prompts.soldOut).toBe(1);
    expect((s.layer as unknown as { signName(w: World, e: number): string }).signName(s.w, s.e)).toBe("Bo!");
  });
});
