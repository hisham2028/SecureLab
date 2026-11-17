import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { PrismaService } from "../src/prisma/prisma.service";
import { hashPassword } from "../src/auth/auth.service";

export const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

export async function createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret-123";
  process.env.JUDGE0_URL ??= "http://localhost:2358";
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, "");
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/** Creates an isolated institution with one account per role and returns their tokens. */
export async function seedInstitution(app: INestApplication, prisma: PrismaService) {
  const tag = randomUUID().slice(0, 8);
  const inst = await prisma.institution.create({ data: { name: `Test ${tag}`, slug: `t-${tag}` } });
  const password = "correct horse battery staple";
  const passwordHash = await hashPassword(password);
  const tokens: Record<"ADMIN" | "HOST" | "INVIGILATOR", string> = {
    ADMIN: "",
    HOST: "",
    INVIGILATOR: "",
  };
  const ids: Record<string, string> = {};
  for (const role of ["ADMIN", "HOST", "INVIGILATOR"] as const) {
    const email = `${role.toLowerCase()}-${tag}@example.edu`;
    const u = await prisma.staffUser.create({
      data: { email, displayName: role, role, institutionId: inst.id, passwordHash },
    });
    ids[role] = u.id;
    const res = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email, password })
      .expect(200);
    tokens[role] = res.body.accessToken;
  }
  return { institutionId: inst.id, tokens, ids };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
