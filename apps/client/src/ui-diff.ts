/**
 * Minimal DOM morph for menu refreshes: patches `dst` in place to match a freshly built `src` so unchanged nodes (and
 * the focused control) survive. Elements match by position + tag + data-key; text nodes update in place. Button
 * handlers are the `onclick` property (copied over, so fresh closures win). Existing inputs keep the user's value.
 * Returns the number of DOM mutations (0 = data unchanged).
 */
/** Handler properties copied from the fresh render onto reused elements (closures see the current view). */
const MORPH_HANDLERS = ["onclick", "onfocus", "onmouseenter", "onmouseleave"] as const;
export function morph(dst: Element, src: Element): number {
  let n = 0;
  for (const a of Array.from(dst.attributes)) if (!src.hasAttribute(a.name)) { dst.removeAttribute(a.name); n++; }
  for (const a of Array.from(src.attributes)) if (dst.getAttribute(a.name) !== a.value) { dst.setAttribute(a.name, a.value); n++; }
  const d = dst as unknown as Record<string, unknown> & { disabled?: boolean }, s = src as unknown as Record<string, unknown> & { disabled?: boolean };
  for (const h of MORPH_HANDLERS) if (d[h] !== s[h]) d[h] = s[h]; // ADR-219: property handlers follow the fresh render (addEventListener ones would go stale)
  if (typeof s.disabled === "boolean" && d.disabled !== s.disabled) { d.disabled = s.disabled; n++; }
  if (dst instanceof HTMLInputElement) return n;
  const sc = Array.from(src.childNodes), dc = Array.from(dst.childNodes);
  for (let i = 0; i < Math.max(sc.length, dc.length); i++) {
    const a = dc[i], b = sc[i];
    if (!b) { a!.remove(); n++; continue; }
    if (!a) { dst.append(b); n++; continue; }
    if (a.nodeType === 3 && b.nodeType === 3) { if (a.nodeValue !== b.nodeValue) { a.nodeValue = b.nodeValue; n++; } continue; }
    if (a instanceof Element && b instanceof Element && a.tagName === b.tagName && (a as HTMLElement).dataset?.["key"] === (b as HTMLElement).dataset?.["key"]) { n += morph(a, b); continue; }
    a.replaceWith(b); n++;
  }
  return n;
}
