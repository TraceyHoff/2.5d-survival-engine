/** Authoritative game server: world + gameplay + streaming chunks + persistence + NetServer sessions. */
import { CommandRejected, DEFAULT_TICK_HZ, FixedLoop, installCommandHandlers, type CosmeticCatalogLike, Membership, PlayerId, Transform, World, type Entity, type PermissionsRes } from "@engine/core";
import { ChunkManager, ProceduralGenerator, chunkKeyOf, type BuildingGrid } from "@engine/world";
import { spawnPlayer, spawnResourceNode, gameplayDefs, setIntent, IntentAction, ResourceNode, PlayerIntent, registerGameplayCommands, installEconomy, installCustomization,
  appearanceServerHooks, applyReplication, installStallBuyHook, installViewBonus, setHitValidator, installPvp, playerNames, stallListing, listingRevision, stallOf, tillOf, StallHeader, StallOwnerKind } from "@engine/gameplay";
import { AppearanceServer, NameSync, NetServer, StallResult, StallServer, TileSync, validateHit, type ClientSession, type ServerTransport, type StallHooks } from "@engine/net";
import { AccountAssigned, ClaimAccount, SetName, WorldPersistence, loadSocial, tokenToHex, tokenToWords, wordsToName, wordsToToken, type WorldStore } from "@engine/persist";
import { seedStarterCamp, giveRandomAppearance } from "./camp.js";
import { Act, applyMoveInput, installDemoWorld, rejectReasonCode, DEMO_COMMANDS, DEMO_EVENTS, GAMEPLAY_NET_COMMANDS, Ping, Pong } from "./protocol.js";

/** ProceduralGenerator node kinds -> gameplay resource keys (see DEFAULT_BANDS comments in @engine/world). */
const NODE_RESOURCES: Record<number, string> = { 1: "fallen_branches", 2: "fiber_grass", 3: "berry_bush", 4: "loose_rocks", 5: "tree", 6: "boulder", 7: "iron_vein" };
export const SPAWN = { x: 16, y: 16 };
/** Starter camp hut origin (NE of spawn; yard reaches back toward spawn). */
export const CAMP = { x: 19, y: 8 };

export interface GameServerOptions {
  transport: ServerTransport;
  /** Persistent store; omit for an in-memory, non-persistent world. */
  store?: WorldStore;
  /** Used only for a new world; a save keeps its own seed. */
  seed?: number;
  tickHz?: number;
  autosaveSeconds?: number;
  playerSaveSeconds?: number;
  loadRadius?: number;
  buildings?: BuildingGrid;
  log?: (msg: string) => void;
  /** Cosmetics catalog (@engine/assets CosmeticCatalog). Enables customization: Appearance net messages + gameplay commands. */
  catalog?: CosmeticCatalogLike;
  /** Seed the starter camp near spawn (default true; skipped if pieces already stand there). */
  starterCamp?: boolean;
  /** Give each joining client (players and bots) a random valid Appearance as a placeholder until they set their own look. */
  randomAppearance?: boolean;
  /** Server mode (default "multiplayer"). "singleplayer" = in-browser local server with local human bots. */
  mode?: ServerMode;
}

/** claimed: ClaimAccount processed (saved record restored), so a held join-time look can no longer be overwritten by the restore. */
interface Player { entity: Entity; account: string; name: string; claimed: boolean }

export type ServerMode = "singleplayer" | "multiplayer";
export interface GameServer {
  readonly mode: ServerMode;
  world: World; net: NetServer; chunks: ChunkManager; persist: WorldPersistence | undefined; loop: FixedLoop;
  /** Core permissions resource: GroupRegistry (parties/clans), ClaimRegistry, policy. Saved with the world. */
  permissions: PermissionsRes;
  players: ReadonlyMap<number, Player>;
  stalls: StallServer; appearance: AppearanceServer | undefined;
  /** Wall-clock ms of recent world.step calls (filled by the host loop via step()). */
  step(dt: number): void;
  tickTimes: number[];
  /** Graceful shutdown: full save, close the store. Does not close the transport. */
  shutdown(): Promise<{ chunks: number; players: number }>;
}

export function createGameServer(o: GameServerOptions): GameServer {
  const log = o.log ?? (() => {});
  const tickHz = o.tickHz ?? DEFAULT_TICK_HZ;
  const meta = o.store?.readMeta();
  const seed = meta?.seed ?? o.seed ?? 1234;
  const world = new World({ seed, maxEntities: 1 << 18 });
  // Saved parties/clans/claims (throws on a corrupt record rather than starting empty and overwriting it).
  const permissions = installDemoWorld(world, "server", { tickHz, ...(o.store ? { social: loadSocial(o.store) } : {}) });
  if (meta) { world.tick = meta.tick; if (meta.schemaHash !== world.getSchemaHash()) log(`persist: save schema ${meta.schemaHash.toString(16)} != build ${world.getSchemaHash().toString(16)}; chunks with changed persistent components load read-only`); }
  const generator = new ProceduralGenerator({ seed });
  const persist = o.store ? new WorldPersistence({
    world, store: o.store, generator, tickHz, log,
    ...(o.buildings ? { buildings: o.buildings } : {}),
    autosaveSeconds: o.autosaveSeconds ?? 30, playerSaveSeconds: o.playerSaveSeconds ?? 60,
    player: { exclude: [PlayerIntent] },
    social: permissions,
    ...(o.catalog ? { appearance: { catalog: o.catalog } } : {}),
  }) : undefined;
  let localPlayerIds = 1; // no store: ids only need to be unique for this run
  const loadRadius = o.loadRadius ?? 2;
  const chunks = new ChunkManager({ provider: persist?.provider ?? generator, loadRadius, unloadMargin: 1, cacheSize: 64, maxLoadsPerUpdate: 4 });
  const defs = gameplayDefs(world);
  const resIds = new Map<number, number>();
  for (const [kind, key] of Object.entries(NODE_RESOURCES)) { try { resIds.set(Number(kind), defs.resourceId(key)); } catch { /* resource renamed: skip */ } }
  chunks.onLoad((_c, nodes) => { for (const n of nodes) { const id = resIds.get(n.kind); if (id !== undefined) spawnResourceNode(world, id, n.tx + 0.5, n.ty + 0.5); } });

  const players = new Map<number, Player>();
  let closing = false; // after shutdown() the save is final: disconnects no longer write
  const removeEntity = (e: Entity): void => { if (world.isAlive(e)) world.destroy(e); };

  const net: NetServer = new NetServer({
    world, tickHz, transport: o.transport,
    commands: DEMO_COMMANDS, events: DEMO_EVENTS,
    forwardCoreRejections: false, // forwarded below with the net command def + a reason code (protocol.ts)
    applyInput: (w, e, cmd, clientId) => {
      applyMoveInput(w, e, cmd, 1 / tickHz);
      if (cmd && (cmd.buttons & Act.Gather) && players.get(clientId)?.entity === e) {
        const target = nearestNode(e); if (target !== undefined) setIntent(w, e, { action: IntentAction.Gather, target });
      }
    },
    onClientJoin: (s, w) => {
      const e = spawnPlayer(w, { x: SPAWN.x + (s.clientId % 7) - 3, y: SPAWN.y + ((s.clientId * 3) % 7) - 3, clientId: s.clientId });
      net.netIds.assign(e);
      // random valid look (replicates; a restored player record or the client's own setAppearance replaces it)
      if (o.catalog && o.randomAppearance) giveRandomAppearance(w, e, o.catalog, Math.random);
      const account = tokenToHex(s.token); // provisional account = net session token until the client claims one
      players.set(s.clientId, { entity: e, account, name: "", claimed: false });
      persist?.trackPlayer(account, e);
      log(`join: client ${s.clientId}`);
    },
    onClientLeave: (s) => leave(s.clientId, "disconnect"),
  });

  applyReplication(net);
  // Gameplay commands: core handlers (economy + customization) fed by the net mirrors from protocol.ts.
  const handlers = installCommandHandlers(world, registerGameplayCommands());
  installEconomy(world, handlers);
  installPvp(world, handlers); // gameplay.respawnPlayer
  // Melee hits from players are re-checked with lag compensation (target rewound to what the attacker saw).
  setHitValidator(world, (attacker, target, check) => {
    let s: ClientSession | undefined; for (const [cid, p] of players) if (p.entity === attacker) { s = net.sessions.get(cid); break; }
    if (!s) return undefined; // not a connected player: nothing to rewind against
    const r = validateHit(net, s, attacker, target, { reach: check.reach, coneDeg: check.coneDeg });
    return r.ok ? undefined : r.reason;
  });
  // Watchtower sight: gameplay computes per-client chunk bonus; net caps it and applies hysteresis.
  installViewBonus(world, (c, n) => net.setViewRadiusBonus(c, n));
  if (o.catalog) installCustomization(world, { catalog: o.catalog, handlers });
  let cmdSeq = 0;
  const netDefOf = new Map<number, (typeof GAMEPLAY_NET_COMMANDS)[number]["net"]>(); // core command type -> net mirror
  for (const { core, net: def } of GAMEPLAY_NET_COMMANDS) {
    if (!o.catalog && (core.name === "gameplay.setAppearance" || core.name === "gameplay.equipCosmetic")) continue; // no catalog: unhandled
    const type = handlers.registry.register(core); netDefOf.set(type, def);
    net.onCommand(def, (s, payload) => {
      const p = players.get(s.clientId); if (!p || !world.isAlive(p.entity)) return;
      handlers.enqueue(p.entity, s.clientId, cmdSeq++, { type, values: payload as never });
    });
  }
  // Gameplay rejections -> the issuing client (client.onCommandRejected / onGameplayRejected): net command + reason code + text.
  world.events.on(CommandRejected, (r) => {
    if (!net.sessions.get(r.clientId)?.conn) return;
    const def = netDefOf.get(r.type); net.rejectCommand(r.clientId, def ?? r.type, rejectReasonCode(r.reason), r.reason);
  });
  // Stall raw protocol (client.stalls): gameplay owns the purchase via the buy hook; owner ops go through the commands above.
  const stallHooks: StallHooks = {
    view: (w, target) => {
      const st = stallOf(w, target); const h = st !== undefined ? w.get(st, StallHeader) : undefined; if (st === undefined || !h) return undefined;
      return {
        open: h.open === 1, ownerKind: h.ownerKind, ownerId: h.ownerId, revision: listingRevision(w, st), stock: st, till: tillOf(w, st) ?? st,
        listing: (id) => { const l = stallListing(w, st, id); return l && l.enabled ? { listingId: id, slot: id, item: l.stockItem, count: l.stock, durability: 0, crafterId: 0, price: { itemId: l.priceItem, count: l.priceCount } } : undefined; },
      };
    },
    canManage: () => false, owner: () => StallResult.Denied, sold: () => {},
    saleRecipients: (_w, _st, v) => (v.ownerKind === StallOwnerKind.Player ? [v.ownerId] : []),
  };
  const names = playerNames(world);
  const nameSync = new NameSync(net, { names }); // crafter/buyer names for sale notifications + client.names
  const stalls = new StallServer(net, { hooks: stallHooks, names: nameSync, playerIdOf: (s) => { const e = players.get(s.clientId)?.entity; return (e !== undefined && world.getField(e, PlayerId, "id")) || 0; } });
  installStallBuyHook(stalls);
  // The buyer gets the sale record too (crafter provenance + names), unless they are also the recipient owner.
  stalls.saleLog.push((sale, st) => { const v = stallHooks.view(world, st); if (sale.buyerId && !(v && stallHooks.saleRecipients(world, st, v).includes(sale.buyerId))) stalls.notify(sale, [sale.buyerId]); });
  const appearance = o.catalog ? new AppearanceServer(net, {
    catalog: o.catalog,
    // The join-time look is held (AppearanceServer pending) until the account is claimed, then applied with initial=true:
    // a new player has no created look, so gameplay's first-join rule passes; a returning player's restored look wins.
    entityOf: (s) => { const p = players.get(s.clientId); return p?.claimed ? p.entity : undefined; },
    ...appearanceServerHooks(world, (e) => {
      for (const p of players.values()) if (p.entity === e && persist && !closing) { void persist.savePlayer(p.account, e, p.name).catch((x) => log(`persist: save failed ${String(x)}`)); break; }
    }),
  }) : undefined;

  new TileSync(net, { tiles: chunks }); // tile replication: full chunks on AOI entry + per-tick deltas (sole tileChanges() drainer)

  function leave(clientId: number, why: string): void {
    const p = players.get(clientId); if (!p) return;
    players.delete(clientId); chunks.removeSource(clientId);
    if (persist && !closing) { void persist.savePlayer(p.account, p.entity, p.name).catch((e) => log(`persist: save failed ${String(e)}`)); persist.untrackPlayer(p.account); }
    removeEntity(p.entity);
    // Forget the net session: identity across reconnects/restarts is the persistent account (ClaimAccount).
    net.removeSession(clientId);
    log(`leave: client ${clientId} (${why})${p.name ? ` "${p.name}"` : ""}`);
  }

  net.onCommand(ClaimAccount, (s, payload) => {
    const p = players.get(s.clientId); if (!p) return;
    const zero = !payload.t0 && !payload.t1 && !payload.t2 && !payload.t3;
    let restored = 0;
    if (!zero) {
      const token = wordsToToken(payload);
      if (token !== p.account) {
        for (const [cid, other] of players) if (cid !== s.clientId && other.account === token) leave(cid, "account taken over by a new connection");
        persist?.untrackPlayer(p.account); p.account = token;
        const r = persist?.restorePlayer(token, p.entity);
        if (r) { restored = 1; if (r.name && !p.name) p.name = r.name; log(`restore: client ${s.clientId} account ${token.slice(0, 8)}… (${r.restored.length} components${r.skipped.length ? `, skipped ${r.skipped.join(",")}` : ""})`); }
        persist?.trackPlayer(token, p.entity, p.name);
      }
    }
    assignIdentity(p.entity); p.claimed = true;
    if (p.name) names.set(world.getField(p.entity, PlayerId, "id")!, p.name);
    net.emitEvent(AccountAssigned, { ...tokenToWords(p.account), restored }, { scope: { owner: s.clientId } });
  });
  /** Account PlayerId (restored from the player record, else newly allocated) + Membership mirrored from the registry. */
  function assignIdentity(e: Entity): void {
    let id = world.getField(e, PlayerId, "id") ?? 0;
    if (!id) { id = persist ? persist.allocatePlayerId() : localPlayerIds++; if (world.has(e, PlayerId)) world.setField(e, PlayerId, "id", id); else world.add(e, PlayerId, { id }); }
    const gs = permissions.groups.groupsOf(id);
    const m = { partyId: gs.find((g) => g.kind === 1)?.id ?? 0, clanId: gs.find((g) => g.kind === 2)?.id ?? 0 };
    if (world.has(e, Membership)) { world.setField(e, Membership, "partyId", m.partyId); world.setField(e, Membership, "clanId", m.clanId); } else world.add(e, Membership, m);
  }
  net.onCommand(SetName, (s, payload) => {
    const p = players.get(s.clientId); if (!p) return;
    p.name = wordsToName(payload); persist?.trackPlayer(p.account, p.entity, p.name);
    const id = world.getField(p.entity, PlayerId, "id"); if (id) names.set(id, p.name);
  });
  net.onCommand(Ping, (s, payload) => net.emitEvent(Pong, { t: payload.t }, { scope: { owner: s.clientId } }));

  /** Nearest resource node within reach, from chunk membership (O(entities in 3x3 chunks)). */
  function nearestNode(e: Entity): Entity | undefined {
    const t = world.get(e, Transform); if (!t) return undefined;
    let best: Entity | undefined, bd = 2.25 * 2.25;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const set = persist ? persist.membership.entitiesIn(chunkKeyOf(t.x + dx * 32, t.y + dy * 32)) : undefined;
      for (const n of set ?? world.query([ResourceNode, Transform])) {
        if (!world.has(n, ResourceNode)) continue; const nt = world.get(n, Transform)!;
        const d = (nt.x - t.x) ** 2 + (nt.y - t.y) ** 2; if (d < bd) { bd = d; best = n; }
      }
      if (!persist) return best; // full scan done once
    }
    return best;
  }

  // Streaming: players are the interest sources. Runs before persist.track (registered by attach below).
  world.addSystem("postSim", "server.chunks", () => {
    // A watchtower's AOI bonus widens streaming too, so the extra chunks exist to be sent.
    for (const [cid, p] of players) { const t = world.get(p.entity, Transform); if (t) chunks.setSource({ id: cid, x: t.x, y: t.y, radius: loadRadius + net.viewRadiusBonus(cid) }); }
    chunks.update();
  });
  persist?.attach(chunks);
  chunks.setSource({ id: 0, x: SPAWN.x, y: SPAWN.y, radius: 1 }); // keep spawn warm
  do chunks.update(); while (chunks.pendingLoads > 0); // load the spawn area before the first tick
  if (o.starterCamp !== false) { const n = seedStarterCamp(world, CAMP).length; if (n) log(`camp: seeded ${n} pieces at ${CAMP.x},${CAMP.y}`); }

  const tickTimes: number[] = [];
  const step = (dt: number): void => { const t0 = performance.now(); world.step(dt); tickTimes.push(performance.now() - t0); if (tickTimes.length > 4096) tickTimes.splice(0, 2048); };
  const loop = new FixedLoop({ tickHz, step });
  return {
    mode: o.mode ?? "multiplayer", world, net, chunks, persist, loop, permissions, players, stalls, appearance, step, tickTimes,
    async shutdown() {
      if (!persist || closing) return { chunks: 0, players: 0 };
      const r = await persist.saveAll(); closing = true; await persist.store.close(); return r;
    },
  };
}
export type { ClientSession };
