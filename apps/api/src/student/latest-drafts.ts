import type { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

// A type, not an interface, so it can go into JSON audit metadata.
export type DraftSubmission = {
  submissionId: string;
  examQuestionId: string;
  language: string;
};

/**
 * Submits each question's most recent server draft when it differs from what was last
 * submitted, so saved work still counts. Used when staff end a student's exam and when a student
 * closes a locked-screen exam. Run inside a transaction.
 *
 * `submittedById` is the staff member doing it, or null when the student's own action caused it.
 * `maxPerQuestion` skips questions whose submission limit is used up (staff override it).
 */
export async function submitLatestDrafts(
  tx: Prisma.TransactionClient,
  registrationId: string,
  opts: { submittedById: string | null; maxPerQuestion?: number },
): Promise<DraftSubmission[]> {
  const drafts = await tx.studentDraft.findMany({
    where: { registrationId },
    orderBy: { savedAt: "desc" },
  });
  const latestPerQuestion = new Map<string, (typeof drafts)[number]>();
  for (const d of drafts)
    if (!latestPerQuestion.has(d.examQuestionId)) latestPerQuestion.set(d.examQuestionId, d);

  const submitted: DraftSubmission[] = [];
  for (const d of latestPerQuestion.values()) {
    if (!d.code.trim()) continue;
    // Same lock as a student's own submission, so the sequence numbers can't race.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${registrationId}:${d.examQuestionId}`}))`;
    const last = await tx.submission.findFirst({
      where: { registrationId, examQuestionId: d.examQuestionId },
      orderBy: { sequence: "desc" },
    });
    const sha = createHash("sha256").update(d.code, "utf8").digest("hex");
    if (last && last.codeSha256 === sha && last.language === d.language) continue;
    if (opts.maxPerQuestion !== undefined && (last?.sequence ?? 0) >= opts.maxPerQuestion) continue;
    const s = await tx.submission.create({
      data: {
        registrationId,
        examQuestionId: d.examQuestionId,
        sequence: (last?.sequence ?? 0) + 1,
        clientSubmissionId: randomUUID(),
        language: d.language,
        code: d.code,
        codeSha256: sha,
        submittedById: opts.submittedById,
        job: { create: {} },
      },
    });
    submitted.push({ submissionId: s.id, examQuestionId: d.examQuestionId, language: d.language });
  }
  return submitted;
}
