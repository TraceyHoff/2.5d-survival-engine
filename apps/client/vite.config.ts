import { defineConfig, type Plugin, type Connect } from "vite";
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Art for the WebGL2 IsoRenderer, served under `<base>art/` (dev: middleware; build: copied into dist/art/):
 *   art/pack/         <- packages/assets/pack (manifest, piece_variants, atlases/*; audio excluded)
 *   art/survival_fx/  <- assets/survival_fx render_tuning.json + daynight_grading.json + textures/ + lut/
 *   art/ui/           <- assets/ui theme.json + Fredoka font (HUD)
 * GitHub Pages serves the site under /<repo>/; set BASE (e.g. BASE=/2.5d-survival-engine/) for that build.
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../..");
const MOUNTS: [string, string, (rel: string) => boolean][] = [
  ["pack/", join(root, "packages/assets/pack"), (r) => /^(manifest\.json|piece_variants\.json|ids\.lock\.json|atlases\/[^/]+\.(png|json))$/.test(r)],
  ["survival_fx/", join(root, "assets/survival_fx"), (r) => /^(render_tuning\.json|daynight_grading\.json|textures\/[^/]+\.png|lut\/[^/]+\.(png|json))$/.test(r)],
  ["ui/", join(root, "assets/ui"), (r) => /^(theme\.json|fonts\/(Fredoka\.ttf|OFL-Fredoka\.txt))$/.test(r)],
];
const TYPES: Record<string, string> = { ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".ttf": "font/ttf", ".txt": "text/plain" };

function walk(dir: string, rel = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n), r = rel + n; return statSync(p).isDirectory() ? walk(p, r + "/") : [r]; });
}

function art(): Plugin {
  let base = "/", outDir = "dist";
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const url = decodeURIComponent((req.url ?? "").split("?")[0]!);
    const prefix = base + "art/";
    if (!url.startsWith(prefix)) return next();
    const rest = url.slice(prefix.length);
    for (const [p, dir, ok] of MOUNTS) {
      if (!rest.startsWith(p)) continue;
      const rel = rest.slice(p.length); const file = normalize(join(dir, rel));
      if (!ok(rel) || !file.startsWith(normalize(dir)) || !existsSync(file)) break;
      res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
      createReadStream(file).pipe(res); return;
    }
    res.statusCode = 404; res.end();
  };
  return {
    name: "client-art",
    configResolved(c) { base = c.base; outDir = resolve(c.root, c.build.outDir); },
    configureServer(s) { s.middlewares.use(serve); },
    configurePreviewServer(s) { s.middlewares.use(serve); },
    closeBundle() {
      for (const [p, dir, ok] of MOUNTS) for (const rel of walk(dir).filter(ok)) {
        const dst = join(outDir, "art", p, rel); mkdirSync(join(dst, ".."), { recursive: true }); cpSync(join(dir, rel), dst);
      }
    },
  };
}

export default defineConfig({
  base: process.env["BASE"] ?? "/",
  plugins: [art()],
  build: { target: "es2022" },
});
