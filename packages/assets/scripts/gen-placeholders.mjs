// Generates cute cartoony placeholder atlases (bright shapes, dark outlines) + sample manifest. No deps.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const OUT = fileURLToPath(new URL("../sample/", import.meta.url)); mkdirSync(OUT, { recursive: true });

const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); }
function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.px = Buffer.alloc(w * h * 4); }
  set(x, y, c) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = (y * this.w + x) * 4; this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; this.px[i + 3] = c[3] ?? 255; }
  /** filled shape via predicate with 1.5px dark outline */
  shape(ox, oy, w, h, inside, fill, outline = [40, 30, 50]) {
    for (let y = -2; y < h + 2; y++) for (let x = -2; x < w + 2; x++) {
      if (inside(x, y)) this.set(ox + x, oy + y, fill);
      else { let near = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (inside(x + dx, y + dy)) near = true; if (near) this.set(ox + x, oy + y, outline); }
    }
  }
  ellipse(cx, cy, rx, ry, fill) { this.shape(cx - rx, cy - ry, rx * 2, ry * 2, (x, y) => ((x - rx) / rx) ** 2 + ((y - ry) / ry) ** 2 <= 1, fill); }
  rect(x, y, w, h, fill) { this.shape(x, y, w, h, (a, b) => a >= 0 && b >= 0 && a < w && b < h, fill); }
  diamond(cx, cy, hw, hh, fill) { this.shape(cx - hw, cy - hh, hw * 2, hh * 2, (x, y) => Math.abs(x - hw) / hw + Math.abs(y - hh) / hh <= 1, fill); }
  save(name) { writeFileSync(OUT + name, png(this.w, this.h, this.px)); }
}
const DIRS8 = Array.from({ length: 8 }, (_, d) => [Math.cos((d * Math.PI) / 4), Math.sin((d * Math.PI) / 4)]);
// Characters/zombies: 4 frames (idle0, idle1, walk0, walk1) x 8 direction rows, 32x48 frames
function creatureAtlas(name, body, head, eye) {
  const FW = 32, FH = 48, C = 4, R = 8, cv = new Canvas(FW * C, FH * R);
  for (let d = 0; d < R; d++) for (let f = 0; f < C; f++) {
    const ox = f * FW, oy = d * FH, bob = f % 2, step = f >= 2 ? (f === 2 ? -2 : 2) : 0, [dx, dy] = DIRS8[d];
    cv.ellipse(ox + 16, oy + 44, 9, 3, [0, 0, 0, 70]);                       // shadow
    cv.rect(ox + 10 + step, oy + 36, 4, 7, body.map((c) => c * 0.7)); cv.rect(ox + 18 - step, oy + 36, 4, 7, body.map((c) => c * 0.7)); // legs
    cv.ellipse(ox + 16, oy + 30 - bob, 8, 8, body);                          // body
    cv.ellipse(ox + 16, oy + 15 - bob, 10, 10, head);                        // big cute head
    const ex = ox + 16 + dx * 5, ey = oy + 15 - bob + dy * 3;
    if (dy > -0.7) { cv.ellipse(ex - 3, ey, 1.5, 2, eye); cv.ellipse(ex + 3, ey, 1.5, 2, eye); }
  }
  cv.save(`${name}.png`); return { key: name, image: `${name}.png`, frameW: FW, frameH: FH, columns: C, rows: R };
}
// Icon grid atlases: 32x32 per frame, one shape per cell
function iconAtlas(name, draws, FW = 32, FH = 32) {
  const C = 4, R = Math.ceil(draws.length / C), cv = new Canvas(FW * C, FH * R);
  draws.forEach((fn, i) => fn(cv, (i % C) * FW, Math.floor(i / C) * FH, FW, FH));
  cv.save(`${name}.png`); return { key: name, image: `${name}.png`, frameW: FW, frameH: FH, columns: C, rows: R };
}
const atlases = [
  creatureAtlas("characters", [80, 150, 255], [255, 214, 170], [30, 30, 40]),
  creatureAtlas("zombies", [120, 170, 90], [150, 210, 120], [220, 40, 40]),
  iconAtlas("items", [
    (c, x, y) => c.rect(x + 8, y + 10, 16, 12, [170, 110, 60]),                 // wood
    (c, x, y) => c.ellipse(x + 16, y + 17, 10, 8, [160, 160, 175]),             // stone
    (c, x, y) => c.ellipse(x + 16, y + 16, 8, 8, [230, 50, 90]),                // berry
    (c, x, y) => c.ellipse(x + 16, y + 17, 6, 9, [90, 200, 255]),               // water
  ]),
  iconAtlas("equipment", [
    (c, x, y) => { c.rect(x + 14, y + 10, 4, 18, [150, 100, 60]); c.rect(x + 9, y + 5, 14, 7, [190, 190, 210]); }, // axe
    (c, x, y) => { c.rect(x + 14, y + 10, 4, 18, [150, 100, 60]); c.rect(x + 6, y + 5, 20, 5, [120, 120, 140]); }, // pickaxe
    (c, x, y) => c.rect(x + 14, y + 4, 4, 24, [220, 220, 240]),                // sword
    (c, x, y) => c.ellipse(x + 16, y + 16, 11, 11, [200, 140, 60]),            // shield
  ]),
  iconAtlas("resources", [
    (c, x, y) => { c.rect(x + 14, y + 40, 6, 18, [140, 90, 50]); c.ellipse(x + 17, y + 28, 15, 18, [60, 190, 90]); }, // tree
    (c, x, y) => c.ellipse(x + 16, y + 50, 14, 10, [150, 150, 165]),           // boulder
    (c, x, y) => { c.ellipse(x + 16, y + 48, 13, 11, [70, 170, 70]); c.ellipse(x + 11, y + 45, 2, 2, [230, 40, 80]); c.ellipse(x + 20, y + 50, 2, 2, [230, 40, 80]); }, // bush
    (c, x, y) => { c.ellipse(x + 16, y + 50, 13, 10, [130, 120, 130]); c.ellipse(x + 13, y + 48, 3, 2, [230, 150, 90]); }, // iron vein
  ], 32, 64),
  iconAtlas("buildings", [
    (c, x, y) => c.diamond(x + 32, y + 48, 31, 15, [200, 160, 110]),           // floor
    (c, x, y) => { c.rect(x + 4, y + 16, 56, 32, [190, 130, 80]); c.rect(x + 4, y + 12, 56, 6, [150, 100, 60]); }, // wall
    (c, x, y) => { c.rect(x + 26, y + 6, 12, 50, [170, 170, 185]); },        // pillar
    (c, x, y) => { c.ellipse(x + 32, y + 50, 14, 6, [120, 120, 120]); c.ellipse(x + 32, y + 42, 7, 10, [255, 150, 40]); }, // campfire
  ], 64, 64),
  iconAtlas("tiles", [
    (c, x, y) => c.diamond(x + 32, y + 16, 31, 15, [80, 170, 240]),            // water
    (c, x, y) => c.diamond(x + 32, y + 16, 31, 15, [240, 220, 150]),           // sand
    (c, x, y) => c.diamond(x + 32, y + 16, 31, 15, [120, 210, 100]),           // grass
    (c, x, y) => c.diamond(x + 32, y + 16, 31, 15, [70, 160, 80]),             // forest
    (c, x, y) => c.diamond(x + 32, y + 16, 31, 15, [160, 160, 170]),           // rock
  ], 64, 32),
];
const creature = (key, category, atlas) => ({ key, category, atlas, anchor: { x: 0.5, y: 0.92 },
  animations: { idle: { frames: [0, 1], fps: 3, directions: 8 }, walk: { frames: [2, 3], fps: 8, directions: 8 } } });
const icon = (key, category, atlas, f, anchor) => ({ key, category, atlas, ...(anchor ? { anchor } : {}), animations: { idle: { frames: [f], fps: 1 } } });
const manifest = { version: 1, name: "placeholder", atlases, sprites: [
  creature("player", "character", "characters"), creature("zombie_walker", "zombie", "zombies"),
  ...["wood", "stone", "berries", "water_flask"].map((k, i) => icon(k, "item", "items", i, { x: 0.5, y: 0.5 })),
  ...["stone_axe", "stone_pickaxe", "sword", "shield"].map((k, i) => icon(k, "equipment", "equipment", i, { x: 0.5, y: 0.5 })),
  ...["tree", "boulder", "berry_bush", "iron_vein"].map((k, i) => icon(k, "resource", "resources", i, { x: 0.5, y: 0.92 })),
  ...["floor", "wall", "pillar", "campfire"].map((k, i) => icon(k, "building", "buildings", i, { x: 0.5, y: 0.75 })),
  ...["tile_water", "tile_sand", "tile_grass", "tile_forest", "tile_rock"].map((k, i) => icon(k, "tile", "tiles", i, { x: 0.5, y: 0.5 })),
] };
writeFileSync(OUT + "manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${atlases.length} atlases + manifest.json (${manifest.sprites.length} sprites) to ${OUT}`);
