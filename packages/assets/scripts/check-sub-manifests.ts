// Merges pack + sub-manifests exactly like apps/client/src/view.ts and reports duplicate keys (must be 0).
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs"; import { join } from "node:path";
import { mergeManifests } from "../src/merge.js";
const root = join(import.meta.dirname, "../../..");
const frags = [["pack", "packages/assets/pack/manifest.json"], ["ui-kit", "assets/ui/kit/manifest.ui.kit.json"], ["branding", "assets/ui/branding/manifest.branding.json"], ["customization", "packages/assets/pack/customization/manifest.customization.json"], ["vehicles", "packages/assets/pack/vehicles/manifest.vehicles.json"], ["items", "packages/assets/pack/items/manifest.items.json"], ["vehicle_items", "packages/assets/pack/vehicle_items/manifest.vehicle_items.json"], ["building", "packages/assets/pack/building/manifest.building.json"]]
  .filter(([, p]) => existsSync(join(root, p))).map(([name, p]) => ({ name, manifest: JSON.parse(readFileSync(join(root, p), "utf8")) }));
const r = mergeManifests(frags as never);
console.log(`fragments ${frags.length}, duplicates ${r.collisions.length}`); for (const c of r.collisions.slice(0, 20)) console.log(` ${c.section}:${c.key} ${c.fragments.join(",")}`);
// Every .ktx2 under the pack must be non-empty with a full mip chain (levelCount u32 @ byte 40).
const bad: string[] = []; const walk = (d: string): void => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith(".ktx2")) { const n = statSync(f).size; if (n === 0) bad.push(`${f}: 0 bytes`); else if (n < 44 || readFileSync(f).readUInt32LE(40) <= 1) bad.push(`${f}: no mip chain`); } } };
walk(join(root, "packages/assets/pack")); console.log(`ktx2 problems ${bad.length}`); for (const b of bad.slice(0, 20)) console.log(` ${b}`);
process.exit(r.collisions.length || bad.length ? 1 : 0);
