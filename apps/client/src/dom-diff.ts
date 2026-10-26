/**
 * ADR-158: write-if-changed DOM helpers for per-frame HUD code. Assigning an unchanged attribute / hidden / text still
 * queues a mutation and can invalidate style (the HUD did ~12 such writes per frame: one layout + two style recalcs
 * every frame while nothing on screen changed).
 */
export function setHidden(el: HTMLElement, v: boolean): void { if (el.hidden !== v) el.hidden = v; }
export function setData(el: HTMLElement, k: string, v: string): void { if (el.dataset[k] !== v) el.dataset[k] = v; }
export function setText(el: Node, v: string): void { if (el.textContent !== v) el.textContent = v; }
export function setAttr(el: Element, k: string, v: string): void { if (el.getAttribute(k) !== v) el.setAttribute(k, v); }
export function setStyle(el: HTMLElement, k: string, v: string): void { if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v); }
export function setDisabled(el: HTMLButtonElement, v: boolean): void { if (el.disabled !== v) el.disabled = v; }
