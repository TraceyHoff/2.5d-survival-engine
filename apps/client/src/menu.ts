/**
 * Boot UI in Art's cozy-camp theme: loading screen (logo from art/ui/branding/ when present, else a styled title)
 * with a progress bar, then the main menu (Singleplayer / Multiplayer / Settings).
 * Navigation: mouse, touch (buttons), keyboard (arrows/WASD/Tab, Enter/Space, Esc) and gamepad (d-pad/stick, A, B).
 */
import { enterFullscreen } from "./fullscreen.js";
interface Branding { title: string; tagline: string; logo: string; bg: "" | "flat" | "parallax"; plates: boolean; icons: boolean; loading: boolean; loadingAnim: boolean }
declare const __BRANDING__: Branding | undefined;
const BR: Branding = (typeof __BRANDING__ !== "undefined" && __BRANDING__) || { title: "Cozy Wild", tagline: "survival", logo: "", bg: "", plates: false, icons: false, loading: false, loadingAnim: false };
/** {app.title}: Art's branding.json title (placeholder until the game is named). */
export const APP_TITLE = BR.title;
export type MenuChoice = { kind: "singleplayer" } | { kind: "multiplayer"; url: string };
export interface Settings { bots: number; showHud: boolean; fullscreen: boolean }
const SETTINGS_KEY = "engine-settings";
export function loadSettings(): Settings {
  try { return { bots: 3, showHud: true, fullscreen: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings> }; } catch { return { bots: 3, showHud: true, fullscreen: true }; }
}

const CSS = (base: string): string => `@font-face{font-family:Fredoka;src:url(${base}art/ui/fonts/Fredoka.ttf) format("truetype");font-display:swap}
.boot{position:fixed;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;
font:600 16px Fredoka,system-ui,sans-serif;color:#FFFAF0;background:radial-gradient(ellipse at 50% 35%,#3d5a3a 0%,#22301f 55%,#14110f 100%);transition:opacity .35s}
.boot.hide{opacity:0;pointer-events:none}
.boot .title{font-size:clamp(34px,7vw,68px);font-weight:700;letter-spacing:1px;color:#FFD45A;text-align:center;line-height:1.05;
text-shadow:0 3px 0 #74432C,0 6px 0 #432C24,0 10px 18px rgba(0,0,0,.5);-webkit-text-stroke:2px #3B2433}
.boot .title small{display:block;font-size:.38em;color:#F6EAD2;-webkit-text-stroke:1px #3B2433;letter-spacing:4px;margin-top:6px}
.boot .logo{max-width:min(620px,84vw);max-height:38vh;filter:drop-shadow(0 8px 14px rgba(0,0,0,.45))}
.boot .track{width:min(420px,76vw);height:18px;background:#E6C47E;border:3px solid #4A2F3D;border-radius:10px;overflow:hidden;box-shadow:0 3px 0 #432C24}
.boot .fill{height:100%;width:0;background:linear-gradient(#FFE28A,#F4A74A);transition:width .2s}
.boot .lbl{font-size:13px;color:#E6C47E;min-height:1em}
.boot .panel{display:flex;flex-direction:column;gap:12px;background:#F6EAD2;border:4px solid #74432C;border-radius:18px;padding:18px 22px;
box-shadow:0 4px 0 #432C24,0 10px 24px rgba(0,0,0,.45);min-width:min(320px,86vw);max-width:92vw;color:#3B2433}
.boot button{font:700 20px Fredoka,system-ui,sans-serif;color:#FFFAF0;background:#5A9A4A;border:3px solid #3B2433;border-radius:14px;padding:10px 18px;
box-shadow:0 4px 0 #2D5A2E;cursor:pointer;touch-action:manipulation;text-shadow:0 2px 0 #2D5A2E;min-height:48px}
.boot button.alt{background:#C98A4B;box-shadow:0 4px 0 #74432C;text-shadow:0 2px 0 #74432C}
.boot button:focus,.boot button.sel{outline:3px solid #FFD45A;outline-offset:2px;transform:translateY(-1px)}
.boot button:active{transform:translateY(2px);box-shadow:0 2px 0 #2D5A2E}
.boot input{font:600 16px Fredoka,system-ui,sans-serif;padding:8px 10px;border:3px solid #4A2F3D;border-radius:10px;background:#FFFAF0;color:#3B2433}
.boot p{margin:0;font-size:14px;line-height:1.35;color:#4A2F3D;max-width:360px}
.boot h2{margin:0;font-size:22px;color:#74432C}
.boot label{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:15px}
.boot .hint{font-size:12px;color:#E6C47E}
${artCss(base)}`;
const KEYS: Record<string, string> = { Singleplayer: "singleplayer", Multiplayer: "multiplayer", Settings: "settings", Connect: "multiplayer", Save: "settings", Back: "quit" };
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
  if (BR.loadingAnim) c += `.boot .zw,.boot .cf{position:absolute;bottom:22px;width:64px;height:64px;background-size:384px 64px;image-rendering:pixelated}
.boot .zw{background-image:${u("loading/loading_zombie_walk.png")};animation:bootsheet .857s steps(6) infinite;transform:translateX(-32px);transition:left .2s}
.boot .cf{right:-40px;background-image:${u("loading/loading_campfire.png")};animation:bootsheet .6s steps(6) infinite}
@keyframes bootsheet{to{background-position:-384px 0}}.boot[data-boot=menu] .zw,.boot[data-boot=menu] .cf{display:none}`;
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

  constructor(private readonly base: string) {
    const st = document.createElement("style"); st.textContent = CSS(base); document.head.append(st);
    this.root.className = "boot"; this.root.dataset["boot"] = "loading";
    const esc = (t: string): string => t.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    this.header.innerHTML = `<div class="title">${esc(BR.title)}<small>${esc(BR.tagline.toUpperCase())}</small></div>`;
    document.title = BR.title;
    if (BR.bg === "parallax") ["sky", "far", "near", "fireflies", "vignette"].forEach((l, i) => { const d = document.createElement("div"); d.className = "px"; d.style.backgroundImage = `url(${base}art/ui/branding/background/parallax/menu_bg_${l}.png)`; d.style.setProperty("--d", String([0, 0.15, 0.35, 0.6, 0][i])); this.root.append(d); });
    const track = document.createElement("div"); track.className = "track"; this.fill.className = "fill"; track.append(this.fill);
    if (BR.loadingAnim) { this.zw.className = "zw"; const cf = document.createElement("div"); cf.className = "cf"; track.append(this.zw, cf); }
    this.lbl.className = "lbl"; this.body.append(track, this.lbl);
    this.root.append(this.header, this.body); document.body.append(this.root);
    void this.loadLogo();
  }
  /** Art's logo (assets/ui/branding/logo.png|webp|svg) replaces the text title when it exists. */
  private async loadLogo(): Promise<void> {
    if (!BR.logo) return;
    try { const img = new Image(); img.className = "logo"; img.alt = BR.title; img.src = `${this.base}art/ui/branding/${BR.logo}`; await img.decode(); this.header.replaceChildren(img); } catch { /* keep text title */ }
  }
  progress(f: number, label: string): void { const pc = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`; this.fill.style.width = pc; this.zw.style.left = pc; this.lbl.textContent = label; }

  /** Main menu; resolves with the player's choice. */
  menu(opts: { hostedStatic: boolean; defaultUrl: string }): Promise<MenuChoice> {
    this.root.dataset["boot"] = "menu";
    return new Promise((resolve) => {
      const main = (): void => this.screen([
        ["Singleplayer", () => { enterFullscreen(); resolve({ kind: "singleplayer" }); }],
        ["Multiplayer", multi],
        ["Settings", settings, "alt"],
      ], undefined, `<div class="hint">Mouse / touch · arrows + Enter · gamepad D-pad + A</div>`);
      const multi = (): void => {
        const input = document.createElement("input"); input.value = localStorage.getItem("engine-server-url") ?? opts.defaultUrl; input.placeholder = "wss://your-server:7777"; input.setAttribute("aria-label", "Server URL");
        const note = opts.hostedStatic
          ? `<p><b>Multiplayer needs a hosted game server.</b> This GitHub Pages build is static and can't host one: run <code>pnpm --filter @engine/server start</code> on a machine and enter its <code>ws://</code> / <code>wss://</code> address (https pages need <code>wss://</code>). Human bots are off in multiplayer.</p>`
          : `<p>Enter the game server address. Human bots are off in multiplayer.</p>`;
        this.screen([["Connect", () => { const url = input.value.trim(); if (!url) return; localStorage.setItem("engine-server-url", url); enterFullscreen(); resolve({ kind: "multiplayer", url }); }], ["Back", main, "alt"]],
          main, `<h2>Multiplayer</h2>${note}`, input);
      };
      const settings = (): void => {
        const s = loadSettings();
        const bots = document.createElement("input"); bots.type = "number"; bots.min = "0"; bots.max = "12"; bots.value = String(s.bots); bots.style.width = "70px";
        const hud = document.createElement("input"); hud.type = "checkbox"; hud.checked = s.showHud;
        const l1 = document.createElement("label"); l1.append("Singleplayer human bots", bots);
        const l2 = document.createElement("label"); l2.append("Show HUD", hud);
        const fs = document.createElement("input"); fs.type = "checkbox"; fs.checked = s.fullscreen;
        const l3 = document.createElement("label"); l3.append("Fullscreen when playing", fs);
        const save = (): void => { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ bots: Math.max(0, Math.min(12, Number(bots.value) || 0)), showHud: hud.checked, fullscreen: fs.checked })); main(); };
        this.screen([["Save", save], ["Back", main, "alt"]], main, `<h2>Settings</h2>`, l1, l2, l3);
      };
      main();
    });
  }

  private screen(items: [string, () => void, string?][], back: (() => void) | undefined, html = "", ...extra: HTMLElement[]): void {
    this.back = back;
    const panel = document.createElement("div"); panel.className = "panel"; panel.setAttribute("role", "menu");
    if (html) { const h = document.createElement("div"); h.style.cssText = "display:flex;flex-direction:column;gap:8px"; h.innerHTML = html; if (h.querySelector(".hint")) { h.remove(); } else panel.append(h); }
    panel.append(...extra);
    const buttons = items.map(([t, fn, cls]) => { const b = document.createElement("button"); b.setAttribute("role", "menuitem"); if (cls) b.className = cls;
      const k = KEYS[t]; if (BR.plates && k) { b.classList.add(`k-${k}`); if (!extra.length && !html.includes("<h2")) panel.classList.add("art"); }
      if (BR.icons && k && (t === "Singleplayer" || t === "Multiplayer" || t === "Settings")) { const ic = new Image(); ic.src = `${this.base}art/ui/branding/buttons/icons/ic_menu_${k}.png`; ic.alt = ""; b.append(ic); }
      b.append(t); b.addEventListener("click", fn); return b; });
    panel.append(...buttons);
    const nodes: HTMLElement[] = [panel]; if (html.includes("hint")) { const h = document.createElement("div"); h.className = "hint"; h.textContent = "Mouse / touch · arrows + Enter · gamepad D-pad + A"; nodes.push(h); }
    this.body.replaceChildren(...nodes);
    const focusables = (): HTMLElement[] => Array.from(panel.querySelectorAll<HTMLElement>("input,button"));
    let idx = focusables().indexOf(buttons[0]!); const focus = (i: number): void => { const f = focusables(); idx = (i + f.length) % f.length; f[idx]!.focus(); };
    focus(idx);
    if (this.keyHandler) removeEventListener("keydown", this.keyHandler);
    this.keyHandler = (e: KeyboardEvent): void => {
      const typing = (document.activeElement as HTMLElement | null)?.tagName === "INPUT" && (document.activeElement as HTMLInputElement).type !== "checkbox";
      if (e.key === "ArrowDown" || (!typing && (e.key === "s" || e.key === "S"))) { focus(idx + 1); e.preventDefault(); }
      else if (e.key === "ArrowUp" || (!typing && (e.key === "w" || e.key === "W"))) { focus(idx - 1); e.preventDefault(); }
      else if (e.key === "Escape" && this.back) { this.back(); e.preventDefault(); }
      else if (e.key === "Enter" && typing) { buttons[0]!.click(); e.preventDefault(); }
    };
    addEventListener("keydown", this.keyHandler);
    cancelAnimationFrame(this.padTimer);
    let prev = { up: false, down: false, a: false, b: false };
    const poll = (): void => {
      const gp = [...(navigator.getGamepads?.() ?? [])].find((g) => g); if (gp) {
        const ay = gp.axes[1] ?? 0; const cur = { up: !!gp.buttons[12]?.pressed || ay < -0.5, down: !!gp.buttons[13]?.pressed || ay > 0.5, a: !!gp.buttons[0]?.pressed, b: !!gp.buttons[1]?.pressed };
        if (cur.down && !prev.down) focus(idx + 1); if (cur.up && !prev.up) focus(idx - 1);
        if (cur.a && !prev.a) { const f = focusables()[idx]; if (f instanceof HTMLInputElement && f.type === "checkbox") f.checked = !f.checked; else f?.click(); }
        if (cur.b && !prev.b) this.back?.();
        prev = cur;
      }
      this.padTimer = requestAnimationFrame(poll);
    };
    this.padTimer = requestAnimationFrame(poll);
  }

  hide(): void {
    cancelAnimationFrame(this.padTimer); if (this.keyHandler) removeEventListener("keydown", this.keyHandler);
    this.root.classList.add("hide"); this.root.dataset["boot"] = "done"; setTimeout(() => this.root.remove(), 400);
  }
}
