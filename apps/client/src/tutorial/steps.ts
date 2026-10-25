/**
 * ADR-144 tutorial steps + progress. Pure (no DOM): text uses tokens that the overlay turns into live binding chips:
 *   {A:Action} or {A:Action@Context}  the controls bound to an input action on the active device
 *   {M:menuId}                        how to open a game menu on the active device
 * "do" steps finish when the probe shows the player did the thing; "info" steps wait for Next.
 */
import type { TutDevice } from "./labels.js";

/** Counters and values sampled from the game a few times a second (see main.ts tutorialProbe). */
export type Probe = Readonly<Record<string, number>>;
export type StepText = string | ({ all?: string } & Partial<Record<TutDevice, string>>);
export interface TutStep {
  id: string; section: string; title: string; text: StepText;
  /** Finishes the step when true (cur vs. the probe when the step began). Missing = info card (Next). */
  done?: (cur: Probe, base: Probe) => boolean;
  /** CSS selector of the UI element to spotlight (per device). */
  target?: (d: TutDevice) => string | undefined;
}
const grew = (k: string, by = 1) => (c: Probe, b: Probe): boolean => (c[k] ?? 0) - (b[k] ?? 0) >= by;
const any = (...fs: ((c: Probe, b: Probe) => boolean)[]) => (c: Probe, b: Probe): boolean => fs.some((f) => f(c, b));
const touchOr = (touchSel: string, other?: string) => (d: TutDevice): string | undefined => d === "touch" ? touchSel : other;
const menuBtn = (id: string) => (): string => `#game-menubar [data-open=${id}]`;
const stat = (k: string) => (): string => `#hud [data-stat=${k}]`;

export const TUTORIAL_STEPS: readonly TutStep[] = [
  { id: "welcome", section: "Start", title: "Welcome!", text: "This quick guide shows you how to stay alive. You can skip it at any time. You can play it again from Settings." },
  // ---- moving ----
  { id: "move", section: "Move", title: "Walk", text: "Walk around. Use {A:Move}.", done: grew("moved", 3), target: touchOr("[data-touch=move]") },
  { id: "sprint", section: "Move", title: "Run", text: { all: "Hold {A:Sprint} while you walk to run. Running uses stamina ⚡.", touch: "Tap {A:Sprint} and walk to run. Running uses stamina ⚡." }, done: grew("sprint", 3), target: (d) => d === "touch" ? "[data-touch=sprint]" : "#hud [data-stat=stamina]" },
  { id: "look", section: "Move", title: "Look around", text: { keyboardMouse: "Zoom in or out with {A:Camera.Zoom}.", gamepad: "Aim with {A:Aim}. Zoom with {A:Camera.Zoom}.", touch: "Zoom in or out: {A:Camera.Zoom}." }, done: any(grew("zoom"), grew("aim", 20)) },
  // ---- gathering + bag ----
  { id: "gather", section: "Gather", title: "Pick things up", text: { all: "Walk up to a bush, stick or rock. A hand ✋ means you can take it with bare hands. Press {A:Interact} to gather.", gamepad: "Walk up to a bush, stick or rock. A hand ✋ means you can take it with bare hands. Hold {A:Primary} to gather." }, done: grew("gain"), target: (d) => d === "touch" ? "[data-touch=context]" : "#tool-hint" },
  { id: "inventory", section: "Gather", title: "Your bag", text: "Open your bag with {M:inventory}.", done: grew("menu:inventory"), target: menuBtn("inventory") },
  { id: "bag-info", section: "Gather", title: "Your bag", text: "All your items live here. Pick an item to see what it does.", target: () => ".gm-modal[data-modal=inventory] .gm-panel" },
  { id: "eat", section: "Gather", title: "Eat and drink", text: { all: "Eat or drink something. Pick food or water in your bag and choose Use. You can also drink at a lake with {A:QuickUse}.", touch: "Eat or drink something. Pick food or water in your bag and choose Use. You can also drink at a lake with the {A:QuickUse}." }, done: grew("eat"), target: stat("hunger") },
  // ---- crafting ----
  { id: "craft", section: "Craft", title: "Make things", text: "Open crafting with {M:crafting}. You only see things you can make by hand here. Pick one to make it.", done: grew("craft"), target: menuBtn("crafting") },
  { id: "craft-station", section: "Craft", title: "Stations", text: "Bigger things need a station, like a campfire or a workbench. Those recipes are at the station." },
  { id: "equip", section: "Craft", title: "Hold a tool", text: { all: "Hold a tool, like a stone axe. Pick it in your hotbar with {A:Hotbar1}, or choose Equip in your bag.", gamepad: "Hold a tool, like a stone axe. Pick it with {A:Hotbar1}, or choose Equip in your bag.", touch: "Hold a tool, like a stone axe. Tap its slot, or choose Equip in your bag." }, done: (c) => (c["tool"] ?? 0) > 0 },
  { id: "chop", section: "Craft", title: "Chop a tree", text: "Stand next to a tree. Hold {A:Primary} to chop it. You get logs.", done: grew("gainLog"), target: touchOr("[data-touch=attack]") },
  // ---- building ----
  { id: "build", section: "Build", title: "Build mode", text: { all: "Open build mode with {A:ToggleBuild}. Pick the campfire.", touch: "Tap the {A:ToggleBuild}. Pick the campfire." }, done: grew("build"), target: menuBtn("build") },
  { id: "rotate", section: "Build", title: "Turn it", text: "Turn the piece with {A:Build.RotateCW@Building}.", done: grew("rotate"), target: touchOr("[data-touch=rotate]") },
  { id: "ghost", section: "Build", title: "Green or red", text: "Green means you can build here. Red means you can't. The red note tells you why, like \"Too far away\".", target: () => ".build-hud .bh-chip" },
  { id: "place", section: "Build", title: "Place it", text: "Put it down with {A:Build.PlaceConfirm@Building}.", done: grew("place"), target: touchOr("[data-touch=confirm]", ".build-hud .bh-chip") },
  { id: "roads", section: "Build", title: "Roads and signs", text: { keyboardMouse: "Lay roads with {A:RoadTool}. Put up signs with {A:PlaceSign}. Both are in the Build menu too.", all: "Roads and signs are in the Build menu. Roads help you find your way home." } },
  { id: "station", section: "Build", title: "Use a station", text: "Walk to your campfire. Press {A:Interact} to use it. Light it to cook food.", done: grew("menu:station"), target: touchOr("[data-touch=context]") },
  { id: "skills", section: "Grow", title: "Skills", text: "Open skills with {M:skills}.", done: grew("menu:skills"), target: menuBtn("skills") },
  { id: "skills-info", section: "Grow", title: "XP and levels", text: { all: "You get XP when you gather, craft and fight. Each new level gives you a skill point. Use the tabs on top to see each group.", gamepad: "You get XP when you gather, craft and fight. Each new level gives you a skill point. Switch tabs with {A:UI.TabNext@Inventory}." }, target: () => ".gm-modal[data-modal=skills] .gm-panel" },
  // ---- staying alive ----
  { id: "hunger", section: "Stay alive", title: "Hunger 🍖", text: "This bar shows how full you are. When it is empty, you get hurt. Eat food to fill it.", target: stat("hunger") },
  { id: "thirst", section: "Stay alive", title: "Thirst 💧", text: "This bar shows your water. It goes down faster than food. Drink often.", target: stat("thirst") },
  { id: "health", section: "Stay alive", title: "Health ❤", text: "This is your health. Hits and hunger take it away. Eat, drink and rest to get it back.", target: stat("hp") },
  { id: "stamina", section: "Stay alive", title: "Stamina ⚡", text: "Running, chopping and fighting use stamina. Stop for a moment and it comes back.", target: stat("stamina") },
  { id: "daynight", section: "Stay alive", title: "Day and night", text: "The clock shows the time. Nights are dark and more dangerous. A campfire gives you light.", target: () => "#hud .clock" },
  { id: "zombies", section: "Stay alive", title: "Zombies", text: "Zombies walk the land. Many come out at dusk and at night. Keep your distance or fight back." },
  { id: "hordes", section: "Stay alive", title: "Hordes", text: "After a few safe days, big groups of zombies called hordes can come for your camp. Build walls before then." },
  { id: "fight", section: "Stay alive", title: "Fight", text: "Hit with {A:Primary}. A bar over an enemy shows its health. Tools and weapons hit harder than fists.", target: touchOr("[data-touch=attack]") },
  { id: "death", section: "Stay alive", title: "If you die", text: "If your health runs out, you die. Your items drop in a bag where you fell. Come back and pick them up." },
  { id: "save", section: "Stay alive", title: "Saving", text: { all: "The game saves by itself. It also saves when you quit from the Menu." } },
  // ---- social ----
  { id: "chat", section: "Friends", title: "Chat", text: "Talk to other players with {M:chat}.", target: menuBtn("chat") },
  { id: "party", section: "Friends", title: "Party", text: "A party is a small team. Open it with {M:party} to invite a friend.", target: menuBtn("party") },
  { id: "clan", section: "Friends", title: "Clan", text: "A clan is a big group with ranks. Open it with {M:clan}." },
  { id: "trade", section: "Friends", title: "Trade stalls", text: "Build a stall to sell your items. Walk up to a stall and press {A:Interact} to buy." },
  { id: "settings", section: "Friends", title: "Settings", text: "Change sound, graphics and more in {M:settings}. You can play this guide again there." },
  { id: "done", section: "Done", title: "You're ready!", text: "That's it. Stay fed, stay safe, and have fun!" },
];

export type TutStatus = "active" | "done" | "skipped";
export interface TutSave { status: TutStatus; step: string; v: 1 }
export interface TutStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }
export const tutorialKey = (slot: string): string => `survivaz-tutorial-${slot}`;

/** Step cursor with save/resume. Call `observe` with fresh probes; it returns true when a "do" step finished. */
export class TutorialProgress {
  private i = 0; private base: Probe | undefined; status: TutStatus | undefined;
  constructor(readonly steps: readonly TutStep[], private readonly store: TutStorage | undefined, private readonly key: string) {
    const s = this.load();
    if (s) { this.status = s.status; const j = steps.findIndex((x) => x.id === s.step); this.i = j < 0 ? 0 : j; }
  }
  private load(): TutSave | undefined {
    try { const j = JSON.parse(this.store?.getItem(this.key) ?? "null") as TutSave | null; return j && (j.status === "active" || j.status === "done" || j.status === "skipped") ? j : undefined; } catch { return undefined; }
  }
  private save(): void { try { if (this.status) this.store?.setItem(this.key, JSON.stringify({ status: this.status, step: this.step.id, v: 1 } satisfies TutSave)); } catch { /* private mode */ } }
  /** True when the tutorial should open by itself: never seen it on this slot and this is a new game, or it was left half-way. */
  shouldAutoStart(newGame: boolean): boolean { return this.status === "active" || (this.status === undefined && newGame); }
  get index(): number { return this.i; }
  get step(): TutStep { return this.steps[this.i]!; }
  get active(): boolean { return this.status === "active"; }
  start(fromStart = false): void { if (fromStart || this.status !== "active") this.i = 0; this.status = "active"; this.base = undefined; this.save(); }
  go(i: number): void { this.i = Math.max(0, Math.min(this.steps.length - 1, i)); this.base = undefined; this.save(); }
  next(): void { if (this.i >= this.steps.length - 1) { this.finish(); return; } this.go(this.i + 1); }
  back(): void { this.go(this.i - 1); }
  skip(): void { this.status = "skipped"; this.save(); }
  finish(): void { this.status = "done"; this.save(); }
  observe(p: Probe): boolean {
    if (!this.active) return false;
    const s = this.step; if (!s.done) return false;
    if (!this.base) this.base = { ...p };
    if (s.done(p, this.base)) { this.next(); return true; }
    return false;
  }
}
