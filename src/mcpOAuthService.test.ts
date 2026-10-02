import { createHash, randomUUID } from "crypto";
import { McpOAuthService } from "./services/mcpOAuthService";

function createMockPrisma() {
  const authorizationCodes = new Map<string, any>();
  const assistantSessions = new Map<string, any>();
  const refreshTokens = new Map<string, any>();

  return {
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
          refreshTokens.set(tokenHash, {
            ...record,
            ...data,
          });
          count += 1;
        }
        return { count };
      }),
    },
  };
}

describe("McpOAuthService durability", () => {
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
      "Invalid refresh token",
    );
  });
});
