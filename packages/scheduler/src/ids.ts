import { createHash } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(timestampMs: number): string {
  let value = BigInt(Math.max(0, Math.trunc(timestampMs)));
  let output = "";
  for (let index = 0; index < 10; index += 1) {
    output = CROCKFORD[Number(value & 31n)] + output;
    value >>= 5n;
  }
  return output;
}

function encodeHash(seed: string): string {
  const digest = createHash("sha256").update(seed).digest();
  let buffer = 0;
  let bits = 0;
  let output = "";
  for (const byte of digest) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && output.length < 16) {
      bits -= 5;
      output += CROCKFORD[(buffer >> bits) & 31];
    }
    if (output.length === 16) break;
    buffer &= (1 << bits) - 1;
  }
  return output.padEnd(16, "0");
}

export function deterministicPrefixedUlid(prefix: string, timestamp: string, seed: string): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) throw new TypeError("timestamp must be a valid ISO date-time");
  return `${prefix}_${encodeTime(parsed)}${encodeHash(seed)}`;
}
