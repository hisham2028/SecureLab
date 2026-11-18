import { z } from "zod";

const Reason = z.string().trim().min(3, "Give a reason (at least 3 characters).").max(1000);
const Mark = z
  .number()
  .min(-1000)
  .max(1000)
  .refine((n) => Math.round(n * 100) === Number((n * 100).toFixed(6)), "Use at most two decimals.");

export const AdjustMarkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("OVERRIDE"), mark: Mark, reason: Reason }),
  z.object({
    kind: z.literal("RUBRIC"),
    rubric: z
      .array(z.object({ label: z.string().trim().min(1).max(200), points: Mark }))
      .min(1)
      .max(20),
    reason: Reason,
  }),
]);

export const PublishSchema = z.object({ releaseId: z.string().uuid() });
export const HideSchema = z.object({ reason: Reason });
export { Reason };
