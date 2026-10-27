import { defineConfig, type Plugin, type Connect } from "vite";
import { cpSync, createReadStream, existsSync, readFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { servedManifestIndex } from "./src/manifest-index.js";

/**
 * Art for the WebGL2 IsoRenderer, served under `<base>art/` (dev: middleware; build: copied into dist/art/):
 *   art/pack/         <- packages/assets/pack (manifest, piece_variants, atlases/*, audio/<bus>/<name>.(ogg|opus|m4a|mp3) for the ADR-117 mixer; .wav masters excluded)
 *   art/survival_fx/  <- assets/survival_fx render_tuning.json + daynight_grading.json + textures/ + lut/
 *   art/ui/           <- assets/ui theme.json + fonts/** + branding/** + kit/** (Cozy Camp kit atlases 1x/2x) + screens/** + screen.schema.json + strings/en.json + input/** (glyphs/touch) + creator/** (ADR-115) + hooks/atlas
 * GitHub Pages serves the site under /<repo>/; set BASE (e.g. BASE=/2.5d-survival-engine/) for that build.
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../..");
const MOUNTS: [string, string, (rel: string) => boolean][] = [
  ["pack/", join(root, "packages/assets/pack"), (r) => /^(manifest\.json|piece_variants\.json|ids\.lock\.json|(?:customization\/)?(?:atlases|mirror)\/[^/]+\.(png|json|ktx2)|(?:vehicles|building|items|nature|vehicle_items)\/(?:manifest\.\w+\.json|atlases\/[^/]+\.(?:png|json|ktx2))|customization\/strings\/en\.json|customization\/manifest\.customization(?:\.[\w-]+)*\.json|audio\/(?:sfx|ambience|ui|music|voice)\/[\w-]+\.(?:ogg|opus|m4a|mp3))$/.test(r)],
  ["survival_fx/", join(root, "assets/survival_fx"), (r) => /^(render_tuning\.json|daynight_grading\.json|textures\/[^/]+\.png|lut\/[^/]+\.(png|json))$/.test(r)],
  ["ui/", join(root, "assets/ui"), (r) => /^(theme\.json|screen\.schema\.json|fonts\/(?:sdf\/)?[^/]+\.(ttf|txt|png|json)|atlas\/ui_atlas(@2x)?\.(png|json)|(?:kit|screens|strings|branding|creator|hooks\/atlas|input|input\/atlas)\/(?:[\w-]+\/)*[^/]+\.(png|webp|svg|json))$/.test(r) && !/\/frames\//.test(r)],
];
const TYPES: Record<string, string> = { ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".ttf": "font/ttf", ".txt": "text/plain", ".svg": "image/svg+xml", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".ktx2": "image/ktx2" };

function walk(dir: string, rel = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n), r = rel + n; return statSync(p).isDirectory() ? walk(p, r + "/") : [r]; });
}

/** Whether `<art>/<url>` is served by MOUNTS (exists and passes the mount filter). */
export function artServed(url: string): boolean {
  for (const [p, dir, ok] of MOUNTS) if (url.startsWith(p)) { const rel = url.slice(p.length); return ok(rel) && existsSync(join(dir, rel)); }
  return false;
}
/** `<art>/manifests.index.json`: only fragments that ship, so the client requests no missing manifests. */
const manifestIndexJson = (): string => JSON.stringify(servedManifestIndex(artServed), null, 1);

function art(): Plugin {
  let base = "/", outDir = "dist", building = false;
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const url = decodeURIComponent((req.url ?? "").split("?")[0]!);
    const prefix = base + "art/";
    if (!url.startsWith(prefix)) return next();
    const rest = url.slice(prefix.length);
    if (rest === "manifests.index.json") { res.setHeader("Content-Type", "application/json"); res.end(manifestIndexJson()); return; }
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
    // vitest resolves this config with build.outDir "dummy-non-existing-folder" and may run closeBundle: only copy art
    // for a real `vite build` (otherwise 658 MB of art landed in apps/client/dummy-non-existing-folder).
    configResolved(c) { base = c.base; outDir = resolve(c.root, c.build.outDir); building = c.command === "build" && !process.env["VITEST"] && !/dummy-non-existing-folder/.test(outDir); },
    configureServer(s) { s.middlewares.use(serve); },
    configurePreviewServer(s) { s.middlewares.use(serve); },
    closeBundle() {
      if (!building) return;
      for (const [p, dir, ok] of MOUNTS) for (const rel of walk(dir).filter(ok)) {
        const dst = join(outDir, "art", p, rel); mkdirSync(join(dst, ".."), { recursive: true }); cpSync(join(dir, rel), dst);
      }
      writeFileSync(join(outDir, "art", "manifests.index.json"), manifestIndexJson());
    },
  };
}

/** Art's branding (assets/ui/branding/, branding.json title = {app.title}), resolved at build time so the client never probes missing files (no 404s). */
const BR = join(root, "assets/ui/branding");
const brandingJson = ((): { title?: string; tagline?: string } => { try { return JSON.parse(readFileSync(join(BR, "branding.json"), "utf8")) as { title?: string; tagline?: string }; } catch { return {}; } })();
/** {app.title}: the game's name. Art's logo is used only once it is drawn for this title (branding.json title matches). */
const APP_TITLE = "SurVivaZ";
const BRANDING = {
  title: APP_TITLE, tagline: brandingJson.tagline ?? "a cozy survival camp-out",
  logo: brandingJson.title === APP_TITLE ? ["logo/logo_1024.png", "logo/logo_512.png", "logo.png"].find((f) => existsSync(join(BR, f))) ?? "" : "",
  bg: existsSync(join(BR, "background/parallax/menu_bg_sky.png")) ? "parallax" : existsSync(join(BR, "background/menu_bg_1920x1080.png")) ? "flat" : "",
  plates: existsSync(join(BR, "buttons/plates/btn_plate_singleplayer_normal.png")),
  icons: existsSync(join(BR, "buttons/icons/ic_menu_singleplayer.png")),
  loading: existsSync(join(BR, "loading/loading_frame.png")) && existsSync(join(BR, "loading/loading_fill.png")),
  loadingAnim: existsSync(join(BR, "loading/loading_zombie_walk.png")) && existsSync(join(BR, "loading/loading_campfire.png")),
};

/** ADR-198: short git hash stamped into the error log (GITHUB_SHA on CI). */
function buildHash(): string { const e = process.env["GITHUB_SHA"]; if (e) return e.slice(0, 8); try { return execSync("git rev-parse --short=8 HEAD", { cwd: root }).toString().trim(); } catch { return "unknown"; } }
export default defineConfig({
  define: { __BRANDING__: JSON.stringify(BRANDING), __BUILD_HASH__: JSON.stringify(buildHash()) },
  base: process.env["BASE"] ?? "/",
  plugins: [art()],
  build: { target: "es2022" },
});
