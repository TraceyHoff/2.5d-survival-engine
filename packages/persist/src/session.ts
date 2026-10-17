import { defineCommand, defineNetEvent } from "@engine/net";
import { hexToToken, tokenToHex } from "./types.js";

/**
 * Account/session protocol for persistent players (net commands/events; register them in this order on both peers,
 * after any gameplay commands, via SESSION_COMMANDS / SESSION_EVENTS).
 *
 * Why: NetServer session tokens live in memory, so they do not survive a server restart (Hello with an unknown token
 * is rejected with BadToken). The persistent identity is therefore an ACCOUNT token at the app level:
 *  1. Client connects with no net token (fresh session; the server spawns a fresh player).
 *  2. Client sends `ClaimAccount(token)` with the account token it stored (localStorage / bot memory), if any.
 *  3. Server restores the saved player for that token onto the session's entity (unless that account is already
 *     online), and always answers `AccountAssigned(token, restored)`. A client without a token gets its net session
 *     token as the new account token. The client stores whatever it is assigned.
 * Requested from Netcode: a `resolveToken`/`onResume` hook so a Hello token can resume an account directly.
 */
export const ClaimAccount = defineCommand("session.claim", { t0: "u32", t1: "u32", t2: "u32", t3: "u32" }, { rate: { perSec: 1, burst: 3 } });
/** Display name, up to 32 UTF-8 bytes packed little-endian into 8 u32 (commands carry numbers only). */
export const SetName = defineCommand("session.name", { n0: "u32", n1: "u32", n2: "u32", n3: "u32", n4: "u32", n5: "u32", n6: "u32", n7: "u32" }, { rate: { perSec: 1, burst: 3 } });
export const AccountAssigned = defineNetEvent("session.assigned", { t0: "u32", t1: "u32", t2: "u32", t3: "u32", restored: "u8" });

export const SESSION_COMMANDS = [ClaimAccount, SetName] as const;
export const SESSION_EVENTS = [AccountAssigned] as const;

type TokenWords = { t0: number; t1: number; t2: number; t3: number };
export function tokenToWords(t: Uint8Array | string): TokenWords {
  const b = typeof t === "string" ? hexToToken(t) : t; if (b.length !== 16) throw new Error("token must be 16 bytes");
  const v = new DataView(b.buffer, b.byteOffset, 16);
  return { t0: v.getUint32(0, true), t1: v.getUint32(4, true), t2: v.getUint32(8, true), t3: v.getUint32(12, true) };
}
export function wordsToToken(w: TokenWords): string {
  const b = new Uint8Array(16); const v = new DataView(b.buffer);
  v.setUint32(0, w.t0 >>> 0, true); v.setUint32(4, w.t1 >>> 0, true); v.setUint32(8, w.t2 >>> 0, true); v.setUint32(12, w.t3 >>> 0, true);
  return tokenToHex(b);
}
type NameWords = { n0: number; n1: number; n2: number; n3: number; n4: number; n5: number; n6: number; n7: number };
const NAME_KEYS = ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7"] as const;
export function nameToWords(name: string): NameWords {
  const enc = new TextEncoder().encode(name); const b = new Uint8Array(32);
  // truncate on a UTF-8 boundary
  let n = Math.min(enc.length, 32); while (n > 0 && n < enc.length && (enc[n]! & 0xc0) === 0x80) n--;
  b.set(enc.subarray(0, n)); const v = new DataView(b.buffer);
  const out = {} as NameWords; NAME_KEYS.forEach((k, i) => { out[k] = v.getUint32(i * 4, true); }); return out;
}
export function wordsToName(w: NameWords): string {
  const b = new Uint8Array(32); const v = new DataView(b.buffer); NAME_KEYS.forEach((k, i) => v.setUint32(i * 4, w[k] >>> 0, true));
  let n = b.indexOf(0); if (n < 0) n = 32;
  return new TextDecoder().decode(b.subarray(0, n)).replace(/[\u0000-\u001f]/g, "").trim();
}
