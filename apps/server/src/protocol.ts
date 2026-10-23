/**
 * Browser-safe demo protocol shared by apps/server, the headless bots and apps/client ("@engine/server/protocol").
 * Input bits + movement (identical on server and in client prediction), and the ordered command/event lists.
 * Movement lives here because gameplay has no movement system yet; replace with gameplay's once it exists.
 */
import { Appearance, DEFAULT_TICK_HZ, defineActions, entityIndex, installPermissions, Transform, type ClaimRegistry, type Entity, type GroupRegistry, type PermissionsRes, type World } from "@engine/core";
import { defineCommand, defineNetEvent, type CommandRejection, type InputCmd, type NetClient } from "@engine/net";
import { PVP_COMMANDS, CRAFT_QUEUE_COMMANDS, CUSTOMIZATION_COMMANDS, ECONOMY_COMMAND_RATES, ECONOMY_COMMANDS, ECONOMY_ENTITY_FIELDS, installGameplay, PlayerIntent, UseCmd, PlaceCmd, EmoteCmd } from "@engine/gameplay";
import type { CommandDef } from "@engine/core";
import { SESSION_COMMANDS, SESSION_EVENTS } from "@engine/persist";

export const Act = defineActions(["MoveUp", "MoveDown", "MoveLeft", "MoveRight", "Sprint", "Gather"]);
export const MOVE_SPEED = 4; // tiles/s
export const SPRINT_MUL = 1.6;

/** App-level ping (Netcode has no RTT measurement yet). Server answers on its next tick, so RTT includes 0..1 tick. */
export const Ping = defineCommand("demo.ping", { t: "u32" }, { rate: { perSec: 4, burst: 4 } });
export const Pong = defineNetEvent("demo.pong", { t: "u32" });

/** Same order on both peers (checked by the "netdefs" handshake hash). */
/**
 * Gameplay commands on the wire: net mirrors of gameplay's core CommandDefs (same name + schema; `stall` is a NetId
 * resolved to an Entity). The server bridges each into core CommandHandlers (see game.ts). Append-only order.
 */
const mirror = (d: CommandDef) => {
  const perSec = ECONOMY_COMMAND_RATES[d.name] ?? 2;
  return defineCommand(d.name, d.schema, { entityFields: [...(ECONOMY_ENTITY_FIELDS[d.name] ?? [])], rate: { perSec, burst: Math.max(2, Math.ceil(perSec * 2)) } });
};
export const GAMEPLAY_NET_COMMANDS = [...ECONOMY_COMMANDS, ...CUSTOMIZATION_COMMANDS, ...PVP_COMMANDS, ...CRAFT_QUEUE_COMMANDS, /* appended */ UseCmd, PlaceCmd, EmoteCmd].map((d) => ({ core: d as CommandDef, net: mirror(d) }));
/** Net command for a gameplay core CommandDef (clients: `client.sendCommand(gameplayNet(BuyFromStallCmd), {...})`). */
export function gameplayNet<D extends CommandDef>(d: D): ReturnType<typeof defineCommand<D["schema"]>> {
  const m = GAMEPLAY_NET_COMMANDS.find((x) => x.core === d); if (!m) throw new Error(`not a bridged gameplay command: ${d.name}`);
  return m.net as unknown as ReturnType<typeof defineCommand<D["schema"]>>;
}
/**
 * Dev load-test bots (src/bots.ts) tag their connection with this before ClaimAccount. A multiplayer server drops tagged
 * connections unless started with the dev flag (NET_DEV_BOTS=1 / devBots). Human bots are a singleplayer/offline thing.
 */
export const DevBotHello = defineCommand("demo.devBot", { v: "u8" }, { rate: { perSec: 1, burst: 1 } });
export const DEMO_COMMANDS = [...SESSION_COMMANDS, Ping, ...GAMEPLAY_NET_COMMANDS.map((x) => x.net), DevBotHello] as const;
export const DEMO_EVENTS = [...SESSION_EVENTS, Pong] as const;

/**
 * Wire codes for gameplay command rejections (CommandRejection.reason; the reason string also rides in `detail`).
 * Append-only; 0 = unknown (read `detail`).
 */
export const COMMAND_REJECT_REASONS = [
  "unknown_command", "no_actor", "forbidden", "not_allowed", "rate_limited",
  "not_stall", "stall_closed", "out_of_range", "bad_listing", "listing_disabled", "stale_listing", "price_changed", "sold_out",
  "no_funds", "no_space", "till_full", "till_empty", "bad_qty", "bad_slot", "viewers_full",
  "no_catalog", "no_appearance", "no_target", "not_dead",
  "unknown_recipe", "bad_count", "no_station", "queue_full", "missing_ingredients", "no_job", "not_authority",
] as const;
export type CommandRejectReason = (typeof COMMAND_REJECT_REASONS)[number];
export function rejectReasonCode(reason: string): number { const i = (COMMAND_REJECT_REASONS as readonly string[]).indexOf(reason); return i < 0 ? 0 : i + 1; }
export function rejectReasonName(code: number): CommandRejectReason | undefined { return code > 0 ? COMMAND_REJECT_REASONS[code - 1] : undefined; }
export interface GameplayRejection { command: CommandDef; code: number; reason: string; raw: CommandRejection }
/** Client: gameplay command rejected by the server (core CommandDef, reason code, reason name). Returns unsubscribe. */
export function onGameplayRejected(client: Pick<NetClient, "onCommandRejected">, fn: (r: GameplayRejection) => void): () => void {
  return client.onCommandRejected((raw) => {
    const m = GAMEPLAY_NET_COMMANDS.find((x) => x.net === raw.command); if (!m) return;
    fn({ command: m.core, code: raw.reason, reason: rejectReasonName(raw.reason) ?? raw.detail, raw });
  });
}

/** Screen-aligned iso movement from input bits: W = up-screen, etc. */
export function moveDelta(buttons: number, dt: number): { dx: number; dy: number } {
  const sp = MOVE_SPEED * dt * ((buttons & Act.Sprint) ? SPRINT_MUL : 1);
  let dx = 0, dy = 0;
  if (buttons & Act.MoveUp) { dx -= sp; dy -= sp; }
  if (buttons & Act.MoveDown) { dx += sp; dy += sp; }
  if (buttons & Act.MoveLeft) { dx -= sp; dy += sp; }
  if (buttons & Act.MoveRight) { dx += sp; dy -= sp; }
  if (dx && dy) { const k = Math.SQRT1_2; dx *= k; dy *= k; }
  return { dx, dy };
}

/** Applies one input to a player entity (server authority and client prediction use this same function). */
export function applyMoveInput(world: World, e: Entity, cmd: InputCmd | null, dt = 1 / DEFAULT_TICK_HZ): void {
  const b = cmd?.buttons ?? 0; const t = world.get(e, Transform); if (!t) return;
  const { dx, dy } = moveDelta(b, dt);
  if (dx || dy) world.set(e, Transform, { x: t.x + dx, y: t.y + dy, facing: Math.atan2(dy, dx) });
  if (world.has(e, PlayerIntent)) {
    const moving = dx || dy ? 1 : 0, sprint = moving && (b & Act.Sprint) ? 1 : 0;
    const st = world.store(PlayerIntent); const i = entityIndex(e); const s = st.slot(i);
    if (st.data.moving[s] !== moving || st.data.sprint[s] !== sprint) { st.data.moving[s] = moving; st.data.sprint[s] = sprint; st.markChanged(i); }
  }
}

/**
 * The shared registration module for the demo: every peer (server, browser client, bots) calls this so component
 * order and the schema hash match. Gameplay, then core permissions (PlayerId, Membership, OwnedBy, AccessList +
 * the Permissions resource; the server passes its saved GroupRegistry / ClaimRegistry).
 */
export function installDemoWorld(world: World, role: "server" | "client", opts: { tickHz?: number; social?: { groups: GroupRegistry; claims: ClaimRegistry } } = {}): PermissionsRes {
  installGameplay(world, { role, ...(opts.tickHz !== undefined ? { tickHz: opts.tickHz } : {}) });
  if (!world.isRegistered(Appearance)) world.register(Appearance); // character look (same order on every peer)
  return installPermissions(world, opts.social ?? {});
}
