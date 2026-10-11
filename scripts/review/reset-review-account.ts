import {
  assertReviewResetAccount,
  assertReviewResetDatabase,
  assertReviewResetEnrollment,
  ReviewDatabaseProof,
  ReviewResetSafetyError,
  validateReviewResetEnvironment,
} from "./reset-review-safety";

const ONE_DAY_MS = 86_400_000;

function utcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function reviewInstant(date: string, hourUtc: number): Date {
  return new Date(`${date}T${String(hourUtc).padStart(2, "0")}:00:00.000Z`);
}

async function main() {
  // No implicit .env loading. Reject unsafe input before loading any DB module.
  const { databaseUrl, timezone, ...identity } = validateReviewResetEnvironment(
    process.env,
  );
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@prisma/client");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const now = new Date();
    // The guard and existing enrollment both require UTC; calendar shifts and
    // fixture instants therefore share the authoritative account timezone.
    const today = utcDate(now);
    const yesterday = utcDate(new Date(now.getTime() - ONE_DAY_MS));
    const tomorrow = utcDate(new Date(now.getTime() + ONE_DAY_MS));

    await prisma.$transaction(async (tx) => {
      const proof = await tx.$queryRaw<ReviewDatabaseProof[]>`
        SELECT current_database() AS "databaseName",
               inet_server_addr()::text AS "serverAddress",
               shobj_description(d.oid, 'pg_database') AS "marker"
        FROM pg_database d
        WHERE d.datname = current_database()
      `;
      if (proof.length !== 1) {
        throw new ReviewResetSafetyError(
          "Review reset could not verify the disposable database",
        );
      }
      assertReviewResetDatabase(proof[0]);
      const user = await tx.user.findUnique({
        where: { id: identity.userId },
        select: { id: true, email: true, isVerified: true },
      });
      assertReviewResetAccount(user, { databaseUrl, timezone, ...identity });
      const enrollment = await tx.agentEnrollment.findUnique({
        where: { userId: user.id },
        select: { timezone: true },
      });
      assertReviewResetEnrollment(enrollment);

      await tx.todo.deleteMany({ where: { userId: user.id } });
      await tx.project.deleteMany({ where: { userId: user.id } });

      const launch = await tx.project.create({
        data: {
          userId: user.id,
          name: "Review launch",
          description: "Deterministic local synthetic review fixtures.",
          priority: "high",
        },
      });
      const personal = await tx.project.create({
        data: {
          userId: user.id,
          name: "Personal admin",
          description: "Secondary project for tool selection checks.",
          priority: "medium",
        },
      });

      await tx.todo.createMany({
        data: [
          {
            userId: user.id,
            projectId: launch.id,
            title: "Review sample A",
            status: "next",
            priority: "urgent",
            energy: "low",
            estimateMinutes: 15,
            effortScore: 15,
            dueDate: reviewInstant(today, 17),
            tags: ["review-fixture"],
            order: 10,
          },
          {
            userId: user.id,
            projectId: launch.id,
            title: "Review sample B",
            status: "next",
            priority: "high",
            energy: "low",
            estimateMinutes: 15,
            effortScore: 15,
            scheduledDate: reviewInstant(today, 14),
            dueDate: reviewInstant(tomorrow, 17),
            tags: ["review-fixture"],
            order: 20,
          },
          {
            userId: user.id,
            projectId: launch.id,
            title: "Review sample C",
            status: "next",
            priority: "high",
            energy: "low",
            estimateMinutes: 10,
            effortScore: 10,
            dueDate: reviewInstant(yesterday, 17),
            tags: ["review-fixture"],
            order: 30,
          },
          {
            userId: user.id,
            projectId: personal.id,
            title: "Schedule a follow-up for tomorrow",
            status: "next",
            priority: "medium",
            energy: "medium",
            estimateMinutes: 20,
            effortScore: 20,
            dueDate: reviewInstant(tomorrow, 17),
            tags: ["review-fixture"],
            order: 40,
          },
          {
            userId: user.id,
            title: "Capture an unfiled idea",
            status: "inbox",
            priority: "low",
            energy: "low",
            estimateMinutes: 10,
            effortScore: 10,
            tags: ["review-fixture"],
            order: 50,
          },
          {
            userId: user.id,
            projectId: launch.id,
            title: "Review completed sample",
            status: "done",
            completed: true,
            completedAt: now,
            priority: "low",
            energy: "low",
            estimateMinutes: 5,
            effortScore: 5,
            dueDate: reviewInstant(today, 17),
            tags: ["review-fixture"],
            order: 60,
          },
        ],
      });

      await tx.userPlanningPreferences.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          maxDailyTasks: 5,
          preferredChunkMinutes: 30,
          weekendsActive: true,
        },
        update: {
          maxDailyTasks: 5,
          preferredChunkMinutes: 30,
          weekendsActive: true,
        },
      });
    });

    console.log(
      `Reset local disposable fixture account: 2 projects, 6 tasks (5 open, 1 completed), effective date ${today}, timezone ${timezone}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // Database/client failures may include credentials or account details.
  console.error(
    error instanceof ReviewResetSafetyError
      ? error.message
      : "Local review fixture reset failed; inspect the disposable database privately before retrying.",
  );
  process.exit(1);
});
