import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

interface CachedAgentResponse {
  inputHash: string;
  status: number;
  body: unknown;
  expiresAt: number;
}

export type IdempotencyLookupResult =
  | {
      kind: "miss";
    }
  | {
      kind: "replay";
      status: number;
      body: unknown;
    }
  | {
      kind: "conflict";
    };

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );

  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(",")}}`;
}

function cloneJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class AgentIdempotencyService {
  constructor(private readonly prisma?: PrismaClient) {}

  private readonly ttlMs = 30 * 24 * 60 * 60 * 1000;
  private readonly entries = new Map<string, CachedAgentResponse>();

  private makeCacheKey(action: string, userId: string, idempotencyKey: string) {
    return `${userId}:${action}:${idempotencyKey}`;
  }

  private hashInput(input: unknown): string {
    return createHash("sha256").update(stableStringify(input)).digest("hex");
  }

  private pruneExpiredEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  async lookup(
    action: string,
    userId: string,
    idempotencyKey: string,
    input: unknown,
    client: Prisma.TransactionClient | undefined = this.prisma,
  ): Promise<IdempotencyLookupResult> {
    if (client) {
      const existing = await client.agentIdempotencyRecord.findUnique({
        where: {
          action_userId_idempotencyKey: {
            action,
            userId,
            idempotencyKey,
          },
        },
      });

      if (!existing) {
        return { kind: "miss" };
      }

      if (existing.expiresAt.getTime() <= Date.now()) {
        await client.agentIdempotencyRecord.delete({
          where: {
            action_userId_idempotencyKey: {
              action,
              userId,
              idempotencyKey,
            },
          },
        });
        return { kind: "miss" };
      }

      const inputHash = this.hashInput(input);
      if (existing.inputHash !== inputHash) {
        return { kind: "conflict" };
      }

      return {
        kind: "replay",
        status: existing.status,
        body: cloneJsonSafe(existing.response),
      };
    }

    this.pruneExpiredEntries();

    const cacheKey = this.makeCacheKey(action, userId, idempotencyKey);
    const existing = this.entries.get(cacheKey);
    if (!existing) {
      return { kind: "miss" };
    }

    const inputHash = this.hashInput(input);
    if (existing.inputHash !== inputHash) {
      return { kind: "conflict" };
    }

    return {
      kind: "replay",
      status: existing.status,
      body: cloneJsonSafe(existing.body),
    };
  }

  async store(
    action: string,
    userId: string,
    idempotencyKey: string,
    input: unknown,
    status: number,
    body: unknown,
    client: Prisma.TransactionClient | undefined = this.prisma,
  ): Promise<void> {
    if (client) {
      const existing = await client.agentIdempotencyRecord.findUnique({
        where: {
          action_userId_idempotencyKey: {
            action,
            userId,
            idempotencyKey,
          },
        },
      });

      if (existing) {
        return;
      }

      await client.agentIdempotencyRecord.create({
        data: {
          action,
          userId,
          idempotencyKey,
          inputHash: this.hashInput(input),
          status,
          response: cloneJsonSafe(body) as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + this.ttlMs),
        },
      });
      return;
    }

    this.pruneExpiredEntries();

    this.entries.set(this.makeCacheKey(action, userId, idempotencyKey), {
      inputHash: this.hashInput(input),
      status,
      body: cloneJsonSafe(body),
      expiresAt: Date.now() + this.ttlMs,
    });
  }
}
