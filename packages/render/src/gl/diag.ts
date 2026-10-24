/**
 * `?diag=1` render diagnostics: per-pass gl.getError, FBO / texture status and small pixel readbacks of the
 * scene FBO, lightmap and final output on frames 1 and 60. Pure helpers here (unit-tested); IsoRenderer gathers.
 */

export type Rgba = [number, number, number, number];
export interface DiagReadback { frame: number; scene: Rgba[]; light: Rgba[]; output: Rgba[]; clear: Rgba; instances: number; drawCalls: number; empty: boolean }
export interface RenderDiag {
  enabled: boolean;
  safe: boolean;
  /** Times the renderer switched itself to safe mode (empty scene while instances were drawn). */
  autoSafe: number;
  /** checkFramebufferStatus name per target ("scene", "lightmap", "bloom0", ...). */
  fbo: Record<string, string>;
  /** Texture state: atlas array layers / levels / downscale and upload errors. */
  textures: { atlasLayers: number; atlasLayerSize: number; atlasLevels: number; atlasDownscale: number; pool: boolean; uploadErrors: string[] };
  /** gl.getError name after each pass of the last diagnosed frame. */
  passErrors: Record<string, string>;
  readbacks: DiagReadback[];
  messages: string[];
}

export const newDiag = (enabled: boolean, safe: boolean): RenderDiag => ({ enabled, safe, autoSafe: 0, fbo: {}, textures: { atlasLayers: 0, atlasLayerSize: 0, atlasLevels: 0, atlasDownscale: 1, pool: false, uploadErrors: [] }, passErrors: {}, readbacks: [], messages: [] });

/** `?diag=1` / `?diag` in a query string. */
export function parseDiagFlag(search: string | undefined): boolean {
  if (!search) return false; const v = new URLSearchParams(search).get("diag"); return v !== null && v !== "0" && v !== "false";
}

const GL_ERRORS: Record<number, string> = { 0: "NO_ERROR", 0x500: "INVALID_ENUM", 0x501: "INVALID_VALUE", 0x502: "INVALID_OPERATION", 0x505: "OUT_OF_MEMORY", 0x506: "INVALID_FRAMEBUFFER_OPERATION", 0x9242: "CONTEXT_LOST_WEBGL" };
export const glErrorName = (e: number): string => GL_ERRORS[e] ?? "0x" + e.toString(16);
const FBO_STATUS: Record<number, string> = { 0x8cd5: "COMPLETE", 0x8cd6: "INCOMPLETE_ATTACHMENT", 0x8cd7: "MISSING_ATTACHMENT", 0x8cd9: "INCOMPLETE_DIMENSIONS", 0x8cdd: "UNSUPPORTED", 0x8d56: "INCOMPLETE_MULTISAMPLE" };
export const fboStatusName = (s: number): string => FBO_STATUS[s] ?? "0x" + s.toString(16);

/** Normalised sample points (centre, quarter points, lower third where the ground usually is). */
export const SAMPLE_POINTS: readonly [number, number][] = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.33]];

/** Scene counts as empty when every sampled pixel equals the clear colour (within tol of 0..255). */
export function isEmptyScene(pixels: readonly Rgba[], clear: Rgba, tol = 3): boolean {
  if (pixels.length === 0) return true;
  return pixels.every((p) => Math.abs(p[0] - clear[0]) <= tol && Math.abs(p[1] - clear[1]) <= tol && Math.abs(p[2] - clear[2]) <= tol);
}

const hex = (p: Rgba): string => "#" + p.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("") + (p[3] !== 255 ? `/${p[3]}` : "");

/** Plain-text report for the client's diag overlay. */
export function formatDiagReport(d: RenderDiag, head: { renderer: string; mobile: boolean; precision: string; budgetMB: number; vramMB?: number; fallbacks: string[]; problems: string[] }): string {
  const L: string[] = [];
  L.push(`render diag  ${head.renderer}  mobile=${head.mobile}  frag=${head.precision}  safe=${d.safe}${d.autoSafe ? ` (auto x${d.autoSafe})` : ""}`);
  const t = d.textures;
  L.push(`atlas: ${t.atlasLayers} layers @ ${t.atlasLayerSize}px, ${t.atlasLevels} mips, downscale x${t.atlasDownscale}, pool=${t.pool}, budget ${head.budgetMB} MB${head.vramMB !== undefined ? `, vram ${head.vramMB} MB` : ""}`);
  if (t.uploadErrors.length) L.push(`atlas errors: ${t.uploadErrors.join("; ")}`);
  L.push(`fbo: ${Object.entries(d.fbo).map(([k, v]) => `${k}=${v}`).join(" ") || "(not checked)"}`);
  L.push(`gl errors: ${Object.entries(d.passErrors).map(([k, v]) => `${k}=${v}`).join(" ") || "(none recorded)"}`);
  for (const r of d.readbacks) {
    L.push(`frame ${r.frame}: instances=${r.instances} draws=${r.drawCalls} clear=${hex(r.clear)} ${r.empty ? "SCENE EMPTY" : "scene ok"}`);
    L.push(`  scene  ${r.scene.map(hex).join(" ")}`); L.push(`  light  ${r.light.map(hex).join(" ")}`); L.push(`  output ${r.output.map(hex).join(" ")}`);
  }
  if (head.fallbacks.length) L.push(`fallbacks: ${head.fallbacks.join("; ")}`);
  if (head.problems.length) L.push(`problems: ${head.problems.join("; ")}`);
  for (const m of d.messages) L.push(`! ${m}`);
  return L.join("\n");
}
