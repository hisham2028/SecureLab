/**
 * Creates a default institution and the first admin. Idempotent.
 * Usage: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... pnpm --filter @securelab/api db:seed
 * SEED_RESET_PASSWORD=1 also sets the password of an existing admin (SecureLab Lite uses this when
 * setup runs again with new settings) and signs that admin out everywhere.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "./auth/auth.service";

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (12+ characters).");
  }
  const prisma = new PrismaClient();
  try {
    const institution = await prisma.institution.upsert({
      where: { slug: "default" },
      update: {},
      create: { name: "Default Institution", slug: "default" },
    });
    const existing = await prisma.staffUser.findUnique({ where: { email } });
    if (existing && process.env.SEED_RESET_PASSWORD === "1") {
      await prisma.staffUser.update({
        where: { id: existing.id },
        data: {
          passwordHash: await hashPassword(password),
          isActive: true,
          tokenVersion: { increment: 1 },
        },
      });
      console.log(`Admin ${email} already existed; its password was reset.`);
      return;
    }
    if (existing) {
      console.log(`Admin ${email} already exists; leaving it unchanged.`);
      return;
    }
    await prisma.staffUser.create({
      data: {
        email,
        displayName: "Administrator",
        role: "ADMIN",
        institutionId: institution.id,
        passwordHash: await hashPassword(password),
      },
    });
    console.log(`Created admin ${email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
