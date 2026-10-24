/**
 * Gameplay bodies for the ADR-095 menu shell (game-menus.ts): inventory, crafting, build, character, party, clan and
 * trade stall, from @engine/gameplay's menu view-models (packages/gameplay/src/ui/menus.ts). Data + commands only:
 * every control is a shell <button> (44px, focusable, so UINav reaches it by touch, D-pad/stick + A, Tab/arrows + Enter)
 * and every action is a gameplay command intent sent through `GameplaySource.send`. No art: styling is the shell's.
 * Data hooks for Art: `[data-role=slot|recipe|job|owed|piece|listing|member|invite|perm|unlock]`, `[data-key]`.
 */
import {
  buildView, cancelQueuedCraftIntent, clanAcceptIntent, clanCreateIntent, clanDemoteIntent, clanDisbandIntent, clanInviteIntent, clanKickIntent, clanLeaveIntent,
  clanPromoteIntent, clanSetGoalIntent, clanSetRankPermsIntent, clanView, collectTillIntent, craftingView, equipCosmeticIntent, inventoryView, JOB_STATE_LABEL,
  nearestStall, partyAcceptIntent, partyDeclineIntent, partyInviteIntent, partyKickIntent, partyLeaveIntent, partyView, queueCraftIntent, buyFromStallIntent,
  setAppearanceIntent, setStallNameIntent, priceItemChoices, listItemIntents, unstockStallIntent, type StallListDraft, setStallOpenIntent, stallView, togglePermMask, wardrobeView, placeIntent,
  type BuildSelection, type MenuCtx, type MenuIntent,
} from "@engine/gameplay";
import { GroupRole, Transform, type Entity } from "@engine/core";

export const GAMEPLAY_PANELS = ["inventory", "crafting", "build", "character", "party", "clan", "trade"] as const;
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
const dismissedClan = new Set<number>();
const draft: StallListDraft = { listing: 0, invSlot: -1, count: 1, priceItem: 0, priceCount: 1, qty: 1 };

export function gameplayBody(id: GameplayPanel, src: GameplaySource, kit: PanelKit): Node[] {
  const c = src.ctx(); if (!c) return [kit.para("Join a game to use this menu.")];
  const btn = (label: string, key: string, fn: () => void, opts: { alt?: boolean; disabled?: boolean; title?: string; role?: string; pressed?: boolean } = {}): HTMLButtonElement => {
    const b = el("button", { type: "button", "data-key": key }, label); if (opts.alt) b.className = "alt"; if (opts.disabled) b.disabled = true; if (opts.title) { b.title = opts.title; b.setAttribute("aria-label", `${label}. ${opts.title}`); }
    if (opts.role) b.dataset["role"] = opts.role; if (opts.pressed !== undefined) b.setAttribute("aria-pressed", String(opts.pressed));
    b.onclick = fn; return b; // property (not listener) so the diffing refresh can swap in fresh closures
  };
  const send = (i: MenuIntent, ok: string): void => { kit.status(src.send(i) ? ok : "Not connected."); kit.rerender(); };
  switch (id) {
    case "inventory": {
      const v = inventoryView(c); if (!v.length) return [kit.para("Your pack is empty.")];
      const g = grid(); for (const s of v) g.append(btn(`${s.name} ×${s.count}`, `slot-${s.slot}`, () => kit.status(s.tooltip.replace(/\n/g, " · ")), { title: s.tooltip, role: "slot" }));
      return [g];
    }
    case "crafting": {
      const v = craftingView(c); const out: Node[] = [];
      if (v.queue.length) { out.push(heading("Queue")); const g = grid(); for (const j of v.queue) g.append(btn(`✕ ${j.name} ×${j.count} · ${JOB_STATE_LABEL[j.state] ?? ""} ${Math.round(j.progress * 100)}%`, `job-${j.slot}`, () => send(cancelQueuedCraftIntent(j.slot), `Cancelled ${j.name}.`), { alt: true, role: "job", title: `${Math.ceil(j.secondsLeft)}s left. Cancel refunds unfinished units.` })); out.push(g); }
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
        if (sel.paintable) { out.push(heading("Tint")); const pg = grid(); for (let i = 0; i < 6; i++) pg.append(btn(i ? `Tint ${i}` : "Clan / none", `tint-${i}`, () => { buildSel.paint = i; src.onBuildSelect?.({ ...buildSel }); kit.rerender(); }, { pressed: i === buildSel.paint, alt: i !== buildSel.paint })); out.push(pg); }
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
      for (const u of v.unlocks) { const p = kit.para(`${u.unlocked ? "✓" : "🔒"} ${u.tag.replace(/_/g, " ")}`); p.dataset["role"] = "unlock"; p.dataset["key"] = u.tag; ug.append(p); }
      out.push(ug); return out;
    }
    case "party": {
      const v = partyView(c); const out: Node[] = [];
      if (v.invite) { const inv = v.invite; out.push(kit.para(`${inv.fromName} invited you (${inv.secondsLeft}s).`)); const g = grid(); g.append(btn("Accept", "party-accept", () => send(partyAcceptIntent(inv.party), "Joined party.")), btn("Decline", "party-decline", () => send(partyDeclineIntent(inv.party), "Declined."), { alt: true })); out.push(g); }
      out.push(heading(v.party ? `Party (${v.members.length}/${v.maxSize})` : "Not in a party"));
      if (v.party) { const g = grid(); for (const m of v.members) g.append(m.entity === c.player ? kit.para(`${m.name} (you)`) : btn(`Kick ${m.name}`, `kick-${m.playerId}`, () => send(partyKickIntent(m.entity), `Kicked ${m.name}.`), { alt: true, role: "member" })); out.push(g); const l = grid(); l.append(btn("Leave party", "party-leave", () => send(partyLeaveIntent(), "Left party."), { alt: true })); out.push(l); }
      out.push(heading("Invite nearby")); if (!v.candidates.length) out.push(kit.para("Nobody nearby."));
      const ig = grid(); for (const p of v.candidates.slice(0, 12)) ig.append(btn(`Invite ${p.name}`, `invite-${p.playerId}`, () => send(partyInviteIntent(p.entity), `Invited ${p.name}.`), { title: `${Math.round(p.distance)} m` })); out.push(ig);
      return out;
    }
    case "clan": {
      const v = clanView(c); const out: Node[] = [];
      if (v.invite && !dismissedClan.has(v.invite.clan)) { const inv = v.invite; out.push(kit.para(`${inv.fromName} invited you to a clan (${inv.secondsLeft}s).`)); const g = grid(); g.append(btn("Accept", "clan-accept", () => send(clanAcceptIntent(inv.clan), "Joined clan.")), btn("Dismiss", "clan-dismiss", () => { dismissedClan.add(inv.clan); kit.rerender(); }, { alt: true })); out.push(g); }
      if (!v.clan) { const g = grid(); g.append(btn("Create clan", "clan-create", () => send(clanCreateIntent(), "Clan created."))); out.push(kit.para("Not in a clan."), g); return out; }
      const lead = v.role === GroupRole.Leader; const officer = v.role >= GroupRole.Officer;
      out.push(kit.para(`${v.roleName} · goal: ${v.goalName} · your contribution: ${v.contrib}`));
      out.push(heading("Goal")); const gg = grid(); v.goals.forEach((n, i) => gg.append(btn(n, `goal-${i}`, () => { const t = c.world.get(c.player, Transform); send(clanSetGoalIntent(i, t?.x ?? 0, t?.y ?? 0), `Goal: ${n}.`); }, { pressed: i === v.goal, alt: i !== v.goal, disabled: !officer, title: "Goal point = where you stand" }))); out.push(gg);
      out.push(heading("Members")); const mg = grid();
      for (const m of v.members) { if (m.entity === c.player) continue; const r = el("div", { "data-role": "member", "data-key": String(m.playerId) }); r.append(kit.para(`${m.name} · ${m.role === 3 ? "Leader" : m.role === 2 ? "Officer" : "Member"}`));
        r.append(btn("Promote", `promote-${m.playerId}`, () => send(clanPromoteIntent(m.entity), `Promoted ${m.name}.`), { disabled: !lead }), btn("Demote", `demote-${m.playerId}`, () => send(clanDemoteIntent(m.entity), `Demoted ${m.name}.`), { alt: true, disabled: !lead }), btn("Kick", `ckick-${m.playerId}`, () => send(clanKickIntent(m.entity), `Kicked ${m.name}.`), { alt: true, disabled: !officer })); mg.append(r); }
      out.push(mg);
      out.push(heading("Invite nearby")); const ig = grid(); for (const p of v.candidates.slice(0, 12)) ig.append(btn(`Invite ${p.name}`, `cinvite-${p.playerId}`, () => send(clanInviteIntent(p.entity), `Invited ${p.name}.`), { disabled: !officer })); out.push(ig);
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
  }
}
