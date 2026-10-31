// ADR-242: engine-side fill for Art's drops: pvp_clan + stalls packs load (streamed, art-root image paths, building keeps
// its duplicates, ids locked append-only), banner@small/@large, no dead hearth/lantern/windsock/mirror fallbacks, held
// lantern/candle lights == gameplay heldLight, random lightning strike, breath in the cold, raid fx + nameplates.
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadManifest, mergeManifests, type ManifestJson } from "@engine/assets";
import { readManifestJson } from "@engine/assets/node";
import { defaultDefs, resolveSprite } from "@engine/gameplay";
import { COLD_BREATH, lightningStrikeAnim, BurningFx, type VfxSpawn } from "@engine/render";
import { MANIFEST_INDEX, applyFragmentFlags, fragmentBase, servedManifestIndex } from "../src/manifest-index.js";
import { DEFAULT_LIGHTS, HELD_LIGHT_ITEMS } from "../src/lights.js";
import { RaidFx, RAID_BURNING, useRaidBurning, type RaidArt } from "../src/raid-fx.js";
import { NAMEPLATE, nineSlice } from "../src/name-tags.js";

const root = resolve(__dirname, "../../..");
const repoPath = (url: string) => resolve(root, url.startsWith("pack/") ? "packages/assets/" + url : "assets/" + url);
const frags = MANIFEST_INDEX.filter((f) => existsSync(repoPath(f.url))).map((f) => ({ name: f.name, manifest: applyFragmentFlags(f, readManifestJson<ManifestJson>(repoPath(f.url))) }));
const lock = JSON.parse(readFileSync(resolve(root, "packages/assets/pack/ids.lock.json"), "utf8"));
const merged = mergeManifests(frags);
const { registry } = loadManifest(merged.manifest, { lock });

describe("ADR-242 pvp_clan + stalls packs", () => {
  test("indexed after nature, optional, art-root paths, streamed", () => {
    const names = MANIFEST_INDEX.map((f) => f.name);
    expect(names.indexOf("pvp_clan")).toBeGreaterThan(names.indexOf("building"));
    for (const n of ["pvp_clan", "stalls"]) {
      const f = MANIFEST_INDEX.find((x) => x.name === n)!; expect(f.optional).toBe(true); expect(f.stream).toBe(true);
      expect(fragmentBase(f, `https://h/b/art/${f.url}`, "https://h/b/art/")).toBe("https://h/b/art/");
      expect(existsSync(repoPath(f.url)), f.url).toBe(true);
    }
    expect(fragmentBase(MANIFEST_INDEX[0]!, "https://h/art/pack/manifest.json", "https://h/art/")).toBe("https://h/art/pack/");
    expect(servedManifestIndex((u) => !u.startsWith("stalls/")).fragments.map((f) => f.name)).toContain("pvp_clan");
  });
  test("every image path of both fragments exists under assets/ (art-root relative)", () => {
    for (const u of ["pvp_clan/manifest.fragment.json", "stalls/manifest.fragment.json"]) {
      const paths = new Set(JSON.stringify(JSON.parse(readFileSync(repoPath(u), "utf8"))).match(/"[\w/.@-]+\.png"/g)!.map((s) => s.slice(1, -1)));
      expect(paths.size).toBeGreaterThan(20);
      for (const p of paths) expect(existsSync(resolve(root, "assets", p)), p).toBe(true);
    }
  });
  test("atlases stream; only pvp_clan/stalls repeat keys and building's copy wins", () => {
    const pv = frags.find((f) => f.name === "pvp_clan")!.manifest as { atlases: { residency?: string }[] };
    expect(pv.atlases.every((a) => a.residency === "stream")).toBe(true);
    for (const c of merged.collisions) expect(c.fragments.slice(1).every((f) => f === "pvp_clan" || f === "stalls"), `${c.section}.${c.key} ${c.fragments}`).toBe(true);
    expect(merged.collisions.some((c) => c.key === "banner" && c.fragments[0] === "building")).toBe(true);
  });
  test("the lock covers the new raid / nameplate / stall keys (append-only)", () => {
    for (const k of ["raid_hit_wood", "raid_hit_stone", "raid_hit_dust", "raid_collapse", "raid_repair", "raid_rubble_smolder", ...Object.values(RAID_BURNING), "stall_sale_coins", "loot_beam"]) {
      expect(lock.vfx[k], k).toBeTypeOf("number"); expect(registry.ids.vfx.tryId(k), k).toBe(lock.vfx[k]);
    }
    for (const k of ["nameplate_neutral", "nameplate_clan", "nameplate_party", "fx_hit_wood", "fx_collapse_poof", "rubble_smoldering"]) expect(lock.sprites[k], k).toBeTypeOf("number");
    const ids = Object.values(lock.vfx as Record<string, number>); expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ADR-242 pieces + lights", () => {
  test("banner variants name small / large -> banner@small / banner@large art", () => {
    const d = defaultDefs(); const b = d.pieces.get(d.pieceId("banner")!)!;
    expect(b.variantNames).toEqual(["", "small", "large"]);
    expect(registry.spriteForPiece("banner@small")).toBeDefined(); expect(registry.spriteForPiece("banner@large")).toBeDefined();
    expect(registry.spriteForPiece("banner@small")).not.toBe(registry.spriteForPiece("banner@large"));
  });
  test("hearths / lantern / windsock / mirror are real art, with lit + unlit states for the fires", () => {
    const fb = JSON.parse(readFileSync(resolve(root, "packages/gameplay/data/sprite_fallbacks.json"), "utf8")) as { sprites: Record<string, unknown> };
    for (const k of ["campfire", "torch_stand", "fireplace", "wood_stove", "lantern", "windsock", "mirror"]) {
      expect(fb.sprites[k], k).toBeUndefined(); expect(resolveSprite(k, (x) => registry.spriteForPiece(x) !== undefined)?.key, k).toBe(k);
    }
    for (const k of ["campfire", "torch_stand", "fireplace", "wood_stove"]) {
      const sp = registry.sprite(registry.spriteForPiece(k)!); const names = sp.animList.map((a) => a.name);
      expect(names, k).toContain("idle"); expect(sp.building?.states?.["unlit"] ?? names.includes("unlit"), k).toBeTruthy();
    }
  });
  test("held lantern / tallow candle light radius == gameplay heldLight (ADR-216/217)", () => {
    const d = defaultDefs();
    for (const k of ["lantern", "tallow_candle", "torch"]) {
      expect(HELD_LIGHT_ITEMS).toContain(k);
      const it = [...d.items.values()].find((i) => i.key === k)!; expect(DEFAULT_LIGHTS[`held_${k}`]!.radius, k).toBe(it.heldLight);
    }
    for (const k of ["held_lantern", "held_tallow_candle"]) expect(registry.ids.sprites.tryId(k), k).toBeDefined();
  });
});

describe("ADR-242 weather / status fx", () => {
  test("lightning picks any strike_* variant uniformly, 0 when the sprite has none", () => {
    const names = ["idle", "strike_a", "flash", "strike_b", "strike_c"];
    expect([0, 0.34, 0.67, 0.999].map((r) => lightningStrikeAnim(names, r))).toEqual([1, 3, 4, 4]);
    expect(lightningStrikeAnim(["idle"], 0.5)).toBe(0);
    const bolt = registry.sprite(registry.ids.sprites.tryId("fx_lightning")!).animList.map((a) => a.name);
    expect(bolt.filter((n) => n.startsWith("strike_")).length).toBeGreaterThanOrEqual(3);
  });
  test("breath puffs once body cold passes COLD_BREATH (not only when shivering)", () => {
    expect(COLD_BREATH).toBeGreaterThan(0); expect(COLD_BREATH).toBeLessThan(1);
    for (const k of ["fx_drip", "fx_breath_puff", "fx_sweat_drop"]) expect(registry.ids.sprites.tryId(k), k).toBeDefined();
  });
});

describe("ADR-242 raid fx", () => {
  const art = registry as unknown as RaidArt;
  const sink = (): { list: VfxSpawn[]; spawn(s: VfxSpawn): void } => { const list: VfxSpawn[] = []; return { list, spawn: (s) => { list.push(s); } }; };
  test("hit -> wood/stone chips + dust, repair -> sparkle, destroyed after a hit -> collapse + smoulder", () => {
    const fx = new RaidFx(); const s = sink(); let seed = 1; fx.rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const p = (hp: number, tier = 1, e = 1) => ({ e, x: 3.5, y: 4.5, z: 0, hp, tier });
    fx.step(art, s, [p(100), p(100, 2, 2), p(50, 1, 3)], 0); expect(s.list).toHaveLength(0); // first sight: no fx
    fx.step(art, s, [p(80), p(90, 2, 2), p(50, 1, 3)], 0.1);
    expect(fx.counts.get("raid_hit_wood")).toBe(6); expect(fx.counts.get("raid_hit_stone")).toBe(6); expect(fx.counts.get("raid_hit_dust")).toBe(2);
    fx.step(art, s, [p(95), p(90, 2, 2), p(50, 1, 3)], 0.2); expect(fx.counts.get("raid_repair")).toBe(1);
    fx.step(art, s, [p(95)], 1); // 2 was hit 0.9 s ago -> collapses; 3 just left interest range -> nothing
    expect(fx.counts.get("raid_collapse")).toBe(12); expect(fx.counts.get("raid_rubble_smolder")).toBe(1);
    const sm = s.list.at(-1)!; expect(sm.lifetime).toBe(6); expect(sm.fade).toBe(true);
    fx.step(art, s, [], 9); expect(fx.counts.get("raid_collapse")).toBe(12); // hit 8.9 s ago: unloaded, not collapsed
    for (const v of s.list) { expect(Number.isFinite(v.x + v.y + (v.z ?? 0))).toBe(true); expect(v.spriteId).toBeGreaterThanOrEqual(0); }
  });
  test("no art -> no fx; burning switches to raid flames only when all four keys are served", () => {
    const fx = new RaidFx(); const s = sink();
    fx.step(undefined, s, [{ e: 1, x: 0, y: 0, z: 0, hp: 9, tier: 0 }], 0); fx.step(undefined, s, [{ e: 1, x: 0, y: 0, z: 0, hp: 1, tier: 0 }], 1); expect(s.list).toHaveLength(0);
    const b = new BurningFx(); expect(useRaidBurning(b, art)).toBe(true); expect(b.cfg).toMatchObject(RAID_BURNING); expect(b.cfg.maxFlames).toBe(4);
    const none = { ids: { vfx: { tryId: () => undefined } }, effect: () => { throw new Error("x"); }, sprite: () => ({ animList: [] }) } as unknown as RaidArt;
    const b2 = new BurningFx(); expect(useRaidBurning(b2, none)).toBe(false); expect(b2.cfg.fireBig).toBe("fire_big");
  });
});

describe("ADR-242 nameplates", () => {
  test("plate frames + nine-slice cover the destination exactly", () => {
    expect(NAMEPLATE.frame).toEqual({ other: 0, party: 2, clan: 3 });
    expect(registry.sprite(registry.ids.sprites.tryId("nameplate_clan")!).animList[0]!.frames[0]).toBeDefined();
    const r = nineSlice(3, 10, 20, 100, 24); expect(r).toHaveLength(9);
    expect(r[0]!.slice(0, 4)).toEqual([3 * 128, 0, 18, 16]); expect(r[8]!.slice(4)).toEqual([101, 36, 9, 8]);
    expect(r.reduce((a, q) => a + q[6]! * q[7]!, 0)).toBeCloseTo(100 * 24);
    const tiny = nineSlice(0, 0, 0, 10, 12); for (const q of tiny) expect(q[6]).toBeGreaterThanOrEqual(0);
  });
});
