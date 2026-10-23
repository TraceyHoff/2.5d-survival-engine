/**
 * Trade stalls demo / screenshots (stalls.html). Content: the pack manifest + Art's stalls and pvp_clan fragments
 * (mergeManifestFragments adapter), real stall art from /@art/stalls. Mock gameplay components with the agreed schemas.
 * URL: ?mode=rotations|states|tints|lanterns  time=0..24  zoom=  shot=1
 */
import { World, Transform, defineComponent, type Entity } from "@engine/core";
import { TileMap, tileToChunk, tileToLocal } from "@engine/world";
import { DEFAULT_MANIFEST, fetchDefaultManifest, type ManifestJson } from "@engine/assets";
import { IsoRenderer, sourcesFromManifest, mergeManifestFragments, StallLayer, parseStallTuning, buildRuntimeSdf, TileId } from "../src/index.js";
import { BuildPiece } from "./mockGameplay.js";
import { initTime } from "./time.js";

declare global { interface Window { __iso?: Record<string, unknown> } }
const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => { const v = q.get(k); const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? n : d; };
const ART = "/@art/"; const ASSETS = "/@assets/";
const StallHeader = defineComponent("StallHeader", { ownerKind: "u8", ownerId: "u32", open: "u8", listingCount: "u8" });
const Listings = defineComponent("Listings", { priceItem: { type: "u16", length: 24 }, priceCount: { type: "u16", length: 24 }, qty: { type: "u16", length: 24 }, enabled: { type: "u8", length: 24 }, revision: "u32" });
const Stock = defineComponent("Container", { items: { type: "u16", length: 24 }, counts: { type: "u16", length: 24 } });
/** DEMO item ids -> sprite keys (pack items; 1 = coin from stall_icons). */
const ITEMS = ["", "coin", "berries", "apple", "carrot", "mushroom", "cooked_meat", "bandage", "rope", "planks", "iron_ingot", "water_flask", "cloth", "arrow", "blueberries", "pumpkin"];
const LISTINGS: Record<string, number> = { stall_blanket: 4, stall_cart: 8, stall_booth: 12, clan_pavilion: 24, market_counter: 6 };

async function main(): Promise<void> {
  window.__iso = { ready: false };
  const frags: { json: ManifestJson; artBase: string }[] = [];
  for (const f of ["stalls/manifest.fragment.json", "pvp_clan/manifest.fragment.json"]) frags.push({ json: await (await fetch(ART + f)).json() as ManifestJson, artBase: ART });
  const manifestUrl = ASSETS + DEFAULT_MANIFEST; let issues: string[] = [];
  const { registry: reg } = await fetchDefaultManifest(ASSETS, async (u) => {
    const r = await fetch(u); if (u !== manifestUrl || !r.ok) return r;
    const m = mergeManifestFragments(await r.json() as ManifestJson, frags); issues = m.issues; return { ok: true, json: async () => m.manifest };
  });
  if (issues.length) console.warn("fragment merge:", issues);
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const renderer = new IsoRenderer(canvas, { preserveDrawingBuffer: true });
  await renderer.atlas.setRegistry(reg, sourcesFromManifest(reg, manifestUrl));
  const world = new World({ seed: 3 }); IsoRenderer.registerComponents(world);
  for (const c of [BuildPiece, StallHeader, Listings, Stock]) world.register(c);
  initTime(world, num("time", 11), 20 * 60 * 4);
  const map = new TileMap(); const N = 48;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { map.setTile(x, y, (x + y) % 7 === 0 && x > 8 ? TileId.Dirt : TileId.Grass); map.ensureChunk(tileToChunk(x), tileToChunk(y)).setHeight(tileToLocal(x), tileToLocal(y), 1); }
  renderer.tilemap = map;
  renderer.bindGameplay({ buildPiece: BuildPiece });

  const signs = new Map<number, string>();
  const place = (key: string, x: number, y: number, o: { rot?: number; open?: number; soldOut?: boolean; tint?: number; clan?: boolean; sign?: string } = {}): Entity => {
    const s = reg.byKey(key); const e = world.create(); const n = LISTINGS[s.building!.piece] ?? 4;
    world.add(e, Transform, { x, y, z: 1, facing: 0 });
    world.add(e, BuildPiece, { visualId: s.id, variant: 0, tint: o.tint ?? 0, damageStage: 0, rotation: o.rot ?? 0, level: 0, layer: s.building!.layer, ghost: 0 });
    world.add(e, StallHeader, { ownerKind: o.clan ? 2 : 1, ownerId: e & 0xffff, open: o.open ?? 1, listingCount: n });
    world.add(e, Listings, {}); world.add(e, Stock, {});
    for (let i = 0; i < n; i++) {
      world.getArray(e, Listings, "priceItem")![i] = 1; world.getArray(e, Listings, "priceCount")![i] = 1 + ((i * 7 + x) % 12); world.getArray(e, Listings, "qty")![i] = 1; world.getArray(e, Listings, "enabled")![i] = 1;
      world.getArray(e, Stock, "items")![i] = 2 + ((i + x + y) % (ITEMS.length - 2)); world.getArray(e, Stock, "counts")![i] = o.soldOut ? 0 : 1 + (i % 4);
    }
    if (o.sign) signs.set(e, o.sign);
    return e;
  };
  const mode = q.get("mode") ?? "rotations"; let look: [number, number] = [20, 20];
  if (mode === "rotations") {
    const keys = ["stall_blanket_patch", "stall_cart_pine_red", "stall_booth_thatch", "clan_pavilion", "clan_trading_post"];
    keys.forEach((k, row) => { for (let r = 0; r < 4; r++) place(k, 6 + r * 6, 6 + row * 5, { rot: r, tint: k.startsWith("clan") ? 2 : 0, clan: k.startsWith("clan"), sign: ["Bo", "Pip's Cart", "Tilda's Pantry", "Sky Traders", "Post"][row]! + ` r${r}` }); });
    look = [17, 17];
  } else if (mode === "states") {
    place("stall_cart_dark_teal", 10, 10, { open: 1, sign: "Open" }); place("stall_cart_dark_teal", 15, 10, { open: 0, sign: "Closed" }); place("stall_cart_dark_teal", 20, 10, { open: 1, soldOut: true, sign: "Sold out" });
    place("stall_booth_bluecloth", 10, 16, { open: 1, sign: "Iron Ivy" }); place("stall_booth_bluecloth", 15, 16, { open: 0, sign: "Iron Ivy" }); place("stall_booth_bluecloth", 20, 16, { open: 1, soldOut: true, sign: "Iron Ivy" });
    look = [17, 15];
  } else if (mode === "tints") {
    for (let i = 0; i < 4; i++) place("clan_pavilion", 8 + i * 7, 10, { tint: 1 + i * 3, clan: true, sign: reg.clanPalettes[i * 3]?.key ?? "clan" });
    for (let i = 0; i < 4; i++) place("clan_trading_post", 9 + i * 7, 17, { tint: 2 + i * 3, clan: true, sign: reg.clanPalettes[1 + i * 3]?.key ?? "clan" });
    look = [19, 15];
  } else {
    place("stall_booth_thatch", 10, 10, { sign: "Tilda's Pantry" }); place("stall_booth_redroof", 15, 10, { sign: "Iron Ivy" }); place("stall_booth_bluecloth", 20, 10, { sign: "Blue Bell" });
    place("clan_pavilion", 12, 16, { tint: 1, clan: true, sign: "Berry Clan" }); place("clan_pavilion", 19, 16, { tint: 2, clan: true, sign: "Sky Traders" });
    look = [17, 14];
  }
  const stalls = new StallLayer(renderer, reg, {
    stallHeader: StallHeader, listings: Listings, stock: Stock,
    itemSprite: (i) => { const k = ITEMS[i]; return k ? reg.ids.sprites.tryId(k) : undefined; },
    signText: (_w, piece) => signs.get(piece),
  });
  const tj = await fetch(ART + "stalls/render_tuning.stalls.json").then((r) => r.json()).catch(() => null);
  if (tj) { const t = parseStallTuning(tj); stalls.setTuning(t.tuning); if (t.warnings.length) console.warn(t.warnings); }
  try { const ff = new FontFace("Fredoka", `url(${ART}ui/fonts/Fredoka.ttf)`, { weight: "300 700" }); await ff.load(); (document.fonts as unknown as Set<FontFace>).add(ff); } catch (e) { console.warn("Fredoka load failed", e); }
  stalls.setFont(buildRuntimeSdf("Fredoka", stalls.tuning.sign.weight));
  renderer.camera.lookAt(look[0], look[1], 1); renderer.camera.zoom = num("zoom", 1.25);
  const resize = (): void => renderer.resize(innerWidth, innerHeight, 1); addEventListener("resize", resize); resize();
  let frames = 0; let saleAt = 0;
  const frame = (): void => {
    frames++;
    if (q.get("sale") === "1" && frames - saleAt > 40) { saleAt = frames; const e = [...signs.keys()][0]!; renderer.vfx.handle({ tick: frames, def: { name: "gameplay.stall_sale" }, payload: { stall: e, listingSlot: 2 } }); }
    stalls.prepare(world); renderer.render(world, 1); stalls.drawOverlay();
    window.__iso = { ready: frames > 30, stats: { ...renderer.stats }, stalls: stalls.stats, glyphs: stalls.textGlyphs, issues, mode };
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
main().catch((e: unknown) => { console.error(e); window.__iso = { ready: false, error: String((e as Error)?.stack ?? e) }; });
