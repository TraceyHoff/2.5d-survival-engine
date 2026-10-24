/**
 * Browser P2P host (no DOM): runs the authoritative server in THIS tab (createLocalServer, mode "multiplayer":
 * human bots off, animals + zombies on) and serves WebRTC guests through the same NetServer as the host's own
 * loopback client, so guests get the Node server's validation, rate limits, entityRefs "aoi" scoping and dev-bot
 * rejection. Persistence: the existing browser WorldStore (IndexedDB); saved on leave() and on page unload.
 */
import { RtcClientTransport, RtcServerTransport, type ClientTransport } from "@engine/net";
import type { CosmeticCatalogLike } from "@engine/core";
import type { WorldStore } from "@engine/persist";
import { createLocalServer, type LocalServer } from "./local.js";
import { hostRoom, type Signaling, type SignalingRoom } from "./p2p.js";

export interface P2PHostOptions {
  signaling: Signaling; store?: WorldStore; seed?: number;
  /** Player cap including the host (see p2p.hostPlayerCap). */
  cap: number; capDetail?: string;
  population?: boolean; catalog?: CosmeticCatalogLike; log?: (s: string) => void; random?: () => number;
}
export interface P2PPlayer { clientId: number; name: string; host: boolean }
export interface P2PHost {
  local: LocalServer; room: SignalingRoom; rtc: RtcServerTransport; code: string; cap: number;
  /** The host's own client transport (pass to ClientSession.connect). */
  hostTransport: ClientTransport;
  /** Set once the host's own client is connected (marks it in players()). */
  hostClientId: number | undefined;
  /** Connected players (host first). */
  players(): P2PPlayer[];
  /** Ends the session: guests get "Host ended the session", the world is saved, signaling closes. Idempotent. */
  leave(): Promise<void>;
  /** Best-effort synchronous-start save for beforeunload/pagehide (also tells guests the host left). */
  unload(): void;
}

export async function startP2PHost(o: P2PHostOptions): Promise<P2PHost> {
  const rtc = new RtcServerTransport();
  const local = await createLocalServer({
    mode: "multiplayer", extraTransports: [rtc], maxClients: o.cap, serverFullDetail: o.capDetail ?? `the host's game is full (${o.cap} players max)`,
    ...(o.store ? { store: o.store } : {}), ...(o.seed !== undefined ? { seed: o.seed } : {}), ...(o.population === false ? { population: false } : {}),
    ...(o.catalog ? { catalog: o.catalog } : {}), ...(o.log ? { log: o.log } : {}),
  });
  let room: SignalingRoom;
  try { room = await hostRoom(o.signaling, o.random); } catch (e) { await local.stop(); throw e; }
  room.onPeer((link) => { rtc.accept(link); });
  const hostTransport = local.createTransport();
  let ended: Promise<void> | undefined;
  const host: P2PHost = {
    local, room, rtc, code: room.code, cap: o.cap, hostTransport, hostClientId: undefined,
    players: () => {
      const out: P2PPlayer[] = [];
      for (const [cid, p] of local.game.players) out.push({ clientId: cid, name: p.name || `Player ${cid}`, host: cid === host.hostClientId });
      return out.sort((a, b) => Number(b.host) - Number(a.host) || a.clientId - b.clientId);
    },
    leave: () => (ended ??= (async () => { rtc.close(); room.close(); await local.stop(); })()),
    unload: () => { if (ended) return; rtc.close(); room.close(); void local.game.persist?.saveAll(); },
  };
  return host;
}

/** Guest transport for a room code (signaling + both data channels). */
export function guestTransport(signaling: Signaling, code: string): RtcClientTransport { return new RtcClientTransport(() => signaling.join(code)); }
