import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const CONFIRMATION = "RESET_DEDICATED_REVIEW_ACCOUNT";
const ONE_DAY_MS = 86_400_000;

function required(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function dateInTimezone(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function reviewInstant(date: string, hourUtc: number): Date {
  return new Date(`${date}T${String(hourUtc).padStart(2, "0")}:00:00.000Z`);
}

async function main() {
  const databaseUrl = required("DATABASE_URL");
  const reviewUserId = required("REVIEW_ACCOUNT_USER_ID");
  const reviewEmail = required("REVIEW_ACCOUNT_EMAIL").toLowerCase();
  const confirmation = required("REVIEW_RESET_CONFIRM");
  const timezone = (process.env.REVIEW_TIMEZONE || "America/New_York").trim();

  if (confirmation !== CONFIRMATION) {
    throw new Error(`REVIEW_RESET_CONFIRM must equal ${CONFIRMATION}`);
  }
  new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const user = await prisma.user.findUnique({ where: { id: reviewUserId } });
    if (!user || user.email?.toLowerCase() !== reviewEmail) {
      throw new Error(
        "REVIEW_ACCOUNT_USER_ID and REVIEW_ACCOUNT_EMAIL do not identify the same existing account",
      );
    }
    if (!user.isVerified) {
      throw new Error("The dedicated review account must already be verified");
    }

    const now = new Date();
    const today = dateInTimezone(now, timezone);
    const yesterday = dateInTimezone(
      new Date(now.getTime() - ONE_DAY_MS),
      timezone,
    );
    const tomorrow = dateInTimezone(
      new Date(now.getTime() + ONE_DAY_MS),
      timezone,
    );

    await prisma.$transaction(async (tx) => {
      await tx.todo.deleteMany({ where: { userId: user.id } });
      await tx.project.deleteMany({ where: { userId: user.id } });

      const launch = await tx.project.create({
        data: {
          userId: user.id,
          name: "Review launch",
          description: "Deterministic fixtures for hosted app review.",
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
            title: "Review production launch checklist",
            status: "next",
            priority: "urgent",
            energy: "high",
            estimateMinutes: 45,
            dueDate: reviewInstant(today, 17),
            tags: ["review-fixture"],
            order: 10,
          },
          {
            userId: user.id,
            projectId: launch.id,
            title: "Confirm reviewer demo flow",
            status: "next",
            priority: "high",
            energy: "medium",
            estimateMinutes: 30,
            scheduledDate: reviewInstant(today, 14),
            tags: ["review-fixture"],
            order: 20,
          },
          {
            userId: user.id,
            projectId: launch.id,
            title: "Close an overdue review item",
            status: "next",
            priority: "high",
            energy: "low",
            estimateMinutes: 15,
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
            dueDate: reviewInstant(tomorrow, 17),
            tags: ["review-fixture"],
            order: 40,
          },
          {
            userId: user.id,
            title: "Capture an unfiled idea",
            status: "inbox",
            priority: "low",
            estimateMinutes: 10,
            tags: ["review-fixture"],
            order: 50,
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
      await tx.agentEnrollment.updateMany({
        where: { userId: user.id },
        data: { timezone },
      });
    });

    console.log(
      `Reset dedicated review account ${reviewEmail}: 2 projects, 5 tasks, effective date ${today}, timezone ${timezone}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
