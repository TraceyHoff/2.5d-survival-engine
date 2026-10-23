// Cozy Camp UI prototype runtime: theme tokens -> CSS vars, `{path}` bindings, HUD + inventory driven by a
// state object shaped like ui/screens/mock/state.json (in the game this is the view-model the client adapter
// builds from ECS components each frame). Item icons come from the art pack atlases (TexturePacker hash) via
// background-position; the renderer may later swap these for its cached offscreen icons.
const j = (u) => fetch(u).then((r) => r.json());
const [theme, state, items, equip, food] = await Promise.all([j("../theme.json"), j("../screens/mock/state.json"), j("../../atlases/items.json"), j("../../atlases/equipment.json"), j("../../survival_fx/atlases/surv_food.json").catch(() => ({ frames: {}, meta: { size: { w: 0, h: 0 } } }))]);
const ui = document.getElementById("ui");

// 1) tokens -> CSS custom properties
const rs = document.documentElement.style;
for (const [k, v] of Object.entries(theme.palette)) rs.setProperty(`--${k}`, v);
const tg = theme.vitals.temperature.gradient.map(([p, c]) => `${c} ${p * 100}%`).join(",");
rs.setProperty("--temp-gradient", `linear-gradient(90deg,${tg})`);

// 2) tiny binding: `{a.b.c}` paths (full expression language lives in tools/uikit/expr.py; mirror it for prod)
const get = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
const bindAll = () => ui.querySelectorAll("[data-bind]").forEach((e) => { e.textContent = e.dataset.bind.replace(/\{([^}]+)\}/g, (_, p) => get(state, p.trim()) ?? ""); });

// 3) item icons from art-pack atlases
const atlases = [[items, "../../atlases/items.png"], [equip, "../../atlases/equipment.png"]];
const FOOD_IMG = "../../survival_fx/atlases/surv_food.png";
function sheetBg(e, a, img, f) { e.style.background = `url(${img}) -${f.x}px -${f.y}px / ${a.meta.size.w}px ${a.meta.size.h}px`; }
/** Food decay stage (theme.food.rule): staged art food_<key>/<stage>/0 + food_badge_<stage> at the slot's top-right. */
function badgeEl(stage) {
  const f = food.frames[`food_badge_${stage}/idle/0`]?.frame; if (!f) return null;
  const b = document.createElement("i"); b.className = "fbadge"; b.title = theme.food.stages.find((s) => s.key === stage)?.label ?? stage;
  // badge art sits at (19,19)-(30,30) inside its 32px frame
  b.style.background = `url(${FOOD_IMG}) -${f.x + 19}px -${f.y + 19}px / ${food.meta.size.w}px ${food.meta.size.h}px`; return b;
}
function iconEl(key, stage) {
  const e = document.createElement("i"); e.className = "icon";
  const sf = stage && food.frames[`food_${key}/${stage}/0`]?.frame;
  if (sf) { sheetBg(e, food, FOOD_IMG, sf); return e; }
  for (const [a, img] of atlases) {
    const f = a.frames[key]?.frame; if (!f) continue;
    e.style.background = `url(${img}) -${f.x}px -${f.y}px / ${a.meta.size.w}px ${a.meta.size.h}px`; return e;
  }
  e.style.background = "url(../atlas/frames/ic_star.png) center/contain no-repeat"; return e; // placeholder (golden_acorn etc.)
}
function slotEl(s, hotkey) {
  const d = document.createElement("div"); d.className = "slot"; d.dataset.index = s.index;
  const it = s.item;
  if (hotkey) { const k = document.createElement("span"); k.className = "k"; k.textContent = hotkey; d.append(k); }
  if (it) {
    d.dataset.rarity = it.rarity; d.append(iconEl(it.key, it.food?.stage));
    if (it.food) { const b = badgeEl(it.food.stage); if (b) d.append(b); }
    if (it.count > 1) { const n = document.createElement("b"); n.className = "n"; n.textContent = it.count; d.append(n); }
    if (it.durability != null) { const b = document.createElement("span"); b.className = "dur"; b.style.setProperty("--d", it.durability); d.append(b); }
    d.addEventListener("pointerenter", (ev) => showTip(it, ev)); d.addEventListener("pointerleave", hideTip);
  }
  d.addEventListener("click", () => emit("inventory.slotClick", { container: s.container, index: s.index }));
  return d;
}

// 4) events out: the client wires these to netcode commands (inventory.move, hotbar.select, ...)
const emit = (event, args) => { ui.dispatchEvent(new CustomEvent("ui:action", { detail: { event, args } })); console.log("ui:action", event, args); };

// tooltip
const tip = ui.querySelector(".tooltip");
function showTip(it, ev) {
  const r = theme.rarity[it.rarity];
  tip.innerHTML = `<h3>${it.name}</h3><div class="r" style="color:${r.text}">${r.label} · ${it.categoryLabel}</div><p>${it.description}</p>` +
    (it.food ? `<div class="fresh" style="--c:${theme.food.stages.find((s) => s.key === it.food.stage).color};--v:${1 - it.food.spoiled}">${it.food.stageLabel}<span></span></div>` : "");
  const b = ev.currentTarget.getBoundingClientRect(); tip.hidden = false;
  tip.style.left = `${Math.min(innerWidth - 260, b.right + 8)}px`; tip.style.top = `${Math.max(8, b.top - 20)}px`;
}
function hideTip() { tip.hidden = true; }

// HUD render
function renderVitals() {
  const v = state.player.vitals;
  const vals = { health: [v.health, v.healthMax], hunger: [v.hunger, 100], thirst: [v.thirst, 100], stamina: [v.stamina, v.staminaMax] };
  for (const [k, [a, m]] of Object.entries(vals)) {
    const row = ui.querySelector(`[data-vital=${k}]`), t = theme.vitals[k], p = Math.max(0, Math.min(1, a / m));
    row.style.setProperty("--fill", t.fill); row.style.setProperty("--light", t.light); row.style.setProperty("--dark", t.dark); row.style.setProperty("--v", p);
    row.classList.toggle("low", p <= t.lowAt);
    row.querySelector(".ico").style.setProperty("--f", `url(../atlas/frames/${p <= t.lowAt ? t.icon + "_low" : t.icon}.png)`);
    row.querySelector(".num").textContent = Math.round(a);
  }
  const [lo, hi] = theme.vitals.temperature.range, tr = ui.querySelector("[data-vital=temperature]");
  tr.style.setProperty("--v", (v.bodyTemp - lo) / (hi - lo)); tr.querySelector(".num").textContent = `${Math.round(v.bodyTemp)}°`;
  const h = state.world.time.hours; ui.querySelector(".clock").textContent = `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
}
function renderHotbar() {
  const bar = ui.querySelector(".hud-hotbar"); bar.replaceChildren();
  state.hotbar.slots.slice(0, 8).forEach((s, i) => { const e = slotEl(s, String(i + 1)); e.classList.toggle("sel", i === state.hotbar.selected); bar.append(e); });
}
function renderInventory() {
  const g = ui.querySelector(".inv .grid"); g.replaceChildren(...state.inventory.slots.map((s) => slotEl(s)));
  const w = state.inventory.weight, max = state.inventory.maxWeight; // Inventory.weight / maxWeight components
  ui.querySelector(".inv .w").textContent = `${w.toFixed(1)} / ${max} kg`;
  ui.querySelector(".inv .weight").style.setProperty("--v", Math.min(1, w / max));
}
function toast(text) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = text; ui.querySelector(".toasts").append(t);
  setTimeout(() => t.remove(), 3000);
}

// input
const inv = ui.querySelector(".inv");
const setOpen = (o) => { inv.hidden = !o; hideTip(); emit(o ? "ui.open" : "ui.close", { screen: "inventory" }); };
addEventListener("keydown", (e) => {
  if (e.key === "Tab") { e.preventDefault(); setOpen(inv.hidden); }
  else if (e.key === "Escape") setOpen(false);
  else if (/^[1-8]$/.test(e.key)) { state.hotbar.selected = Number(e.key) - 1; renderHotbar(); emit("hotbar.select", { index: state.hotbar.selected }); }
});
inv.querySelector(".close").addEventListener("click", () => setOpen(false));

// URL flags for screenshots: ?inv=1&low=1
const q = new URLSearchParams(location.search);
if (q.has("still")) ui.classList.add("still"); // for screenshots
if (q.has("low")) { state.player.vitals.hunger = 12; state.player.vitals.health = 20; }
bindAll(); renderVitals(); renderHotbar(); renderInventory();
if (q.has("inv")) setOpen(true);
toast("+3 Wood  (into your backpack)");
// simulated vitals tick (in game: driven by Survival/Health components each frame)
setInterval(() => { const v = state.player.vitals; v.stamina = Math.min(100, v.stamina + 1); state.world.time.hours = (state.world.time.hours + 0.01) % 24; renderVitals(); }, 250);
if (q.has("tip")) { const s = ui.querySelector(".inv .slot[data-rarity=epic], .inv .slot[data-rarity=rare]"); s?.dispatchEvent(new PointerEvent("pointerenter")); }
