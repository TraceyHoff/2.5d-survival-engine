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
import "./gameplay-panels.css";
import { iconForItem,
  buildView, gameplayDefs, cancelQueuedCraftIntent, clanAcceptIntent, clanDeclineIntent, clanRosterRows, onlineTargets, paintIntent, paintTarget, type SocialDirectory, clanCreateIntent, clanDemoteIntent, clanDisbandIntent, clanInviteIntent, clanKickIntent, clanLeaveIntent,
  clanPromoteIntent, clanSetGoalIntent, clanSetRankPermsIntent, clanView, collectTillIntent, containerView, CONTAINER_PAGE_SIZE, craftingView, depositIntent, fuelView, toggleFireIntent, openContainer, withdrawIntent, equipCosmeticIntent, inventoryView, JOB_STATE_LABEL,
  nearestStall, partyAcceptIntent, partyDeclineIntent, partyInviteIntent, partyKickIntent, partyLeaveIntent, partyView, queueCraftIntent, buyFromStallIntent,
  setAppearanceIntent, setStallNameIntent, priceItemChoices, listItemIntents, unstockStallIntent, type StallListDraft, setStallOpenIntent, stallView, togglePermMask, wardrobeView, placeIntent,
  type BuildSelection, type MenuCtx, type MenuIntent, camperStationView, vehicleRefuelIntent, type CamperRecipeView,
} from "@engine/gameplay";
import { GroupRole, PlayerId, Transform, type Entity } from "@engine/core";

export const GAMEPLAY_PANELS = ["inventory", "crafting", "build", "character", "party", "clan", "trade", "camper"] as const;
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
  /** Stall the trade panel shows (set by interacting with a stall); falls back to the nearest stall. */
  stall?(): Entity | undefined;
  /** Owner-scoped clan roster + online directory (net events gameplay.clanRoster / clanRosterMember / onlinePlayer). */
  social?: SocialDirectory;
  /** Camper whose station panel is open (set from the vehicleStationOpened event, GameMenus.openCamper). */
  camper?(): Entity | undefined;
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
let wardrobeSlot = 0;
/** Camper station: active tab + selected cook recipe survive re-renders. */
const camperSel = { tab: "craft" as "craft" | "cook", cook: 0 };
const dismissedClan = new Set<number>();
/** Container panel page (ADR-098): survives re-renders; clamped by containerView. */
let containerPage = 0;
/** Page the open container by `d` (PgUp/PgDn, LB/RB, ◀ ▶). Returns true if a page change applies. */
export function pageContainer(d: number): boolean { containerPage = Math.max(0, containerPage + d); return true; }
export function containerPageIndex(): number { return containerPage; }
const gameplayDefsIcon = (c: MenuCtx, item: number): string => gameplayDefs(c.world).items.get(item)?.spriteKey ?? "";
const draft: StallListDraft = { listing: 0, invSlot: -1, count: 1, priceItem: 0, priceCount: 1, qty: 1 };

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
function panelIcon(world: Parameters<typeof gameplayDefs>[0], icon: string, item: string | undefined): string {
  if (!icon || hasIcon(icon)) return icon;
  const it = item ? gameplayDefs(world).items.get(Number(item)) : undefined;
  return it ? iconForItem(it, hasIcon) : icon;
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
      else { const g = grid(); for (const s of v) g.append(btn(`${s.name} ×${s.count}`, `slot-${s.slot}`, () => cv ? send(depositIntent(cv.entity, s.item, s.count), `Stored ${s.name} ×${s.count}.`) : kit.status(s.tooltip.replace(/\n/g, " · ")), { title: cv ? `${s.tooltip}\nStore in container` : s.tooltip, role: "slot", data: { item: String(s.item), icon: s.icon } })); out.push(g); }
      if (cv) {
        // ADR-098: paged container grid (CONTAINER_PAGE_SIZE per page). Every slot is a focusable button so the D-pad /
        // arrows walk the grid; ◀ ▶ (touch), PgUp/PgDn (keyboard) and LB/RB (gamepad) change pages. Keys are slot-stable,
        // so the morph refresh only patches the slots that changed.
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
    case "crafting": {
      const v = craftingView(c); const out: Node[] = [];
      if (v.queue.length) { out.push(heading("Queue")); const g = grid(); for (const j of v.queue) g.append(btn(`✕ ${j.name} ×${j.count} · ${JOB_STATE_LABEL[j.state] ?? ""} ${Math.round(j.progress * 100)}%`, `job-${j.slot}`, () => send(cancelQueuedCraftIntent(j.slot), `Cancelled ${j.name}.`), { alt: true, role: "job", p: j.progress, title: `${Math.ceil(j.secondsLeft)}s left. Cancel refunds unfinished units.` })); out.push(g); }
      if (v.owed.length) { out.push(heading("Owed (delivered when you have space)")); for (const o of v.owed) { const p = kit.para(`${o.name} ×${o.count}${o.crafterName ? ` · crafted by ${o.crafterName}` : ""}`); p.dataset["role"] = "owed"; out.push(p); } }
      out.push(heading("Recipes"));
      const counts = grid(); for (const n of [1, 5, 10]) counts.append(btn(`×${n}`, `count-${n}`, () => { castSel.count = n; kit.rerender(); }, { alt: castSel.count !== n, pressed: castSel.count === n })); out.push(counts);
      const g = grid();
      for (const r of v.recipes) {
        const need = r.ingredients.map((i) => `${i.name} ${i.have}/${i.count * castSel.count}`).join(", ");
        g.append(btn(`${r.output.name} ×${r.output.count}`, `recipe-${r.id}`, () => send(queueCraftIntent(r.id, castSel.count), `Queued ${r.output.name} ×${castSel.count}.`), { role: "recipe", title: `${need} · ${r.seconds}s${r.reason ? ` · ${r.reason.replace(/_/g, " ")}` : ""}`, alt: !!r.reason }));
      }
      out.push(g); return out;
    }
    case "build": {
      const v = buildView(c); if (!buildSel.piece && v[0]) buildSel.piece = v[0].id;
      const sel = v.find((p) => p.id === buildSel.piece); const out: Node[] = [heading("Pieces")]; const g = grid();
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
      return out;
    }
    case "character": {
      const v = wardrobeView(c); const out: Node[] = [];
      out.push(kit.para(v.canEdit ? (v.created ? "At a wardrobe: change your look." : "Create your character.") : "Stand near a wardrobe to change your look."));
      const sg = grid(); for (const s of v.slots) sg.append(btn(`${s.key}${s.equipped ? "" : " (none)"}`, `wslot-${s.slot}`, () => { wardrobeSlot = s.slot; kit.rerender(); }, { pressed: s.slot === wardrobeSlot, alt: s.slot !== wardrobeSlot }));
      out.push(heading("Slot"), sg);
      const cur = v.slots[wardrobeSlot]!; const cg = grid();
      const pal = cur.key === "hair" || cur.key === "face" ? v.palettes.hair : v.palettes.clothing;
      cg.append(btn("Remove", "unequip", () => send(equipCosmeticIntent(cur.slot, 0), "Removed."), { alt: true, disabled: !v.canEdit || !cur.equipped }));
      for (let i = 0; i < Math.min(pal, 8); i++) cg.append(btn(`Colour ${i + 1}`, `color-${i}`, () => send(equipCosmeticIntent(cur.slot, cur.equipped, i, cur.secondary), "Colour set."), { disabled: !v.canEdit || !cur.equipped, pressed: cur.primary === i }));
      out.push(heading(`${cur.key}: colour`), cg);
      if (v.palettes.skin) { const kg = grid(); for (let i = 0; i < Math.min(v.palettes.skin, 8); i++) kg.append(btn(`Skin ${i + 1}`, `skin-${i}`, () => { const a = v.slots; send(setAppearanceIntent({ bodyType: 0, skinTone: i, parts: a.map((s) => s.equipped), primary: a.map((s) => s.primary), secondary: a.map((s) => s.secondary) }), "Look saved."); }, { disabled: !v.canEdit })); out.push(heading("Skin tone"), kg); }
      out.push(heading("Unlocks")); const ug = el("div", { "data-role": "unlocks" });
      for (const u of v.unlocks) { const p = kit.para(u.tag.replace(/_/g, " ")); p.dataset["role"] = "unlock"; p.dataset["key"] = u.tag; if (u.unlocked) p.dataset["unlocked"] = ""; ug.append(p); }
      out.push(ug); return out;
    }
    case "party": {
      const v = partyView(c); const out: Node[] = [];
      if (v.invite) { const inv = v.invite; out.push(kit.para(`${inv.fromName} invited you (${inv.secondsLeft}s).`)); const g = grid(); g.append(btn("Accept", "party-accept", () => send(partyAcceptIntent(inv.party), "Joined party.")), btn("Decline", "party-decline", () => send(partyDeclineIntent(inv.party), "Declined."), { alt: true })); out.push(g); }
      out.push(heading(v.party ? `Party (${v.members.length}/${v.maxSize})` : "Not in a party"));
      if (v.party) { const g = grid(); for (const m of v.members) g.append(m.entity === c.player ? kit.para(`${m.name} (you)`) : btn(`Kick ${m.name}`, `kick-${m.playerId}`, () => send(partyKickIntent(m.entity), `Kicked ${m.name}.`), { alt: true, role: "member", data: { rank: "member" } })); out.push(g); const l = grid(); l.append(btn("Leave party", "party-leave", () => send(partyLeaveIntent(), "Left party."), { alt: true })); out.push(l); }
      const pc = onlineTargets(c, src.social, new Set(v.members.map((m) => m.playerId)));
      out.push(heading("Invite")); if (!pc.length) out.push(kit.para("Nobody online nearby."));
      const ig = grid(); for (const p of pc.slice(0, 16)) { const e = p.entity; ig.append(btn(`Invite ${p.name}`, `invite-${p.playerId}`, () => { if (e !== undefined) send(partyInviteIntent(e), `Invited ${p.name}.`); }, { disabled: e === undefined, title: p.distance !== undefined ? `${Math.round(p.distance)} m` : "online, not nearby" })); } out.push(ig);
      return out;
    }
    case "clan": {
      const v = clanView(c); const out: Node[] = [];
      if (v.invite && !dismissedClan.has(v.invite.clan)) { const inv = v.invite; out.push(kit.para(`${inv.fromName} invited you to a clan (${inv.secondsLeft}s).`)); const g = grid(); g.append(btn("Accept", "clan-accept", () => send(clanAcceptIntent(inv.clan), "Joined clan.")), btn("Dismiss", "clan-dismiss", () => { dismissedClan.add(inv.clan); send(clanDeclineIntent(inv.clan), "Declined."); }, { alt: true })); out.push(g); }
      if (!v.clan) { const g = grid(); g.append(btn("Create clan", "clan-create", () => send(clanCreateIntent(), "Clan created."))); out.push(kit.para("Not in a clan."), g); return out; }
      const lead = v.role === GroupRole.Leader; const officer = v.role >= GroupRole.Officer;
      out.push(kit.para(`${v.roleName} · goal: ${v.goalName} · your contribution: ${v.contrib}`));
      out.push(heading("Goal")); const gg = grid(); v.goals.forEach((n, i) => gg.append(btn(n, `goal-${i}`, () => { const t = c.world.get(c.player, Transform); send(clanSetGoalIntent(i, t?.x ?? 0, t?.y ?? 0), `Goal: ${n}.`); }, { pressed: i === v.goal, alt: i !== v.goal, disabled: !officer, title: "Goal point = where you stand" }))); out.push(gg);
      out.push(heading("Members")); const mg = grid();
      const roster = clanRosterRows(c, src.social, v.clan); const myPid = c.world.getField(c.player, PlayerId, "id") ?? 0;
      if (roster) for (const m of roster) { if (m.playerId === myPid) continue; const e = m.entity; const r = el("div", { "data-role": "member", "data-key": String(m.playerId), "data-rank": rankOf(m.role) }); r.append(kit.para(`${m.online ? "●" : "○"} ${m.name} · ${m.roleName}`));
        const far = e === undefined ? " (not nearby)" : "";
        r.append(btn("Promote", `promote-${m.playerId}`, () => { if (e !== undefined) send(clanPromoteIntent(e), `Promoted ${m.name}.`); }, { disabled: !lead || e === undefined, title: far }), btn("Demote", `demote-${m.playerId}`, () => { if (e !== undefined) send(clanDemoteIntent(e), `Demoted ${m.name}.`); }, { alt: true, disabled: !lead || e === undefined, title: far }), btn("Kick", `ckick-${m.playerId}`, () => { if (e !== undefined) send(clanKickIntent(e), `Kicked ${m.name}.`); }, { alt: true, disabled: !officer || e === undefined, title: far })); mg.append(r); }
      else for (const m of v.members) { if (m.entity === c.player) continue; const r = el("div", { "data-role": "member", "data-key": String(m.playerId), "data-rank": rankOf(m.role) }); r.append(kit.para(`${m.name} · ${m.role === 3 ? "Leader" : m.role === 2 ? "Officer" : "Member"}`));
        r.append(btn("Promote", `promote-${m.playerId}`, () => send(clanPromoteIntent(m.entity), `Promoted ${m.name}.`), { disabled: !lead }), btn("Demote", `demote-${m.playerId}`, () => send(clanDemoteIntent(m.entity), `Demoted ${m.name}.`), { alt: true, disabled: !lead }), btn("Kick", `ckick-${m.playerId}`, () => send(clanKickIntent(m.entity), `Kicked ${m.name}.`), { alt: true, disabled: !officer })); mg.append(r); }
      out.push(mg);
      const cc = onlineTargets(c, src.social, new Set([...(roster ?? []).map((m) => m.playerId), ...v.members.map((m) => m.playerId)]));
      out.push(heading("Invite")); const ig = grid(); for (const p of cc.slice(0, 16)) { const e = p.entity; ig.append(btn(`Invite ${p.name}`, `cinvite-${p.playerId}`, () => { if (e !== undefined) send(clanInviteIntent(e), `Invited ${p.name}.`); }, { disabled: !officer || e === undefined, title: e === undefined ? "online, not nearby" : "" })); } out.push(ig);
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
