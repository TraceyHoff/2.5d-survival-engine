// Character creator preview demo: DOM controls driving createCharacterPreview. ?shot=1 sets window.__ready.
import { WEARABLE_SLOTS, slotIndex } from "@engine/core";
import { createCharacterPreview } from "../src/index.js";
import { loadContent } from "./content.js";
import { variedAppearance } from "./characters.js";

const q = new URLSearchParams(location.search);
const content = await loadContent({ content: "pack", debugCharacters: true });
const cat = content.registry.cosmetics!;
const pv = await createCharacterPreview(document.getElementById("pv")!, {
  registry: content.registry, sources: content.sources, appearance: variedAppearance(cat as never, Number(q.get("seed") ?? 3)),
  facing: q.has("facing") ? Number(q.get("facing")) : undefined, zoom: Number(q.get("zoom") ?? 1), anim: q.get("anim") === "walk" ? "walk" : "idle",
});
pv.bindKeys();
const ui = document.getElementById("ui")!;
const add = (html: string): HTMLElement => { const d = document.createElement("div"); d.innerHTML = html; ui.appendChild(d); return d; };
const sel = (label: string, opts: [number, string][], cur: number, on: (v: number) => void): void => {
  const d = add(`<label>${label}</label><select>${opts.map(([v, n]) => `<option value="${v}"${v === cur ? " selected" : ""}>${n}</option>`).join("")}</select>`);
  d.querySelector("select")!.onchange = (ev) => on(Number((ev.target as HTMLSelectElement).value));
};
const edit = (f: (a: ReturnType<typeof pv.getAppearance>) => void): void => { const a = pv.getAppearance(); f(a); pv.setAppearance(a); };
const a0 = pv.getAppearance();
sel("Body", [[0, "Body A"], [1, "Body B"]], a0.bodyType, (v) => edit((a) => { a.bodyType = v; }));
sel("Skin", cat.skinTones.map((c, i) => [i, c.key]), a0.skinTone, (v) => edit((a) => { a.skinTone = v; }));
for (const slot of WEARABLE_SLOTS) {
  const si = slotIndex(slot); const items = cat.bySlot(slot);
  if (!items.length) continue;
  sel(slot, [[0, "none"], ...items.map((w) => [w.id, w.key.replace(/^dbg_/, "")] as [number, string])], a0.parts[si] ?? 0, (v) => edit((a) => { a.parts[si] = v; }));
  const pal = slot === "hair" ? cat.hairColors : cat.clothingColors;
  sel(`${slot} colour`, pal.map((c, i) => [i, c.key]), a0.primary[si] ?? 0, (v) => edit((a) => { a.primary[si] = v; }));
}
const b = add(`<label>View</label><button data-r="1">⟲</button><button data-r="-1">⟳</button><button data-a="idle">idle</button><button data-a="walk">walk</button><p>drag = rotate · wheel/pinch = zoom · ←/→ Q/E · LB/RB</p>`);
b.onclick = (ev) => { const t = ev.target as HTMLElement; if (t.dataset.r) pv.rotate(Number(t.dataset.r)); if (t.dataset.a) pv.setAnim(t.dataset.a as "idle" | "walk"); };
(window as unknown as { __pv: typeof pv }).__pv = pv;
requestAnimationFrame(() => requestAnimationFrame(() => { (window as unknown as { __ready: boolean }).__ready = true; }));
