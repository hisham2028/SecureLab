/** Staff account management used by the dashboard's Staff page. */
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { randomUUID } from "node:crypto";
import type { PrismaService } from "../src/prisma/prisma.service";
import { bearer, createTestApp, describeDb, seedInstitution } from "./helpers";

describeDb("Staff accounts (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    http = request(app.getHttpServer());
  });
  afterAll(async () => app?.close());

  const login = (email: string, password: string) =>
    http.post("/v1/auth/login").send({ email, password });

  it("lets an admin add staff and give them a new password; old sessions end", async () => {
    const { tokens } = await seedInstitution(app, prisma);
    const admin = bearer(tokens.ADMIN);
    const email = `inv-${randomUUID().slice(0, 8)}@example.edu`;
    const created = (
      await http
        .post("/v1/staff")
        .set(admin)
        .send({
          email,
          displayName: "New Invigilator",
          role: "INVIGILATOR",
          password: "first-password-123",
        })
        .expect(201)
    ).body;
    const list = (await http.get("/v1/staff").set(admin).expect(200)).body;
    expect(list.map((s: { email: string }) => s.email)).toContain(email);
    expect(JSON.stringify(list)).not.toContain("passwordHash");

    const before = (await login(email, "first-password-123").expect(200)).body.accessToken;
    const url = `/v1/staff/${created.id}/password`;
    await http.post(url).set(admin).send({ password: "short", reason: "Forgot it" }).expect(400);
    await http.post(url).set(admin).send({ password: "second-password-123" }).expect(400);
    await http
      .post(url)
      .set(admin)
      .send({ password: "second-password-123", reason: "Forgot it" })
      .expect(204);
    await http.get("/v1/auth/me").set(bearer(before)).expect(401);
    await login(email, "first-password-123").expect(401);
    await login(email, "second-password-123").expect(200);
    expect(
      await prisma.auditLog.count({
        where: { action: "staff.password_set", targetId: created.id },
      }),
    ).toBe(1);

    // Only admins manage staff.
    await http.get("/v1/staff").set(bearer(tokens.HOST)).expect(403);
    await http
      .post(url)
      .set(bearer(tokens.HOST))
      .send({ password: "third-password-123", reason: "x x x" })
      .expect(403);
  });

  it("lets anyone change their own password, ending their other sessions", async () => {
    const { tokens, ids } = await seedInstitution(app, prisma);
    const email = (await prisma.staffUser.findUniqueOrThrow({ where: { id: ids.HOST } })).email;
    const other = (await login(email, "correct horse battery staple").expect(200)).body.accessToken;
    await http
      .post("/v1/auth/password")
      .set(bearer(tokens.HOST))
      .send({ currentPassword: "wrong", newPassword: "a-new-password-123" })
      .expect(401);
    const res = await http
      .post("/v1/auth/password")
      .set(bearer(tokens.HOST))
      .send({ currentPassword: "correct horse battery staple", newPassword: "a-new-password-123" })
      .expect(200);
    await http.get("/v1/auth/me").set(bearer(res.body.accessToken)).expect(200);
    await http.get("/v1/auth/me").set(bearer(other)).expect(401);
    await http.get("/v1/auth/me").set(bearer(tokens.HOST)).expect(401);
    await login(email, "a-new-password-123").expect(200);
  });
});
