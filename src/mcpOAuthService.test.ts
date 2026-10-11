import { createHash, randomUUID } from "crypto";
import { McpOAuthService } from "./services/mcpOAuthService";

function createMockPrisma() {
  const authorizationCodes = new Map<string, any>();
  const assistantSessions = new Map<string, any>();
  const refreshTokens = new Map<string, any>();

  const prisma = {
    agentEnrollment: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    mcpAuthorizationCode: {
      create: jest.fn(async ({ data }) => {
        authorizationCodes.set(data.code, { ...data, usedAt: null });
        return data;
      }),
      findUnique: jest.fn(async ({ where }) => {
        return authorizationCodes.get(where.code) || null;
      }),
      update: jest.fn(async ({ where, data }) => {
        const record = authorizationCodes.get(where.code);
        const updated = { ...record, ...data };
        authorizationCodes.set(where.code, updated);
        return updated;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const record = authorizationCodes.get(where.code);
        if (
          !record ||
          (where.usedAt === null && record.usedAt !== null) ||
          (where.expiresAt?.gt && record.expiresAt <= where.expiresAt.gt)
        ) {
          return { count: 0 };
        }
        authorizationCodes.set(where.code, { ...record, ...data });
        return { count: 1 };
      }),
    },
    mcpAssistantSession: {
      create: jest.fn(async ({ data }) => {
        const created = {
          id: data.id || randomUUID(),
          ...data,
          revokedAt: null,
          lastAccessTokenIssuedAt: null,
          lastUsedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        assistantSessions.set(created.id, created);
        return created;
      }),
      findUnique: jest.fn(async ({ where }) => {
        return assistantSessions.get(where.id) || null;
      }),
      findMany: jest.fn(async ({ where }) => {
        return Array.from(assistantSessions.values()).filter(
          (session) =>
            session.userId === where.userId &&
            (where.revokedAt === null ? session.revokedAt === null : true),
        );
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        let count = 0;
        for (const [id, session] of assistantSessions.entries()) {
          if (session.id !== where.id && where.id !== undefined) {
            continue;
          }
          if (session.userId !== where.userId && where.userId !== undefined) {
            continue;
          }
          if (where.revokedAt === null && session.revokedAt !== null) {
            continue;
          }
          assistantSessions.set(id, {
            ...session,
            ...data,
            updatedAt: new Date(),
          });
          count += 1;
        }
        return { count };
      }),
    },
    mcpRefreshToken: {
      create: jest.fn(async ({ data }) => {
        refreshTokens.set(data.tokenHash, {
          ...data,
          revokedAt: null,
          rotatedAt: null,
        });
        return data;
      }),
      findUnique: jest.fn(async ({ where, include }) => {
        const record = refreshTokens.get(where.tokenHash) || null;
        if (!record || !include?.session || !record.sessionId) {
          return record;
        }
        return {
          ...record,
          session: assistantSessions.get(record.sessionId) || null,
        };
      }),
      update: jest.fn(async ({ where, data }) => {
        const record = refreshTokens.get(where.tokenHash);
        const updated = { ...record, ...data };
        refreshTokens.set(where.tokenHash, updated);
        return updated;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        let count = 0;
        for (const [tokenHash, record] of refreshTokens.entries()) {
          if (where.tokenHash !== undefined && tokenHash !== where.tokenHash) {
            continue;
          }
          if (record.userId !== where.userId && where.userId !== undefined) {
            continue;
          }
          if (
            record.sessionId !== where.sessionId &&
            where.sessionId !== undefined
          ) {
            continue;
          }
          if (where.revokedAt === null && record.revokedAt !== null) {
            continue;
          }
          if (where.rotatedAt === null && record.rotatedAt !== null) {
            continue;
          }
          if (where.expiresAt?.gt && record.expiresAt <= where.expiresAt.gt) {
            continue;
          }
          if (where.session?.is) {
            const session = assistantSessions.get(record.sessionId);
            if (
              !session ||
              session.userId !== where.session.is.userId ||
              session.revokedAt !== null
            ) {
              continue;
            }
          }
          refreshTokens.set(tokenHash, {
            ...record,
            ...data,
          });
          count += 1;
        }
        return { count };
      }),
    },
    $transaction: jest.fn(),
  };
  let transactionQueue = Promise.resolve();
  prisma.$transaction.mockImplementation((operation) => {
    const next = transactionQueue.then(async () => {
      const maps = [authorizationCodes, assistantSessions, refreshTokens];
      const snapshots = maps.map((map) => new Map(map));
      try {
        return await operation(prisma);
      } catch (error) {
        maps.forEach((map, index) => {
          map.clear();
          snapshots[index].forEach((value, key) => map.set(key, value));
        });
        throw error;
      }
    });
    transactionQueue = next.catch(() => undefined);
    return next;
  });
  return prisma;
}

describe("McpOAuthService durability", () => {
  it("rejects malformed codes before querying the persisted UUID column", async () => {
    const prisma = createMockPrisma();
    const service = new McpOAuthService(prisma as any);
    await expect(
      service.exchangeAuthorizationCode({
        code: "synthetic-invalid-code",
        clientId: "chatgpt-client",
        redirectUri: "https://chat.openai.com/aip/callback",
        codeVerifier: "pkce-verifier-1111111111111111111111111111111111111",
      }),
    ).rejects.toThrow("Invalid authorization code");
    expect(prisma.mcpAuthorizationCode.findUnique).not.toHaveBeenCalled();
  });

  it("persists identity scopes independently from Todos permissions", async () => {
    const prisma = createMockPrisma();
    const first = new McpOAuthService(prisma as any);
    const second = new McpOAuthService(prisma as any);
    const verifier = "pkce-verifier-oidc-persistence-111111111111111111111111";
    const challenge = createHash("sha256")
      .update(verifier, "utf8")
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    const created = await first.createAuthorizationCode({
      userId: "user-1",
      email: "user-1@example.com",
      clientId: "chatgpt-client",
      redirectUri: "https://chat.openai.com/aip/callback",
      scopes: ["openid", "email"],
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
    });

    const exchanged = await second.exchangeAuthorizationCode({
      code: created.code,
      clientId: "chatgpt-client",
      redirectUri: "https://chat.openai.com/aip/callback",
      codeVerifier: verifier,
    });

    expect(exchanged.scopes).toEqual(["email", "openid"]);
  });

  it("exchanges authorization codes across service instances when backed by Prisma", async () => {
    const prisma = createMockPrisma();
    const first = new McpOAuthService(prisma as any);
    const second = new McpOAuthService(prisma as any);

    const created = await first.createAuthorizationCode({
      userId: "user-1",
      email: "user-1@example.com",
      clientId: "chatgpt-client",
      redirectUri: "https://chat.openai.com/aip/callback",
      scopes: ["tasks.read"],
      assistantName: "ChatGPT",
      codeChallenge: "abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabc",
      codeChallengeMethod: "S256",
    });

    await expect(
      second.exchangeAuthorizationCode({
        code: created.code,
        clientId: "chatgpt-client",
        redirectUri: "https://chat.openai.com/aip/callback",
        codeVerifier: "pkce-verifier-1111111111111111111111111111111111111",
      }),
    ).rejects.toThrow("Invalid code verifier");
  });

  it("rotates refresh tokens across service instances when backed by Prisma", async () => {
    const prisma = createMockPrisma();
    const first = new McpOAuthService(prisma as any);
    const second = new McpOAuthService(prisma as any);

    const issued = await first.createRefreshToken({
      userId: "user-1",
      email: "user-1@example.com",
      scopes: ["tasks.read"],
      assistantName: "ChatGPT",
      clientId: "chatgpt-client",
    });

    const refreshed = await second.exchangeRefreshToken({
      refreshToken: issued.refreshToken,
      clientId: "chatgpt-client",
    });

    expect(refreshed.refreshToken).toEqual(expect.any(String));
    expect(refreshed.refreshToken).not.toBe(issued.refreshToken);
  });

  it("revokes an assistant session and blocks future refresh exchanges", async () => {
    const prisma = createMockPrisma();
    const service = new McpOAuthService(prisma as any);

    const session = await service.createAssistantSession({
      userId: "user-1",
      scopes: ["tasks.read"],
      assistantName: "ChatGPT",
      clientId: "chatgpt-client",
      source: "oauth",
    });
    const issued = await service.createRefreshToken({
      userId: "user-1",
      email: "user-1@example.com",
      scopes: ["tasks.read"],
      assistantName: "ChatGPT",
      clientId: "chatgpt-client",
      sessionId: session.id,
    });

    await service.revokeAssistantSession({
      userId: "user-1",
      sessionId: session.id,
    });

    await expect(
      service.exchangeRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: "chatgpt-client",
      }),
    ).rejects.toThrow("Assistant session revoked");
  });

  it("binds authorization codes to the exact MCP resource", async () => {
    const service = new McpOAuthService();
    const resource = "https://api.example.com/mcp/app";
    const created = await service.createAuthorizationCode({
      userId: "user-1",
      email: "user-1@example.com",
      clientId: "chatgpt-client",
      redirectUri: "https://chat.openai.com/aip/callback",
      scopes: ["tasks.read"],
      codeChallenge: "abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabc",
      codeChallengeMethod: "S256",
      resource,
    });

    await expect(
      service.exchangeAuthorizationCode({
        code: created.code,
        clientId: "chatgpt-client",
        redirectUri: "https://chat.openai.com/aip/callback",
        codeVerifier: "pkce-verifier-1111111111111111111111111111111111111",
        resource: "https://api.example.com/mcp",
      }),
    ).rejects.toThrow("Authorization code resource mismatch");
  });

  it("preserves resource binding across refresh rotation", async () => {
    const service = new McpOAuthService();
    const resource = "https://api.example.com/mcp/app";
    const issued = await service.createRefreshToken({
      userId: "user-1",
      email: "user-1@example.com",
      scopes: ["tasks.read"],
      clientId: "chatgpt-client",
      resource,
    });

    await expect(
      service.exchangeRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: "chatgpt-client",
        resource: "https://api.example.com/mcp",
      }),
    ).rejects.toThrow("Refresh token resource mismatch");

    await expect(
      service.exchangeRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: "chatgpt-client",
        resource,
      }),
    ).resolves.toMatchObject({ resource });
  });

  it("rejects replay of an authorization code after a successful exchange", async () => {
    const service = new McpOAuthService();
    const verifier = "pkce-verifier-replay-111111111111111111111111111111111";
    const challenge = createHash("sha256")
      .update(verifier, "utf8")
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const created = await service.createAuthorizationCode({
      userId: "user-1",
      email: "user-1@example.com",
      clientId: "chatgpt-client",
      redirectUri: "https://chat.openai.com/aip/callback",
      scopes: ["tasks.read"],
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
    });
    const exchange = {
      code: created.code,
      clientId: "chatgpt-client",
      redirectUri: "https://chat.openai.com/aip/callback",
      codeVerifier: verifier,
    };

    await expect(
      service.exchangeAuthorizationCode(exchange),
    ).resolves.toMatchObject({
      userId: "user-1",
    });
    await expect(service.exchangeAuthorizationCode(exchange)).rejects.toThrow(
      "Invalid authorization code",
    );
  });

  it("rejects replay of a refresh token after rotation", async () => {
    const service = new McpOAuthService();
    const issued = await service.createRefreshToken({
      userId: "user-1",
      email: "user-1@example.com",
      scopes: ["tasks.read"],
      clientId: "chatgpt-client",
    });
    const exchange = {
      refreshToken: issued.refreshToken,
      clientId: "chatgpt-client",
    };

    await expect(service.exchangeRefreshToken(exchange)).resolves.toMatchObject(
      {
        userId: "user-1",
      },
    );
    await expect(service.exchangeRefreshToken(exchange)).rejects.toThrow(
      "Refresh token already rotated",
    );
  });

  it("allows only one concurrent code exchange across persisted service instances", async () => {
    const prisma = createMockPrisma();
    const first = new McpOAuthService(prisma as any);
    const second = new McpOAuthService(prisma as any);
    const verifier = "pkce-verifier-concurrent-111111111111111111111111111111";
    const created = await first.createAuthorizationCode({
      userId: "user-1",
      email: "user-1@example.com",
      clientId: "chatgpt-client",
      redirectUri: "https://chat.openai.com/aip/callback",
      scopes: ["tasks.read"],
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      codeChallengeMethod: "S256",
    });
    const exchange = {
      code: created.code,
      clientId: created.clientId,
      redirectUri: created.redirectUri,
      codeVerifier: verifier,
    };
    const results = await Promise.allSettled([
      first.exchangeAuthorizationCode(exchange),
      second.exchangeAuthorizationCode(exchange),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  it.each(["memory", "persisted"])(
    "allows only one concurrent refresh exchange with %s storage",
    async (storage) => {
      const prisma = storage === "persisted" ? createMockPrisma() : undefined;
      const first = new McpOAuthService(prisma as any);
      const second = prisma ? new McpOAuthService(prisma as any) : first;
      const issued = await first.createRefreshToken({
        userId: "user-1",
        email: "user-1@example.com",
        scopes: ["tasks.read"],
        clientId: "chatgpt-client",
      });
      const exchange = {
        refreshToken: issued.refreshToken,
        clientId: "chatgpt-client",
      };
      const results = await Promise.allSettled([
        first.exchangeRefreshToken(exchange),
        second.exchangeRefreshToken(exchange),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const successful = results.find(
        (result) => result.status === "fulfilled",
      );
      if (successful?.status !== "fulfilled")
        throw new Error("No refresh succeeded");
      await expect(
        first.exchangeRefreshToken({
          refreshToken: successful.value.refreshToken,
          clientId: "chatgpt-client",
        }),
      ).rejects.toThrow(/Assistant session revoked|Invalid refresh token/);
    },
  );

  it.each(["memory", "persisted"])(
    "revokes only the replayed refresh token's session with %s storage",
    async (storage) => {
      const prisma = storage === "persisted" ? createMockPrisma() : undefined;
      const service = new McpOAuthService(prisma as any);
      const createToken = () =>
        service.createRefreshToken({
          userId: "user-1",
          email: "user-1@example.com",
          scopes: ["tasks.read"],
          clientId: "chatgpt-client",
        });
      const issued = await createToken();
      const unrelated = await createToken();
      const exchange = {
        refreshToken: issued.refreshToken,
        clientId: "chatgpt-client",
      };
      const successor = await service.exchangeRefreshToken(exchange);
      await expect(service.exchangeRefreshToken(exchange)).rejects.toThrow(
        "Refresh token already rotated",
      );
      await expect(
        service.exchangeRefreshToken({
          refreshToken: successor.refreshToken,
          clientId: "chatgpt-client",
        }),
      ).rejects.toThrow(/Assistant session revoked|Invalid refresh token/);
      await expect(
        service.exchangeRefreshToken({
          refreshToken: unrelated.refreshToken,
          clientId: "chatgpt-client",
        }),
      ).resolves.toMatchObject({ userId: "user-1" });
    },
  );

  it("requires the bound client before consuming a refresh token", async () => {
    const service = new McpOAuthService();
    const issued = await service.createRefreshToken({
      userId: "user-1",
      email: "user-1@example.com",
      scopes: ["tasks.read"],
      clientId: "chatgpt-client",
    });
    await expect(
      service.exchangeRefreshToken({ refreshToken: issued.refreshToken }),
    ).rejects.toThrow("Refresh token client mismatch");
    await expect(
      service.exchangeRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: "another-client",
      }),
    ).rejects.toThrow("Refresh token client mismatch");
    await expect(
      service.exchangeRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: "chatgpt-client",
      }),
    ).resolves.toMatchObject({ userId: "user-1" });
  });

  it("rolls back persisted rotation when successor persistence fails", async () => {
    const prisma = createMockPrisma();
    const service = new McpOAuthService(prisma as any);
    const issued = await service.createRefreshToken({
      userId: "user-1",
      email: "user-1@example.com",
      scopes: ["tasks.read"],
      clientId: "chatgpt-client",
    });
    prisma.mcpRefreshToken.create.mockRejectedValueOnce(
      new Error("synthetic persistence failure"),
    );
    const exchange = {
      refreshToken: issued.refreshToken,
      clientId: "chatgpt-client",
    };
    await expect(service.exchangeRefreshToken(exchange)).rejects.toThrow(
      "synthetic persistence failure",
    );
    await expect(service.exchangeRefreshToken(exchange)).resolves.toMatchObject(
      { userId: "user-1" },
    );
  });

  it("does not classify expiry while waiting to rotate as session-compromising replay", async () => {
    jest.useFakeTimers();
    try {
      const prisma = createMockPrisma();
      const service = new McpOAuthService(prisma as any);
      const session = await service.createAssistantSession({
        userId: "user-1",
        scopes: ["tasks.read"],
        source: "oauth",
        clientId: "chatgpt-client",
      });
      const issued = await service.createRefreshToken({
        userId: "user-1",
        email: "user-1@example.com",
        scopes: ["tasks.read"],
        clientId: "chatgpt-client",
        sessionId: session.id,
      });
      const expiresAt = new Date(issued.expiresAt).getTime();
      jest.setSystemTime(expiresAt - 1);
      const transaction = prisma.$transaction.getMockImplementation()!;
      prisma.$transaction.mockImplementationOnce((operation) => {
        jest.setSystemTime(expiresAt + 1);
        return transaction(operation);
      });
      await expect(
        service.exchangeRefreshToken({
          refreshToken: issued.refreshToken,
          clientId: "chatgpt-client",
        }),
      ).rejects.toThrow("Refresh token expired");
      expect(await service.listAssistantSessions("user-1")).toEqual([
        expect.objectContaining({ id: session.id }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
});
