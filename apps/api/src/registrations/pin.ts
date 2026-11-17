import * as argon2 from "argon2";
import { createHash } from "node:crypto";

// PINs are short, so lockout after repeated failures is the real brute-force defence. These
// parameters (OWASP minimum for argon2id) keep a 300-student CSV import to a few seconds.
const PIN_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const MAX_PIN_FAILURES = 5;

export const hashPin = (pin: string) => argon2.hash(pin, PIN_HASH_OPTIONS);
export const verifyPin = (hash: string, pin: string) => argon2.verify(hash, pin).catch(() => false);

/** Changes whenever the PIN hash changes, so a PIN reset invalidates outstanding student tokens. */
export const credentialVersion = (pinHash: string) =>
  createHash("sha256").update(pinHash).digest("hex").slice(0, 16);
