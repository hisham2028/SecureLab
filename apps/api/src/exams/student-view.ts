import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * The only way question content reaches a student (or a host's "preview as student").
 * Hidden test cases are excluded in the query itself, so they never enter this code path.
 */
export async function studentQuestionView(
  prisma: PrismaService,
  examId: string,
  examQuestionId: string,
) {
  const eq = await prisma.examQuestion.findFirst({
    where: { id: examQuestionId, examId },
    select: {
      id: true,
      ordinal: true,
      points: true,
      questionVersion: {
        select: {
          title: true,
          statement: true,
          inputFormat: true,
          outputFormat: true,
          constraints: true,
          allowedLanguages: true,
          timeLimitMs: true,
          memoryLimitKb: true,
          aiMode: true,
          testCases: {
            where: { isHidden: false },
            orderBy: { ordinal: "asc" },
            select: { ordinal: true, input: true, expectedOutput: true },
          },
        },
      },
    },
  });
  if (!eq) throw new NotFoundException("Question not found.");
  const { testCases, ...content } = eq.questionVersion;
  return { id: eq.id, ordinal: eq.ordinal, points: eq.points, ...content, samples: testCases };
}

export async function studentQuestionList(prisma: PrismaService, examId: string) {
  const rows = await prisma.examQuestion.findMany({
    where: { examId },
    orderBy: { ordinal: "asc" },
    select: { id: true, ordinal: true, points: true, questionVersion: { select: { title: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    ordinal: r.ordinal,
    points: r.points,
    title: r.questionVersion.title,
  }));
}
