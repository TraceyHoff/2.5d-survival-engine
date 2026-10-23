import { readFileSync } from "node:fs";
import { loadManifest } from "/workspace/engine/packages/assets/src/index.ts";
const ui = JSON.parse(readFileSync("/workspace/assets/ui/atlas/engine/manifest.ui.json", "utf8"));
const { registry } = loadManifest(ui);
const r = registry.byKey("ui_panel_wood");
const f = registry.frame(r.id, "idle", 0, 0);
console.log("ok sprites", registry.size, "panel_wood", f.x, f.y, f.w, f.h, JSON.stringify(f.nineSlice));
const sample = JSON.parse(readFileSync("/workspace/engine/packages/assets/sample/manifest.json", "utf8"));
const merged = { ...sample, atlases: [...sample.atlases, ...ui.atlases], sprites: [...sample.sprites, ...ui.sprites] };
const m = loadManifest(merged); console.log("merged with sample ok", m.registry.size);
// Default content pack (packages/assets/pack, batch 9): the real merge target.
const pack = JSON.parse(readFileSync("/workspace/engine/packages/assets/pack/manifest.json", "utf8"));
const frag = JSON.parse(readFileSync("/workspace/assets/ui/atlas/engine/manifest.ui.pack.json", "utf8"));
const mp = loadManifest({ ...pack, atlases: [...pack.atlases, ...frag.atlases], sprites: [...pack.sprites, ...frag.sprites] });
console.log("merged with default pack ok", mp.registry.size);
