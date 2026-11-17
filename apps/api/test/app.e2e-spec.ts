/**
 * Exercises the real HTTP stack against a real Postgres. Requires DATABASE_URL pointing at a
 * migrated, disposable database (CI provides one). Skipped when DATABASE_URL is not set.
 */
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { PrismaService } from "../src/prisma/prisma.service";
import { hashPassword } from "../src/auth/auth.service";

const run = process.env.DATABASE_URL ? describe : describe.skip;

run("API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `host-${Date.now()}@example.edu`;
  const password = "correct horse battery staple";

  beforeAll(async () => {
    process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret-123";
    process.env.JUDGE0_URL ??= "http://localhost:2358";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, "");
    await app.init();
    prisma = app.get(PrismaService);
    const inst = await prisma.institution.upsert({
      where: { slug: "e2e" },
      update: {},
      create: { name: "E2E", slug: "e2e" },
    });
    await prisma.staffUser.create({
      data: {
        email,
        displayName: "Host",
        role: "HOST",
        institutionId: inst.id,
        passwordHash: await hashPassword(password),
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("reports ready when the database is reachable", async () => {
    await request(app.getHttpServer()).get("/health/ready").expect(200, { status: "ok", db: "ok" });
  });

  it("requires authentication by default", async () => {
    const res = await request(app.getHttpServer()).get("/v1/auth/me").expect(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect(res.headers["x-correlation-id"]).toBeDefined();
  });

  it("rejects a wrong password with a generic message and audits it", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email, password: "nope" })
      .expect(401);
    expect(res.body.error.message).toBe("Email or password is incorrect.");
    const failed = await prisma.auditLog.count({ where: { action: "auth.login_failed" } });
    expect(failed).toBeGreaterThan(0);
  });

  it("validates the login body", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: "x" })
      .expect(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("refuses to modify audit rows at the database level", async () => {
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it("logs in and returns the current user", async () => {
    const login = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email, password })
      .expect(200);
    const me = await request(app.getHttpServer())
      .get("/v1/auth/me")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ email, role: "HOST" });
    expect(me.body.passwordHash).toBeUndefined();
  });
});
