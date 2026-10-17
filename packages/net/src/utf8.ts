/** UTF-8 string codec for chat/rejection text. TODO(core batch 7): switch to core's UTF-8 codec once it lands (same wire: varuint byteLength + bytes). */
import type { BitReader, BitWriter } from "./bits.js";
const enc = new TextEncoder(); const dec = new TextDecoder("utf-8", { fatal: false });
export const MAX_UTF8_BYTES = 4096;
export function utf8Bytes(s: string): Uint8Array { return enc.encode(s); }
export function writeUtf8(w: BitWriter, s: string, maxBytes = MAX_UTF8_BYTES): void {
  let b = enc.encode(s); if (b.length > maxBytes) b = b.subarray(0, maxBytes);
  w.writeVarUint(b.length); w.writeBytes(b);
}
export function readUtf8(r: BitReader, maxBytes = MAX_UTF8_BYTES): string {
  const n = r.readVarUint(); if (n > maxBytes) throw new Error("string too long");
  return dec.decode(r.readBytes(n));
}
