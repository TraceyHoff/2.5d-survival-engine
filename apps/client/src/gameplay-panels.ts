/**
 * Gameplay bodies for the ADR-095 menu shell (game-menus.ts): inventory, crafting, build, character, party, clan and
 * trade stall, from @engine/gameplay's menu view-models (packages/gameplay/src/ui/menus.ts). Data + commands only:
 * every control is a shell <button> (44px, focusable, so UINav reaches it by touch, D-pad/stick + A, Tab/arrows + Enter)
 * and every action is a gameplay command intent sent through `GameplaySource.send`. No art: styling is the shell's.
 * Data hooks for Art: `[data-role=slot|recipe|job|owed|piece|listing|member|invite|perm|unlock]`, `[data-key]`;
 * slots `[data-item=<itemId>][data-icon=<manifest icon key>]`; jobs `style="--p:<0..1>"`; unlocks `[data-unlocked]`
 * (present = unlocked); member rows `[data-rank=member|officer|leader]`; tooltips `[data-tip]` (never `title=`).
 * Chat log lines (game-menus.ts) carry `[data-chan=global|local|party|clan|trade|whisper|system]`.
 */
import { deployKitIntent, isKit } from "./vehicle-controls.js";
import { clanMemberActions } from "./clan-actions.js";
import "./gameplay-panels.css";
import { iconForItem,
  buildView, gameplayDefs, cancelQueuedCraftIntent, clanAcceptIntent, clanDeclineIntent, clanRosterRows, onlineTargets, paintIntent, paintTarget, type SocialDirectory, clanCreateIntent, clanDemoteIntent, clanDisbandIntent, clanInviteIntent, clanKickIntent, clanLeaveIntent,
  clanPromoteIntent, takeAllIntent, LootBag, clanSetGoalIntent, clanSetRankPermsIntent, clanView, collectTillIntent, containerView, CONTAINER_PAGE_SIZE, craftingView, depositIntent, fuelView, toggleFireIntent, openContainer, withdrawIntent, equipCosmeticIntent, inventoryView, JOB_STATE_LABEL,
  nearestStall, partyAcceptIntent, partyDeclineIntent, partyInviteIntent, partyKickIntent, partyLeaveIntent, partyView, queueCraftIntent, buyFromStallIntent,
  setAppearanceIntent, setStallNameIntent, priceItemChoices, listItemIntents, unstockStallIntent, type StallListDraft, setStallOpenIntent, stallView, togglePermMask, wardrobeView, placeIntent,
  type BuildSelection, type MenuCtx, type MenuIntent, camperStationView, vehicleRefuelIntent, type CamperRecipeView,
  progressionView, unlockSkillIntent, respecSkillsIntent, SKILL_REJECT_TEXT, useIntent, drinkWaterIntent, nearWater,
  SKILLS, equipIntent, wearIntent, equipmentView,
  petView, petsOf, petOfferIntent, petCommandIntent, dropItemIntent, PET_HELP, petName, petSpecies, Pet,
} from "@engine/gameplay";
import { colorChoices, requestCharacterEdit } from "./character-creator.js";
import { GroupRole, PlayerId, SLOT_PALETTE, Transform, type Entity, type WearableSlot } from "@engine/core";

export const GAMEPLAY_PANELS = ["inventory", "crafting", "build", "character", "party", "clan", "trade", "camper", "skills", "station", /* ADR-145 */ "pet"] as const;
export type GameplayPanel = (typeof GAMEPLAY_PANELS)[number];
/** What the client wires in (main.ts): the local replica + player, and a command sender (NetId mapping + gameplayNet). */
export interface GameplaySource {
  ctx(): MenuCtx | undefined;
  /** Send a command intent; returns false when not connected / not bridged. */
  send(i: MenuIntent): boolean;
  /** Build selection changed. */
  onBuildSelect?(s: BuildSelection): void;
  /** Enter build mode with this selection (aim-point placement, see build-mode.ts). */
  startPlacing?(s: BuildSelection): void;
  /** ADR-122 road / sign tools (world-tools.ts): Build panel buttons so gamepad and touch reach them. */
  worldTools?: { road(surface: number): void; roadSurface(): number; placeSign(): boolean; editNearestSign(): boolean; surfaces: readonly string[] };
  /** Stall the trade panel shows (set by interacting with a stall); falls back to the nearest stall. */
  stall?(): Entity | undefined;
  /** Owner-scoped clan roster + online directory (net events gameplay.clanRoster / clanRosterMember / onlinePlayer). */
  social?: SocialDirectory;
  /** Camper whose station panel is open (set from the vehicleStationOpened event, GameMenus.openCamper). */
  camper?(): Entity | undefined;
  /** ADR-136: station whose crafting panel is open (Interact near a workbench / forge / campfire …, GameMenus.openStation). */
  station?(): { entity: Entity; kind: number } | undefined;
  /** ADR-145: pet / tameable animal the pet panel shows (Interact next to it, or picked from the list). */
  pet?(): Entity | undefined;
  /** ADR-145: choose another pet from the panel's list. */
  selectPet?(e: Entity | undefined): void;
  /** ADR-145: open the rename editor (modal; on-screen keyboard on gamepad). */
  renamePet?(pet: Entity, current: string): void;
}
export interface PanelKit { para(t: string): HTMLElement; rerender(): void; status(t: string): void; close(): void }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k.startsWith("data-")) e.dataset[k.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = v; else e.setAttribute(k, v); }
  if (text !== undefined) e.textContent = text; return e;
};
const grid = (): HTMLElement => el("div", { class: "gm-grid" });
const heading = (t: string): HTMLElement => { const h = el("p", { "data-role": "section" }); const b = el("strong", {}, t); h.append(b); return h; };

/** Build-panel selection survives re-renders. */
const buildSel: BuildSelection = { piece: 0, tier: 0, variant: 0, paint: 0 };
const castSel = { recipe: 0, count: 1 };
let buildCat = "";
let wardrobeSlot = 0;
/** Camper station: active tab + selected cook recipe survive re-renders. */
const camperSel = { tab: "craft" as "craft" | "cook", cook: 0 };
const dismissedClan = new Set<number>();
/** Container panel page (ADR-098): survives re-renders; clamped by containerView. */
let containerPage = 0;
/** ADR-145: inventory "Drop items…" section open state (survives panel re-renders). */
export const dropUi = { open: false };
/** Skill tree (ADR-113): zoom + selected node survive re-renders; the viewport scroll position is kept by the diffing refresh. */
const skillUi = { zoom: 0.6, sel: -1, branch: "", cat: "" };
/** ADR-132: active skill category tab (one tree per tab); ◀ ▶ / tab buttons (touch, mouse, Tab+Enter, gamepad focus+A), PgUp/PgDn and gamepad LB/RB. */
export function selectSkillCategory(key: string): void { if (skillUi.cat !== key) { skillUi.cat = key; skillUi.sel = -1; } }
export const skillCategory = (): string => skillUi.cat;
/** ADR-132: cycle the skill tree tab (PgUp/PgDn, gamepad LB/RB, ◀ ▶). */
export function pageSkillCategory(d: number): void { const cs = SKILLS.categories; const i = Math.max(0, cs.findIndex((c) => c.key === skillUi.cat)); selectSkillCategory(cs[(i + d + cs.length) % cs.length]!.key); }
export const SKILL_ZOOM = { min: 0.35, max: 1.4, step: 0.15 };
export function zoomSkills(d: number): number { skillUi.zoom = Math.max(SKILL_ZOOM.min, Math.min(SKILL_ZOOM.max, +(skillUi.zoom + d).toFixed(2))); return skillUi.zoom; }
/** Page the open container by `d` (PgUp/PgDn, LB/RB, ◀ ▶). Returns true if a page change applies. */
export function pageContainer(d: number): boolean { containerPage = Math.max(0, containerPage + d); return true; }
export function containerPageIndex(): number { return containerPage; }
const gameplayDefsIcon = (c: MenuCtx, item: number): string => gameplayDefs(c.world).items.get(item)?.spriteKey ?? "";
const draft: StallListDraft = { listing: 0, invSlot: -1, count: 1, priceItem: 0, priceCount: 1, qty: 1 };

/** ADR-145 pet panel title: the species shows once (an unnamed pet's name is its species). */
export function petTitle(v: { wild: boolean; name: string; speciesName: string; level: number }): string {
  if (v.wild) return v.name; return v.name === v.speciesName ? `${v.name} · Lv ${v.level}` : `${v.name} · ${v.speciesName} · Lv ${v.level}`;
}
/** ADR-110: icon keys the stylesheet has art for ([data-icon="x"] rules; Art's generated block), scanned once. */
let knownIcons: Set<string> | undefined;
export function iconKeysFromCss(cssTexts: Iterable<string>): Set<string> {
  const out = new Set<string>(); for (const t of cssTexts) for (const m of t.matchAll(/\[data-icon="([^"]+)"\]/g)) out.add(m[1]!); return out;
}
function hasIcon(k: string): boolean {
  if (!knownIcons) { const texts: string[] = []; try { for (const sh of Array.from(document.styleSheets)) { try { for (const r of Array.from(sh.cssRules)) texts.push(r.cssText); } catch { /* cross-origin sheet */ } } } catch { /* no DOM */ } knownIcons = iconKeysFromCss(texts); }
  return knownIcons.size === 0 || knownIcons.has(k); // no stylesheet info (tests / headless): keep keys as-is
}
/** Real icon when Art has it, else the item's mapped fallback, else its category's generic icon. */
export function panelIcon(world: Parameters<typeof gameplayDefs>[0], icon: string, item: string | undefined): string {
  if (!icon || hasIcon(icon)) return icon;
  const it = item ? gameplayDefs(world).items.get(Number(item)) : undefined;
  return it ? iconForItem(it, hasIcon) : icon;
}
/** Short label telling apart recipes with the same output: first ingredient not shared by every sibling recipe. */
export function recipeVariantLabel(r: { output: { item: number }; ingredients: { item: number; name: string }[] }, all: readonly { output: { item: number }; ingredients: { item: number }[] }[]): string {
  const sib = all.filter((o) => o.output.item === r.output.item && o !== r);
  const d = r.ingredients.find((i) => sib.every((o) => !o.ingredients.some((x) => x.item === i.item))) ?? r.ingredients.find((i) => sib.some((o) => !o.ingredients.some((x) => x.item === i.item)));
  return (d ?? r.ingredients[0])?.name.toLowerCase() ?? "alt";
}
export function gameplayBody(id: GameplayPanel, src: GameplaySource, kit: PanelKit): Node[] {
  const c = src.ctx(); if (!c) return [kit.para("Join a game to use this menu.")];
  const rankOf = (role: number): string => role === 3 ? "leader" : role === 2 ? "officer" : "member";
  const btn = (label: string, key: string, fn: () => void, opts: { alt?: boolean; disabled?: boolean; title?: string; role?: string; pressed?: boolean; data?: Record<string, string>; p?: number } = {}): HTMLButtonElement => {
    const b = el("button", { type: "button", "data-key": key }, label); if (opts.alt) b.className = "alt"; if (opts.disabled) b.disabled = true; if (opts.title) { b.dataset["tip"] = opts.title; b.setAttribute("aria-label", `${label}. ${opts.title}`); }
    if (opts.data) for (const [k, v] of Object.entries(opts.data)) b.setAttribute(`data-${k}`, k === "icon" ? panelIcon(c.world, v, opts.data["item"]) : v);
    if (opts.p !== undefined) b.setAttribute("style", `--p:${Math.max(0, Math.min(1, opts.p)).toFixed(3)}`);
    if (opts.role) b.dataset["role"] = opts.role; if (opts.pressed !== undefined) b.setAttribute("aria-pressed", String(opts.pressed));
    b.onclick = fn; return b; // property (not listener) so the diffing refresh can swap in fresh closures
  };
  const send = (i: MenuIntent, ok: string): void => { kit.status(src.send(i) ? ok : "Not connected."); kit.rerender(); };
  switch (id) {
    case "inventory": {
      const v = inventoryView(c); const box = openContainer(c); const cv = box !== undefined ? containerView(c, box, containerPage) : undefined;
      if (cv) containerPage = cv.page;
      const out: Node[] = [];
      if (!v.length && !cv) return [kit.para("Your pack is empty.")];
      // ADR-108: fired stations / lights show a fuel section — status, Light/Put out toggle (X on pad), and one button
      // per fuel item in the pack (adds the whole stack). All plain focusable buttons: touch, D-pad and keys work alike.
      const fv = cv ? fuelView(c, cv.entity) : undefined;
      if (cv && fv) {
        const fs = el("section", { "data-role": "station-fuel" }); const secs = Math.round(fv.secondsLeft);
        fs.append(el("p", { "data-role": "fuel-time" }, `${fv.lit ? "Lit" : "Out"} · fuel ${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`));
        fs.append(btn(fv.lit ? "Put out" : "Light", "fire-toggle", () => send(toggleFireIntent(cv.entity), fv.lit ? "Put out." : "Lit."), { role: "toggle", pressed: fv.lit, disabled: !fv.lit && secs <= 0, title: fv.lit ? "Extinguish (X)" : secs > 0 ? "Light (X)" : "Add fuel first", data: { pad: "X" } }));
        const g = grid(); g.dataset["role"] = "fuel-slots";
        for (const f of fv.fuels) g.append(btn(`${f.name} ×${f.count}`, `fuel-${f.item}`, () => send(depositIntent(cv.entity, f.item, f.count), `Added ${f.name} ×${f.count}.`), { role: "slot", title: `${f.seconds}s each · add as fuel`, data: { item: String(f.item), icon: f.key } }));
        if (!fv.fuels.length) fs.append(kit.para("Carry wood, coal or crude oil to fuel this."));
        else fs.append(g);
        out.push(heading("Fuel"), fs);
      }
      if (cv) out.push(heading("Your pack"));
      if (!v.length) out.push(kit.para("Your pack is empty."));
      else {
        // ADR-135: with no container open, tapping (click / D-pad + A) an equippable slot equips or unequips it; slots drag onto the Equipment section.
        const equipSlot = (s: (typeof v)[number]): void => send(s.equip === "hand" ? equipIntent(s.slot) : wearIntent(s.slot), s.equipped ? `Unequipped ${s.name}.` : `Equipped ${s.name}.`);
        const g = grid(); for (const s of v) {
          const b = btn(`${s.equipped ? "◆ " : ""}${s.name} ×${s.count}`, `slot-${s.slot}`, () => cv ? send(depositIntent(cv.entity, s.item, s.count), `Stored ${s.name} ×${s.count}.`) : s.equip ? equipSlot(s) : kit.status(s.tooltip.replace(/\n/g, " · ")),
            { title: cv ? `${s.tooltip}\nStore in container` : s.equip ? `${s.tooltip}\n${s.equipped ? "Unequip" : "Equip"}` : s.tooltip, role: "slot", data: { item: String(s.item), icon: s.icon, ...(s.equip && { equip: s.equip }), ...(s.equipped && { equipped: "" }) } });
          if (!cv && s.equip) { b.draggable = true; b.ondragstart = (ev) => ev.dataTransfer?.setData("text/x-slot", String(s.slot)); }
          g.append(b);
        }
        out.push(g);
        if (!cv) {
          const eq = el("section", { "data-role": "equipment" }); const eg = grid();
          for (const q of equipmentView(c)) {
            eg.append(btn(`${q.label}: ${q.item ? q.name : "—"}`, `equip-${q.slot}`, () => { if (!q.item) return kit.status(`Tap an item to equip it (${q.label}).`); send(q.slot < 0 ? equipIntent(q.invSlot) : wearIntent(q.invSlot), `Unequipped ${q.name}.`); },
              { role: "equip", title: q.item ? "Unequip" : "Empty", data: { slot: String(q.slot), ...(q.item && { item: String(q.item), icon: q.icon }) } }));
          }
          eq.ondragover = (ev) => ev.preventDefault();
          eq.ondrop = (ev) => { ev.preventDefault(); const sl = Number(ev.dataTransfer?.getData("text/x-slot")); const s = v.find((x) => x.slot === sl); if (s?.equip && !s.equipped) equipSlot(s); };
          eq.append(eg); out.push(heading("Equipment"), eq);
          const knives = v.filter((s) => s.equip === "hand" && gameplayDefs(c.world).items.get(s.item)?.wear?.slot === 6 /* WearSlot.OffHand */);
          if (knives.length) { const kg = grid(); kg.dataset["role"] = "offhand"; for (const s of knives) kg.append(btn(`Off hand: ${s.name}`, `offhand-${s.slot}`, () => send(wearIntent(s.slot), `Off hand ${s.name}.`), { role: "use", title: "Hold in the off hand (armor)", data: { item: String(s.item), icon: s.icon } })); out.push(kg); }
        }
      }
      // ADR-128: Eat / Drink context actions (focusable buttons: tap, click, D-pad + A all work); server validates
      // cooldown, rotten food (iron_stomach) and refills empty containers next to water.
      if (!cv) {
        const me = c.world.get(c.player, Transform); const wet = !!me && nearWater(c.world, me.x, me.y);
        const eats = v.filter((s) => s.consume);
        if (eats.length || wet) {
          const g = grid(); g.dataset["role"] = "consume";
          for (const s of eats) {
            const empty = s.consume === "drink" && /Empty:/.test(s.tooltip); const verb = empty ? (wet ? "Refill" : "Empty") : s.consume === "drink" ? "Drink" : "Eat";
            g.append(btn(`${verb} ${s.name}`, `use-${s.slot}`, () => send(useIntent(s.slot), `${verb === "Refill" ? "Refilled" : verb === "Drink" ? "Drank" : "Ate"} ${s.name}.`), { role: "use", disabled: empty && !wet, title: s.tooltip, data: { item: String(s.item), icon: s.icon, use: s.consume ?? "" } }));
          }
          if (wet) g.append(btn("Drink water", "use-water", () => send(drinkWaterIntent(), "You drink from the water."), { role: "use", title: "Drink straight from the water", data: { use: "drink" } }));
          out.push(heading("Eat & drink"), g);
        }
        // ADR-170: vehicle kits deploy from here (tap / click / D-pad + A); the vehicle spawns 2.5 tiles ahead
        const kits = v.filter((s) => isKit(c.world, s.item));
        if (kits.length) {
          const g = grid(); g.dataset["role"] = "deploy";
          for (const s of kits) g.append(btn(`Deploy ${s.name}`, `deploy-${s.slot}`, () => { const i = deployKitIntent(c.world, c.player, s.slot); if (i) send(i, `Deployed ${s.name}. Walk up and press Use to get in.`); }, { role: "deploy", title: s.tooltip, data: { item: String(s.item), icon: s.icon } }));
          out.push(heading("Vehicles"), g);
        }
        // ADR-145: drop a stack on the ground (a following pet fetches it into its bag)
        const dg = grid(); dg.dataset["role"] = "drop";
        for (const s of v) if (!s.equipped) dg.append(btn(`Drop ${s.name}`, `drop-${s.slot}`, () => send(dropItemIntent(s.item, s.count), `Dropped ${s.name} ×${s.count}.`), { alt: true, role: "drop", title: "Drop on the ground (your pet fetches it)", data: { item: String(s.item), icon: s.icon } }));
        if (dg.childElementCount) {
          // the panel re-renders on every inventory / tick change, so keep the open state outside the DOM (a native toggle was lost)
          const det = el("details", { "data-role": "drop-section" }); det.open = dropUi.open; const sum = el("summary", { tabindex: "0" }, "Drop items…");
          sum.addEventListener("click", (ev) => { ev.preventDefault(); dropUi.open = !dropUi.open; det.open = dropUi.open; });
          det.append(sum, dg); out.push(det);
        }
      }
      if (cv) {
        // ADR-098: paged container grid (CONTAINER_PAGE_SIZE per page). Every slot is a focusable button so the D-pad /
        // arrows walk the grid; ◀ ▶ (touch), PgUp/PgDn (keyboard) and LB/RB (gamepad) change pages. Keys are slot-stable,
        // so the morph refresh only patches the slots that changed.
        // ADR-160: loot bags (zombie / animal / death / dropped) get a "Take all" first (focusable: click, tap, D-pad + A)
        if (c.world.isRegistered(LootBag) && c.world.has(cv.entity, LootBag) && cv.slots.some((x) => x.item)) out.push(btn("Take all", "take-all", () => send(takeAllIntent(cv.entity), "Took everything that fits."), { role: "use", title: "Move every stack into your pack" }));
        out.push(heading(`Storage · ${cv.slotCount} slots · ${Math.round(cv.weight)}/${Math.round(cv.maxWeight)} kg`));
        const g = grid(); g.dataset["role"] = "container-grid"; g.dataset["page"] = String(cv.page);
        for (const s of cv.slots) g.append(s.item
          ? btn(`${s.name} ×${s.count}`, `cslot-${s.slot}`, () => send(withdrawIntent(cv.entity, s.item, s.count), `Took ${s.name} ×${s.count}.`), { title: `${s.tooltip}\nTake`, role: "cslot", data: { item: String(s.item), icon: s.icon, slot: String(s.slot) } })
          : btn("·", `cslot-${s.slot}`, () => kit.status(s.tooltip), { alt: true, title: s.tooltip, role: "cslot", data: { item: "0", slot: String(s.slot) } }));
        out.push(g);
        if (cv.pages > 1) {
          const pg = grid(); pg.dataset["role"] = "container-pager";
          pg.append(btn("◀ Prev", "page-prev", () => { pageContainer(-1); kit.rerender(); }, { alt: true, disabled: cv.page === 0, title: "Previous page (PgUp / LB)" }));
          const label = kit.para(`Page ${cv.page + 1}/${cv.pages} · slots ${cv.first + 1}-${Math.min(cv.slotCount, cv.first + CONTAINER_PAGE_SIZE)}`); label.dataset["role"] = "page-label"; pg.append(label);
          pg.append(btn("Next ▶", "page-next", () => { pageContainer(1); kit.rerender(); }, { alt: true, disabled: cv.page >= cv.pages - 1, title: "Next page (PgDn / RB)" }));
          out.push(pg);
        }
      }
      return out;
    }
    case "station":
    case "crafting": {
      // ADR-136: personal menu = hand recipes only; a station's panel = that station's recipes only
      const st = id === "station" ? src.station?.() : undefined;
      if (id === "station" && !st) return [kit.para("Walk up to a crafting station and interact (E / X / tap) to use it.")];
      const v = craftingView(c, st?.kind ?? 0); const out: Node[] = [];
      if (st) {
        out.push(el("p", { "data-role": "station-name" }, v.stationName));
        const fv = fuelView(c, st.entity); // fired stations (campfire, furnace): light / fuel without leaving the panel
        if (fv) { const secs = Math.round(fv.secondsLeft); const fs = el("section", { "data-role": "station-fuel" });
          fs.append(el("p", { "data-role": "fuel-time" }, `${fv.lit ? "Lit" : "Out — light it to craft"} · fuel ${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`));
          fs.append(btn(fv.lit ? "Put out" : "Light", "fire-toggle", () => send(toggleFireIntent(st.entity), fv.lit ? "Put out." : "Lit."), { role: "toggle", pressed: fv.lit, disabled: !fv.lit && secs <= 0, title: fv.lit ? "Extinguish (X)" : secs > 0 ? "Light (X)" : "Add fuel first", data: { pad: "X" } }));
          const f0 = fv.fuels[0]; if (f0) fs.append(btn(`Add ${f0.name} ×${f0.count}`, `fuel-${f0.item}`, () => send(depositIntent(st.entity, f0.item, f0.count), `Added ${f0.name} ×${f0.count}.`), { role: "slot", title: `${f0.seconds}s each · add as fuel` }));
          out.push(fs); }
      }
      if (v.queue.length) { out.push(heading("Queue")); const g = grid(); for (const j of v.queue) g.append(btn(`✕ ${j.name} ×${j.count} · ${JOB_STATE_LABEL[j.state] ?? ""} ${Math.round(j.progress * 100)}%`, `job-${j.slot}`, () => send(cancelQueuedCraftIntent(j.slot), `Cancelled ${j.name}.`), { alt: true, role: "job", p: j.progress, title: `${Math.ceil(j.secondsLeft)}s left. Cancel refunds unfinished units.` })); out.push(g); }
      if (v.owed.length) { out.push(heading("Owed (delivered when you have space)")); for (const o of v.owed) { const p = kit.para(`${o.name} ×${o.count}${o.crafterName ? ` · crafted by ${o.crafterName}` : ""}`); p.dataset["role"] = "owed"; out.push(p); } }
      if (!st) { const n = v.elsewhere.reduce((a, e) => a + e.count, 0); if (n) { const h = kit.para(`More recipes at stations (${n}): ${v.elsewhere.map((e) => `${e.name} ${e.count}`).join(" · ")}`); h.dataset["role"] = "station-hint"; out.push(h); } }
      out.push(heading("Recipes"));
      const counts = grid(); for (const n of [1, 5, 10]) counts.append(btn(`×${n}`, `count-${n}`, () => { castSel.count = n; kit.rerender(); }, { alt: castSel.count !== n, pressed: castSel.count === n })); out.push(counts);
      const g = grid();
      const dupOut = new Set<number>(); { const seen = new Set<number>(); for (const r of v.recipes) { if (seen.has(r.output.item)) dupOut.add(r.output.item); seen.add(r.output.item); } }
      for (const r of v.recipes) {
        const need = r.ingredients.map((i) => `${i.name} ${i.have}/${i.count * castSel.count}`).join(", ");
        // alternate recipes for the same item (e.g. Hoe from stone or bone) are told apart by their first distinct ingredient
        const alt = dupOut.has(r.output.item) ? ` (${recipeVariantLabel(r, v.recipes)})` : "";
        g.append(btn(`${r.output.name} ×${r.output.count}${alt}`, `recipe-${r.id}`, () => send(queueCraftIntent(r.id, castSel.count), `Queued ${r.output.name} ×${castSel.count}.`), { role: "recipe", title: `${need} · ${r.seconds}s${r.reason ? ` · ${r.reason === "no_station" && st ? "light it / move closer" : r.reason.replace(/_/g, " ")}` : ""}`, alt: !!r.reason, data: { item: String(r.output.item), icon: gameplayDefsIcon(c, r.output.item) } }));
      }
      out.push(g);
      return out;
    }
    case "build": {
      const all = buildView(c); if (!buildSel.piece && all[0]) buildSel.piece = all[0].id;
      // ADR-112: category tabs keep the 170+ piece catalog scannable (focusable buttons: touch, D-pad, keys)
      const cats = [...new Set(all.map((p) => p.category))]; if (!cats.includes(buildCat)) buildCat = all.find((p) => p.id === buildSel.piece)?.category ?? cats[0] ?? "structure";
      const v = all.filter((p) => p.category === buildCat);
      const sel = all.find((p) => p.id === buildSel.piece); const out: Node[] = [heading("Category")]; const cg0 = grid(); cg0.dataset["role"] = "build-cats";
      for (const k of cats) cg0.append(btn(k, `bcat-${k}`, () => { buildCat = k; kit.rerender(); }, { pressed: k === buildCat, alt: k !== buildCat }));
      out.push(cg0, heading("Pieces")); const g = grid();
      for (const p of v) { const t = p.tiers.find((x) => x.tier === buildSel.tier) ?? p.tiers[0]!; g.append(btn(p.key.replace(/_/g, " "), `piece-${p.id}`, () => { buildSel.piece = p.id; buildSel.variant = 0; if (!p.tiers.some((x) => x.tier === buildSel.tier)) buildSel.tier = p.tiers[0]!.tier; src.onBuildSelect?.({ ...buildSel }); kit.rerender(); }, { role: "piece", pressed: p.id === buildSel.piece, alt: !t.affordable, title: t.cost.map((x) => `${x.name} ${x.have}/${x.count}`).join(", ") || "free" })); }
      out.push(g);
      if (sel) {
        if (sel.tiers.length > 1) { out.push(heading("Tier")); const tg = grid(); for (const t of sel.tiers) tg.append(btn(t.key, `tier-${t.tier}`, () => { buildSel.tier = t.tier; src.onBuildSelect?.({ ...buildSel }); kit.rerender(); }, { pressed: t.tier === buildSel.tier, alt: t.tier !== buildSel.tier, title: t.cost.map((x) => `${x.name} ${x.have}/${x.count}`).join(", ") })); out.push(tg); }
        if (sel.variants.length > 1) { out.push(heading("Variant")); const vg = grid(); sel.variants.forEach((n, i) => vg.append(btn(n, `variant-${i}`, () => { buildSel.variant = i; src.onBuildSelect?.({ ...buildSel }); kit.rerender(); }, { pressed: i === buildSel.variant, alt: i !== buildSel.variant }))); out.push(vg); }
        if (sel.paintable) { out.push(heading("Tint")); const pg = grid(); for (let i = 0; i < 6; i++) pg.append(btn(i ? `Tint ${i}` : "Clan / none", `tint-${i}`, () => { buildSel.paint = i; src.onBuildSelect?.({ ...buildSel }); kit.rerender(); }, { pressed: i === buildSel.paint, alt: i !== buildSel.paint }));
          const tgt = paintTarget(c); pg.append(btn("Paint nearest piece", "paint-apply", () => { if (tgt !== undefined) send(paintIntent(tgt, buildSel.paint), "Painted."); }, { disabled: tgt === undefined, title: "Applies the selected tint to the nearest paintable piece in reach" })); out.push(pg); }
        const t = sel.tiers.find((x) => x.tier === buildSel.tier) ?? sel.tiers[0]!;
        out.push(kit.para(`Cost: ${t.cost.map((x) => `${x.name} ${x.have}/${x.count}`).join(", ") || "free"}`));
        const a = grid(); a.append(btn("Place (aim to position · R / RB / ⟳ rotate)", "place", () => { if (!src.startPlacing) { kit.status("Placement unavailable."); return; } src.startPlacing({ ...buildSel }); kit.close(); }, { disabled: !t.affordable || !src.startPlacing })); out.push(a);
      }
      const wt = src.worldTools;
      if (wt) {
        out.push(heading("Roads & signs")); const rg = grid(); rg.dataset["role"] = "world-tools";
        wt.surfaces.forEach((name, i) => rg.append(btn(`Lay ${name.toLowerCase()} (G)`, `road-${i + 1}`, () => { wt.road(i + 1); kit.close(); }, { pressed: wt.roadSurface() === i + 1, alt: wt.roadSurface() !== i + 1, title: "Drag (mouse) · drag then ✓ (touch) · right stick + A (gamepad)" })));
        if (wt.roadSurface()) rg.append(btn("Road tool off", "road-0", () => { wt.road(0); kit.rerender(); }, { alt: true }));
        rg.append(btn("Place sign (N)", "sign-place", () => { if (wt.placeSign()) { kit.status("Sign placed — choose Edit nearest sign to write on it."); } else kit.status("You need a sign item (craft one first)."); }));
        rg.append(btn("Edit nearest sign", "sign-edit", () => { kit.close(); if (!wt.editNearestSign()) kit.status("No sign within reach."); }));
        out.push(rg);
      }
      return out;
    }
    case "character": {
      const v = wardrobeView(c); const out: Node[] = [];
      out.push(kit.para(v.canEdit ? (v.created ? "At a wardrobe: change your look." : "Create your character.") : "Stand near a wardrobe to change your look."));
      const sg = grid(); for (const s of v.slots) sg.append(btn(`${s.key}${s.equipped ? "" : " (none)"}`, `wslot-${s.slot}`, () => { wardrobeSlot = s.slot; kit.rerender(); }, { pressed: s.slot === wardrobeSlot, alt: s.slot !== wardrobeSlot }));
      out.push(heading("Slot"), sg);
      const cur = v.slots[wardrobeSlot]!; const cg = grid();
      const cat = c.catalog; const slotKey = cur.key as WearableSlot;
      // eyes offer the creator's curated eye list (clothingColors indices); other slots the whole slot palette
      const choices = cat ? colorChoices(cat, slotKey) : Array.from({ length: cur.key === "hair" || cur.key === "face" ? v.palettes.hair : v.palettes.clothing }, (_, i) => i);
      cg.append(btn("Remove", "unequip", () => send(equipCosmeticIntent(cur.slot, 0), "Removed."), { alt: true, disabled: !v.canEdit || !cur.equipped }));
      for (const i of choices) cg.append(btn(`Colour ${i + 1}`, `color-${i}`, () => send(equipCosmeticIntent(cur.slot, cur.equipped, i, cur.secondary), "Colour set."), { disabled: !v.canEdit || !cur.equipped, pressed: cur.primary === i }));
      out.push(heading(`${cur.key}: colour`), cg);
      const w2 = cur.equipped && cat ? cat.wearable(cur.equipped) : undefined; // G (secondary) row only when the worn piece tints G (tintChannels 2)
      if (w2 && (w2.tintChannels >= 2 || (w2.layers ?? []).some((l) => l.tintChannels >= 2))) {
        const pal2 = SLOT_PALETTE[slotKey] === "hairColors" ? cat!.hairColors : cat!.clothingColors; const g2 = grid();
        pal2.forEach((pc, i) => { const b = btn(`Secondary ${i + 1}`, `color2-${i}`, () => send(equipCosmeticIntent(cur.slot, cur.equipped, cur.primary, i), "Colour set."), { disabled: !v.canEdit, pressed: cur.secondary === i, alt: cur.secondary !== i, data: { swatch: `#${(pc.color & 0xffffff).toString(16).padStart(6, "0")}` } }); b.style.setProperty("--cz-sw", b.dataset["swatch"]!); g2.append(b); });
        out.push(heading(`${cur.key}: secondary colour`), g2);
      }
      // skin keeps the current body type (a hard-coded male body made female looks fail validation / swap body)
      if (v.palettes.skin) { const kg = grid(); for (let i = 0; i < v.palettes.skin; i++) kg.append(btn(`Skin ${i + 1}`, `skin-${i}`, () => { const a = v.slots; send(setAppearanceIntent({ bodyType: v.bodyType, skinTone: i, parts: a.map((s) => s.equipped), primary: a.map((s) => s.primary), secondary: a.map((s) => s.secondary) }), "Look saved."); }, { disabled: !v.canEdit, pressed: v.skinTone === i })); out.push(heading("Skin tone"), kg); }
      out.push(heading("Unlocks")); const ug = el("div", { "data-role": "unlocks" });
      for (const u of v.unlocks) { const p = kit.para(u.tag.replace(/_/g, " ")); p.dataset["role"] = "unlock"; p.dataset["key"] = u.tag; if (u.unlocked) p.dataset["unlocked"] = ""; ug.append(p); }
      out.push(ug);
      const eg = grid(); eg.append(btn("Edit character (next start)", "edit-character", () => { requestCharacterEdit(); kit.status("The character creator opens next time you enter a world."); }, { alt: true })); out.push(eg);
      return out;
    }
    case "skills": {
      const v = progressionView(c.world, c.player); if (!v) return [kit.para("No skills for this character.")];
      const out: Node[] = [];
      const head = kit.para(`Level ${v.level} · XP ${v.xp}/${v.next} · ${v.points} skill point${v.points === 1 ? "" : "s"} (shared by all trees)`); head.dataset["role"] = "skill-summary"; out.push(head);
      const tools = grid();
      tools.append(btn("Zoom −", "skill-zoom-out", () => { zoomSkills(-SKILL_ZOOM.step); kit.rerender(); }, { alt: true }), btn("Zoom +", "skill-zoom-in", () => { zoomSkills(SKILL_ZOOM.step); kit.rerender(); }, { alt: true }));
      tools.append(btn(`Respec (${v.respecCost} coin)`, "skill-respec", () => send(respecSkillsIntent(), "Skills reset."), { alt: true, disabled: v.canRespec !== undefined, title: v.canRespec ? SKILL_REJECT_TEXT[v.canRespec] : "Refund all skill points" }));
      tools.append(btn("Back", "skill-back", () => kit.close(), { alt: true }));
      out.push(tools);
      // ADR-132 category tabs: one tree per tab, shared point pool shown above. Buttons = touch / keyboard (Tab/Enter) / gamepad (focus+A).
      const cats = v.categories; const ci = Math.max(0, cats.findIndex((c) => c.key === skillUi.cat)); const cat = cats[ci]!; skillUi.cat = cat.key;
      const go = (d: number): void => { pageSkillCategory(d); kit.rerender(); };
      const tabs = el("div", { class: "gm-grid", "data-role": "skill-tabs", role: "tablist" });
      tabs.append(btn("◀", "skill-tab-prev", () => go(-1), { alt: true, title: "Previous tree (PgUp / LB)" }));
      for (const c of cats) { const t = btn(`${c.name} ${c.owned}/${c.nodes.length}${c.available ? ` · ${c.available}✦` : ""}`, `skill-tab-${c.key}`, () => { selectSkillCategory(c.key); kit.rerender(); }, { alt: c.key !== cat.key, pressed: c.key === cat.key, data: { icon: c.icon, category: c.key } }); t.setAttribute("role", "tab"); t.setAttribute("aria-selected", String(c.key === cat.key)); t.style.minHeight = "44px"; tabs.append(t); }
      tabs.append(btn("▶", "skill-tab-next", () => go(1), { alt: true, title: "Next tree (PgDn / RB)" }));
      tabs.setAttribute("style", "display:flex;flex-wrap:nowrap;overflow-x:auto;gap:6px;-webkit-overflow-scrolling:touch;touch-action:pan-x");
      for (const t of Array.from(tabs.children) as HTMLElement[]) t.style.flex = "0 0 auto";
      out.push(tabs); queueMicrotask(() => (tabs.querySelector("[aria-selected=true]") as HTMLElement | null)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }));
      const z = skillUi.zoom; const vp = el("div", { "data-role": "skill-tree", class: "skill-tree", "data-category": cat.key });
      vp.setAttribute("style", "position:relative;overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;height:min(52dvh,420px);border:2px solid #74432C;border-radius:10px;background:#EAD9B8");
      const inner = el("div"); inner.setAttribute("style", `position:relative;width:${Math.ceil(cat.width * z)}px;height:${Math.ceil(cat.height * z)}px`);
      const ns = "http://www.w3.org/2000/svg"; const svg = document.createElementNS(ns, "svg"); svg.setAttribute("width", String(Math.ceil(cat.width * z))); svg.setAttribute("height", String(Math.ceil(cat.height * z)));
      svg.setAttribute("style", "position:absolute;left:0;top:0;pointer-events:none"); const W = 150, H = 56;
      const shown = cat.nodes.map((i) => v.nodes[i]!);
      for (const n of shown) for (const r of n.requires) { const p = v.nodes[r]!; const l = document.createElementNS(ns, "line");
        l.setAttribute("x1", String((p.cx + W / 2) * z)); l.setAttribute("y1", String((p.cy + H) * z)); l.setAttribute("x2", String((n.cx + W / 2) * z)); l.setAttribute("y2", String(n.cy * z));
        l.setAttribute("stroke", n.state === "owned" ? "#5A9A4A" : "#9C7A5A"); l.setAttribute("stroke-width", "2"); svg.append(l); }
      inner.append(svg);
      for (const n of shown) {
        const b = btn(`${n.name} (${n.cost})`, `skill-${n.key}`, () => {
          if (skillUi.sel !== n.index) { skillUi.sel = n.index; kit.rerender(); return; } // first tap/A selects (shows details), second learns
          if (n.state === "owned") return; if (n.why) { kit.status(SKILL_REJECT_TEXT[n.why]); kit.rerender(); return; }
          send(unlockSkillIntent(n.index), `Learned ${n.name}.`);
        }, { role: "skill-node", alt: n.state !== "owned", disabled: false, pressed: skillUi.sel === n.index, title: n.desc, data: { icon: n.icon, branch: n.branch, category: n.category, state: n.state, tier: String(n.tier) } });
        b.setAttribute("style", `position:absolute;left:${Math.round(n.cx * z)}px;top:${Math.round(n.cy * z)}px;width:${Math.round(W * z)}px;min-height:44px;font-size:${Math.max(11, Math.round(14 * z))}px;padding:2px 4px;${n.state === "locked" ? "opacity:.55;" : ""}`);
        inner.append(b);
      }
      vp.append(inner);
      vp.addEventListener("wheel", (ev) => { if (!ev.ctrlKey) return; ev.preventDefault(); zoomSkills(ev.deltaY < 0 ? SKILL_ZOOM.step : -SKILL_ZOOM.step); kit.rerender(); }, { passive: false });
      out.push(vp);
      const sel = v.nodes[skillUi.sel];
      if (sel) { const d = kit.para(`${sel.name}: ${sel.desc} — cost ${sel.cost}. ${sel.state === "owned" ? "Learned." : sel.why ? SKILL_REJECT_TEXT[sel.why] : "Tap / press again to learn."}`); d.dataset["role"] = "skill-detail"; out.push(d); }
      out.push(kit.para("Pick a tree tab (◀ ▶, PgUp/PgDn or LB/RB) · scroll or drag to pan · Ctrl+wheel or Zoom ± to zoom · select a skill, then select again to learn. Points are shared across all trees."));
      return out;
    }
    case "party": {
      const v = partyView(c); const out: Node[] = [];
      if (v.invite) { const inv = v.invite; out.push(kit.para(`${inv.fromName} invited you (${inv.secondsLeft}s).`)); const g = grid(); g.append(btn("Accept", "party-accept", () => send(partyAcceptIntent(inv.party), "Joined party.")), btn("Decline", "party-decline", () => send(partyDeclineIntent(inv.party), "Declined."), { alt: true })); out.push(g); }
      out.push(heading(v.party ? `Party (${v.members.length}/${v.maxSize})` : "Not in a party"));
      if (v.party) { const g = grid(); for (const m of v.members) g.append(m.entity === c.player ? kit.para(`${m.name} (you)`) : !v.canKick(m) ? kit.para(m.name) : btn(`Kick ${m.name}`, `kick-${m.playerId}`, () => send(partyKickIntent(m.entity), `Kicked ${m.name}.`), { alt: true, role: "member", data: { rank: "member" } })); out.push(g); const l = grid(); l.append(btn("Leave party", "party-leave", () => send(partyLeaveIntent(), "Left party."), { alt: true })); out.push(l); }
      if (!v.canInvite) return out; // only leaders/officers may invite (PARTY_RULES; ADR-141)
      const pc = onlineTargets(c, src.social, new Set(v.members.map((m) => m.playerId)));
      out.push(heading("Invite")); if (!pc.length) out.push(kit.para("Nobody online nearby."));
      const ig = grid(); for (const p of pc.slice(0, 16)) { const e = p.entity; ig.append(btn(`Invite ${p.name}`, `invite-${p.playerId}`, () => { if (e !== undefined) send(partyInviteIntent(e), `Invited ${p.name}.`); }, { disabled: e === undefined, title: p.distance !== undefined ? `${Math.round(p.distance)} m` : "online, not nearby" })); } out.push(ig);
      return out;
    }
    case "clan": {
      const v = clanView(c); const out: Node[] = [];
      if (v.invite && !dismissedClan.has(v.invite.clan)) { const inv = v.invite; out.push(kit.para(`${inv.fromName} invited you to a clan (${inv.secondsLeft}s).`)); const g = grid(); g.append(btn("Accept", "clan-accept", () => send(clanAcceptIntent(inv.clan), "Joined clan.")), btn("Dismiss", "clan-dismiss", () => { dismissedClan.add(inv.clan); send(clanDeclineIntent(inv.clan), "Declined."); }, { alt: true })); out.push(g); }
      if (!v.clan) { const g = grid(); g.append(btn("Create clan", "clan-create", () => send(clanCreateIntent(), "Clan created."))); out.push(kit.para("Not in a clan."), g); return out; }
      const lead = v.role === GroupRole.Leader; const permOn = (perm: string): boolean => lead || !!v.perms.find((r) => r.role === v.role)?.perms.find((p) => p.perm === perm)?.on; const kickPerm = permOn("kick");
      out.push(kit.para(`${v.roleName} · goal: ${v.goalName} · your contribution: ${v.contrib}`));
      out.push(heading("Goal")); const gg = grid(); v.goals.forEach((n, i) => gg.append(btn(n, `goal-${i}`, () => { const t = c.world.get(c.player, Transform); send(clanSetGoalIntent(i, t?.x ?? 0, t?.y ?? 0), `Goal: ${n}.`); }, { pressed: i === v.goal, alt: i !== v.goal, disabled: !permOn("goal"), title: "Goal point = where you stand" }))); out.push(gg);
      out.push(heading("Members")); const mg = grid();
      const roster = clanRosterRows(c, src.social, v.clan); const myPid = c.world.getField(c.player, PlayerId, "id") ?? 0;
      if (roster) for (const m of roster) { if (m.playerId === myPid) continue; const e = m.entity; const r = el("div", { "data-role": "member", "data-key": String(m.playerId), "data-rank": rankOf(m.role) }); r.append(kit.para(`${m.online ? "●" : "○"} ${m.name} · ${m.roleName}`));
        const far = e === undefined ? " (not nearby)" : "";
        const act = clanMemberActions(v.role, m.role, kickPerm);
        if (act.promote) r.append(btn("Promote", `promote-${m.playerId}`, () => { if (e !== undefined) send(clanPromoteIntent(e), `Promoted ${m.name}.`); }, { disabled: e === undefined, title: far }));
        if (act.demote) r.append(btn("Demote", `demote-${m.playerId}`, () => { if (e !== undefined) send(clanDemoteIntent(e), `Demoted ${m.name}.`); }, { alt: true, disabled: e === undefined, title: far }));
        if (act.kick) r.append(btn("Kick", `ckick-${m.playerId}`, () => { if (e !== undefined) send(clanKickIntent(e), `Kicked ${m.name}.`); }, { alt: true, disabled: e === undefined, title: far })); mg.append(r); }
      else for (const m of v.members) { if (m.entity === c.player) continue; const r = el("div", { "data-role": "member", "data-key": String(m.playerId), "data-rank": rankOf(m.role) }); r.append(kit.para(`${m.name} · ${m.role === 3 ? "Leader" : m.role === 2 ? "Officer" : "Member"}`));
        const act = clanMemberActions(v.role, m.role, kickPerm);
        if (act.promote) r.append(btn("Promote", `promote-${m.playerId}`, () => send(clanPromoteIntent(m.entity), `Promoted ${m.name}.`)));
        if (act.demote) r.append(btn("Demote", `demote-${m.playerId}`, () => send(clanDemoteIntent(m.entity), `Demoted ${m.name}.`), { alt: true }));
        if (act.kick) r.append(btn("Kick", `ckick-${m.playerId}`, () => send(clanKickIntent(m.entity), `Kicked ${m.name}.`), { alt: true })); mg.append(r); }
      out.push(mg);
      const cc = onlineTargets(c, src.social, new Set([...(roster ?? []).map((m) => m.playerId), ...v.members.map((m) => m.playerId)]));
      if (permOn("invite")) { out.push(heading("Invite")); const ig = grid(); for (const p of cc.slice(0, 16)) { const e = p.entity; ig.append(btn(`Invite ${p.name}`, `cinvite-${p.playerId}`, () => { if (e !== undefined) send(clanInviteIntent(e), `Invited ${p.name}.`); }, { disabled: e === undefined, title: e === undefined ? "online, not nearby" : "" })); } out.push(ig); }
      out.push(heading("Rank permissions"));
      for (const r of v.perms) { const pg = grid(); pg.dataset["role"] = "perm"; pg.dataset["key"] = String(r.role); for (const p of r.perms) pg.append(btn(`${r.roleName}: ${p.perm} ${p.on ? "✓" : "✕"}`, `perm-${r.role}-${p.perm}`, () => send(clanSetRankPermsIntent(r.role, togglePermMask(r.mask, p.perm)), "Permissions updated."), { pressed: p.on, alt: !p.on, disabled: !lead })); out.push(pg); }
      const a = grid(); a.append(btn("Leave clan", "clan-leave", () => send(clanLeaveIntent(), "Left clan."), { alt: true }));
      if (lead) a.append(btn("Disband clan", "clan-disband", () => send(clanDisbandIntent(), "Clan disbanded."), { alt: true }));
      out.push(a); return out;
    }
    case "trade": {
      const s = src.stall?.() ?? nearestStall(c); const v = s !== undefined ? stallView(c, s) : undefined; if (!v) return [kit.para("Walk up to a trade stall to browse it.")];
      const out: Node[] = [kit.para(`${v.name || "Trade stall"} · ${v.open ? "open" : "closed"}`)]; const g = grid();
      for (const l of v.listings) { if (!l.stockItem && !v.mine) continue; const label = l.stockItem ? `${l.stockName} ×${l.qty || 1} — ${l.priceCount} ${l.priceName} (stock ${l.stock})` : `Empty listing ${l.slot + 1}`;
        g.append(btn(label, `listing-${l.slot}`, () => send(buyFromStallIntent(v, l, 1), `Bought ${l.stockName}.`), { role: "listing", disabled: v.mine || !v.open || !l.enabled || !l.stockItem || l.stock < Math.max(1, l.qty), alt: !l.canAfford, title: l.canAfford ? "Buy" : `Need ${l.priceCount} ${l.priceName}` })); }
      out.push(g);
      if (v.mine) {
        out.push(heading(`Till: ${v.till.map((t) => `${t.name} ×${t.count}`).join(", ") || "empty"}`));
        const name = el("input", { "data-role": "stall-name", maxlength: "24", "aria-label": "Stall name", placeholder: "Stall name" }); name.value = v.name;
        const a = grid(); a.append(btn("Collect till", "collect", () => send(collectTillIntent(v.stall), "Collected."), { disabled: !v.till.length }),
          btn(v.open ? "Close stall" : "Open stall", "open", () => send(setStallOpenIntent(v.stall, !v.open), v.open ? "Closed." : "Opened."), { alt: true }),
          btn("Rename", "rename", () => { const live = document.querySelector<HTMLInputElement>("[data-role=stall-name]") ?? name; send(setStallNameIntent(v.stall, live.value), "Renamed."); }));
        out.push(name, a);
        // ---- stock + price a listing: pick listing, pick an inventory slot, set price / qty / count, List it ----
        const inv = inventoryView(c); const prices = priceItemChoices(c);
        if (draft.listing >= v.listings.length) draft.listing = 0;
        if (!prices.some((p) => p.item === draft.priceItem)) draft.priceItem = prices[0]?.item ?? 0;
        const slot = inv.find((x) => x.slot === draft.invSlot); if (!slot) draft.invSlot = -1; draft.count = Math.max(1, Math.min(draft.count, slot?.count ?? 1));
        const cur = v.listings[draft.listing];
        out.push(heading("Stock & price"));
        const lg = grid(); for (const l of v.listings) lg.append(btn(`Listing ${l.slot + 1}${l.stockItem ? `: ${l.stockName}` : ""}`, `draft-listing-${l.slot}`, () => { draft.listing = l.slot; if (l.priceItem) { draft.priceItem = l.priceItem; draft.priceCount = l.priceCount; draft.qty = Math.max(1, l.qty); } kit.rerender(); }, { pressed: l.slot === draft.listing, alt: l.slot !== draft.listing }));
        out.push(lg, kit.para("Item to stock:"));
        const ig = grid(); for (const x of inv) ig.append(btn(`${x.name} ×${x.count}`, `draft-slot-${x.slot}`, () => { draft.invSlot = x.slot; draft.count = x.count; kit.rerender(); }, { pressed: x.slot === draft.invSlot, alt: x.slot !== draft.invSlot, title: x.tooltip }));
        if (!inv.length) out.push(kit.para("Nothing in your pack to stock.")); else out.push(ig);
        const priceName = prices.find((p) => p.item === draft.priceItem)?.name ?? "—";
        const step = (k: "count" | "priceCount" | "qty", d: number, max = 9999): void => { draft[k] = Math.max(1, Math.min(max, draft[k] + d)); kit.rerender(); };
        const fg = grid();
        fg.append(btn(`Price in: ${priceName}`, "draft-price-item", () => { const i = prices.findIndex((p) => p.item === draft.priceItem); draft.priceItem = prices[(i + 1) % Math.max(1, prices.length)]?.item ?? 0; kit.rerender(); }, { disabled: prices.length < 2, title: "Cycle currency" }),
          btn("Price −", "draft-price-dec", () => step("priceCount", -1)), btn(`Price ${draft.priceCount}`, "draft-price", () => step("priceCount", 10), { alt: true, title: "+10" }), btn("Price +", "draft-price-inc", () => step("priceCount", 1)),
          btn("Per sale −", "draft-qty-dec", () => step("qty", -1)), btn(`Per sale ${draft.qty}`, "draft-qty", () => step("qty", 1), { alt: true }), btn("Per sale +", "draft-qty-inc", () => step("qty", 1)),
          btn("Stock −", "draft-count-dec", () => step("count", -1, slot?.count ?? 1), { disabled: !slot }), btn(`Stock ${slot ? draft.count : 0}`, "draft-count", () => { draft.count = slot?.count ?? 1; kit.rerender(); }, { alt: true, disabled: !slot, title: "All" }), btn("Stock +", "draft-count-inc", () => step("count", 1, slot?.count ?? 1), { disabled: !slot }));
        out.push(fg);
        const lgo = grid();
        lgo.append(btn(slot ? `List ${draft.count} ${slot.name} for ${draft.priceCount} ${priceName} / ${draft.qty}` : `Update price: ${draft.priceCount} ${priceName} / ${draft.qty}`, "draft-list", () => { let ok = true; for (const i of listItemIntents(v.stall, draft)) ok = src.send(i) && ok; draft.invSlot = -1; kit.status(ok ? "Listed." : "Not connected."); kit.rerender(); }, { disabled: !draft.priceItem || (!slot && !cur?.stockItem) }),
          btn("Unstock listing", "draft-unstock", () => send(unstockStallIntent(v.stall, draft.listing, cur?.stock ?? 0), "Unstocked."), { alt: true, disabled: !cur?.stock }));
        out.push(lgo);
      }
      return out;
    }
    case "pet": return petBody(c, src, kit, btn, send);
    case "camper": {
      const ve = src.camper?.(); const v = ve === undefined ? undefined : camperStationView(c, ve);
      if (!v) return [kit.para("Open a camper's station (interact inside a parked camper).")];
      const slotData = (s: { item: number; icon: string; count: number } | undefined): Record<string, string> => s && s.item ? { item: String(s.item), icon: s.icon, count: String(s.count) } : {};
      const fuel = el("section", { "data-role": "station-fuel" }); const fi = v.fuelItem;
      const need = Math.max(1, Math.ceil(v.fuel.capacity - v.fuel.liters));
      fuel.append(btn(fi ? `${fi.name} ×${fi.count}` : "No fuel", "fuel-slot", () => { if (fi) send(vehicleRefuelIntent(v.vehicle, fi.slot, Math.min(255, fi.count, need)), `Added ${fi.name}.`); },
        { role: "slot", disabled: !fi || !v.fuel.uses || v.fuel.fraction >= 1, title: fi ? `${fi.name} ×${fi.count} · Y to add` : v.fuel.uses ? "Carry fuel that fits this tank" : "No fuel tank", data: { ...slotData(fi), pad: "Y" } }));
      const pct = Math.round(v.fuel.fraction * 100);
      const gauge = el("div", { "data-role": "fuel-gauge", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), style: `--p:${v.fuel.fraction.toFixed(3)}` }); if (v.fuel.low) gauge.setAttribute("data-low", "");
      const secs = Math.round(v.fuel.seconds); fuel.append(gauge, el("p", { "data-role": "fuel-time" }, v.fuel.uses ? `${pct}% · ${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s` : "No fuel tank"));
      const tabs = el("nav", { "data-role": "station-tabs" });
      tabs.append(btn("Craft", "tab-craft", () => { camperSel.tab = "craft"; kit.rerender(); }, { pressed: camperSel.tab === "craft", data: { pad: "LB" } }), btn("Cook", "tab-cook", () => { camperSel.tab = "cook"; kit.rerender(); }, { pressed: camperSel.tab === "cook", data: { pad: "RB" } }));
      const tip = (r: CamperRecipeView): string => `${r.output.name}${r.output.count > 1 ? ` ×${r.output.count}` : ""} · ${r.ingredients.map((i) => `${i.count} ${i.name}`).join(" + ")}${r.reason ? ` · ${r.reason.replace(/_/g, " ")}` : ""}`;
      const jobBtn = (j: { slot: number; name: string; count: number; progress: number; secondsLeft: number; icon: string; recipe: number }, key: string): HTMLButtonElement => btn(`${j.name} · ${Math.ceil(j.secondsLeft)}s`, key, () => send(cancelQueuedCraftIntent(j.slot), `Cancelled ${j.name}.`),
        { role: "job", p: j.progress, title: `${j.name} ×${j.count} · ${Math.ceil(j.secondsLeft)}s left · cancel refunds unfinished units`, data: { item: String(gameplayDefs(c.world).recipes.get(j.recipe)?.output.item ?? 0), icon: j.icon } });
      const craft = el("section", { "data-role": "station-craft" }); const cg = grid();
      for (const r of v.craft) { const b = btn(r.output.name, `recipe-${r.key}`, () => send(queueCraftIntent(r.id, 1), `Queued ${r.output.name}.`), { role: "recipe", alt: !!r.reason, title: tip(r), data: { item: String(r.output.item), icon: r.icon } }); cg.append(b); }
      if (!v.craft.length) cg.append(kit.para("No crafting station in this camper."));
      craft.append(cg); for (const j of v.craftJobs) craft.append(jobBtn(j, `job-${j.slot}`));
      const cook = el("section", { "data-role": "station-cook" });
      const sel = v.cook.find((r) => r.id === camperSel.cook) ?? v.cook[0];
      const row = el("div", { "data-role": "cook-row" }); const ins = el("div", { "data-role": "cook-inputs" });
      for (let i = 0; i < 3; i++) { const ing = sel?.ingredients[i]; const icon = ing ? gameplayDefsIcon(c, ing.item) : "";
        ins.append(btn(ing ? `${ing.name} ${ing.have}/${ing.count}` : "—", `cook-in-${i}`, () => kit.status(ing ? `${ing.name}: have ${ing.have}, need ${ing.count}` : "Empty input"), { role: "slot", title: ing ? `${ing.name} · have ${ing.have} / need ${ing.count}` : "Empty input", data: ing ? { item: String(ing.item), icon, count: String(ing.have) } : {} })); }
      const cj = v.cookJobs[0];
      const cookJob = cj ? jobBtn(cj, "cook-job") : btn(sel ? `Cook ${sel.output.name}` : "Nothing to cook", "cook-job", () => { if (sel) send(queueCraftIntent(sel.id, 1), `Cooking ${sel.output.name}.`); }, { role: "job", p: 0, disabled: !sel, title: sel ? tip(sel) : "No cooking station", data: sel ? { item: String(sel.output.item), icon: sel.icon } : {} });
      row.append(ins, cookJob, btn(sel ? `${sel.output.name} ×${sel.output.count}` : "—", "cook-out", () => kit.status(sel ? tip(sel) : ""), { role: "slot", title: sel ? tip(sel) : "Output", data: sel ? { item: String(sel.output.item), icon: sel.icon, count: String(sel.output.count) } : {} }));
      const kg = grid(); for (const r of v.cook) kg.append(btn(r.output.name, `cook-${r.key}`, () => { if (sel?.id !== r.id) { camperSel.cook = r.id; kit.rerender(); } else send(queueCraftIntent(r.id, 1), `Cooking ${r.output.name}.`); },
        { role: "recipe", alt: !!r.reason, pressed: sel?.id === r.id, title: `${tip(r)} · select, then A again to cook`, data: { item: String(r.output.item), icon: r.icon } }));
      if (!v.cook.length) kg.append(kit.para("No campfire in this camper."));
      cook.append(row, kg);
      if (camperSel.tab === "craft") cook.hidden = true; else craft.hidden = true; // CSS hides it too; `hidden` keeps UINav/Tab off the inactive tab
      const inv = el("section", { "data-role": "station-inv" }); inv.append(el("p", { "data-role": "section" }, `Camper storage ${v.storage.used}/${v.storage.total}`));
      const ig = grid(); for (const s of v.storage.slots) ig.append("name" in s ? btn(`${s.name} ×${s.count}`, `inv-${s.slot}`, () => send(withdrawIntent(v.vehicle, s.item, s.count), `Took ${s.name} ×${s.count}.`), { role: "slot", title: `${s.name} ×${s.count} · A to take`, data: slotData(s) })
        : btn("", `inv-${s.slot}`, () => kit.status("Empty slot"), { role: "slot", title: "Empty slot" }));
      inv.append(ig);
      return [fuel, tabs, craft, cook, inv];
    }
  }
}

// ---- ADR-145 pet panel -----------------------------------------------------------------------------------
type Btn = (label: string, key: string, fn: () => void, opts?: { alt?: boolean; disabled?: boolean; title?: string; role?: string; pressed?: boolean; data?: Record<string, string>; p?: number }) => HTMLButtonElement;
const PREF_TEXT: Record<string, string> = { love: "loves it", like: "likes it", ok: "will try it", hate: "hates it", food: "food" };
const bar = (label: string, v: number, max: number, role: string): HTMLElement => {
  const p = el("p", { "data-role": role }, `${label} ${Math.round(v)}/${Math.round(max)}`); p.setAttribute("style", `--p:${Math.max(0, Math.min(1, max ? v / max : 0)).toFixed(3)}`); return p;
};
function petBody(c: MenuCtx, src: GameplaySource, kit: PanelKit, btn: Btn, send: (i: MenuIntent, ok: string) => void): Node[] {
  const w = c.world; const me = w.getField(c.player, PlayerId, "id") ?? 0; const out: Node[] = [];
  const target = src.pet?.(); const v = target !== undefined ? petView(w, c.player, target) : undefined;
  const mine = petsOf(w, me);
  if (mine.length > 1 || (mine.length && !v)) {
    const g = grid(); g.dataset["role"] = "pet-list";
    for (const e of mine) { const sp = petSpecies(w.getField(e, Pet, "species") ?? 0); g.append(btn(`${petName(w, e)} · Lv ${w.getField(e, Pet, "level") ?? 1}`, `pet-${e}`, () => { src.selectPet?.(e); kit.rerender(); }, { pressed: e === target, role: "pet", title: sp?.name ?? "Pet" })); }
    out.push(heading("Your pets"), g);
  }
  if (!v) {
    if (!mine.length) out.push(kit.para("You have no pets yet."));
    out.push(heading("How pets work"), ...PET_HELP.map((t) => kit.para(t)));
    return out;
  }
  const head = el("section", { "data-role": "pet-status", "data-species": petSpecies(v.species)?.key ?? "" });
  head.append(el("p", { "data-role": "pet-name" }, petTitle(v)));
  head.append(bar("HP", v.hp, v.maxHp, "pet-hp"));
  if (!v.wild) head.append(bar("Fed", v.fullness, 100, "pet-fullness"), bar("Trust", v.loyalty, 100, "pet-loyalty"), bar("XP", v.xp, v.xpNext, "pet-xp"));
  out.push(head);
  if (!v.wild && !v.owned) { out.push(kit.para(`Someone else's ${v.speciesName.toLowerCase()}.`)); return out; }
  if (v.owned) {
    const g = grid(); g.dataset["role"] = "pet-commands";
    g.append(btn("Follow", "pet-follow", () => send(petCommandIntent(v.entity, 0), `${v.name} follows you.`), { pressed: v.cmd === 0, role: "toggle", title: "Follow, defend you, fetch dropped items" }));
    g.append(btn("Stay", "pet-stay", () => send(petCommandIntent(v.entity, 1), `${v.name} stays here.`), { pressed: v.cmd === 1, role: "toggle", title: "Guard this spot, your buildings and pets" }));
    g.append(btn("Rename", "pet-rename", () => src.renamePet?.(v.entity, v.name), { alt: true, title: "Give your pet a name" }));
    out.push(g);
  }
  // treats / food offers (tame chance for wild animals)
  const og = grid(); og.dataset["role"] = "pet-offers";
  for (const o of v.offers) {
    const label = v.wild ? `Offer ${o.name} (${o.pref === "hate" ? "refuses" : Math.round(o.chance * 100) + "%"})` : `Feed ${o.name} ×${o.count}`;
    og.append(btn(label, `offer-${o.item}`, () => send(petOfferIntent(v.entity, o.item), v.wild ? `Offered ${o.name}…` : `Fed ${o.name}.`), { role: "offer", disabled: v.wild && o.chance <= 0, title: `${petSpecies(v.species)?.name}: ${PREF_TEXT[o.pref]}${o.fullness ? ` · +${o.fullness} fed` : ""}`, data: { item: String(o.item), icon: o.key, pref: o.pref } }));
    og.lastElementChild?.prepend(el("span", { "data-role": "ic", "data-icon": o.key, "aria-hidden": "true" })); // treat icon (::before is the tooltip)
  }
  out.push(heading(v.wild ? "Tame with a treat" : "Feed"));
  if (og.childElementCount) out.push(og);
  else out.push(kit.para(v.wild ? `No treat it accepts. ${PET_HELP[0]}` : "Nothing it can eat in your pack."));
  if (v.owned) {
    const inv = inventoryView(c); const cv = containerView(c, v.entity, 0);
    if (cv) {
      out.push(heading(`${v.name}'s bag · ${cv.slotCount} slots`));
      const g = grid(); g.dataset["role"] = "container-grid";
      for (const s of cv.slots) g.append(s.item
        ? btn(`${s.name} ×${s.count}`, `cslot-${s.slot}`, () => send(withdrawIntent(v.entity, s.item, s.count), `Took ${s.name} ×${s.count}.`), { title: `${s.tooltip}\nTake`, role: "cslot", data: { item: String(s.item), icon: s.icon, slot: String(s.slot) } })
        : btn("·", `cslot-${s.slot}`, () => kit.status("Empty slot"), { alt: true, title: "Empty", role: "cslot", data: { item: "0", slot: String(s.slot) } }));
      out.push(g);
      out.push(heading("Give from your pack"));
      const pg = grid(); for (const s of inv) if (!s.equipped) pg.append(btn(`${s.name} ×${s.count}`, `slot-${s.slot}`, () => send(depositIntent(v.entity, s.item, s.count), `Gave ${s.name} ×${s.count}.`), { title: `${s.tooltip}\nPut in ${v.name}'s bag`, role: "slot", data: { item: String(s.item), icon: s.icon } }));
      out.push(pg.childElementCount ? pg : kit.para("Your pack is empty."));
    } else { src.selectPet?.(v.entity); out.push(kit.para("Opening the bag…")); } // (re)sends the open; throttled in selectPet
  }
  return out;
}
