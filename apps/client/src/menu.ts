/**
 * Boot UI in Art's cozy-camp theme: loading screen (logo from art/ui/branding/ when present, else a styled title)
 * with a progress bar, then the main menu (Singleplayer / Multiplayer / Settings).
 * Navigation: mouse, touch (buttons), keyboard (arrows/WASD/Tab, Enter/Space, Esc) and gamepad (d-pad/stick, A, B).
 */
import { deleteConfirm, deleteLocalProgress, listLocalSaves, type LocalSaveKind } from "./delete-progress.js";
import { mountUi } from "./ui-root.js";
import { enterFullscreen } from "./fullscreen.js";
import { BackHistory, focusVisible } from "./back-history.js";
import { EasedBar, zombiePose } from "./load-progress.js";
interface Branding { title: string; tagline: string; logo: string; bg: "" | "flat" | "parallax"; plates: boolean; icons: boolean; loading: boolean; loadingAnim: boolean }
declare const __BRANDING__: Branding | undefined;
const BR: Branding = (typeof __BRANDING__ !== "undefined" && __BRANDING__) || { title: "Cozy Wild", tagline: "survival", logo: "", bg: "", plates: false, icons: false, loading: false, loadingAnim: false };
/** {app.title}: Art's branding.json title (placeholder until the game is named). */
export const APP_TITLE = BR.title;
export type MenuChoice = { kind: "singleplayer" } | { kind: "multiplayer"; url: string } | { kind: "host" } | { kind: "join"; code: string };
/** hostCap: desktop P2P host player cap incl. the host (mobile hosts are fixed at 6, see p2p.ts). */
export interface Settings { bots: number; showHud: boolean; fullscreen: boolean; hostCap: number; /** ADR-121: new-world rules */ hordes: boolean; hordeGraceDays: number }
/** ADR-121: the world rules a NEW local / hosted world is created with (an existing save keeps its own). */
export function newWorldRules(s: Settings = loadSettings()): { hordes: boolean; hordeGraceDays: number } { return { hordes: s.hordes !== false, hordeGraceDays: Math.max(0, Math.min(30, Number(s.hordeGraceDays) || 0)) }; }
const SETTINGS_KEY = "engine-settings";
export function saveSettings(s: Settings): void { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as object), ...s })); } catch { /* private mode */ } }
export function loadSettings(): Settings {
  try { return { bots: 3, showHud: true, fullscreen: true, hostCap: 12, hordes: true, hordeGraceDays: 3, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings> }; } catch { return { bots: 3, showHud: true, fullscreen: true, hostCap: 12, hordes: true, hordeGraceDays: 3 }; }
}

const CSS = (base: string): string => `@font-face{font-family:Fredoka;src:url(${base}art/ui/fonts/Fredoka.ttf) format("truetype");font-display:swap}
.boot{position:fixed;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;
font:600 16px Fredoka,system-ui,sans-serif;color:#FFFAF0;background:radial-gradient(ellipse at 50% 35%,#3d5a3a 0%,#22301f 55%,#14110f 100%);transition:opacity .35s;
overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);box-sizing:border-box}
.boot.hide{opacity:0;pointer-events:none}
.boot .title{font-size:clamp(34px,7vw,68px);font-weight:700;letter-spacing:1px;color:#FFD45A;text-align:center;line-height:1.05;
text-shadow:0 3px 0 #74432C,0 6px 0 #432C24,0 10px 18px rgba(0,0,0,.5);-webkit-text-stroke:2px #3B2433}
.boot .title small{display:block;font-size:.38em;color:#F6EAD2;-webkit-text-stroke:1px #3B2433;letter-spacing:4px;margin-top:6px}
.boot .logo{max-width:min(620px,84vw);max-height:38vh;filter:drop-shadow(0 8px 14px rgba(0,0,0,.45))}
.boot .track{width:min(420px,76vw);height:18px;background:#E6C47E;border:3px solid #4A2F3D;border-radius:10px;overflow:hidden;box-shadow:0 3px 0 #432C24}
.boot .fill{height:100%;width:0;background:linear-gradient(#FFE28A,#F4A74A);transition:width .2s}
.boot .lane{position:relative;width:min(420px,76vw);padding-top:40px}.boot .lane .track{width:100%}
.boot .lane .zw{position:absolute;left:0;bottom:16px;width:36px;height:36px;margin-left:-18px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'%3E%3Crect x='5' y='1' width='6' height='5' fill='%2379a85a'/%3E%3Crect x='6' y='3' width='1' height='1' fill='%23c0302a'/%3E%3Crect x='9' y='3' width='1' height='1' fill='%23c0302a'/%3E%3Crect x='4' y='6' width='8' height='5' fill='%234a6b8a'/%3E%3Crect x='11' y='6' width='4' height='2' fill='%2379a85a'/%3E%3Crect x='5' y='11' width='2' height='4' fill='%233b2433'/%3E%3Crect x='9' y='11' width='2' height='4' fill='%233b2433'/%3E%3C/svg%3E") center/contain no-repeat;image-rendering:pixelated;pointer-events:none;will-change:transform,left}
.boot[data-boot=error] .fill{background:#C0302A}.boot[data-boot=error] .lbl{color:#FF9A8A}.boot[data-boot=menu] .lane .zw{display:none}
.boot .lbl{font-size:13px;color:#E6C47E;min-height:1em}
.boot .panel{display:flex;flex-direction:column;gap:12px;background:#F6EAD2;border:4px solid #74432C;border-radius:18px;padding:18px 22px;
box-shadow:0 4px 0 #432C24,0 10px 24px rgba(0,0,0,.45);min-width:min(320px,86vw);max-width:92vw;color:#3B2433;box-sizing:border-box;
max-height:calc(100vh - 24px);max-height:calc(100dvh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - 24px);overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior:contain;flex-shrink:0}
.boot button{font:700 20px Fredoka,system-ui,sans-serif;color:#FFFAF0;background:#5A9A4A;border:3px solid #3B2433;border-radius:14px;padding:10px 18px;
box-shadow:0 4px 0 #2D5A2E;cursor:pointer;touch-action:manipulation;text-shadow:0 2px 0 #2D5A2E;min-height:48px}
.boot .panel.has-footer{max-height:calc(100dvh - var(--sat,0px) - var(--sab,0px) - 16px);overflow-y:auto;padding-bottom:0}
.boot .sticky-footer{position:sticky;bottom:0;z-index:1;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;background:#F6EAD2;border-top:2px solid #74432C;padding:10px 0 14px;margin-top:4px}
.boot .sticky-footer button{flex:1 1 auto;min-height:44px}.boot button:disabled{opacity:.45;cursor:not-allowed}
.boot button.alt{background:#C98A4B;box-shadow:0 4px 0 #74432C;text-shadow:0 2px 0 #74432C}
.boot button:focus,.boot button.sel{outline:3px solid #FFD45A;outline-offset:2px;transform:translateY(-1px)}
.boot button:active{transform:translateY(2px);box-shadow:0 2px 0 #2D5A2E}
.boot input{font:600 16px Fredoka,system-ui,sans-serif;padding:8px 10px;border:3px solid #4A2F3D;border-radius:10px;background:#FFFAF0;color:#3B2433}
.boot p{margin:0;font-size:14px;line-height:1.35;color:#4A2F3D;max-width:360px}
.boot [data-role=notice]{font-weight:700;color:#A0302A}
.boot h2{margin:0;font-size:22px;color:#74432C}
.boot label{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:15px}
.boot .hint{font-size:12px;color:#E6C47E}
${artCss(base)}`;
const KEYS: Record<string, string> = { Singleplayer: "singleplayer", Multiplayer: "multiplayer", Settings: "settings", Connect: "multiplayer", "Host game": "multiplayer", "Join with code": "multiplayer", Join: "multiplayer", "Dedicated server": "multiplayer", Save: "settings", Back: "quit" };
function artCss(base: string): string {
  const u = (f: string): string => `url(${base}art/ui/branding/${f})`; let c = "";
  if (BR.bg === "parallax") c += `.boot{background:#1b1622}.boot .px{position:absolute;inset:-4%;background-size:cover;background-position:center;pointer-events:none;z-index:-1;animation:bootdrift 30s ease-in-out infinite alternate}
@keyframes bootdrift{from{transform:translateX(calc(var(--d)*-24px))}to{transform:translateX(calc(var(--d)*24px))}}`;
  else if (BR.bg === "flat") c += `.boot{background:#1b1622 ${u("background/menu_bg_1920x1080.png")} center/cover}`;
  if (BR.plates) {
    c += `.boot button[class*="k-"]{background:none;border:0;border-style:solid;box-shadow:none;outline:none;border-radius:0;padding:14px 26px 18px;min-height:76px;transform:none;display:flex;align-items:center;justify-content:center;gap:10px;text-shadow:0 2px 0 rgba(59,36,51,.8)}
.boot button[class*="k-"] img{width:40px;height:40px;image-rendering:auto}.boot .panel.art{background:none;border:0;box-shadow:none;padding:0}`;
    for (const k of ["singleplayer", "multiplayer", "settings", "quit"]) for (const [st, sel] of [["normal", ""], ["hover", ":hover,.boot button.k-" + k + ":focus,.boot button.k-" + k + ".sel"], ["pressed", ":active"]] as const)
      c += `.boot button.k-${k}${sel}{border-image:${u(`buttons/plates/btn_plate_${k}_${st}.png`)} 18 22 20 22 fill / 18px 22px 20px 22px stretch}`;
  }
  if (BR.loading) c += `.boot .track{border:0;border-style:solid;border-image:${u("loading/loading_frame.png")} 12 16 15 14 fill / 12px 16px 15px 14px stretch;background:none;box-shadow:none;height:32px;padding:6px 9px 8px 8px;box-sizing:border-box;border-radius:0;overflow:visible;position:relative}
.boot .fill{border:0;border-style:solid;border-image:${u("loading/loading_fill.png")} 7 8 7 8 fill / 7px 8px 7px 8px stretch;background:none;min-width:16px;height:18px}`;
  if (BR.loadingAnim) c += `.boot .cf{position:absolute;bottom:22px;width:64px;height:64px;background-size:384px 64px;image-rendering:pixelated}
.boot .lane .zw{background-image:${u("loading/loading_zombie_walk.png")};background-size:384px 64px;width:64px;height:64px;bottom:22px;margin-left:-32px}
.boot .cf{right:-40px;background-image:${u("loading/loading_campfire.png")};animation:bootsheet .6s steps(6) infinite}
@keyframes bootsheet{to{background-position:-384px 0}}.boot[data-boot=menu] .zw,.boot[data-boot=menu] .cf{display:none}
@media (prefers-reduced-motion:reduce){.boot .cf{animation:none}}`;
  return c;
}

export class BootUI {
  readonly root = document.createElement("div");
  private fill = document.createElement("div");
  private lbl = document.createElement("div");
  private header = document.createElement("div");
  private body = document.createElement("div");
  private zw = document.createElement("div");
  private padTimer = 0;
  private keyHandler: ((e: KeyboardEvent) => void) | undefined;
  private back: (() => void) | undefined;
  private readonly history = new BackHistory(() => { this.back?.(); });

  constructor(private readonly base: string) {
    const st = document.createElement("style"); st.textContent = CSS(base); document.head.append(st);
    this.root.className = "boot"; this.root.dataset["boot"] = "loading";
    const esc = (t: string): string => t.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    this.header.innerHTML = `<div class="title">${esc(BR.title)}<small>${esc(BR.tagline.toUpperCase())}</small></div>`;
    document.title = BR.title;
    if (BR.bg === "parallax") ["sky", "far", "near", "fireflies", "vignette"].forEach((l, i) => { const d = document.createElement("div"); d.className = "px"; d.style.backgroundImage = `url(${base}art/ui/branding/background/parallax/menu_bg_${l}.png)`; d.style.setProperty("--d", String([0, 0.15, 0.35, 0.6, 0][i])); this.root.append(d); });
    const track = document.createElement("div"); track.className = "track"; this.fill.className = "fill"; track.append(this.fill);
    const lane = document.createElement("div"); lane.className = "lane"; this.zw.className = "zw"; this.zw.dataset["role"] = "loading-zombie"; lane.append(track, this.zw);
    if (BR.loadingAnim) { const cf = document.createElement("div"); cf.className = "cf"; track.append(cf); }
    track.setAttribute("role", "progressbar"); track.setAttribute("aria-valuemin", "0"); track.setAttribute("aria-valuemax", "100"); this.track = track;
    this.lbl.className = "lbl"; this.lbl.setAttribute("aria-live", "polite"); this.body.append(lane, this.lbl);
    try { this.bar.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* old browsers */ }
    this.root.append(this.header, this.body); mountUi(this.root);
    void this.loadLogo();
  }
  /** Art's logo (assets/ui/branding/logo.png|webp|svg) replaces the text title when it exists. */
  private async loadLogo(): Promise<void> {
    if (!BR.logo) return;
    try { const img = new Image(); img.className = "logo"; img.alt = BR.title; img.src = `${this.base}art/ui/branding/${BR.logo}`; await img.decode(); this.header.replaceChildren(img); } catch { /* keep text title */ }
  }
  private track: HTMLElement | undefined;
  private readonly bar = new EasedBar();
  private raf = 0; private lastT = 0; private finishWaiters: (() => void)[] = [];
  /** Target progress (0..1, ADR-118): the fill eases toward it, never backwards; the zombie walks on the fill edge. */
  progress(f: number, label: string): void {
    if (this.root.dataset["boot"] === "error") return;
    this.bar.set(f); this.lbl.textContent = label; this.kick();
  }
  /** Ease to 100% then resolve (capped so a hidden tab or slow frame never blocks the hand-off). */
  finish(label = "Ready"): Promise<void> {
    this.progress(1, label);
    return new Promise((ok) => { if (this.bar.done) { ok(); return; } this.finishWaiters.push(ok); setTimeout(() => { this.bar.reducedMotion = true; this.paint(0); }, 1200); });
  }
  /** Error state: stop the walk, red bar, message stays (the caller decides whether boot continues). */
  fail(message: string): void { this.root.dataset["boot"] = "error"; this.lbl.textContent = message; this.paint(0); }
  private kick(): void {
    if (this.raf) return;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
    const tick = (t: number): void => { const dt = this.lastT ? (t - this.lastT) / 1000 : 1 / 60; this.lastT = t; this.raf = 0; if (this.paint(dt)) this.raf = raf(tick); else this.lastT = 0; };
    this.raf = raf(tick);
  }
  /** One frame; returns true while still animating. */
  private paint(dt: number): boolean {
    const before = this.bar.shown; const v = this.bar.step(dt); const moving = v > before && this.root.dataset["boot"] !== "error";
    const pc = `${(v * 100).toFixed(2)}%`; this.fill.style.width = pc; this.zw.style.left = pc;
    this.track?.setAttribute("aria-valuenow", String(Math.round(v * 100)));
    const pose = zombiePose(performance.now() / 1000, moving, this.bar.reducedMotion);
    this.zw.style.transform = `translateY(${pose.bob.toFixed(1)}px)`;
    if (BR.loadingAnim) this.zw.style.backgroundPosition = `${-64 * pose.frame}px 0`;
    if (this.bar.done) { const w = this.finishWaiters; this.finishWaiters = []; for (const f of w) f(); }
    return v < this.bar.goal || (moving && !this.bar.done);
  }

  /** Main menu; resolves with the player's choice. */
  /** notice: shown once on the main screen (e.g. "Host ended the session"), hook `.boot [data-role=notice]`. */
  /** slot: ?player slot whose browser saves "Manage saves" deletes (ADR-099). */
  menu(opts: { hostedStatic: boolean; defaultUrl: string; notice?: string; slot?: string }): Promise<MenuChoice> {
    this.root.dataset["boot"] = "menu";
    return new Promise((resolve) => {
      let notice = opts.notice;
      const main = (): void => {
        const extra: HTMLElement[] = [];
        if (notice) { const n = document.createElement("p"); n.dataset["role"] = "notice"; n.setAttribute("role", "status"); n.textContent = notice; extra.push(n); notice = undefined; }
        this.screen([
          ["Singleplayer", () => { enterFullscreen(); resolve({ kind: "singleplayer" }); }],
          ["Multiplayer", multi],
          ["Delete progress", saves, "alt"],
          ["Settings", settings, "alt"],
        ], undefined, `<div class="hint">Mouse / touch · arrows + Enter · gamepad D-pad + A</div>`, ...extra);
      };
      // Multiplayer: browser-hosted P2P (Host game / Join with code) or a dedicated server.
      const multi = (): void => this.screen([
        ["Host game", () => { enterFullscreen(); resolve({ kind: "host" }); }],
        ["Join with code", join],
        ["Dedicated server", dedicated, "alt"],
        ["Back", main, "alt"],
      ], main, `<h2>Multiplayer</h2><p>Host a game in this browser and share the code, or join a friend's code. Human bots are off in multiplayer.</p>`);
      const join = (): void => {
        const input = document.createElement("input"); input.dataset["role"] = "room-code"; input.placeholder = "ABC-234"; input.maxLength = 7; input.autocapitalize = "characters"; input.autocomplete = "off"; input.spellcheck = false; input.setAttribute("aria-label", "Room code");
        this.screen([["Join", () => { const code = input.value.trim(); if (!code) return; enterFullscreen(); resolve({ kind: "join", code }); }], ["Back", multi, "alt"]],
          multi, `<h2>Join with code</h2><p>Enter the 6-character code shown on the host's screen.</p>`, input);
      };
      const dedicated = (): void => {
        const input = document.createElement("input"); input.value = localStorage.getItem("engine-server-url") ?? opts.defaultUrl; input.placeholder = "wss://your-server:7777"; input.setAttribute("aria-label", "Server URL");
        const note = opts.hostedStatic
          ? `<p><b>Dedicated server.</b> This GitHub Pages build can't run one (use Host game for a browser-hosted session): run <code>pnpm --filter @engine/server start</code> on a machine and enter its <code>ws://</code> / <code>wss://</code> address (https pages need <code>wss://</code>). Human bots are off in multiplayer.</p>`
          : `<p>Enter the game server address. Human bots are off in multiplayer.</p>`;
        this.screen([["Connect", () => { const url = input.value.trim(); if (!url) return; localStorage.setItem("engine-server-url", url); enterFullscreen(); resolve({ kind: "multiplayer", url }); }], ["Back", multi, "alt"]],
          multi, `<h2>Dedicated server</h2>${note}`, input);
      };
      const settings = (): void => {
        const s = loadSettings();
        const bots = document.createElement("input"); bots.type = "number"; bots.min = "0"; bots.max = "12"; bots.value = String(s.bots); bots.style.width = "70px";
        const hud = document.createElement("input"); hud.type = "checkbox"; hud.checked = s.showHud;
        const l1 = document.createElement("label"); l1.append("Singleplayer human bots", bots);
        const l2 = document.createElement("label"); l2.append("Show HUD", hud);
        const fs = document.createElement("input"); fs.type = "checkbox"; fs.checked = s.fullscreen;
        const l3 = document.createElement("label"); l3.append("Fullscreen when playing", fs);
        const cap = document.createElement("input"); cap.type = "number"; cap.min = "2"; cap.max = "32"; cap.value = String(s.hostCap); cap.style.width = "70px";
        const l4 = document.createElement("label"); l4.append("Max players when hosting (desktop)", cap);
        const hz = document.createElement("input"); hz.type = "checkbox"; hz.checked = s.hordes !== false; hz.dataset["setting"] = "hordes";
        const l5 = document.createElement("label"); l5.append("Roaming zombie hordes (new worlds)", hz);
        const gd = document.createElement("input"); gd.type = "number"; gd.min = "0"; gd.max = "30"; gd.step = "0.5"; gd.value = String(s.hordeGraceDays ?? 3); gd.style.width = "70px"; gd.dataset["setting"] = "hordeGraceDays";
        const l6 = document.createElement("label"); l6.append("Horde grace period (in-game days)", gd);
        const manage = document.createElement("button"); manage.className = "alt"; manage.textContent = "Delete progress…"; manage.dataset["action"] = "manage-saves"; manage.addEventListener("click", saves);
        const save = (): void => { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as object), bots: Math.max(0, Math.min(12, Number(bots.value) || 0)), showHud: hud.checked, fullscreen: fs.checked, hordes: hz.checked, hordeGraceDays: Math.max(0, Math.min(30, Number(gd.value) || 0)), hostCap: Math.max(2, Math.min(32, Math.round(Number(cap.value)) || 12)) })); main(); };
        this.screen([["Save", save], ["Back", main, "alt"]], main, `<h2>Settings</h2>`, l1, l2, l3, l4, l5, l6, manage);
      };
      // Delete progress (ADR-099): pick what to delete from this device, then type DELETE or hold to confirm.
      const slot = opts.slot ?? "1";
      const saves = (): void => {
        const box = document.createElement("div"); box.dataset["role"] = "save-picker"; box.style.cssText = "display:flex;flex-direction:column;gap:6px";
        const status = document.createElement("p"); status.textContent = "Looking for saves on this device…"; box.append(status);
        const note = document.createElement("p"); note.className = "hint-note"; note.textContent = "Dedicated-server progress isn't stored on this device: delete it in-game from Settings → Delete my progress while connected to that server.";
        const boxes = new Map<LocalSaveKind, HTMLInputElement>();
        const all = document.createElement("input"); all.type = "checkbox"; all.dataset["save"] = "everything";
        const allL = document.createElement("label"); allL.append(all, " Delete everything (also forgets this device's player identity)");
        all.addEventListener("change", () => { for (const b of boxes.values()) b.checked = all.checked; c.refresh(); });
        // Sticky footer (always visible while the picker scrolls): Back + Delete + Hold to delete.
        const footer = document.createElement("div"); footer.dataset["role"] = "sticky-footer"; footer.className = "sticky-footer";
        const picked = (): boolean => all.checked || [...boxes.values()].some((b) => b.checked);
        const c = deleteConfirm({ message: "Pick what to delete above. This can't be undone.", settingsOption: false, onCancel: main, actions: footer, canConfirm: picked,
          onConfirm: async () => {
            const kinds = new Set([...boxes].filter(([, b]) => b.checked).map(([k]) => k));
            const r = await deleteLocalProgress({ slot, kinds, everything: all.checked }); if (!r.ok) throw new Error(r.message);
            setTimeout(() => { if (this.root.dataset["boot"] === "menu") saves(); }, 1500); // refresh the list
            return r.message;
          } });
        c.el.style.maxHeight = "none"; c.el.style.overflow = "visible"; // the panel scrolls, not a nested box
        this.screen([["Back", main, "alt"]], main, `<h2>Delete progress</h2>`, box, note, c.el, footer);
        this.cleanup = () => c.destroy();
        void listLocalSaves({ slot }).then((list) => {
          if (!box.isConnected) return;
          const rows = list.map((s) => {
            const cb = document.createElement("input"); cb.type = "checkbox"; cb.dataset["save"] = s.kind; boxes.set(s.kind, cb);
            cb.addEventListener("change", () => { if (!cb.checked) all.checked = false; c.refresh(); });
            const l = document.createElement("label"); const d = document.createElement("small"); d.textContent = ` — ${s.detail}`;
            l.append(cb, ` ${s.label}`, d); if (!s.present) l.style.opacity = "0.6"; return l;
          });
          status.remove(); box.append(...rows, allL);
          (rows[0]?.querySelector("input") as HTMLInputElement | null)?.focus();
        }, (e: unknown) => { status.textContent = `Couldn't read saves: ${e instanceof Error ? e.message : String(e)}`; });
      };
      main();
    });
  }
  private cleanup: (() => void) | undefined;

  private screen(items: [string, () => void, string?][], back: (() => void) | undefined, html = "", ...extra: HTMLElement[]): void {
    this.back = back; this.cleanup?.(); this.cleanup = undefined;
    this.history.sync(!!back); // Android/browser back = this screen's Back (ADR-107)
    const panel = document.createElement("div"); panel.className = "panel"; panel.setAttribute("role", "menu");
    if (html) { const h = document.createElement("div"); h.style.cssText = "display:flex;flex-direction:column;gap:8px"; h.innerHTML = html; if (h.querySelector(".hint")) { h.remove(); } else panel.append(h); }
    panel.append(...extra);
    const buttons = items.map(([t, fn, cls]) => { const b = document.createElement("button"); b.setAttribute("role", "menuitem"); if (cls) b.className = cls;
      const k = KEYS[t]; if (BR.plates && k) { b.classList.add(`k-${k}`); if (!extra.length && !html.includes("<h2")) panel.classList.add("art"); }
      if (BR.icons && k && (t === "Singleplayer" || t === "Multiplayer" || t === "Settings")) { const ic = new Image(); ic.src = `${this.base}art/ui/branding/buttons/icons/ic_menu_${k}.png`; ic.alt = ""; b.append(ic); }
      b.append(t); b.addEventListener("click", fn); return b; });
    const footer = extra.find((e) => e.dataset["role"] === "sticky-footer");
    if (footer) { footer.prepend(...buttons); panel.classList.add("ui-scroll", "has-footer"); } else panel.append(...buttons);
    const nodes: HTMLElement[] = [panel]; if (html.includes("hint")) { const h = document.createElement("div"); h.className = "hint"; h.textContent = "Mouse / touch · arrows + Enter · gamepad D-pad + A"; nodes.push(h); }
    this.body.replaceChildren(...nodes);
    const focusables = (): HTMLElement[] => Array.from(panel.querySelectorAll<HTMLElement>("input:not(:disabled),button:not(:disabled)"));
    let idx = focusables().indexOf(buttons[0]!); const focus = (i: number): void => { const f = focusables(); if (!f.length) return; idx = (i + f.length) % f.length; focusVisible(f[idx]); };
    panel.addEventListener("focusin", (e) => { const i = focusables().indexOf(e.target as HTMLElement); if (i >= 0) idx = i; }); // content added later (save picker)
    focus(idx);
    if (this.keyHandler) removeEventListener("keydown", this.keyHandler);
    this.keyHandler = (e: KeyboardEvent): void => {
      const typing = (document.activeElement as HTMLElement | null)?.tagName === "INPUT" && (document.activeElement as HTMLInputElement).type !== "checkbox";
      if (e.key === "ArrowDown" || (!typing && (e.key === "s" || e.key === "S"))) { focus(idx + 1); e.preventDefault(); }
      else if (e.key === "ArrowUp" || (!typing && (e.key === "w" || e.key === "W"))) { focus(idx - 1); e.preventDefault(); }
      else if (e.key === "Escape" && this.back) { this.back(); e.preventDefault(); }
      else if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type === "checkbox") { e.target.click(); e.preventDefault(); }
      else if (e.key === "Enter" && typing && buttons[0]) { buttons[0].click(); e.preventDefault(); }
    };
    addEventListener("keydown", this.keyHandler);
    cancelAnimationFrame(this.padTimer);
    let prev = { up: false, down: false, a: false, b: false };
    const poll = (): void => {
      const gp = [...(navigator.getGamepads?.() ?? [])].find((g) => g); if (gp) {
        const ay = gp.axes[1] ?? 0; const cur = { up: !!gp.buttons[12]?.pressed || ay < -0.5, down: !!gp.buttons[13]?.pressed || ay > 0.5, a: !!gp.buttons[0]?.pressed, b: !!gp.buttons[1]?.pressed };
        if (cur.down && !prev.down) focus(idx + 1); if (cur.up && !prev.up) focus(idx - 1);
        if (cur.a && !prev.a) { const f = focusables()[idx]; f?.click(); }
        if (cur.b && !prev.b) this.back?.();
        prev = cur;
      }
      this.padTimer = requestAnimationFrame(poll);
    };
    this.padTimer = requestAnimationFrame(poll);
  }

  hide(): void {
    cancelAnimationFrame(this.padTimer); if (this.keyHandler) removeEventListener("keydown", this.keyHandler);
    this.history.sync(false); this.history.destroy();
    this.root.classList.add("hide"); this.root.dataset["boot"] = "done"; setTimeout(() => this.root.remove(), 400);
  }
}
