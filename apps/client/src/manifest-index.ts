/**
 * Sub-manifests merged onto the pack manifest (ADR-081 mergeManifests, first definition wins), urls relative to <art>/.
 * vite.config.ts writes `<art>/manifests.index.json` from this list, keeping only fragments that are actually served,
 * so the client never requests a missing optional fragment (no 404s). Without that file the client uses this list.
 */
export interface ManifestFragmentRef { name: string; url: string; optional?: boolean }
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
];
/** The served subset: required fragments always, optional ones only when `served(url)`. */
export const servedManifestIndex = (served: (url: string) => boolean): { fragments: ManifestFragmentRef[] } =>
  ({ fragments: MANIFEST_INDEX.filter((f) => !f.optional || served(f.url)) });
