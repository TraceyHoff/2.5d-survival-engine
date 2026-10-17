/**
 * @engine/net — OWNED BY Netcode team. Stub transport interfaces + message schemas.
 * All messages: u8 type, u16 protocolVersion, then schema-encoded body (see core/serialize).
 */
import type { Schema } from "@engine/core";
export const PROTOCOL_VERSION = 1;
export const enum MsgType { Hello = 1, Welcome = 2, Input = 3, Snapshot = 4, Delta = 5, Ack = 6, Ping = 7, Pong = 8, Disconnect = 9 }
export const MessageSchemas = {
  [MsgType.Hello]: { protocol: "u16", buildHash: "u32" },
  [MsgType.Welcome]: { playerId: "u16", tickHz: "u8", serverTick: "u32", seed: "u32" },
  [MsgType.Input]: { tick: "u32", buttons: "u16", aimX: "f32", aimY: "f32" },
  [MsgType.Ack]: { tick: "u32" },
  [MsgType.Ping]: { t: "f64" },
  [MsgType.Pong]: { t: "f64", serverTick: "u32" },
  [MsgType.Disconnect]: { reason: "u8" },
} as const satisfies Partial<Record<MsgType, Schema>>;
export interface Transport {
  readonly connected: boolean;
  connect(url: string): Promise<void>;
  send(bytes: Uint8Array, reliable?: boolean): void;
  onMessage(fn: (bytes: Uint8Array) => void): void;
  close(): void;
}
export interface ServerTransport {
  listen(port: number): Promise<void>;
  onConnect(fn: (clientId: number) => void): void;
  onMessage(fn: (clientId: number, bytes: Uint8Array) => void): void;
  send(clientId: number, bytes: Uint8Array, reliable?: boolean): void;
  close(): void;
}
/** Client prediction/reconciliation hook points (implemented by Netcode team). */
export interface PredictionController { recordInput(tick: number, input: Uint8Array): void; reconcile(serverTick: number): void }
