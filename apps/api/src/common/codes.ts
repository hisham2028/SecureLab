import { randomInt } from "node:crypto";

// No 0/O, 1/I/L: codes are read off a projector and typed by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateAccessCode(length = 8): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function generatePin(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
