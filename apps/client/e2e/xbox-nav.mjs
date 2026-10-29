// ADR-213: Xbox (Edge) controller navigation harness on the PRODUCTION build.
//   pnpm -C apps/client build && pnpm -C apps/client exec vite preview --port 5417 --strictPort
//   node apps/client/e2e/xbox-nav.mjs [baseUrl=http://127.0.0.1:5417] [shotDir=/tmp]     (XBOX_MODES=key,apiHat to subset)
// Drives every pad-reachable screen with the controller delivered the ways Edge on Xbox can deliver it:
//   key      keyboard emulation: trusted keydown/keyup key "GamepadDPadDown" + keyCode 204 (CDP, real keyCodes)
//   keyUnid  same, but key "Unidentified" (Chromium has no DOM key name for VK_GAMEPAD_*) — only the keyCode identifies it
//   apiIdle0 Gamepad API, mapping "standard", the live pad at index 1 and an idle pad at index 0
//   apiHat   Gamepad API, mapping "" (DirectInput layout): D-pad as a hat on axis 9, View/Menu = 6/7, index 1
//   apiStick Gamepad API, directions from the LEFT STICK only
//   both     one physical press delivered as BOTH a pad key and a Gamepad API button (must act once)
// Checks: each D-pad / stick press moves focus exactly once (focusin count), held direction repeats, focus ring visible
// (:root[data-pad-ui] + outline), A/B/Start work, gameplay (hotbar / zoom) does not react while a menu is open.
import { createRequire } from "node:module"; import { fileURLToPath } from "node:url"; import path from "node:path";
import { xboxInitScript, sendPadKey } from "./xbox-env.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../../packages/render/package.json"));
const { chromium } = require("playwright-core");
const BASE = process.argv[2] ?? "http://127.0.0.1:5417"; const SHOTS = process.argv[3] ?? "/tmp";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const fails = []; let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails.push(msg); console.log(`  FAIL ${msg}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STICK = { up: ["lsy", -0.95], down: ["lsy", 0.95], left: ["lsx", -0.95], right: ["lsx", 0.95] };

async function open(url, mode) {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => console.log(`  pageerror: ${e.message}`));
  await page.addInitScript(xboxInitScript, {});
  await page.addInitScript((s) => { window.STK = s; window.__fc = 0; document.addEventListener("focusin", () => { window.__fc++; }, true); }, STICK);
  const cdp = await page.context().newCDPSession(page);
  await page.goto(url);
  const api = mode.startsWith("api") || mode === "both";
  if (api) await page.evaluate((m) => {
    if (m === "apiIdle0") { __xb.make(0, "standard", "buttons").visible = true; __xb.make(1, "standard", "buttons"); }
    else if (m === "apiHat") __xb.make(1, "", "hat"); else __xb.make(0, "standard", "buttons");
  }, mode);
  const idx = mode === "apiIdle0" || mode === "apiHat" ? 1 : 0;
  /** One physical press of `ctl` held `ms` (with OS-style auto-repeat for keys when held long). */
  const press = async (ctl, ms = 90) => {
    const viaKey = mode === "key" || mode === "keyUnid" || mode === "both", unidentified = mode === "keyUnid";
    const apiSet = (on) => page.evaluate(([i, c, v, stick]) => { if (v) { window.__pt0 = performance.now(); window.__held = 0; } else window.__held = performance.now() - window.__pt0; if (stick && STK[c]) __xb.set(i, STK[c][0], v ? STK[c][1] : 0); else __xb.set(i, c, v); }, [idx, ctl, on, mode === "apiStick"]).catch(() => {});
    if (viaKey) await sendPadKey(h.cdp, ctl, { type: "down", unidentified });
    // the Gamepad API is sampled once per frame: make sure the page really saw the press / release (frames can hitch)
    const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))).catch(() => {});
    if (api) { await apiSet(true); await frames(); }
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await sleep(33); if (viaKey && Date.now() - t0 > 500) await sendPadKey(h.cdp, ctl, { type: "down", unidentified, autoRepeat: true }); }
    if (viaKey) await sendPadKey(h.cdp, ctl, { type: "up", unidentified });
    if (api) { await apiSet(false); await frames(); }
    await sleep(110);
  };
  const h = { browser, page, cdp, press };
  return h;
}
const fc = (page) => page.evaluate(() => window.__fc);
const act = (page) => page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? (a.getAttribute("aria-label") ?? a.textContent ?? a.tagName).trim().slice(0, 40) : ""; });
const top = (page) => page.evaluate(() => window.__qa?.menus?.().nav.top);
const ring = (page) => page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return "no focus"; const s = getComputedStyle(a); const vis = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none"); return vis ? "" : `no ring on ${a.tagName} (${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow})`; });
/** One D-pad / stick step must move focus exactly once. */
async function step(h, dir, where) {
  const b = await fc(h.page), a0 = await act(h.page); await h.press(dir); const n = (await fc(h.page)) - b, a1 = await act(h.page);
  // a press the page saw held past the 400 ms repeat delay (very slow SwiftShader frames) may legitimately repeat once
  const held = await h.page.evaluate(() => window.__held ?? 0);
  ok(n === 1 || (n === 2 && held > 400), `${where}: ${dir} moved focus ${n}x (${a0} -> ${a1}, held ${Math.round(held)} ms)`); return a1;
}
/** Walk focus with the D-pad to the control whose label starts with `label`, steering by geometry (grids, 2-col hubs). */
async function walkTo(h, label, max = 40, inc = false) {
  for (let i = 0; i < max; i++) {
    const d = await h.page.evaluate(([label, inc]) => {
      const a = document.activeElement, m = [...document.querySelectorAll("[data-menu]")].pop() ?? document;
      const lab = (el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(), hit = (el) => (inc ? lab(el).includes(label) : lab(el).startsWith(label));
      if (a && hit(a)) return "";
      const t = [...m.querySelectorAll("button,input,select,[tabindex]")].find((el) => hit(el) && el.getClientRects().length);
      if (!t || !a) return "missing";
      const r1 = a.getBoundingClientRect(), r2 = t.getBoundingClientRect(), dy = (r2.top + r2.bottom - r1.top - r1.bottom) / 2, dx = (r2.left + r2.right - r1.left - r1.right) / 2;
      if (Math.abs(dy) > Math.max(8, r1.height / 2)) return dy > 0 ? "down" : "up"; return dx > 0 ? "right" : "left";
    }, [label, inc]);
    if (d === "") return true; if (d === "missing") return false; await h.press(d);
  }
  return false;
}
async function navCheck(h, where, dirs = ["down", "up"]) {
  for (const d of dirs) await step(h, d, where);
  const r = await ring(h.page); ok(r === "", `${where}: focus ring visible (${r})`);
  ok(await h.page.evaluate(() => !!document.documentElement.dataset.padUi), `${where}: pad UI mode on`);
}

async function mainMenu(mode) {
  console.log(`main menu [${mode}]`);
  const h = await open(`${BASE}/?padDebug=1`, mode);
  await h.page.waitForFunction(() => document.activeElement?.tagName === "BUTTON", null, { timeout: 180000 }); await sleep(500);
  await step(h, "down", `main menu ${mode}`); await step(h, "down", `main menu ${mode}`); await step(h, "up", `main menu ${mode}`);
  if (mode === "key" || mode === "apiHat") {
    for (let i = 0; i < 8 && !/Settings/.test(await act(h.page)); i++) await h.press("down");
    ok(/Settings/.test(await act(h.page)), `main menu ${mode}: reach Settings (${await act(h.page)})`);
    await h.press("a"); await sleep(300); const inSettings = await h.page.evaluate(() => document.querySelector("#boot, [data-boot]")?.textContent?.slice(0, 80));
    console.log(`  main menu ${mode}: after A on Settings: ${inSettings}`);
    await step(h, "down", `main menu settings ${mode}`);
    await h.page.screenshot({ path: `${SHOTS}/xboxnav_main_settings_${mode}.png` });
    await h.press("b"); await sleep(300); ok((await act(h.page)) !== "", `main menu ${mode}: B back`);
    await h.page.screenshot({ path: `${SHOTS}/xboxnav_main_${mode}.png` });
  }
  await h.browser.close();
}

async function inGame(mode, full) {
  console.log(`in game [${mode}]${full ? " (all screens)" : ""}`);
  const h = await open(`${BASE}/?offline=1&dev=sandbox&worker=0&padDebug=1`, mode); const { page } = h;
  await page.waitForFunction(() => window.__qa?.player?.() !== undefined && window.__qa.menus?.(), null, { timeout: 180000 });
  await sleep(1500); await page.evaluate(() => __qa.menus().nav.closeAll()); await sleep(200);
  await h.press("start"); await sleep(200); ok((await top(page)) === "pause", `${mode}: Start opens pause (top=${await top(page)})`);
  await navCheck(h, `pause ${mode}`, ["down", "down", "up"]);
  { const b = await fc(page); await h.press("down", 1200); const n = (await fc(page)) - b; ok(n >= 5 && n <= 10, `pause ${mode}: held down repeated ${n}x (want 5..10)`); }
  const gstate = () => page.evaluate(() => ({ z: __qa.zoom().user, sel: [...document.querySelectorAll("#hotbar button")].map((b) => b.className + b.dataset.equipped + (b.getAttribute("aria-pressed") ?? "")).join() }));
  const g0 = await gstate(); await h.press("left"); await h.press("right"); await h.press("lt"); await h.press("rt"); await page.evaluate(() => { const n = __qa.menus().nav; while (n.top && n.top !== "pause") n.close(); });
  const g1 = await gstate();
  ok(JSON.stringify(g0) === JSON.stringify(g1), `pause ${mode}: gameplay (hotbar/zoom) unchanged while menu open`);
  await page.screenshot({ path: `${SHOTS}/xboxnav_pause_${mode}.png` });
  const entries = await page.evaluate(() => [...document.querySelector("[data-menu=pause]").querySelectorAll("button")].map((b) => (b.getAttribute("aria-label") ?? b.textContent).trim()));
  const targets = full ? entries.filter((e) => !/Close|Resume|Quit|guide/.test(e)) : entries.filter((e) => /Inventory/.test(e));
  for (const t of targets) {
    await page.evaluate(() => { __qa.menus().nav.closeAll(); }); await sleep(100); await h.press("start"); await sleep(150);
    await walkTo(h, t);
    ok((await act(page)) === t, `pause ${mode}: D-pad reaches "${t}" (at "${await act(page)}")`);
    await h.press("a"); await sleep(250); const id = await top(page);
    ok(id && id !== "pause", `${mode}: A on "${t}" opens it (top=${id})`);
    const where = `${id} ${mode}`;
    const nf = await page.evaluate(() => [...document.querySelectorAll("[data-menu]")].pop()?.querySelectorAll("button:not(:disabled),input,select,[tabindex='0']").length ?? 0);
    if (nf > 1) await navCheck(h, where, ["down", "right", "down", "up", "left"]); else console.log(`  ${where}: only ${nf} control (nothing nearby in the sandbox)`);
    if (id === "inventory") await inventoryOps(h, mode);
    if (id === "chat") await chatOsk(h, mode);
    if (id === "settings" && full) await settingsDialogs(h, mode);
    await page.screenshot({ path: `${SHOTS}/xboxnav_${id}_${mode}.png` });
    await page.evaluate((id) => { const n = __qa.menus().nav; while (n.top && n.top !== id && n.top !== "pause") n.close(); }, id).catch(() => {});
    if ((await top(page)) === id) { await h.press("b"); await sleep(200); ok((await top(page)) === "pause", `${where}: B backs out to pause (top=${await top(page)})`); }
  }
  if (full) { await stations(h, mode); await death(h, mode); }
  await page.evaluate(() => __qa.menus().nav.closeAll()); await sleep(100);
  await h.press("start"); await sleep(150); await h.press("start"); await sleep(150); ok(!(await top(page)), `${mode}: Start toggles pause closed (top=${await top(page)})`);
  await h.browser.close();
}
async function inventoryOps(h, mode) {
  const { page } = h;
  const labels = () => page.evaluate(() => [...([...document.querySelectorAll("[data-menu]")].pop()?.querySelectorAll("button,summary") ?? [])].map((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim()));
  const has = async (re) => (await labels()).some((l) => re.test(l));
  // equip: A on Iron Sword toggles its ◆ equipped marker
  ok(await walkTo(h, "Iron Sword"), `inventory ${mode}: D-pad reaches Iron Sword (at ${await act(page)})`);
  const eq0 = await has(/^◆ Iron Sword/); await h.press("a"); await sleep(400);
  ok((await has(/^◆ Iron Sword/)) !== eq0, `inventory ${mode}: A equips/unequips Iron Sword (was ${eq0})`);
  // eat: A on Cooked Meat (count drops by 1 unless food is full; either way focus stays in inventory)
  ok(await walkTo(h, "Cooked Meat"), `inventory ${mode}: D-pad reaches Cooked Meat (at ${await act(page)})`);
  const c0 = (await labels()).find((l) => l.startsWith("Cooked Meat")); await h.press("a"); await sleep(400);
  const c1 = (await labels()).find((l) => l.startsWith("Cooked Meat")); console.log(`  inventory ${mode}: eat ${c0?.slice(0, 16)} -> ${c1?.slice(0, 16)}`);
  ok((await top(page)) === "inventory", `inventory ${mode}: A on Cooked Meat keeps the inventory open`);
  // split: X on Pine Log ×16 opens the picker, RT adds, A splits
  ok(await walkTo(h, "Pine Log"), `inventory ${mode}: D-pad reaches Pine Log (at ${await act(page)})`);
  const logs0 = (await labels()).filter((l) => /^Pine Log ×/.test(l)).length;
  await h.press("x"); await sleep(300);
  ok(/^Split ×/.test(await act(page)), `inventory ${mode}: X opens the split picker (focus ${await act(page)})`);
  await page.screenshot({ path: `${SHOTS}/xboxnav_split_${mode}.png` });
  await h.press("rt"); await sleep(200); const sp = await act(page); await h.press("a"); await sleep(700);
  console.log(`  inventory ${mode}: split ${sp} -> ${(await labels()).filter((l) => /^Pine Log ×/.test(l)).map((l) => l.slice(0, 12)).join(",")} (was ${logs0})`);
  ok((await labels()).filter((l) => /^Pine Log ×/.test(l)).length === logs0 + 1, `inventory ${mode}: A on Split makes a new Pine Log stack`);
  // to hotbar: Y on Iron Ingot opens 8 targets; D-pad + A moves it
  ok(await walkTo(h, "Iron Ingot"), `inventory ${mode}: D-pad reaches Iron Ingot (at ${await act(page)})`);
  await h.press("y"); await sleep(300);
  const hb = await act(page); ok(!hb.startsWith("Iron Ingot"), `inventory ${mode}: Y opens the hotbar picker (focus ${hb.slice(0, 24)})`);
  await step(h, "right", `hotbar picker ${mode}`); await page.screenshot({ path: `${SHOTS}/xboxnav_hotbar_${mode}.png` });
  await h.press("a"); await sleep(500); ok((await top(page)) === "inventory" && !/^Split ×|^Cancel/.test(await act(page)), `inventory ${mode}: A moves Iron Ingot to the hotbar (focus ${(await act(page)).slice(0, 24)})`);
  // drop: open "Drop items…" with A, walk to Drop Stone, A
  ok(await walkTo(h, "Drop items", 60), `inventory ${mode}: D-pad reaches Drop items… (at ${await act(page)})`);
  await h.press("a"); await sleep(300);
  ok(await walkTo(h, "Drop Stone.", 60), `inventory ${mode}: D-pad reaches Drop Stone (at ${await act(page)})`);
  await h.press("a"); await sleep(600);
  ok(!(await has(/^Stone ×/)), `inventory ${mode}: A drops the Stone stack`);
  await page.screenshot({ path: `${SHOTS}/xboxnav_inventory_${mode}.png` });
}
async function chatOsk(h, mode) {
  const { page } = h;
  for (let i = 0; i < 6 && (await page.evaluate(() => document.activeElement?.dataset.role)) !== "chat-input"; i++) await h.press("up");
  await h.press("a"); await sleep(250);
  const osk = await page.evaluate(() => ({ top: __qa.menus().nav.top, role: document.activeElement?.dataset.role }));
  console.log(`  chat ${mode}: A on input -> ${JSON.stringify(osk)}`);
  if (osk.top !== "chat") { await navCheck(h, `chat OSK ${mode}`, ["down", "right", "right", "left"]); await page.screenshot({ path: `${SHOTS}/xboxnav_osk_${mode}.png` }); await h.press("b"); await sleep(200); }
}
async function settingsDialogs(h, mode) {
  const { page } = h;
  for (const dlg of ["Error log", "Delete"]) {
    if (!(await walkTo(h, dlg, 60, true))) { console.log(`  settings ${mode}: no "${dlg}" button`); continue; }
    await h.press("a"); await sleep(250); const id = await top(page); ok(id !== "settings", `settings ${mode}: A opens ${dlg} (top=${id})`);
    await navCheck(h, `${id} ${mode}`, ["down", "up"]); await page.screenshot({ path: `${SHOTS}/xboxnav_${id}_${mode}.png` });
    await h.press("b"); await sleep(200); ok((await top(page)) === "settings", `${id} ${mode}: B back to settings (top=${await top(page)})`);
  }
}
async function stations(h, mode) {
  const { page } = h;
  for (const id of ["station", "camper", "trade", "pet"]) {
    await page.evaluate(() => __qa.menus().nav.closeAll());
    const opened = await page.evaluate((id) => { const m = __qa.menus(); m.open(id); return m.nav.top; }, id).catch((e) => String(e));
    await sleep(250); ok(opened === id, `${mode}: ${id} screen opens (top=${opened})`);
    const n = await page.evaluate(() => [...document.querySelectorAll("[data-menu]")].pop()?.querySelectorAll("button:not(:disabled),input,select,[tabindex='0']").length ?? 0);
    if (n > 1) await navCheck(h, `${id} ${mode}`, ["down", "up"]); else console.log(`  ${id} ${mode}: only ${n} control(s) without a station nearby`);
    await page.screenshot({ path: `${SHOTS}/xboxnav_${id}_${mode}.png` });
    await h.press("b"); await sleep(150); ok(!(await top(page)), `${id} ${mode}: B closes (top=${await top(page)})`);
  }
}
async function death(h, mode) {
  const { page } = h;
  await page.evaluate(() => __qa.menus().nav.closeAll());
  const killed = await page.evaluate(async () => { const G = await __qa.G(); const w = __qa.world(), p = __qa.player(); if (!G.Dead || !w.isRegistered(G.Dead)) return "no Dead"; w.add(p, G.Dead); return true; }).catch((e) => String(e));
  if (killed !== true) { console.log(`  death ${mode}: could not mark the player dead (${killed}); covered by unit tests`); return; }
  await sleep(500); await page.screenshot({ path: `${SHOTS}/xboxnav_death_${mode}.png` });
  const vis = await page.evaluate(() => { const d = document.getElementById("death-screen"); return !!d && !d.hidden; }); console.log(`  death ${mode}: screen visible=${vis}`);
  await page.evaluate(async () => { const G = await __qa.G(); __qa.world().remove?.(__qa.player(), G.Dead); }).catch(() => {});
}

const MODES = process.env.XBOX_MODES?.split(",") ?? ["key", "keyUnid", "apiIdle0", "apiHat", "apiStick", "both"];
for (const m of MODES) { await mainMenu(m); await inGame(m, m === "key" || m === "apiHat" || m === "both"); }
console.log(`\n${checks - fails.length}/${checks} checks passed`); if (fails.length) { console.log(fails.map((f) => ` - ${f}`).join("\n")); process.exit(1); }
