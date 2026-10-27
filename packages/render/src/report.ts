/**
 * ADR-201: render-side errors that used to be swallowed (`() => undefined`, empty catch) are routed here. The client
 * installs a sink that writes them to the persistent error log (ADR-198); `visible` ones also show the overlay.
 * Without a sink they go to console.warn. Never throws.
 */
export interface RenderErrorReport { where: string; error: unknown; visible: boolean }
type Sink = (r: RenderErrorReport) => void;
let sink: Sink | undefined;
export function setRenderErrorSink(s: Sink | undefined): void { sink = s; }
export function reportRenderError(where: string, error: unknown, visible = false): void {
  try { if (sink) sink({ where, error, visible }); else console.warn(`[render] ${where}:`, error); } catch { /* reporting must never break a frame */ }
}
