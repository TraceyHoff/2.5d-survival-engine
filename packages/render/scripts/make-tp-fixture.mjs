// Writes a TexturePacker JSON-hash fixture (debug only) describing packages/assets/sample/zombies.png
// with the agreed naming <sprite>/<anim>/<DIR>/<index>, so the TP importer path is exercised end-to-end.
import { writeFileSync } from "node:fs";
const DIRS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
const FW = 32, FH = 48, frames = {};
const anims = { idle: [0, 1], walk: [2, 3] };
DIRS.forEach((d, row) => {
  for (const [anim, cols] of Object.entries(anims)) cols.forEach((c, i) => {
    frames[`zombie_tp/${anim}/${d}/${i}.png`] = {
      frame: { x: c * FW, y: row * FH, w: FW, h: FH }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: FW, h: FH }, sourceSize: { w: FW, h: FH }, pivot: { x: 0.5, y: 0.92 }, duration: anim === "idle" ? 333 : 125,
    };
  });
});
const json = { frames, meta: { app: "fixture (TexturePacker JSON-hash format)", image: "zombies_tp.png", format: "RGBA8888", size: { w: 128, h: 384 }, scale: "1" } };
writeFileSync(new URL("../assets/debug/zombies_tp.json", import.meta.url), JSON.stringify(json, null, 1));
console.log("wrote", Object.keys(frames).length, "frames");
