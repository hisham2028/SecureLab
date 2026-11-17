import { z } from "zod";

/**
 * Host-defined custom student ID rule. IDs are always handled as strings so
 * leading zeros are preserved.
 */
export const StudentIdRuleSchema = z
  .object({
    minLength: z.number().int().min(1).max(64),
    maxLength: z.number().int().min(1).max(64),
    /** Character classes allowed in the body of the ID. */
    allowDigits: z.boolean().default(true),
    allowLetters: z.boolean().default(false),
    /** Separators allowed anywhere except the first/last character, e.g. "-" or "/". */
    separators: z.string().max(4).default(""),
    /** Required literal prefix, e.g. "CSE". Counted towards length. */
    prefix: z.string().max(16).default(""),
    caseSensitive: z.boolean().default(false),
  })
  .refine((r) => r.minLength <= r.maxLength, { message: "minLength must be <= maxLength" })
  .refine((r) => r.allowDigits || r.allowLetters, {
    message: "At least one of digits or letters must be allowed",
  });
export type StudentIdRule = z.infer<typeof StudentIdRuleSchema>;

export type StudentIdCheck = { ok: true; normalized: string } | { ok: false; reason: string };

export function normalizeStudentId(raw: string, rule: StudentIdRule): string {
  const trimmed = raw.trim();
  return rule.caseSensitive ? trimmed : trimmed.toUpperCase();
}

export function validateStudentId(raw: string, rule: StudentIdRule): StudentIdCheck {
  const id = normalizeStudentId(raw, rule);
  if (id.length < rule.minLength || id.length > rule.maxLength) {
    return { ok: false, reason: `Must be ${rule.minLength}-${rule.maxLength} characters long` };
  }
  const prefix = rule.caseSensitive ? rule.prefix : rule.prefix.toUpperCase();
  if (prefix && !id.startsWith(prefix)) {
    return { ok: false, reason: `Must start with "${rule.prefix}"` };
  }
  const body = id.slice(prefix.length);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const isDigit = ch >= "0" && ch <= "9";
    const isLetter = /[A-Za-z]/.test(ch);
    const isSep = rule.separators.includes(ch);
    if (isDigit && rule.allowDigits) continue;
    if (isLetter && rule.allowLetters) continue;
    if (isSep) {
      const pos = prefix.length + i;
      if (pos === 0 || pos === id.length - 1) {
        return { ok: false, reason: "Cannot start or end with a separator" };
      }
      continue;
    }
    return { ok: false, reason: `Character "${ch}" is not allowed` };
  }
  return { ok: true, normalized: id };
}

/** Returns normalized IDs that appear more than once (duplicate rejection within an exam). */
export function findDuplicateIds(rawIds: readonly string[], rule: StudentIdRule): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const raw of rawIds) {
    const id = normalizeStudentId(raw, rule);
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}
