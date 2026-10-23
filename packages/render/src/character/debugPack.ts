/**
 * DEBUG ONLY (browser): builds a placeholder layered-character pack at runtime from the pack's single-piece character
 * atlases via segmentCharacterSheet. Returns a manifest patch (atlases + sprites + cosmetics, per
 * docs/CHARACTER_CUSTOMIZATION.md) to merge BEFORE loadManifest, and blob-URL atlas sources to add to the renderer's
 * source map. Replace with Art & Assets' real layer atlases; nothing here is shipped content.
 */
import type { ManifestJson } from "@engine/assets";
import type { AtlasSource } from "../assets/atlasManager.js";
import { SKIN_DARK, SKIN_LIGHT, segmentCharacterSheet, type DebugLayerName, type Rgba } from "./debugLayers.js";

export interface DebugCharacterPack { patch(m: ManifestJson): ManifestJson; sources: Map<string, AtlasSource> }
type SpriteJson = ManifestJson["sprites"][number]; type AtlasJson = ManifestJson["atlases"][number];

async function toRgba(url: string): Promise<Rgba> {
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext("2d")!; g.drawImage(bmp, 0, 0);
  const id = g.getImageData(0, 0, bmp.width, bmp.height); return { width: id.width, height: id.height, data: id.data };
}
async function toUrl(im: Rgba): Promise<string> {
  const c = new OffscreenCanvas(im.width, im.height); c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(im.data), im.width, im.height), 0, 0);
  return URL.createObjectURL(await c.convertToBlob({ type: "image/png" }));
}

/** variant a = player (male base), b = player_b (female base), c = player_c (alternate hair/top). */
const VARIANTS = { a: "player", b: "player_b", c: "player_c" } as const;
const LAYERS: DebugLayerName[] = ["body", "hair", "hair_hat", "hat", "accessory", "top", "bottom", "shoes"];

export async function buildDebugCharacterPack(pack: ManifestJson, resolveUrl: (image: string) => string): Promise<DebugCharacterPack> {
  const atlases: AtlasJson[] = []; const sprites: SpriteJson[] = []; const sources = new Map<string, AtlasSource>();
  for (const [v, key] of Object.entries(VARIANTS)) {
    const sp = pack.sprites.find((s) => s.key === key); if (!sp) continue;
    const at = pack.atlases.find((a) => a.key === sp.atlas); if (!at || !at.frameW || !at.frameH) continue;
    const sheets = segmentCharacterSheet(await toRgba(resolveUrl(at.image)), at.frameW, at.frameH, v === "c" ? SKIN_DARK : SKIN_LIGHT);
    for (const l of LAYERS) {
      const k = `dbg_${v}_${l}`;
      atlases.push({ ...at, key: k, image: `debug/${k}.png`, masks: { tintmask: `debug/${k}_tint.png` } } as AtlasJson);
      const { tints: _t, sway: _s, ...rest } = sp as SpriteJson & { tints?: unknown; sway?: unknown };
      sprites.push({ ...rest, key: k, atlas: k } as SpriteJson);
      sources.set(k, { url: await toUrl(sheets[l].shade), emissiveUrl: null, masks: { tintmask: await toUrl(sheets[l].mask) } });
    }
  }
  const body = (v: "a" | "b" | "c", l: DebugLayerName): { sprite: string } => ({ sprite: `dbg_${v}_${l}` });
  const cosmetics = {
    bodyTypes: { male: body("a", "body"), female: body("b", "body") },
    skinTones: [["skin_light", "#f2c9a0"], ["skin_tan", "#d39b6a"], ["skin_brown", "#9a6440"], ["skin_dark", "#5e3b26"], ["skin_pale", "#ffe0cc"]].map(([key, color]) => ({ key: key!, color: color! })),
    hairColors: [["black", "#2a2320"], ["brown", "#6b4423"], ["blonde", "#e0c068"], ["red", "#b0402a"], ["grey", "#b8b8b8"], ["blue", "#3a6ad0"]].map(([key, color]) => ({ key: key!, color: color! })),
    clothingColors: [["white", "#e8e8e8"], ["red", "#c03030"], ["green", "#3c8a40"], ["blue", "#3050b0"], ["yellow", "#e0b020"], ["black", "#303030"], ["purple", "#7a40a0"], ["khaki", "#a89060"]].map(([key, color]) => ({ key: key!, color: color! })),
    wearables: [
      { key: "dbg_hair_short", slot: "hair", layer: 40, tintChannels: 1, bodies: { male: { ...body("a", "hair"), hatHair: body("a", "hair_hat") }, female: { ...body("b", "hair"), hatHair: body("b", "hair_hat") } } },
      { key: "dbg_hair_alt", slot: "hair", layer: 40, tintChannels: 1, bodies: { male: { ...body("c", "hair"), hatHair: body("c", "hair_hat") }, female: { ...body("c", "hair"), hatHair: body("c", "hair_hat") } } },
      { key: "dbg_hat_cap", slot: "hat", layer: 50, tintChannels: 2, hatHair: true, bodies: { male: body("a", "hat"), female: body("b", "hat") } },
      { key: "dbg_scarf", slot: "accessory", layer: 30, tintChannels: 2, bodies: { male: body("a", "accessory"), female: body("b", "accessory") } },
      { key: "dbg_top_a", slot: "top", layer: 20, tintChannels: 1, bodies: { male: body("a", "top"), female: body("b", "top") } },
      { key: "dbg_top_c", slot: "top", layer: 20, tintChannels: 1, bodies: { male: body("c", "top"), female: body("c", "top") } },
      { key: "dbg_bottom", slot: "bottom", layer: 18, tintChannels: 1, bodies: { male: body("a", "bottom"), female: body("b", "bottom") } },
      { key: "dbg_shoes", slot: "shoes", layer: 15, tintChannels: 1, bodies: { male: body("a", "shoes"), female: body("b", "shoes") } },
    ],
  };
  return {
    sources,
    patch: (m) => ({ ...m, atlases: [...m.atlases, ...atlases.filter((a) => !m.atlases.some((x) => x.key === a.key))], sprites: [...m.sprites, ...sprites.filter((s) => !m.sprites.some((x) => x.key === s.key))], ...(m.wearables ? {} : cosmetics) } as ManifestJson),
  };
}
