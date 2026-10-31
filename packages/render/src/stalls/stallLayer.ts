/**
 * StallLayer: draws the trade-stall integration on top of the generic build-piece path.
 *  1. listing item icons + price tags at attach slotN/tagN (per rotation via frameAttach; x mirrored on flipX), read from the
 *     broadcast core StallDisplay (ADR-081, every observer sees them), hidden when StallHeader.open == 0, dimmed + stamped when
 *     a listing is sold out (per listing from the stock container when this peer sees it, else all listings when the
 *     all-sold-out bit is set);
 *  2. sign text at `sign` (SDF Fredoka, shrink-then-ellipsis);
 *  3. clan tint (tintmask R = primary, G = secondary from registry.clanPaletteForTint(tint)) + clan emblem at `emblem`;
 *  4. sway masks: build pieces now pass SpriteDef.sway to the sprite shader, which reads masks.sway (R);
 *  5. lantern emissive only at night (core timeOfDay -> daylight) with flicker (uniform gate, static chunks untouched);
 *  6. world prompt / badge (open, sold out, closed) above the stall, faded by focus distance;
 *  7. stall_sale_coins VFX on the `gameplay.stall_sale` event (client.pollEvents -> renderer.vfx.handle).
 *
 * Usage (per frame):  stalls.prepare(world); renderer.render(world, alpha); stalls.drawOverlay();
 * Events:             for (const ev of client.pollEvents(client.renderTick)) renderer.vfx.handle(ev);
 */
import { entityIndex, StallDisplay, STALL_DISPLAY_ROWS, Transform, type ComponentDef, type Entity, type World } from "@engine/core";
import { floorToTerrainZ, viewRect } from "@engine/world";
import type { AssetRegistry, VfxDef } from "@engine/assets";
import type { IsoRenderer } from "../IsoRenderer.js";
import type { VfxSpawn } from "../vfx.js";
import { readDayFraction } from "../env.js";
import {
  clanTintPair, DEFAULT_STALL_TUNING, stallStrings, fitText, formatPrice, isoPlace, lanternGate, listingSoldOut, promptAlpha, stallPoints, stallStateIndex, stallVisual,
  type ListingView, type StallTuning, type StallVisual,
} from "./stallLogic.js";
import { measureText, SdfTextPass, type SdfFontData } from "./sdfText.js";

type Num = Record<string, ArrayLike<number>>;
/** gameplay StallHeader (components.ts). */
export type StallHeaderDefT = ComponentDef<{ ownerKind: "u8"; ownerId: "u32"; open: "u8"; listingCount: "u8" }>;

export interface StallBindings {
  /** gameplay StallHeader; lives on the stall entity returned by stallOf. */
  stallHeader: StallHeaderDefT;
  /** Broadcast listing rows {item[], qty[], price[], currency[]} (default: core StallDisplay, ADR-081). Same entity as StallHeader. */
  stallDisplay?: ComponentDef;
  /** Optional stock container {counts[]} (viewer-scoped: only used for per-listing sold-out dimming when this peer has it). */
  stock?: ComponentDef;
  /** Piece entity -> stall (stock attachment) entity; default: the piece itself when it has StallHeader. Gameplay: attachmentsOf(world, piece).find(has StallHeader). */
  stallOf?: (world: World, piece: Entity) => Entity | undefined;
  /** Stall entity -> piece entity (for sale events); default: the stall itself. Gameplay: pieceOf / AttachmentOwner. */
  pieceOf?: (world: World, stall: Entity) => Entity | undefined;
  /** Clan palette index (gameplay BuildPiece.paint || BuildPiece.tint, u8) of a stall piece; default: render BuildPiece.tint. */
  clanIndex?: (world: World, piece: Entity) => number;
  /** Item id -> icon sprite id (listing icons, price icons). */
  itemSprite: (itemId: number) => number | undefined;
  /** Shop sign text (gameplay has no field yet: README ask (2)). */
  signText?: (world: World, piece: Entity, stall: Entity) => string | undefined;
  /** Clan emblem sprite of a clan stall (ownerKind 2); default: emblem_* sprites by ownerId. */
  emblemSprite?: (world: World, piece: Entity, ownerKind: number, ownerId: number) => number | undefined;
  /** Header bit for "every listing sold out" (README ask (1)); undefined = derive from listings when available. */
  allSoldOut?: (world: World, stall: Entity) => boolean | undefined;
  /**
   * gameplay StallSign {soldOut u8, nameLen u8, name u8[24]} (scope all, same entity as StallHeader): default source of the
   * sign text and the sold-out badge when signText / allSoldOut are not given.
   */
  stallSign?: ComponentDef;
  /** Focus position (tiles) for prompt fading; default: no fade. */
  focus?: () => { x: number; y: number } | undefined;
}
/** Badge labels resolved from stalls/strings/<locale>.json via worldPrompt.labelKeys (stallStrings); defaults are the keys. */
export interface StallStrings { open: string; soldOut: string; closed: string }

interface PieceInfo { sx: number; sy: number; key: number; vis: number; rot: number; dmg: number; x: number; y: number }

export class StallLayer {
  tuning: StallTuning = DEFAULT_STALL_TUNING;
  strings: StallStrings = { open: DEFAULT_STALL_TUNING.worldPrompt.labelKeys.open, soldOut: DEFAULT_STALL_TUNING.worldPrompt.labelKeys.soldOut, closed: DEFAULT_STALL_TUNING.worldPrompt.labelKeys.closed };
  /** Install a strings table (stalls/strings/en.json); labels resolve through tuning.worldPrompt.labelKeys. */
  setStrings(table: Record<string, unknown>): void { const s = stallStrings(this.tuning, table); this.strings = { open: s.open, soldOut: s.soldOut, closed: s.closed }; this.stringTable = table; }
  private stringTable: Record<string, unknown> | null = null;
  /** Night lantern gate written each prepare() (0 by day). */
  readonly night = { sprites: new Set<number>(), gate: 1 };
  /** Per-frame stats (tests/screenshots). */
  stats = { stalls: 0, icons: 0, tags: 0, signs: 0, emblems: 0, prompts: { open: 0, soldOut: 0, closed: 0 } as Record<StallVisual, number>, gate: 0 };
  private text: SdfTextPass | null = null;
  private stallSprites = new Set<number>();
  private overlay: VfxSpawn[] = [];
  private emblems: number[] = [];
  private tintCache = new Map<number, readonly [number, number]>();
  private world: World | null = null;
  /** screen y of the current stall's pivot (overlay depth lift) */
  private baseSy = 0;
  private ids: { tag: number | undefined; open: number | undefined; soldOut: number | undefined; closed: number | undefined; coin?: VfxDef } = { tag: undefined, open: undefined, soldOut: undefined, closed: undefined };

  constructor(private renderer: IsoRenderer, private reg: AssetRegistry, public b: StallBindings) {
    for (const s of reg.allSprites()) {
      const at = s.attach ?? {}; const isStall = !!s.building && "slot0" in at; // stall pieces declare listing slots (gate_clan etc. also have open states)
      if (isStall) this.stallSprites.add(s.id);
      // lantern art: emissive pages of stall atlases are night-only (booths, pavilion, props incl. stall_lantern)
      if (s.atlas.emissiveImage && (isStall || s.key.startsWith("stall_"))) this.night.sprites.add(s.id);
      if (s.key.startsWith("emblem_")) this.emblems.push(s.id);
    }
    this.refreshIds();
    renderer.bindGameplay({
      nightEmissive: this.night,
      pieceTints: (e) => this.tintsOf(e),
      pieceState: (e) => this.stateOf(e),
    });
    const onSale = (ev: { payload: Record<string, number> }): VfxSpawn[] | null => this.saleSpawns(ev.payload);
    renderer.vfx.onEvent("gameplay.stall_sale", onSale); renderer.vfx.onEvent("stall_sale", onSale);
  }
  private refreshIds(): void {
    const t = this.tuning; const id = (k: string) => this.reg.ids.sprites.tryId(k);
    const fx = this.reg.ids.vfx.tryId("stall_sale_coins");
    this.ids = { tag: id("stall_price_tag"), open: id(t.worldPrompt.open), soldOut: id(t.worldPrompt.soldOut), closed: id(t.worldPrompt.closed), ...(fx !== undefined ? { coin: this.reg.effect("stall_sale_coins") } : {}) };
  }
  setTuning(t: StallTuning): void { this.tuning = t; this.refreshIds(); if (this.stringTable) this.setStrings(this.stringTable); }
  /** Fredoka font: Art's MTSDF atlas (loadBmFont / parseBmFont of tuning sign.font), buildRuntimeSdf only as fallback. Without one, text is skipped. */
  setFont(font: SdfFontData): void { this.text = new SdfTextPass(this.renderer.gl, font); }
  isStallSprite(spriteId: number): boolean { return this.stallSprites.has(spriteId); }

  // ------------------------------------------------------------------ renderer hooks (bindings)
  private stallEntity(world: World, piece: Entity): Entity | undefined {
    if (this.b.stallOf) return this.b.stallOf(world, piece);
    return world.has(piece, this.b.stallHeader) ? piece : undefined;
  }
  private bpVis(world: World, e: Entity): number | undefined { const bp = this.renderer.bindings.buildPiece; return bp ? world.getField(e, bp, "visualId") : undefined; }
  private tintsOf(e: number): readonly [number, number] | undefined {
    const w = this.world; if (!w) return undefined; const vis = this.bpVis(w, e); if (vis === undefined || !this.stallSprites.has(vis)) return undefined;
    const idx = this.b.clanIndex ? this.b.clanIndex(w, e) : (w.getField(e, this.renderer.bindings.buildPiece!, "tint") ?? 0);
    let t = this.tintCache.get(idx);
    if (!t) { const p = clanTintPair(this.reg, idx); t = [p.primary, p.secondary] as const; this.tintCache.set(idx, t); }
    return t;
  }
  private stateOf(e: number): number | undefined {
    const w = this.world; if (!w) return undefined; const vis = this.bpVis(w, e); if (vis === undefined || !this.stallSprites.has(vis)) return undefined;
    const st = this.stallEntity(w, e); if (st === undefined) return undefined;
    return stallStateIndex(this.reg, vis, w.getField(st, this.b.stallHeader, "open") ?? 0);
  }

  // ------------------------------------------------------------------ placement
  private pieceInfo(world: World, e: Entity): PieceInfo | undefined {
    const bp = this.renderer.bindings.buildPiece; if (!bp || !world.has(e, bp) || !world.has(e, Transform)) return undefined;
    const g = world.get(e, bp)!; const tr = world.get(e, Transform)!; const r = this.renderer;
    const vis = g.visualId, rot = g.rotation & 3; const info = r.atlas.pieceInfo(vis);
    const fw = info ? (rot & 1 ? info.fh : info.fw) : 1, fh = info ? (rot & 1 ? info.fw : info.fh) : 1;
    const ax = Math.floor(tr.x), ay = Math.floor(tr.y); const z = floorToTerrainZ(g.level, tr.z);
    const hw = r.iso.tileW / 2, hh = r.iso.tileH / 2, zs = r.iso.zStep, q = (r.iso.view ?? 0) & 3;
    const front = r.pieceAnchor === "front"; const fx = ax + fw, fy = ay + fh;
    const pvx = front ? fx : ax + fw / 2, pvy = front ? fy : ay + fh / 2;
    // ADR-253: screen pivot / key from the view footprint (as sprites.ts gatherPieces); attach points at the view rotation
    const vr = viewRect(ax, ay, fw, fh, q); const vfx = vr.x + vr.w, vfy = vr.y + vr.h;
    const pu = front ? vfx : vr.x + vr.w / 2, pv = front ? vfy : vr.y + vr.h / 2;
    const key = vfx + vfy - 2 + (front ? 1 : 1.95) + z * r.zFactor + g.layer * 0.01;
    return { sx: (pu - pv) * hw, sy: (pu + pv) * hh - z * zs, key, vis, rot: (rot + q) & 3, dmg: g.damageStage, x: pvx, y: pvy };
  }
  /** Overlay sprite centred on (px, py) iso px, `w` px wide (frame width, or `ref` box width), in front of depth key `key`. */
  private place(spriteId: number, px: number, py: number, w: number, key: number, alpha: number, ref?: { w: number; cx: number; cy: number }): (VfxSpawn & { px: number; py: number; k: number }) | null {
    const s = this.reg.sprite(spriteId); const at = s.atlas; const r = this.renderer;
    const scale = ref ? w / ref.w : w / Math.max(at.frameW, at.frameH);
    const axp = s.anchor.x * at.frameW, ayp = s.anchor.y * at.frameH;
    // offset of the reference point (frame centre or attach box centre) from the sprite pivot, in frame px
    const ox = ref ? ref.cx : at.frameW / 2 - axp, oy = ref ? ref.cy : at.frameH / 2 - ayp;
    const pvx = px - ox * scale, pvy = py - oy * scale; // sprite pivot (iso px)
    // billboard depth grows with screen height above the pivot (sprite VS: key + hp * zFactor / zStep): lift the overlay's key by
    // its height above the stall pivot so it stays in front of the stall pixels it sits on (upper shelves, roofs, banners)
    const kk = key + Math.max(0, this.baseSy - pvy) * r.zFactor / r.iso.zStep;
    const p = isoPlace(pvx, pvy, kk - 0.05, r.iso.tileW / 2, r.iso.tileH / 2, r.iso.zStep, r.zFactor, r.iso.view ?? 0);
    return { spriteId, x: p.x, y: p.y, z: p.z, scale, emissive: false, alpha, px: pvx, py: pvy, k: scale };
  }

  // ------------------------------------------------------------------ per frame
  /** Collect overlays for every stall piece and set the lantern gate. Call before renderer.render(world, alpha). */
  prepare(world: World): void {
    this.world = world; const r = this.renderer; const t = this.tuning;
    const ov = this.overlay; ov.length = 0; this.text?.begin();
    const st = (this.stats = { stalls: 0, icons: 0, tags: 0, signs: 0, emblems: 0, prompts: { open: 0, soldOut: 0, closed: 0 }, gate: 0 });
    this.night.gate = st.gate = lanternGate(readDayFraction(world), r.vfx.now, t.lanterns);
    const bp = r.bindings.buildPiece; if (!bp || !world.isRegistered(bp)) { r.vfx.overlay = ov; return; }
    const store = world.store(bp); const vis = (store.data as Num).visualId!;
    const focus = this.b.focus?.();
    for (let k = 0; k < store.size; k++) {
      if (!this.stallSprites.has(vis[k]!)) continue;
      const e = store.dense[k]!; const stall = this.stallEntity(world, e); if (stall === undefined) continue;
      const pi = this.pieceInfo(world, e); if (!pi) continue;
      const h = world.get(stall, this.b.stallHeader)!; st.stalls++; this.baseSy = pi.sy;
      const pts = stallPoints(this.reg, pi.vis, pi.rot, pi.dmg, stallStateIndex(this.reg, pi.vis, h.open), t.worldPrompt.anchorAttach ?? "badge");
      const allSold = this.b.allSoldOut ? this.b.allSoldOut(world, stall) : this.signSoldOut(world, stall);
      const listings = this.listingsOf(world, stall, h.listingCount, allSold === true);
      const vstate = stallVisual(h.open, h.listingCount, listings, allSold);
      // 1. listing icons + price tags (hidden when closed)
      if ((h.open || !t.slots.hideWhenClosed) && listings) {
        for (const s of pts.slots) {
          const l = listings[s.index]; if (!l || !l.enabled || !l.item) continue;
          const icon = this.b.itemSprite(l.item); if (icon === undefined) continue;
          const sold = listingSoldOut(l); const kk = pi.key + 0.1 + (s.p.z ?? 0) * 0.001;
          const o = this.place(icon, pi.sx + s.p.x, pi.sy + s.p.y, (s.p.w ?? 16) * t.slots.iconScale, kk, sold ? t.slots.dimWhenOutOfStock : 1); if (o) { ov.push(o); st.icons++; }
          if (sold) { const stamp = this.reg.ids.sprites.tryId(t.slots.soldOutStamp); if (stamp !== undefined) { const so = this.place(stamp, pi.sx + s.p.x, pi.sy + s.p.y, s.p.w ?? 16, kk + 0.002, 1); if (so) ov.push(so); } }
        }
        for (const g of pts.tags) {
          const l = listings[g.index]; if (!l || !l.enabled || !l.item || !l.priceCount) continue;
          this.priceTag(pi, g.p, l, pi.key + 0.12 + (g.p.z ?? 0) * 0.001, pts.flipX); st.tags++;
        }
      }
      // 2. sign text
      const sign = this.b.signText ? this.b.signText(world, e, stall) : this.signName(world, stall);
      if (sign && pts.sign && this.text) {
        const box = pts.sign; const f = this.text.font;
        const fit = fitText(sign, (box.w ?? 24) - 2, (s, px) => measureText(f, s, px), t.sign.minSizePx, t.sign.maxSizePx);
        this.text.add({ text: fit.text, x: pi.sx + box.x, y: pi.sy + box.y + fit.sizePx * 0.35, sizePx: fit.sizePx, color: hexColor(t.sign.color), align: "center" }); st.signs++;
      }
      // 3. clan emblem
      if (pts.emblem && h.ownerKind === 2) {
        const em = this.b.emblemSprite ? this.b.emblemSprite(world, e, h.ownerKind, h.ownerId) : this.emblems.length ? this.emblems[h.ownerId % this.emblems.length] : undefined;
        if (em !== undefined) { const o = this.place(em, pi.sx + pts.emblem.x, pi.sy + pts.emblem.y, pts.emblem.w ?? 12, pi.key + 0.11, 1); if (o) { ov.push(o); st.emblems++; } }
      }
      // 6. world prompt
      const pid = vstate === "open" ? this.ids.open : vstate === "soldOut" ? this.ids.soldOut : this.ids.closed;
      const a = focus ? promptAlpha(Math.hypot(focus.x - pi.x, focus.y - pi.y), t.worldPrompt.fadeDistanceTiles) : 1;
      if (pid !== undefined && a > 0.01) {
        const ps = this.reg.sprite(pid); const pw = ps.atlas.frameW * 0.5; const lift = t.worldPrompt.offsetZ * r.iso.zStep;
        // badge sprites are bottom-anchored: their pivot sits on pivot + attach.badge (2px above the trimmed art top);
        // frames without the attach fall back to centring the badge offsetZ above the frame top (anchorY = pivot -> art top)
        const o = pts.badge
          ? this.place(pid, pi.sx + pts.badge.x, pi.sy + pts.badge.y - lift, pw, pi.key + 0.2, a, { w: ps.atlas.frameW, cx: 0, cy: 0 })
          : this.place(pid, pi.sx, pi.sy - pts.frame.anchorY - lift, pw, pi.key + 0.2, a);
        if (o) ov.push(o);
        const label = vstate === "soldOut" ? this.strings.soldOut : vstate === "closed" ? this.strings.closed : vstate === "open" ? this.strings.open : "";
        const tb = ps.attach?.text; // pivot-relative text box centre (frame px)
        if (label && tb && this.text && o) {
          const fit = fitText(label, (tb.w ?? 34) * o.k, (s, px) => measureText(this.text!.font, s, px), 4, (tb.h ?? 12) * o.k * 0.75);
          const c = hexColor(t.sign.color); c[3] = a;
          this.text.add({ text: fit.text, x: o.px + tb.x * o.k, y: o.py + tb.y * o.k + fit.sizePx * 0.35, sizePx: fit.sizePx, color: vstate === "soldOut" ? [1, 1, 1, a] : c, align: "center" });
        }
        st.prompts[vstate]++;
      }
    }
    r.vfx.overlay = ov;
  }
  /**
   * Price tag at attach.tagN (enabled listings only). The stall art no longer bakes tag boards: the stall_price_tag sprite
   * is drawn 1:1 with its pivot at tagN - (1.5, -9) (x negated on flipped rows) so its text attach {x:1.5, y:-9, w:14, h:6}
   * lands on tagN; then price-item icon + price text, icon-left-text-right inside that 14x6 box (x/y = box centre).
   */
  private priceTag(pi: PieceInfo, p: { x: number; y: number; w?: number; h?: number }, l: ListingView, key: number, flipX = false): void {
    const t = this.tuning; const ov = this.overlay; const bw = p.w ?? 14, bh = p.h ?? 6;
    const tid = this.ids.tag;
    if (tid !== undefined) {
      const ts = this.reg.sprite(tid); const ta = ts.attach?.text ?? { x: 1.5, y: -9 };
      const o = this.place(tid, pi.sx + p.x - (flipX ? -ta.x : ta.x), pi.sy + p.y - ta.y, ts.atlas.frameW, key - 0.002, 1, { w: ts.atlas.frameW, cx: 0, cy: 0 });
      if (o) ov.push(o);
    }
    const txt = formatPrice(t.priceTag.format, l.priceCount); const f = this.text?.font;
    const iconW = t.priceTag.iconFromPriceItem ? Math.min(t.priceTag.iconSizePx, bh + 1) : 0; const gap = iconW ? 1 : 0;
    const fit = f ? fitText(txt, bw - iconW - gap, (s, px) => measureText(f, s, px), Math.min(4, t.priceTag.sizePx), Math.min(t.priceTag.sizePx, bh)) : { text: txt, sizePx: t.priceTag.sizePx };
    const tw = f ? measureText(f, fit.text, fit.sizePx) : 0;
    const cx = pi.sx + p.x, cy = pi.sy + p.y; const x0 = cx - (tw + iconW + gap) / 2;
    if (iconW) { const ic = this.b.itemSprite(l.priceItem); if (ic !== undefined) { const o = this.place(ic, x0 + iconW / 2, cy, iconW, key + 0.001, 1); if (o) ov.push(o); } }
    if (this.text) this.text.add({ text: fit.text, x: x0 + iconW + gap, y: cy + fit.sizePx * 0.35, sizePx: fit.sizePx, color: hexColor(t.priceTag.color), align: "left" });
  }
  private signSoldOut(world: World, stall: Entity): boolean | undefined {
    const S = this.b.stallSign; if (!S || !world.has(stall, S)) return undefined; return world.getField(stall, S as ComponentDef<any>, "soldOut" as never) === 1;
  }
  private signName(world: World, stall: Entity): string | undefined {
    const S = this.b.stallSign; if (!S || !world.has(stall, S)) return undefined;
    const n = world.getField(stall, S as ComponentDef<any>, "nameLen" as never) ?? 0; const a = world.getArray(stall, S as ComponentDef<any>, "name" as never); if (!a || !n) return undefined;
    return String.fromCharCode(...Array.from(a.subarray(0, n)));
  }
  /** Listing rows from the broadcast StallDisplay; stock from the (viewer-only) container when present, else unknown (not sold out unless allSold). */
  private listingsOf(world: World, stall: Entity, count: number, allSold: boolean): ListingView[] | null {
    const D = this.b.stallDisplay ?? StallDisplay; if (!world.isRegistered(D) || !world.has(stall, D)) return null;
    const g = (def: ComponentDef, f: string) => world.getArray(stall, def as ComponentDef<any>, f as never);
    const item = g(D, "item"), qty = g(D, "qty"), price = g(D, "price"), cur = g(D, "currency"); if (!item || !qty || !price || !cur) return null;
    const S = this.b.stock; const has = !!S && world.isRegistered(S) && world.has(stall, S);
    const sItems = has ? g(S!, "items") : undefined, sCounts = has ? g(S!, "counts") : undefined;
    // core stall stock is any slot container: units of a listing = sum of counts of its item
    const stockOf = (it: number): number => { if (!sItems || !sCounts) return Number.POSITIVE_INFINITY; let c = 0; for (let k = 0; k < sItems.length; k++) if (sItems[k] === it) c += sCounts[k]!; return c; };
    const n = Math.min(count, STALL_DISPLAY_ROWS, item.length);
    return Array.from({ length: n }, (_, i) => ({ item: item[i]!, qty: qty[i]!, enabled: item[i]! !== 0, priceItem: cur[i]!, priceCount: price[i]!,
      stock: allSold ? 0 : stockOf(item[i]!) }));
  }
  /** Draw sign / tag / badge text over the composited frame. Call after renderer.render. */
  drawOverlay(): void {
    if (!this.text) return; const r = this.renderer; const v = r.camera.viewUniform(new Float32Array(4));
    const a = r.lighting.ambient; const l: [number, number, number] = [Math.min(1, Math.max(0.35, a[0])), Math.min(1, Math.max(0.35, a[1])), Math.min(1, Math.max(0.4, a[2]))];
    this.text.draw(v, l);
  }
  get textGlyphs(): number { return this.text?.glyphsDrawn ?? 0; }

  // ------------------------------------------------------------------ 7. sale vfx
  /** stall_sale payload {stall (local entity), listingSlot, ...} -> coin particles from the slot (or stall pivot). */
  saleSpawns(p: Record<string, number>): VfxSpawn[] | null {
    const w = this.world; const fx = this.ids.coin; if (!w || !fx) return null;
    const stall = p.stall as Entity | undefined; if (stall === undefined || !w.isAlive(stall)) return null;
    const piece = this.b.pieceOf ? this.b.pieceOf(w, stall) : stall; if (piece === undefined) return null;
    const pi = this.pieceInfo(w, piece); if (!pi) return null;
    const h = w.get(stall, this.b.stallHeader);
    const pts = stallPoints(this.reg, pi.vis, pi.rot, pi.dmg, stallStateIndex(this.reg, pi.vis, h?.open ?? 1));
    const slot = pts.slots.find((s) => s.index === p.listingSlot)?.p ?? { x: 0, y: -pts.frame.anchorY * 0.5 };
    const r = this.renderer; const at = isoPlace(pi.sx + slot.x, pi.sy + slot.y, pi.key + 0.1 + Math.max(0, -slot.y) * r.zFactor / r.iso.zStep, r.iso.tileW / 2, r.iso.tileH / 2, r.iso.zStep, r.zFactor, r.iso.view ?? 0);
    const pj = fx.particles; const n = pj ? Math.max(1, pj.count) : 1; const out: VfxSpawn[] = [];
    for (let i = 0; i < n; i++) {
      const sp = pj ? pj.speed[0] + (pj.speed[1] - pj.speed[0]) * Math.random() : 1; const ang = Math.random() * Math.PI * 2; const hs = (pj?.spread ?? 1) * Math.random() * 0.5;
      out.push({ spriteId: fx.sprite, x: at.x, y: at.y, z: at.z, lifetime: fx.lifetime, emissive: fx.blend === "additive", scale: 0.35,
        vx: Math.cos(ang) * hs * sp, vy: Math.sin(ang) * hs * sp, vz: sp * 2.2, gravity: (pj?.gravity ?? 1) * 4, fade: pj?.fade ?? true,
        scaleCurve: [pj?.scaleCurve[0] ?? 1, pj?.scaleCurve[pj.scaleCurve.length - 1] ?? 1] });
    }
    return out;
  }
  /** Entity index helper for tests. */
  static index(e: Entity): number { return entityIndex(e); }
}

function hexColor(h: string): [number, number, number, number] {
  const n = parseInt(h.replace("#", ""), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}
