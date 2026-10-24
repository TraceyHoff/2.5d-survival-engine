// @vitest-environment jsdom
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadManifest, mergeManifests } from "@engine/assets";
import { creatorOptions, showCharacterCreator } from "../src/character-creator.js";
const STARTERS = ["top_henley", "top_striped_tee", "top_polo", "top_cardigan", "bottom_capris", "bottom_cutoffs", "bottom_joggers", "bottom_pleated_skirt",
  "shoes_loafers", "shoes_moccasins", "shoes_slip_ons", "shoes_trail_runners", "face_chops", "face_goatee", "face_long_beard", "face_rosy"];
function catalog(): any {
  const P = "packages/assets/pack/"; const base = JSON.parse(readFileSync(P + "manifest.json", "utf8")); const cz = JSON.parse(readFileSync(P + "customization/manifest.customization.json", "utf8"));
  const { manifest } = mergeManifests([{ name: "pack", manifest: base }, { name: "customization", manifest: cz }] as any, { resolve: (p: string) => p } as any);
  const r = loadManifest(manifest, { lock: JSON.parse(readFileSync(P + "ids.lock.json", "utf8")) }) as any; return (r.registry ?? r).cosmetics;
}
it("ADR-115: every unlock-free starter wearable in the customization manifest is offered by the creator (both bodies)", () => {
  const cz = JSON.parse(readFileSync("packages/assets/pack/customization/manifest.customization.json", "utf8"));
  const list: any[] = Array.isArray(cz.wearables) ? cz.wearables : Object.entries(cz.wearables ?? {}).map(([key, v]: any) => ({ key, ...v }));
  const free = list.filter((w) => !(w.unlockTags ?? w.unlock ?? []).length).map((w) => w.key);
  const cat = catalog(); expect(cat).toBeTruthy();
  for (const b of [0, 1]) { const keys = new Set(Object.values(creatorOptions(cat, b)).flat().map((w: any) => w.key));
    for (const k of STARTERS) expect(keys.has(k), `${k} body ${b}`).toBe(true);
    expect(free.filter((k) => !keys.has(k) && !/hair_|face_/.test(k))).toEqual([]); }
});
it("ADR-115: creator uses Art preview_bg and icon buttons (aria-labelled, @2x)", () => {
  document.body.innerHTML = ""; const p = showCharacterCreator({ root: document.body, catalog: catalog(), artBase: "/art/ui/creator/", pads: () => [] } as any);
  const host = document.querySelector<HTMLElement>('[data-role="creator-preview-host"]')!; expect(host.dataset["bg"]).toBe("preview_bg"); expect(host.style.backgroundImage).toContain("preview_bg");
  for (const n of ["ic_rotate_left", "ic_rotate_right", "ic_randomize"]) { const img = document.querySelector<HTMLImageElement>(`img[data-icon="${n}"]`)!; expect(img.srcset).toContain(`${n}@2x.png 2x`);
    expect(img.closest("button")!.getAttribute("aria-label")).toMatch(/Rotate|Randomize/); }
  void p;
});
