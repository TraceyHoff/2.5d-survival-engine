import { defineConfig, type Plugin, type Connect } from "vite";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Demo app (index.html at the package root, sources in demo/ + src/).
 * Read-only static mounts so the demo can load content without copying it:
 *   /@assets/  -> packages/assets          (pack/ = default content via fetchDefaultManifest; sample/ = test fixture)
 *   /@art/     -> <repo>/assets (or $ART_DIR)  (Art & Assets' real content, if present)
 *   /debug/    -> packages/render/assets/debug (served via publicDir)
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const MOUNTS: Record<string, string> = { "/@assets/": join(here, "../assets"), "/@art/": process.env.ART_DIR ?? join(here, "../../assets") };
const TYPES: Record<string, string> = { ".json": "application/json", ".png": "image/png", ".webp": "image/webp" };
const serve: Connect.NextHandleFunction = (req, res, next) => {
  const url = decodeURIComponent((req.url ?? "").split("?")[0]!);
  for (const [prefix, dir] of Object.entries(MOUNTS)) {
    if (!url.startsWith(prefix)) continue;
    const file = normalize(join(dir, url.slice(prefix.length)));
    if (!file.startsWith(normalize(dir)) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end(); return; }
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(res); return;
  }
  next();
};
const mounts = (): Plugin => ({ name: "render-demo-mounts", configureServer: (s) => { s.middlewares.use(serve); }, configurePreviewServer: (s) => { s.middlewares.use(serve); } });

export default defineConfig({
  base: "./", publicDir: "assets", plugins: [mounts()],
  build: { outDir: "dist", target: "es2022", rollupOptions: { input: { main: join(here, "index.html"), preview: join(here, "preview.html") } } }, server: { port: 5173 },
});
