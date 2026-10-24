/**
 * Browser P2P plumbing (no DOM): room codes, player caps, and the Signaling interface with its PeerJS-cloud
 * implementation. Signaling only brokers the WebRTC handshake; game traffic flows peer-to-peer over two data
 * channels (see @engine/net transport/rtc.ts and ADR-094). Swap PeerJS for e.g. a Cloudflare Worker by
 * implementing `Signaling`.
 */
import { pipeFromDataChannel, type RTCDataChannelLike, type RtcPeerLink } from "@engine/net";

/** Unambiguous alphabet: digits 2-9 + A-Z without I, L, O (no 0/O or 1/I/L confusion). 31 symbols, 31^6 ≈ 887M codes. */
export const ROOM_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 6;
/** Namespaced PeerJS id prefix (shared cloud broker: keep ids from colliding with other apps; bump with the protocol). */
export const ROOM_PEER_PREFIX = "survivaz-v7-";

export function generateRoomCode(random: () => number = Math.random): string {
  let s = ""; for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length];
  return s;
}
/** Normalizes user input (case, spaces, dashes); undefined if it is not a valid code (ambiguous chars like O/0/1/I/L are never issued). */
export function normalizeRoomCode(input: string): string | undefined {
  const s = input.toUpperCase().replace(/[\s-]/g, "");
  if (s.length !== ROOM_CODE_LENGTH) return undefined;
  for (const ch of s) if (!ROOM_ALPHABET.includes(ch)) return undefined;
  return s;
}
export const roomPeerId = (code: string): string => `${ROOM_PEER_PREFIX}${code}`;
/** "ABC234" -> "ABC-234" for display. */
export const formatRoomCode = (code: string): string => `${code.slice(0, 3)}-${code.slice(3)}`;

export const MOBILE_PLAYER_CAP = 6;
export const DEFAULT_DESKTOP_PLAYER_CAP = 12;
export const MAX_DESKTOP_PLAYER_CAP = 32;
export interface DeviceHints { coarsePointer: boolean; uaMobile: boolean | undefined }
export function detectDevice(): DeviceHints {
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const ua = (globalThis as { navigator?: { userAgentData?: { mobile?: boolean } } }).navigator?.userAgentData?.mobile;
  return { coarsePointer: coarse, uaMobile: ua };
}
export const isMobileHost = (d: DeviceHints): boolean => d.uaMobile === true || d.coarsePointer;
/** Player cap including the host. Mobile hosts are fixed at 6; desktop uses the configured cap (clamped 2..32). */
export function hostPlayerCap(d: DeviceHints, desktopCap = DEFAULT_DESKTOP_PLAYER_CAP): { cap: number; mobile: boolean; detail: string } {
  const mobile = isMobileHost(d);
  const cap = mobile ? MOBILE_PLAYER_CAP : Math.max(2, Math.min(MAX_DESKTOP_PLAYER_CAP, Math.floor(desktopCap) || DEFAULT_DESKTOP_PLAYER_CAP));
  return { cap, mobile, detail: `the host's game is full (${cap} players max${mobile ? " on a mobile host" : ""})` };
}

/** ICE config: public STUN by default; add TURN here (or via VITE_ICE_SERVERS JSON / ?ice=) for symmetric NATs. */
export interface IceServer { urls: string | string[]; username?: string; credential?: string }
export const DEFAULT_ICE_SERVERS: IceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, { urls: "stun:stun.cloudflare.com:3478" }];
/** Resolves ICE servers from a JSON string (build env or URL param); falls back to the public STUN defaults. */
export function resolveIceServers(json: string | undefined | null): IceServer[] {
  if (!json) return DEFAULT_ICE_SERVERS;
  try { const v = JSON.parse(json) as unknown; if (Array.isArray(v) && v.every((x) => x && typeof x === "object" && "urls" in x)) return v as IceServer[]; } catch { /* ignore */ }
  return DEFAULT_ICE_SERVERS;
}

/** A hosted room: hands each guest's opened peer link to `onPeer`. */
export interface SignalingRoom { readonly code: string; onPeer(fn: (link: RtcPeerLink) => void): void; onError(fn: (msg: string) => void): void; close(): void }
export interface Signaling {
  /** Registers a room under `code`; rejects with code "taken" if that id is in use. */
  host(code: string): Promise<SignalingRoom>;
  /** Connects to a room; rejects with a user-facing message (e.g. no game with that code). */
  join(code: string): Promise<RtcPeerLink>;
}
export class SignalingError extends Error { constructor(readonly code: "taken" | "not-found" | "network" | "unsupported", msg: string) { super(msg); } }

/** Hosts a room, retrying with a fresh code if one is already taken. */
export async function hostRoom(sig: Signaling, random: () => number = Math.random, tries = 4): Promise<SignalingRoom> {
  for (let i = 0; ; i++) {
    try { return await sig.host(generateRoomCode(random)); }
    catch (e) { if (!(e instanceof SignalingError && e.code === "taken") || i + 1 >= tries) throw e; }
  }
}

/* ---------------- PeerJS cloud implementation ---------------- */
// Snapshot channel: negotiated on both ends of PeerJS's connection (same SCTP association, no renegotiation).
const UNRELIABLE_CHANNEL = { label: "snap", negotiated: true, id: 7, ordered: false, maxRetransmits: 0 } as const;
interface PcLike { createDataChannel(label: string, o: object): RTCDataChannelLike; close(): void }
interface DataConnLike { open: boolean; dataChannel: RTCDataChannelLike; peerConnection: PcLike; on(ev: string, fn: (...a: unknown[]) => void): void; close(): void }
interface PeerLike { on(ev: string, fn: (...a: never[]) => void): void; connect(id: string, o: object): DataConnLike; destroy(): void; disconnected: boolean; reconnect(): void }
type PeerCtor = new (...a: unknown[]) => PeerLike;

function linkFrom(conn: DataConnLike, onClose?: () => void): RtcPeerLink {
  const reliable = pipeFromDataChannel(conn.dataChannel);
  const unreliable = pipeFromDataChannel(conn.peerConnection.createDataChannel(UNRELIABLE_CHANNEL.label, UNRELIABLE_CHANNEL));
  let closed = false;
  return { reliable, unreliable, close: () => { if (closed) return; closed = true; setTimeout(() => { try { conn.close(); } catch { /* */ } onClose?.(); }, 50); } }; // let a final "bye" flush
}

export interface PeerJsOptions { iceServers?: IceServer[]; /** PeerJS server (default: the free PeerJS cloud). */ server?: { host: string; port?: number; path?: string; secure?: boolean; key?: string }; timeoutMs?: number }
export class PeerJsSignaling implements Signaling {
  constructor(private readonly o: PeerJsOptions = {}) {}
  private async peer(id?: string): Promise<PeerLike> {
    if (typeof RTCPeerConnection === "undefined") throw new SignalingError("unsupported", "This browser does not support WebRTC.");
    const { Peer } = await import("peerjs") as unknown as { Peer: PeerCtor };
    const opts = { config: { iceServers: this.o.iceServers ?? DEFAULT_ICE_SERVERS }, ...(this.o.server ?? {}), debug: 1 };
    return id ? new Peer(id, opts) : new Peer(opts);
  }
  private opened(p: PeerLike): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new SignalingError("network", "Signaling server timed out.")), this.o.timeoutMs ?? 15000);
      p.on("open", () => { clearTimeout(t); resolve(); });
      p.on("error", (e: { type?: string; message?: string }) => {
        clearTimeout(t);
        reject(e?.type === "unavailable-id" ? new SignalingError("taken", "room code in use") : new SignalingError("network", `Signaling error: ${e?.type ?? e?.message ?? "unknown"}`));
      });
    });
  }
  async host(code: string): Promise<SignalingRoom> {
    const p = await this.peer(roomPeerId(code));
    try { await this.opened(p); } catch (e) { p.destroy(); throw e; }
    const peerFns: ((l: RtcPeerLink) => void)[] = [], errFns: ((m: string) => void)[] = [];
    p.on("connection", (conn: DataConnLike) => { conn.on("open", () => { const l = linkFrom(conn); for (const f of peerFns) f(l); }); });
    // Lost the broker (not the guests): try to stay discoverable for new joins.
    p.on("disconnected", () => { setTimeout(() => { if (p.disconnected) try { p.reconnect(); } catch { /* */ } }, 1000); });
    p.on("error", (e: { type?: string }) => { for (const f of errFns) f(`signaling: ${e?.type ?? "error"}`); });
    return { code, onPeer: (f) => peerFns.push(f), onError: (f) => errFns.push(f), close: () => setTimeout(() => p.destroy(), 100) };
  }
  async join(code: string): Promise<RtcPeerLink> {
    const p = await this.peer();
    try { await this.opened(p); } catch (e) { p.destroy(); throw e; }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { p.destroy(); reject(new SignalingError("network", "Could not reach the host (timed out). A TURN server may be needed on this network.")); }, this.o.timeoutMs ?? 20000);
      p.on("error", (e: { type?: string }) => { clearTimeout(t); p.destroy(); reject(e?.type === "peer-unavailable" ? new SignalingError("not-found", "No game found with that code.") : new SignalingError("network", `Connection failed: ${e?.type ?? "error"}`)); });
      const conn = p.connect(roomPeerId(code), { reliable: true, serialization: "raw" });
      conn.on("open", () => { clearTimeout(t); resolve(linkFrom(conn, () => p.destroy())); });
    });
  }
}
