import type { Prisma } from "@prisma/client";

export const UTC_DAY_MILLISECONDS = 86_400_000;

export function utcDayStart(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function nextUtcDayStart(dayStart: Date): Date {
  return new Date(dayStart.getTime() + UTC_DAY_MILLISECONDS);
}

/** Database clock is authoritative for durable admission buckets. */
export async function databaseUtcDayStart(
  tx: Prisma.TransactionClient,
): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ utcDay: string }>>`
    SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "utcDay"
  `;
  const dayStart = new Date(`${rows[0]?.utcDay}T00:00:00.000Z`);
  if (!Number.isFinite(dayStart.getTime()))
    throw new Error("Invalid database UTC day");
  return dayStart;
}

/** One post-lock database instant keeps saved-record timestamps in the checked day. */
export async function databaseUtcNow(
  tx: Prisma.TransactionClient,
): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ utcNow: string }>>`
    SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "utcNow"
  `;
  const now = new Date(rows[0]?.utcNow);
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid database UTC instant");
  return now;
}
