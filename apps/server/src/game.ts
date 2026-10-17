/** Authoritative game server: world + gameplay + streaming chunks + persistence + NetServer sessions. */
import { DEFAULT_TICK_HZ, FixedLoop, Membership, PlayerId, Transform, World, type Entity, type PermissionsRes } from "@engine/core";
import { ChunkManager, ProceduralGenerator, chunkKeyOf, type BuildingGrid } from "@engine/world";
import { spawnPlayer, spawnResourceNode, gameplayDefs, setIntent, IntentAction, ResourceNode, PlayerIntent } from "@engine/gameplay";
import { NetServer, TileSync, type ClientSession, type ServerTransport } from "@engine/net";
import { AccountAssigned, ClaimAccount, SetName, WorldPersistence, loadSocial, tokenToHex, tokenToWords, wordsToName, wordsToToken, type WorldStore } from "@engine/persist";
import { Act, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS, Ping, Pong } from "./protocol.js";

/** ProceduralGenerator node kinds -> gameplay resource keys (see DEFAULT_BANDS comments in @engine/world). */
const NODE_RESOURCES: Record<number, string> = { 1: "fallen_branches", 2: "fiber_grass", 3: "berry_bush", 4: "loose_rocks", 5: "tree", 6: "boulder", 7: "iron_vein" };
export const SPAWN = { x: 16, y: 16 };

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
}

interface Player { entity: Entity; account: string; name: string }

export interface GameServer {
  world: World; net: NetServer; chunks: ChunkManager; persist: WorldPersistence | undefined; loop: FixedLoop;
  /** Core permissions resource: GroupRegistry (parties/clans), ClaimRegistry, policy. Saved with the world. */
  permissions: PermissionsRes;
  players: ReadonlyMap<number, Player>;
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
  }) : undefined;
  let localPlayerIds = 1; // no store: ids only need to be unique for this run
  const chunks = new ChunkManager({ provider: persist?.provider ?? generator, loadRadius: o.loadRadius ?? 2, unloadMargin: 1, cacheSize: 64, maxLoadsPerUpdate: 4 });
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
    applyInput: (w, e, cmd, clientId) => {
      applyMoveInput(w, e, cmd, 1 / tickHz);
      if (cmd && (cmd.buttons & Act.Gather) && players.get(clientId)?.entity === e) {
        const target = nearestNode(e); if (target !== undefined) setIntent(w, e, { action: IntentAction.Gather, target });
      }
    },
    onClientJoin: (s, w) => {
      const e = spawnPlayer(w, { x: SPAWN.x + (s.clientId % 7) - 3, y: SPAWN.y + ((s.clientId * 3) % 7) - 3, clientId: s.clientId });
      net.netIds.assign(e);
      const account = tokenToHex(s.token); // provisional account = net session token until the client claims one
      players.set(s.clientId, { entity: e, account, name: "" });
      persist?.trackPlayer(account, e);
      log(`join: client ${s.clientId}`);
    },
    onClientLeave: (s) => leave(s.clientId, "disconnect"),
  });

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
    assignIdentity(p.entity);
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
    for (const [cid, p] of players) { const t = world.get(p.entity, Transform); if (t) chunks.setSource({ id: cid, x: t.x, y: t.y }); }
    chunks.update();
  });
  persist?.attach(chunks);
  chunks.setSource({ id: 0, x: SPAWN.x, y: SPAWN.y, radius: 1 }); // keep spawn warm
  do chunks.update(); while (chunks.pendingLoads > 0); // load the spawn area before the first tick

  const tickTimes: number[] = [];
  const step = (dt: number): void => { const t0 = performance.now(); world.step(dt); tickTimes.push(performance.now() - t0); if (tickTimes.length > 4096) tickTimes.splice(0, 2048); };
  const loop = new FixedLoop({ tickHz, step });
  return {
    world, net, chunks, persist, loop, permissions, players, step, tickTimes,
    async shutdown() {
      if (!persist || closing) return { chunks: 0, players: 0 };
      const r = await persist.saveAll(); closing = true; await persist.store.close(); return r;
    },
  };
}
export type { ClientSession };
