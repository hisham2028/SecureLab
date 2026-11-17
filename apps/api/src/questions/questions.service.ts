import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { StaffPrincipal } from "../auth/auth.types";
import type { QuestionContent } from "./questions.dto";

const versionWithTests = {
  testCases: { orderBy: { ordinal: "asc" } },
} satisfies Prisma.QuestionVersionInclude;

function versionData(content: QuestionContent, version: number, createdById: string) {
  const { testCases, ...fields } = content;
  return {
    ...fields,
    version,
    createdById,
    testCases: { create: testCases.map((t, i) => ({ ...t, ordinal: i + 1 })) },
  };
}

@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(user: StaffPrincipal, content: QuestionContent, correlationId?: string) {
    const question = await this.prisma.question.create({
      data: {
        institutionId: user.institutionId,
        createdById: user.sub,
        latestVersion: 1,
        versions: { create: versionData(content, 1, user.sub) },
      },
    });
    await this.audit.record({
      institutionId: user.institutionId,
      actorType: "staff",
      actorId: user.sub,
      action: "question.created",
      targetType: "question",
      targetId: question.id,
      metadata: { version: 1 },
      correlationId,
    });
    return this.get(user, question.id);
  }

  async addVersion(
    user: StaffPrincipal,
    questionId: string,
    baseVersion: number,
    content: QuestionContent,
    correlationId?: string,
  ) {
    const next = baseVersion + 1;
    await this.prisma.$transaction(async (tx) => {
      // Compare-and-set on latestVersion so two editors can't both "win".
      const bumped = await tx.question.updateMany({
        where: {
          id: questionId,
          institutionId: user.institutionId,
          latestVersion: baseVersion,
          archived: false,
        },
        data: { latestVersion: next },
      });
      if (bumped.count === 0) {
        const exists = await tx.question.findFirst({
          where: { id: questionId, institutionId: user.institutionId },
        });
        if (!exists) throw new NotFoundException("Question not found.");
        if (exists.archived) throw new ConflictException("This question is archived.");
        throw new ConflictException(
          `Someone saved version ${exists.latestVersion} while you were editing. Reload and reapply your changes.`,
        );
      }
      await tx.questionVersion.create({
        data: { questionId, ...versionData(content, next, user.sub) },
      });
    });
    await this.audit.record({
      institutionId: user.institutionId,
      actorType: "staff",
      actorId: user.sub,
      action: "question.version_created",
      targetType: "question",
      targetId: questionId,
      metadata: { version: next },
      correlationId,
    });
    return this.get(user, questionId);
  }

  async setArchived(
    user: StaffPrincipal,
    questionId: string,
    archived: boolean,
    correlationId?: string,
  ) {
    const res = await this.prisma.question.updateMany({
      where: { id: questionId, institutionId: user.institutionId },
      data: { archived },
    });
    if (res.count === 0) throw new NotFoundException("Question not found.");
    await this.audit.record({
      institutionId: user.institutionId,
      actorType: "staff",
      actorId: user.sub,
      action: archived ? "question.archived" : "question.unarchived",
      targetType: "question",
      targetId: questionId,
      correlationId,
    });
    return this.get(user, questionId);
  }

  async list(
    user: StaffPrincipal,
    filter: { q?: string; tag?: string; topic?: string; includeArchived?: boolean },
  ) {
    const questions = await this.prisma.question.findMany({
      where: {
        institutionId: user.institutionId,
        ...(filter.includeArchived ? {} : { archived: false }),
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    if (questions.length === 0) return [];
    const latest = await this.prisma.questionVersion.findMany({
      where: { OR: questions.map((q) => ({ questionId: q.id, version: q.latestVersion })) },
      select: {
        questionId: true,
        version: true,
        title: true,
        topic: true,
        difficulty: true,
        tags: true,
        allowedLanguages: true,
        _count: { select: { testCases: true } },
      },
    });
    const byId = new Map(latest.map((v) => [v.questionId, v]));
    const needle = filter.q?.toLowerCase();
    return questions
      .map((q) => {
        const v = byId.get(q.id)!;
        return {
          id: q.id,
          archived: q.archived,
          latestVersion: q.latestVersion,
          title: v.title,
          topic: v.topic,
          difficulty: v.difficulty,
          tags: v.tags,
          allowedLanguages: v.allowedLanguages,
          testCaseCount: v._count.testCases,
          updatedAt: q.updatedAt,
        };
      })
      .filter((q) => !needle || q.title.toLowerCase().includes(needle))
      .filter((q) => !filter.tag || q.tags.includes(filter.tag.toLowerCase()))
      .filter((q) => !filter.topic || q.topic.toLowerCase() === filter.topic.toLowerCase());
  }

  /** Staff view of the latest version, including hidden tests. */
  async get(user: StaffPrincipal, questionId: string) {
    const q = await this.prisma.question.findFirst({
      where: { id: questionId, institutionId: user.institutionId },
    });
    if (!q) throw new NotFoundException("Question not found.");
    return this.getVersion(user, questionId, q.latestVersion);
  }

  async getVersion(user: StaffPrincipal, questionId: string, version: number) {
    const v = await this.prisma.questionVersion.findFirst({
      where: { questionId, version, question: { institutionId: user.institutionId } },
      include: {
        ...versionWithTests,
        question: { select: { archived: true, latestVersion: true } },
      },
    });
    if (!v) throw new NotFoundException("Question version not found.");
    const { question, ...rest } = v;
    return { ...rest, archived: question.archived, latestVersion: question.latestVersion };
  }
}
