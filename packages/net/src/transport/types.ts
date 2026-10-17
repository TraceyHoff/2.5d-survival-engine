/** "reliable" = ordered + guaranteed; "unreliable" = may drop/reorder (WebSocket delivers it reliably anyway). */
export type Channel = "reliable" | "unreliable";
export type ConnId = number;

export interface ClientTransport {
  readonly connected: boolean;
  connect(): Promise<void>;
  send(bytes: Uint8Array, channel: Channel): void;
  onMessage(fn: (bytes: Uint8Array, channel: Channel) => void): void;
  onClose(fn: () => void): void;
  close(): void;
}

export interface ServerTransport {
  /** Optional clock in ms for RTT (simulated transports); default performance.now(). */
  now?(): number;
  onConnect(fn: (conn: ConnId) => void): void;
  onDisconnect(fn: (conn: ConnId) => void): void;
  onMessage(fn: (conn: ConnId, bytes: Uint8Array, channel: Channel) => void): void;
  send(conn: ConnId, bytes: Uint8Array, channel: Channel): void;
  disconnect(conn: ConnId): void;
  close(): void;
}
