/**
 * Sub-manifests merged onto the pack manifest (ADR-081 mergeManifests, first definition wins), urls relative to <art>/.
 * vite.config.ts writes `<art>/manifests.index.json` from this list, keeping only fragments that are actually served,
 * so the client never requests a missing optional fragment (no 404s). Without that file the client uses this list.
 */
export interface ManifestFragmentRef { name: string; url: string; optional?: boolean;
  /** ADR-242: image paths in this fragment are relative to this art-root dir ("" = `<art>/`), not to the fragment's own dir
   *  (Art's top-level drops write `pvp_clan/atlases/x.png`). */ root?: string;
  /** ADR-242: stream this fragment's atlases (`residency:"stream"`: fetched on first use, not at boot). */ stream?: boolean }
export const MANIFEST_INDEX: readonly ManifestFragmentRef[] = [
  { name: "pack", url: "pack/manifest.json" },
  { name: "ui-kit", url: "ui/kit/manifest.ui.kit.json", optional: true },
  { name: "branding", url: "ui/branding/manifest.branding.json", optional: true },
  { name: "customization", url: "pack/customization/manifest.customization.json", optional: true },
  { name: "vehicles", url: "pack/vehicles/manifest.vehicles.json", optional: true },
  { name: "items", url: "pack/items/manifest.items.json", optional: true },
  { name: "vehicle_items", url: "pack/vehicle_items/manifest.vehicle_items.json", optional: true },
  { name: "building", url: "pack/building/manifest.building.json", optional: true },
  { name: "nature", url: "pack/nature/manifest.nature.json", optional: true },
  // ADR-242: Art's PvP/clan drop (raid fx, clan banners/gates, nameplates, loot beams) and the stalls drop (stall art,
  // sale coins). Both repeat keys the building pack already serves; mergeManifests keeps building's (first wins).
  { name: "pvp_clan", url: "pvp_clan/manifest.fragment.json", optional: true, root: "", stream: true },
  { name: "stalls", url: "stalls/manifest.fragment.json", optional: true, root: "", stream: true },
];
/** ADR-242: directory (absolute URL) that `frag`'s relative image paths resolve against. */
export function fragmentBase(f: ManifestFragmentRef, fragUrl: string, artUrl: string): string {
  return f.root !== undefined ? new URL(f.root, artUrl).href.replace(/\/?$/, "/") : fragUrl.replace(/[^/]*$/, "");
}
/** ADR-242: apply a ref's flags to its fetched manifest (in place): `stream` marks every atlas `residency:"stream"`. */
export function applyFragmentFlags<M>(f: ManifestFragmentRef, m: M): M {
  const at = (m as { atlases?: { residency?: string }[] }).atlases;
  if (f.stream && Array.isArray(at)) for (const a of at) a.residency ??= "stream";
  return m;
}
/** ADR-240: player v2 sample (spec §11.1). Not in MANIFEST_INDEX (Art keeps it isolated): loadMergedManifest appends it
 *  only when the charArt setting is v2s / v2s-all (v1 = default = not fetched). */
export const CHAR_ART_V2_FRAGMENT: ManifestFragmentRef = { name: "customization_v2_sample", url: "pack/customization_v2_sample/manifest.customization_v2_sample.json", optional: true };
export const withCharArtFragment = (list: readonly ManifestFragmentRef[], art: string): readonly ManifestFragmentRef[] =>
  art === "v1" || list.some((f) => f.name === CHAR_ART_V2_FRAGMENT.name) ? list : [...list, CHAR_ART_V2_FRAGMENT];
/** The served subset: required fragments always, optional ones only when `served(url)`. */
export const servedManifestIndex = (served: (url: string) => boolean): { fragments: ManifestFragmentRef[] } =>
  ({ fragments: MANIFEST_INDEX.filter((f) => !f.optional || served(f.url)) });
