import { fetchManifest } from "./manifest.js";

/**
 * Default content: the real art pack (packages/assets/pack/). The placeholder set in packages/assets/sample/
 * is a test fixture only (tests and debug tooling).
 */
export const DEFAULT_MANIFEST = "pack/manifest.json";
export const FIXTURE_MANIFEST = "sample/manifest.json";
/** Fetch the default (pack) manifest relative to where packages/assets is served (e.g. "/assets/"). The lock next to it is picked up. */
export function fetchDefaultManifest(base = "/assets/", fetcher?: Parameters<typeof fetchManifest>[1]): ReturnType<typeof fetchManifest> {
  return fetchManifest(base.replace(/\/?$/, "/") + DEFAULT_MANIFEST, fetcher);
}
