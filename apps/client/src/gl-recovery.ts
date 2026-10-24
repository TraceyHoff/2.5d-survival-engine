/**
 * WebGL context-loss recovery (never a black world). A lost context (GPU reset / OOM on weak or virtual adapters) steps
 * the start-up quality down one level per loss and rebuilds everything by reloading:
 *   full -> lowend (?gl=lowend) -> safe (?safe=1) -> debug (?renderer=debug, Canvas2D)
 * The level lives in sessionStorage (per tab) so a reload keeps it and a loss loop always ends on the debug renderer.
 * If webglcontextrestored never arrives (canvas 0x0, GPU null), the reload happens after RESTORE_TIMEOUT_MS anyway.
 */
export type GlLevel = "full" | "lowend" | "safe" | "debug";
export const GL_LEVELS: readonly GlLevel[] = ["full", "lowend", "safe", "debug"];
export const GL_LEVEL_KEY = "survivaz.glLevel";
export const RESTORE_TIMEOUT_MS = 4000;

interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }
const store = (): KV | null => { try { return globalThis.sessionStorage ?? null; } catch { return null; } };

export function savedLevel(s: KV | null = store()): GlLevel { const v = s?.getItem(GL_LEVEL_KEY); return (GL_LEVELS as readonly string[]).includes(v ?? "") ? (v as GlLevel) : "full"; }
export function nextLevel(l: GlLevel): GlLevel { return GL_LEVELS[Math.min(GL_LEVELS.length - 1, GL_LEVELS.indexOf(l) + 1)]!; }
/** The level actually used: the stronger of the URL choice and the saved post-loss level. */
export function effectiveLevel(search: string, s: KV | null = store()): GlLevel {
  const q = new URLSearchParams(search);
  const url: GlLevel = q.get("renderer") === "debug" ? "debug" : q.get("safe") === "1" || q.get("gl")?.split(",").includes("safe") ? "safe" : q.get("gl")?.split(",").includes("lowend") ? "lowend" : "full";
  const saved = savedLevel(s);
  return GL_LEVELS.indexOf(saved) > GL_LEVELS.indexOf(url) ? saved : url;
}
/** gl flags for IsoRenderer at a level (undefined = keep the URL's own ?gl=). */
export function levelFlags(l: GlLevel): ("lowend" | "safe")[] | undefined { return l === "safe" ? ["lowend", "safe"] : l === "lowend" ? ["lowend"] : undefined; }

/** Record one context loss: persist the next level down and return it. */
export function stepDownAfterLoss(search: string, s: KV | null = store()): GlLevel { const n = nextLevel(effectiveLevel(search, s)); s?.setItem(GL_LEVEL_KEY, n); return n; }

/** Wire the canvas: preventDefault on loss (allows restore), step down, rebuild via reload on restore or timeout. */
export function attachContextRecovery(canvas: HTMLCanvasElement, o: { notify: (title: string, detail: string) => void; reload?: () => void; timeoutMs?: number; search?: string }): () => void {
  const reload = o.reload ?? (() => location.reload());
  let timer: ReturnType<typeof setTimeout> | undefined; let done = false;
  const go = (): void => { if (done) return; done = true; if (timer) clearTimeout(timer); reload(); };
  const lost = (ev: Event): void => {
    ev.preventDefault(); if (timer || done) return;
    const n = stepDownAfterLoss(o.search ?? location.search);
    o.notify("WebGL context lost", `The GPU reset or ran out of memory. Restarting the renderer at "${n}" quality${n === "debug" ? " (debug view)" : ""}…`);
    timer = setTimeout(go, o.timeoutMs ?? RESTORE_TIMEOUT_MS);
  };
  const restored = (): void => go();
  canvas.addEventListener("webglcontextlost", lost, false); canvas.addEventListener("webglcontextrestored", restored, false);
  return () => { canvas.removeEventListener("webglcontextlost", lost); canvas.removeEventListener("webglcontextrestored", restored); if (timer) clearTimeout(timer); };
}
