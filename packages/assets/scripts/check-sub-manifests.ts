// Merges pack + sub-manifests exactly like apps/client/src/view.ts and reports duplicate keys (must be 0).
import { readFileSync, existsSync } from "node:fs"; import { join } from "node:path";
import { mergeManifests } from "../src/merge.js";
const root = join(import.meta.dirname, "../../..");
const frags = [["pack", "packages/assets/pack/manifest.json"], ["ui-kit", "assets/ui/kit/manifest.ui.kit.json"], ["branding", "assets/ui/branding/manifest.branding.json"], ["customization", "packages/assets/pack/customization/manifest.customization.json"], ["vehicles", "packages/assets/pack/vehicles/manifest.vehicles.json"], ["items", "packages/assets/pack/items/manifest.items.json"]]
  .filter(([, p]) => existsSync(join(root, p))).map(([name, p]) => ({ name, manifest: JSON.parse(readFileSync(join(root, p), "utf8")) }));
const r = mergeManifests(frags as never);
console.log(`fragments ${frags.length}, duplicates ${r.collisions.length}`); for (const c of r.collisions.slice(0, 20)) console.log(` ${c.section}:${c.key} ${c.fragments.join(",")}`);
process.exit(r.collisions.length ? 1 : 0);
