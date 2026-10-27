/**
 * ADR-198: persistent client error log. Every frame / renderer / uncaught error and unhandled rejection is recorded
 * (timestamp, short code, message, stack, renderer type, GPU, build hash) into a ring buffer persisted to localStorage.
 * Saves are throttled (one write per SAVE_MS, coalesced) and never throw; repeats of the same error bump a counter
 * instead of flooding the buffer. Viewed and copied from Settings → "Error log".
 */
declare const __BUILD_HASH__: string | undefined;
export const BUILD_HASH: string = (typeof __BUILD_HASH__ !== "undefined" && __BUILD_HASH__) || "dev";
export const ERROR_LOG_KEY = "survivaz.errorlog.v1";
export const ERROR_LOG_MAX = 60;
const SAVE_MS = 1000;
export interface ErrorEntry { t: number; code: string; kind: string; message: string; stack?: string; renderer: string; gpu: string; build: string; count: number; last?: number }
export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** Short, stable code for an error (same title+first message line → same code), e.g. "E-3F9A". */
export function errorCode(kind: string, message: string): string {
  const s = `${kind}|${message.split("\n")[0] ?? ""}`; let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `E-${((h >>> 0) & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
}

export class ErrorLog {
  private entries: ErrorEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Context providers (renderer type / GPU string) set by the view once a renderer exists. */
  ctx: { renderer: () => string; gpu: () => string } = { renderer: () => "unknown", gpu: () => "unknown" };
  constructor(private store: StorageLike | undefined, private now: () => number = Date.now) {
    try { const raw = store?.getItem(ERROR_LOG_KEY); const v: unknown = raw ? JSON.parse(raw) : []; if (Array.isArray(v)) this.entries = v.filter((e): e is ErrorEntry => !!e && typeof (e as ErrorEntry).message === "string").slice(-ERROR_LOG_MAX); } catch { this.entries = []; }
  }
  record(kind: string, err: unknown, extra?: string): ErrorEntry {
    let message: string, stack: string | undefined;
    try {
      if (err instanceof Error) { message = err.message || err.name; stack = err.stack; }
      else if (typeof err === "string") message = err; else message = JSON.stringify(err) ?? String(err);
    } catch { message = "<unserializable error>"; }
    if (extra) message = `${message}\n${extra}`;
    message = message.slice(0, 2000); stack = stack?.slice(0, 4000);
    const code = errorCode(kind, message), t = this.now();
    const last = this.entries[this.entries.length - 1];
    if (last && last.code === code && last.message === message) { last.count++; last.last = t; this.schedule(); return last; }
    let renderer = "unknown", gpu = "unknown";
    try { renderer = this.ctx.renderer(); gpu = this.ctx.gpu(); } catch { /* context probe must never throw out of the logger */ }
    const e: ErrorEntry = { t, code, kind, message, ...(stack ? { stack } : {}), renderer, gpu, build: BUILD_HASH, count: 1 };
    this.entries.push(e); if (this.entries.length > ERROR_LOG_MAX) this.entries.splice(0, this.entries.length - ERROR_LOG_MAX);
    this.schedule(); return e;
  }
  list(): readonly ErrorEntry[] { return this.entries; }
  clear(): void { this.entries = []; this.flush(); }
  private schedule(): void { if (this.timer === undefined) this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, SAVE_MS); }
  flush(): void {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
    try { if (this.entries.length) this.store?.setItem(ERROR_LOG_KEY, JSON.stringify(this.entries)); else this.store?.removeItem(ERROR_LOG_KEY); }
    catch { if (this.entries.length > 5) { this.entries.splice(0, this.entries.length >> 1); try { this.store?.setItem(ERROR_LOG_KEY, JSON.stringify(this.entries)); } catch { /* quota: give up */ } } }
  }
  /** Plain-text report for the clipboard. */
  text(): string {
    if (!this.entries.length) return "No errors recorded.";
    return this.entries.map((e) => `[${new Date(e.t).toISOString()}] ${e.code} ${e.kind}${e.count > 1 ? ` ×${e.count}` : ""}\n${e.message}\nrenderer: ${e.renderer} | ${e.gpu} | build ${e.build}${e.stack ? `\n${e.stack}` : ""}`).join("\n\n");
  }
}

function safeStorage(): StorageLike | undefined { try { return typeof localStorage !== "undefined" ? localStorage : undefined; } catch { return undefined; } }
let shared: ErrorLog | undefined;
export function errorLog(): ErrorLog { return (shared ??= new ErrorLog(safeStorage())); }

/** Hooks window error / unhandledrejection into the log (idempotent); flushes on pagehide. */
let installed = false;
export function installGlobalErrorCapture(target: Pick<Window, "addEventListener"> = window, onError?: (e: ErrorEntry) => void): void {
  if (installed) return; installed = true; const log = errorLog();
  target.addEventListener("error", (ev: Event) => {
    const e = ev as ErrorEvent; if (!("message" in e) && !("error" in e)) return; // resource load errors (img/script) bubble as plain Events
    const r = log.record("Uncaught error", e.error ?? e.message, e.filename ? `@${e.filename.split("/").pop()}:${e.lineno}:${e.colno}` : undefined); onError?.(r);
  });
  target.addEventListener("unhandledrejection", (ev: Event) => { const r = log.record("Unhandled rejection", (ev as PromiseRejectionEvent).reason); onError?.(r); });
  target.addEventListener("pagehide", () => log.flush());
}
