/** ADR-259: draft-only job screens. All controls are the gameplay shell's 44px buttons (pad/keys/touch).
 * Lists are paged, never a fixed-height picker; Cancel sends nothing and current assignment survives refresh. */
import { WorkerJob, WORKER_JOB_LABELS, WORKER_JOB_HELP, WORKER_SELECTION_MAX, workerGatherItems, workerRecipes, workerTargets, visibleMarkers, gameplayDefs, setWorkerJobIntent,
  type MenuCtx, type WorkerView, type WorkerJobDetails } from "@engine/gameplay";
import { Transform, type World, type Entity } from "@engine/core";
import type { GameplaySource, PanelKit } from "./gameplay-panels.js";

type Button = (label: string, key: string, fn: () => void, opts?: { disabled?: boolean; pressed?: boolean; title?: string; role?: string; alt?: boolean }) => HTMLButtonElement;
interface Draft { worker: Entity; job: number; details: WorkerJobDetails; selected: number[]; page: number }
const drafts = new WeakMap<World, Draft>();
const PAGE = 10;
export function beginWorkerJob(world: World, v: WorkerView, job: number): void {
  const details = v.job === job ? { ...v.details } : {};
  drafts.set(world, { worker: v.entity, job, details, selected: [...(details.selections ?? [])], page: 0 });
}
function grid(): HTMLDivElement { const g = document.createElement("div"); g.className = "gm-grid"; return g; }
function focus(key: string): void { const e = document.querySelector<HTMLElement>(`[data-key="${key}"]`); e?.focus(); e?.scrollIntoView?.({ block: "nearest" }); }
export function workerJobMenu(c: MenuCtx, src: GameplaySource, kit: PanelKit, btn: Button, v: WorkerView): Node[] | undefined {
  const d = drafts.get(c.world); if (!d || d.worker !== v.entity) return undefined;
  const defs = gameplayDefs(c.world); const out: Node[] = [];
  const refresh = (key: string): void => { kit.rerender(); focus(key); };
  out.push(btn("Back to jobs (cancel)", "worker-detail-back", () => { drafts.delete(c.world); refresh(`worker-job-${d.job}`); }, { alt: true }));
  out.push(kit.para(`${WORKER_JOB_LABELS[d.job]} — ${WORKER_JOB_HELP[d.job] ?? ""}`));
  const choices: { key: string; label: string; pressed: boolean; choose(): void }[] = [];
  if (d.job === WorkerJob.Gather || d.job === WorkerJob.Craft) {
    const gather = d.job === WorkerJob.Gather;
    out.push(kit.para(gather ? "Choose resource types (up to 16). None selected: gather anything. Food and water still take priority when needed." : "Choose hand recipes (up to 16). Only recipes this worker has the skill to make are listed. They gather ingredients and fetch them from your base storage. None selected: automatic axe → pickaxe → spear progression."));
    const list = gather ? workerGatherItems(c.world).map((id) => ({ id, label: defs.items.get(id)?.name ?? "Resource" }))
      : workerRecipes(c.world, v.entity).map((r) => ({ id: r.id, label: `${defs.items.get(r.output.item)?.name ?? r.key} · ${r.ingredients.map((g) => `${g.count} ${defs.items.get(g.item)?.name ?? "item"}`).join(", ")}` }));
    for (const item of list.sort((a, b) => a.label.localeCompare(b.label) || a.id - b.id)) choices.push({ key: `worker-pick-${item.id}`, label: item.label, pressed: d.selected.includes(item.id), choose: () => {
      if (d.selected.includes(item.id)) d.selected = d.selected.filter((id) => id !== item.id);
      else if (d.selected.length < WORKER_SELECTION_MAX) d.selected.push(item.id);
      else kit.status("Choose at most 16. Deselect a resource or recipe first.");
    } });
    out.push(kit.para(`Selected: ${d.selected.length ? d.selected.map((id) => defs.items.get(gather ? id : defs.recipes.get(id)?.output.item ?? 0)?.name ?? "item").join(", ") : "automatic (default)"}`));
  } else if (d.job === WorkerJob.Follow) {
    out.push(kit.para("Follow you and automatically guard you against nearby threats. They may briefly leave to forage, eat or drink, then return. Survival breaks are always enabled."));
  } else {
    const farm = d.job === WorkerJob.Farm, maintain = d.job === WorkerJob.Maintain;
    out.push(kit.para(farm ? "Water, plant and harvest around your base, a chosen location, or one plot. Choosing one plot does not till new soil elsewhere." : maintain ? "Keep nearby damaged structures repaired; materials come from their pack or your base storage. Choose one piece or a work area." : "Guard your base, a custom point, another nearby player, one of your tamed animals, or a nearby structure."));
    const fixed = grid();
    fixed.append(btn(farm ? "All crops at base" : maintain ? "Damaged pieces at base" : "Guard base", "worker-target-base", () => { d.details = {}; refresh("worker-target-base"); }, { pressed: !d.details.kind }));
    fixed.append(btn("This location (update point)", "worker-target-here", () => { const p = c.world.get(c.player, Transform); if (p) d.details = { kind: 1, x: p.x, y: p.y }; refresh("worker-target-here"); }, { pressed: d.details.kind === 1 }));
    out.push(fixed, kit.para("To change a custom point, stand there and choose This location again, or choose a marker placed on your world map."));
    for (const m of visibleMarkers(c.world, c.player)) choices.push({ key: `worker-marker-${m.entity}`, label: `Map: ${m.label || "Marker"} (${m.x.toFixed(1)}, ${m.y.toFixed(1)})`, pressed: d.details.kind === 1 && d.details.x === m.x && d.details.y === m.y, choose: () => { d.details = { kind: 1, x: m.x, y: m.y }; } });
    for (const t of workerTargets(c.world, c.player, d.job, c.names)) choices.push({ key: `worker-target-${t.entity}`, label: t.entity === c.player ? "You (player)" : t.label, pressed: d.details.kind === 2 && d.details.target === t.entity, choose: () => { d.details = { kind: 2, target: t.entity }; } });
    out.push(kit.para(d.details.kind === 2 ? `Chosen target: ${choices.find((x) => x.pressed)?.label ?? "Target unavailable — choose another before confirming"}` : d.details.kind === 1 ? `Chosen point: (${d.details.x?.toFixed(1)}, ${d.details.y?.toFixed(1)})` : "Chosen area: your base"));
  }
  if (choices.length) {
    const pages = Math.ceil(choices.length / PAGE); d.page = Math.min(d.page, pages - 1);
    const g = grid(); g.dataset["role"] = "worker-detail-choices";
    for (const x of choices.slice(d.page * PAGE, (d.page + 1) * PAGE)) g.append(btn(x.label, x.key, () => { x.choose(); refresh(x.key); }, { pressed: x.pressed, role: "toggle" }));
    out.push(g);
    if (pages > 1) { const nav = grid(); nav.append(btn("Previous choices", "worker-detail-prev", () => { d.page = (d.page - 1 + pages) % pages; refresh("worker-detail-prev"); }), btn("Next choices", "worker-detail-next", () => { d.page = (d.page + 1) % pages; refresh("worker-detail-next"); })); out.push(kit.para(`Choices ${d.page + 1} / ${pages}`), nav); }
  }
  const actions = grid();
  actions.append(btn("Confirm assignment", "worker-detail-confirm", () => {
    const intent = setWorkerJobIntent(v.entity, d.job, { ...d.details, selections: d.selected });
    if (src.send(intent)) { drafts.delete(c.world); kit.status("Assignment requested."); refresh(`worker-job-${d.job}`); }
    else kit.status("Not connected. Your choices have not been sent.");
  }, { disabled: !v.aiHumans || (d.details.kind === 2 && !choices.some((x) => x.pressed)) }));
  out.push(actions); return out;
}
