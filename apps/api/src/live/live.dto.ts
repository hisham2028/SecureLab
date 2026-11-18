import { z } from "zod";
import { Reason } from "../results/results.dto";

export const MonitorQuerySchema = z.object({
  status: z
    .enum(["ALL", "NOT_STARTED", "ACTIVE", "DISCONNECTED", "FINISHED", "BLOCKED"])
    .default("ALL"),
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const AnnouncementSchema = z.object({
  message: z.string().trim().min(1, "Write a message.").max(1000),
});
export const NoteSchema = z.object({
  note: z.string().trim().min(1, "Write a note.").max(4000),
  registrationId: z.string().uuid().nullable().optional(),
});
export const ReasonSchema = z.object({ reason: Reason });
export const ReentrySchema = z.object({
  reason: Reason,
  minutes: z.number().int().min(1).max(60).default(10),
});
export const ForceFinishSchema = z.object({
  reason: Reason,
  /** Also submit each question's latest server draft that differs from the last submission. */
  submitDrafts: z.boolean().default(true),
});
