/** Client network session: NetClient over WebSocket, account claim/restore, RTT. No DOM (testable headless). */
import { World, type Entity } from "@engine/core";
import { NetClient, NetRejectedError, WebSocketClientTransport, type ClientTransport, type WebSocketCtor } from "@engine/net";
import { AccountAssigned, ClaimAccount, SetName, nameToWords, tokenToWords, wordsToToken } from "@engine/persist";
import { applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS, Ping, Pong } from "@engine/server/protocol";

/** Minimal storage (localStorage in the browser, a Map in tests). */
export interface KeyValue { getItem(k: string): string | null; setItem(k: string, v: string): void }
export type SessionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface SessionOptions {
  storage: KeyValue;
  /** Storage namespace so two tabs/players on one origin keep separate accounts (e.g. ?player=2). */
  slot: string;
  /** Per-tick input for NetClient (e.g. an @engine/input InputFrame mapped to buttons + v2 fields). */
  sampleInput?: () => { buttons: number; aimX: number; aimY: number };
  /** Buttons-only shortcut (tests, bots); used when sampleInput is absent. */
  sampleButtons?: () => number;
  now?: () => number;
  wsCtor?: WebSocketCtor;
}

export class ClientSession {
  status: SessionStatus = "idle";
  detail = "";
  rttMs: number | undefined;
  restored = false;
  world: World | undefined;
  client: NetClient | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  constructor(private readonly o: SessionOptions) {}

  private key(k: string): string { return `engine.${k}.${this.o.slot}`; }
  get account(): string | null { return this.o.storage.getItem(this.key("account")); }
  get savedUrl(): string | null { return this.o.storage.getItem(this.key("server")); }
  get savedName(): string | null { return this.o.storage.getItem(this.key("name")); }

  /** Owned (locally predicted) player entity, if spawned. */
  get player(): Entity | undefined { const w = this.world; if (!w) return undefined; for (const e of w.predicted) return e; return undefined; }

  /** Connects with a fresh World (returned) so a reconnect never stacks net systems on an old world. */
  /** `transport` overrides the WebSocket (e.g. the in-browser local server's loopback; `url` is then a label). */
  async connect(url: string, name: string, transportOverride?: ClientTransport): Promise<World> {
    this.disconnect();
    this.o.storage.setItem(this.key("server"), url); this.o.storage.setItem(this.key("name"), name);
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const transport = transportOverride ?? new WebSocketClientTransport(url, this.o.wsCtor);
    const client = new NetClient({
      world, transport, commands: DEMO_COMMANDS, events: DEMO_EVENTS,
      sampleInput: () => this.o.sampleInput?.() ?? { buttons: this.o.sampleButtons?.() ?? 0, aimX: 0, aimY: 0 },
      applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd),
    });
    this.world = world; this.client = client; this.status = "connecting"; this.detail = url; this.rttMs = undefined; this.restored = false;
    const now = this.o.now ?? (() => performance.now());
    client.onEvent(AccountAssigned, (p) => { this.o.storage.setItem(this.key("account"), wordsToToken(p)); this.restored = p.restored === 1; });
    client.onEvent(Pong, (p) => { this.rttMs = ((Math.round(now()) >>> 0) - p.t) >>> 0; });
    transport.onClose(() => { if (this.client === client) { this.status = "disconnected"; this.detail = "connection closed"; this.stopPing(); } });
    try {
      await client.connect();
    } catch (e) {
      this.status = "error"; this.detail = e instanceof NetRejectedError ? e.message : String(e instanceof Error ? e.message : e);
      throw e;
    }
    this.status = "connected"; this.detail = url;
    const acct = this.account;
    client.sendCommand(ClaimAccount, acct && /^[0-9a-f]{32}$/.test(acct) ? tokenToWords(acct) : { t0: 0, t1: 0, t2: 0, t3: 0 });
    if (name) client.sendCommand(SetName, nameToWords(name));
    this.pingTimer = setInterval(() => { if (client.connected) client.sendCommand(Ping, { t: Math.round(now()) >>> 0 }); }, 1000);
    return world;
  }
  /** Call every frame after stepping the world: delivers events (account, pong). */
  poll(): void { this.client?.pollEvents(Infinity); }
  disconnect(): void {
    this.stopPing();
    const c = this.client; this.client = undefined;
    if (c) { c.close(); this.status = "disconnected"; this.detail = "disconnected"; }
  }
  private stopPing(): void { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = undefined; }
}
