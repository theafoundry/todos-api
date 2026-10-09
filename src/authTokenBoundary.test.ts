import { createHmac } from "crypto";
import type { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { AuthService } from "./services/authService";
import { validateLegacyMcpResourceMode } from "./validation/mcpValidation";

jest.mock("./config", () => ({
  config: {
    baseUrl: "https://auth-boundary.planwren.test",
    emailFeaturesEnabled: false,
  },
}));

const ACCESS_SECRET = "auth-boundary-access-secret-for-unit-tests";
const REFRESH_SECRET = "auth-boundary-refresh-secret-for-unit-tests";
const ISSUER = "https://auth-boundary.planwren.test";
const MCP_RESOURCE = `${ISSUER}/mcp`;
const APP_RESOURCE = `${ISSUER}/mcp/app`;
const NOW = new Date("2026-10-09T00:00:00.000Z").getTime();
const ISSUED_AT = NOW / 1000;
const USER_ID = "boundary-user";
const EMAIL = "boundary@example.test";

function webClaims(patch: Record<string, unknown> = {}) {
  return {
    userId: USER_ID,
    email: EMAIL,
    iat: ISSUED_AT,
    exp: ISSUED_AT + 900,
    ...patch,
  };
}

function mcpClaims(patch: Record<string, unknown> = {}) {
  return {
    ...webClaims(),
    tokenType: "mcp",
    scopes: ["tasks.read"],
    ...patch,
  };
}

function boundClaims(
  resource = MCP_RESOURCE,
  patch: Record<string, unknown> = {},
) {
  return mcpClaims({
    iss: ISSUER,
    aud: resource,
    sub: USER_ID,
    resource,
    jti: "bound-token-id",
    sessionId: "assistant-session",
    ...patch,
  });
}

// Sign malformed JSON claims directly: jwt.sign would reject some invalid types
// before the actual verifier under test could see them.
function signedClaims(claims: unknown, secret = ACCESS_SECRET) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const body = `${header}.${payload}`;
  return `${body}.${createHmac("sha256", secret)
    .update(body)
    .digest("base64url")}`;
}

function omitClaim(claims: Record<string, unknown>, key: string) {
  const remaining = { ...claims };
  delete remaining[key];
  return remaining;
}

function fakeDatabase() {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({ mcpRevokedAfter: null }),
    },
    mcpAssistantSession: {
      findUnique: jest.fn().mockResolvedValue({
        userId: USER_ID,
        revokedAt: null,
        resource: null,
      }),
    },
  };
}

describe("Local MCP token resource mode", () => {
  test.each([undefined, null, "", " ", MCP_RESOURCE, APP_RESOURCE, 0, false])(
    "rejects an explicitly supplied resource %p instead of dropping its binding",
    (resource) => {
      expect(() => validateLegacyMcpResourceMode({ resource })).toThrow(
        "Resource-bound MCP credentials use /oauth/authorize and /oauth/token",
      );
    },
  );

  test("preserves omitted-resource local inputs", () => {
    expect(() =>
      validateLegacyMcpResourceMode({ scopes: ["tasks.read"] }),
    ).not.toThrow();
  });
});

describe("AuthService access-token boundaries", () => {
  let auth: AuthService;
  let database: ReturnType<typeof fakeDatabase>;
  let previousAccessSecret: string | undefined;
  let previousRefreshSecret: string | undefined;

  beforeEach(() => {
    previousAccessSecret = process.env.JWT_ACCESS_SECRET;
    previousRefreshSecret = process.env.JWT_REFRESH_SECRET;
    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    database = fakeDatabase();
    auth = new AuthService(database as unknown as PrismaClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousAccessSecret === undefined)
      delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = previousAccessSecret;
    if (previousRefreshSecret === undefined)
      delete process.env.JWT_REFRESH_SECRET;
    else process.env.JWT_REFRESH_SECRET = previousRefreshSecret;
  });

  describe("web access", () => {
    test.each([
      ["email account", EMAIL, EMAIL],
      ["phone account", "", ""],
      ["legacy enrollment with null email", null, ""],
    ])(
      "accepts the issued web shape for a %s",
      (_name, email, expectedEmail) => {
        const token = jwt.sign(webClaims({ email }), ACCESS_SECRET);
        expect(auth.verifyToken(token)).toEqual(
          expect.objectContaining({ userId: USER_ID, email: expectedEmail }),
        );
        expect(database.user.findUnique).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["legacy unbound MCP", mcpClaims()],
      ["public resource-bound MCP", boundClaims()],
      ["native resource-bound MCP", boundClaims(APP_RESOURCE)],
      ["MCP type with no scopes", { ...webClaims(), tokenType: "mcp" }],
      ["unknown token type", { ...webClaims(), tokenType: "refresh" }],
      ["type changed to empty string", { ...webClaims(), tokenType: "" }],
      ["client identifier", { ...webClaims(), clientId: "oauth-client" }],
      ["scope without token type", { ...webClaims(), scopes: ["tasks.read"] }],
      [
        "OAuth ID shape",
        { ...webClaims(), iss: ISSUER, aud: "client", sub: USER_ID },
      ],
      [
        "refresh token shape",
        {
          userId: USER_ID,
          tokenId: "refresh-id",
          iat: ISSUED_AT,
          exp: ISSUED_AT + 900,
        },
      ],
      ["JWT identifier", { ...webClaims(), jti: "token-id" }],
      ["extra privilege claim", { ...webClaims(), role: "admin" }],
      ["not-before claim", { ...webClaims(), nbf: ISSUED_AT - 1 }],
    ])("rejects %s even with the valid access signing key", (_name, claims) => {
      expect(() => auth.verifyToken(signedClaims(claims))).toThrow();
    });

    test.each([
      ["missing userId", omitClaim(webClaims(), "userId")],
      ["empty userId", webClaims({ userId: "" })],
      ["whitespace userId", webClaims({ userId: "  " })],
      ["numeric userId", webClaims({ userId: 12 })],
      ["array userId", webClaims({ userId: [USER_ID] })],
      ["missing email", omitClaim(webClaims(), "email")],
      ["boolean email", webClaims({ email: true })],
      ["object email", webClaims({ email: { value: EMAIL } })],
      ["missing issued-at", omitClaim(webClaims(), "iat")],
      ["string issued-at", webClaims({ iat: String(ISSUED_AT) })],
      ["fractional issued-at", webClaims({ iat: ISSUED_AT + 0.5 })],
      ["missing expiration", omitClaim(webClaims(), "exp")],
      ["string expiration", webClaims({ exp: String(ISSUED_AT + 900) })],
      ["fractional expiration", webClaims({ exp: ISSUED_AT + 900.5 })],
      ["expiration before issuance", webClaims({ iat: ISSUED_AT + 901 })],
      ["string payload", "web-token"],
      ["array payload", [webClaims()]],
      ["null payload", null],
    ])("rejects malformed web identity or lifetime: %s", (_name, claims) => {
      expect(() => auth.verifyToken(signedClaims(claims))).toThrow();
    });

    test("rejects a refresh-key signature even when its claims resemble web access", () => {
      expect(() =>
        auth.verifyToken(signedClaims(webClaims(), REFRESH_SECRET)),
      ).toThrow("Invalid token");
    });

    test("verifies the signature and expiration instead of only inspecting claims", () => {
      expect(() =>
        auth.verifyToken(signedClaims(webClaims(), "wrong-signing-key")),
      ).toThrow("Invalid token");
      expect(() =>
        auth.verifyToken(signedClaims(webClaims({ exp: ISSUED_AT }))),
      ).toThrow("Token expired");
      expect(() =>
        auth.verifyToken(
          jwt.sign(webClaims(), ACCESS_SECRET, { algorithm: "HS384" }),
        ),
      ).toThrow("Invalid token");
    });
  });

  describe("MCP access", () => {
    test("preserves explicitly scoped legacy unbound tokens on the broad surface", async () => {
      const token = signedClaims(mcpClaims({ scopes: ["read"] }));
      await expect(
        auth.verifyMcpToken(token, {
          resource: MCP_RESOURCE,
          requireResource: false,
        }),
      ).resolves.toEqual({
        userId: USER_ID,
        email: EMAIL,
        tokenType: "mcp",
        scopes: ["projects.read", "tasks.read"],
        oauthScopes: ["projects.read", "tasks.read"],
      });
      expect(database.user.findUnique).toHaveBeenCalledWith({
        where: { id: USER_ID },
        select: { mcpRevokedAfter: true },
      });
    });

    test("retains the application and identity scope separation", async () => {
      await expect(
        auth.verifyMcpToken(
          signedClaims(mcpClaims({ scopes: ["write", "openid", "email"] })),
        ),
      ).resolves.toMatchObject({
        scopes: [
          "projects.read",
          "projects.write",
          "tasks.read",
          "tasks.write",
        ],
        oauthScopes: [
          "email",
          "openid",
          "projects.read",
          "projects.write",
          "tasks.read",
          "tasks.write",
        ],
      });
    });

    test.each([MCP_RESOURCE, APP_RESOURCE])(
      "accepts a correctly bound token for its exact resource %s",
      async (resource) => {
        database.mcpAssistantSession.findUnique.mockResolvedValue({
          userId: USER_ID,
          revokedAt: null,
          resource,
        });
        const token = auth.createMcpToken({
          userId: USER_ID,
          email: EMAIL,
          scopes: ["tasks.read"],
          resource,
          sessionId: "assistant-session",
        }).token;
        await expect(
          auth.verifyMcpToken(token, { resource, requireResource: true }),
        ).resolves.toMatchObject({ userId: USER_ID, resource });
        await expect(auth.verifyMcpToken(token)).resolves.toMatchObject({
          resource,
        });
        expect(auth.decodeMcpToken(token)).toMatchObject({
          resource,
          issuedAt: ISSUED_AT,
        });
      },
    );

    test.each([MCP_RESOURCE, APP_RESOURCE])(
      "rejects bound tokens minted for the other surface when expecting %s",
      async (resource) => {
        const otherResource =
          resource === MCP_RESOURCE ? APP_RESOURCE : MCP_RESOURCE;
        const token = signedClaims(boundClaims(otherResource));
        await expect(
          auth.verifyMcpToken(token, { resource, requireResource: false }),
        ).rejects.toThrow("Invalid MCP token");
        expect(database.user.findUnique).not.toHaveBeenCalled();
      },
    );

    test("requires resource binding on the native surface while legacy remains usable by helpers", async () => {
      const token = signedClaims(mcpClaims());
      await expect(
        auth.verifyMcpToken(token, {
          resource: APP_RESOURCE,
          requireResource: true,
        }),
      ).rejects.toThrow("Invalid MCP token");
      await expect(auth.verifyMcpToken(token)).resolves.toMatchObject({
        userId: USER_ID,
      });
    });

    test.each([
      ["web token", webClaims()],
      ["missing type", omitClaim(mcpClaims(), "tokenType")],
      ["missing scopes", omitClaim(mcpClaims(), "scopes")],
      ["empty scopes", mcpClaims({ scopes: [] })],
      ["string scopes", mcpClaims({ scopes: "tasks.read" })],
      ["unknown scope", mcpClaims({ scopes: ["admin"] })],
      ["empty scope", mcpClaims({ scopes: [" "] })],
      ["non-string scope", mcpClaims({ scopes: [12] })],
      ["email scope without openid", mcpClaims({ scopes: ["email"] })],
      ["missing userId", omitClaim(mcpClaims(), "userId")],
      ["empty userId", mcpClaims({ userId: "" })],
      ["whitespace userId", mcpClaims({ userId: " " })],
      ["numeric userId", mcpClaims({ userId: 12 })],
      ["missing email", omitClaim(mcpClaims(), "email")],
      ["null email", mcpClaims({ email: null })],
      ["numeric email", mcpClaims({ email: 12 })],
      ["null linked session", mcpClaims({ sessionId: null })],
      ["numeric linked session", mcpClaims({ sessionId: 12 })],
      ["empty linked session", mcpClaims({ sessionId: "" })],
      ["blank linked session", mcpClaims({ sessionId: " " })],
      ["missing issued-at", omitClaim(mcpClaims(), "iat")],
      ["string issued-at", mcpClaims({ iat: String(ISSUED_AT) })],
      ["fractional issued-at", mcpClaims({ iat: ISSUED_AT + 0.5 })],
      ["missing expiration", omitClaim(mcpClaims(), "exp")],
      ["string expiration", mcpClaims({ exp: String(ISSUED_AT + 900) })],
      ["fractional expiration", mcpClaims({ exp: ISSUED_AT + 900.5 })],
      ["expiration before issuance", mcpClaims({ iat: ISSUED_AT + 901 })],
      ["string payload", "mcp-token"],
      ["array payload", [mcpClaims()]],
    ])(
      "rejects malformed MCP credentials before database lookup: %s",
      async (_name, claims) => {
        await expect(auth.verifyMcpToken(signedClaims(claims))).rejects.toThrow(
          "Invalid MCP token",
        );
        expect(database.user.findUnique).not.toHaveBeenCalled();
        expect(database.mcpAssistantSession.findUnique).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["resource without issuer", omitClaim(boundClaims(), "iss")],
      ["resource without audience", omitClaim(boundClaims(), "aud")],
      ["resource without subject", omitClaim(boundClaims(), "sub")],
      ["binding without resource", omitClaim(boundClaims(), "resource")],
      ["issuer alone", mcpClaims({ iss: ISSUER })],
      ["audience alone", mcpClaims({ aud: MCP_RESOURCE })],
      ["subject alone", mcpClaims({ sub: USER_ID })],
      ["token identifier alone", mcpClaims({ jti: "token-id" })],
      ["missing token identifier", omitClaim(boundClaims(), "jti")],
      ["empty token identifier", boundClaims(MCP_RESOURCE, { jti: " " })],
      ["numeric token identifier", boundClaims(MCP_RESOURCE, { jti: 12 })],
      ["missing linked session", omitClaim(boundClaims(), "sessionId")],
      ["empty linked session", boundClaims(MCP_RESOURCE, { sessionId: " " })],
      ["numeric linked session", boundClaims(MCP_RESOURCE, { sessionId: 12 })],
      [
        "foreign issuer",
        boundClaims(MCP_RESOURCE, { iss: "https://foreign.example.test" }),
      ],
      [
        "issuer with trailing slash",
        boundClaims(MCP_RESOURCE, { iss: `${ISSUER}/` }),
      ],
      [
        "foreign audience",
        boundClaims(MCP_RESOURCE, { aud: "https://foreign.example.test/mcp" }),
      ],
      [
        "array audience including own resource",
        boundClaims(MCP_RESOURCE, { aud: [MCP_RESOURCE] }),
      ],
      [
        "audience of the other surface",
        boundClaims(MCP_RESOURCE, { aud: APP_RESOURCE }),
      ],
      ["foreign subject", boundClaims(MCP_RESOURCE, { sub: "other-user" })],
      ["numeric subject", boundClaims(MCP_RESOURCE, { sub: 12 })],
      ["unknown own resource", boundClaims(`${ISSUER}/other`)],
      ["resource with trailing slash", boundClaims(`${MCP_RESOURCE}/`)],
      ["empty resource", boundClaims(MCP_RESOURCE, { resource: "" })],
      ["numeric resource", boundClaims(MCP_RESOURCE, { resource: 12 })],
    ])(
      "rejects malformed or partial binding even without expected-resource options: %s",
      async (_name, claims) => {
        const token = signedClaims(claims);
        expect(() => auth.decodeMcpToken(token)).toThrow("Invalid MCP token");
        await expect(auth.verifyMcpToken(token)).rejects.toThrow(
          "Invalid MCP token",
        );
        expect(database.user.findUnique).not.toHaveBeenCalled();
      },
    );

    test("enforces MCP signatures and expiry before checking revocation", async () => {
      await expect(
        auth.verifyMcpToken(signedClaims(mcpClaims(), "wrong-signing-key")),
      ).rejects.toThrow("Invalid MCP token");
      await expect(
        auth.verifyMcpToken(signedClaims(mcpClaims({ exp: ISSUED_AT }))),
      ).rejects.toThrow("Token expired");
      await expect(
        auth.verifyMcpToken(
          jwt.sign(mcpClaims(), ACCESS_SECRET, { algorithm: "HS384" }),
        ),
      ).rejects.toThrow("Invalid MCP token");
      expect(database.user.findUnique).not.toHaveBeenCalled();
    });

    test("rejects legacy and resource-bound credentials for a deleted user", async () => {
      database.user.findUnique.mockResolvedValue(null);
      for (const claims of [mcpClaims(), boundClaims(APP_RESOURCE)]) {
        await expect(auth.verifyMcpToken(signedClaims(claims))).rejects.toThrow(
          "MCP token revoked",
        );
      }
      expect(database.mcpAssistantSession.findUnique).not.toHaveBeenCalled();
    });

    test("preserves user revocation at the issued-at boundary for both token formats", async () => {
      database.user.findUnique.mockResolvedValue({
        mcpRevokedAfter: new Date(NOW),
      });
      for (const claims of [mcpClaims(), boundClaims(APP_RESOURCE)]) {
        await expect(auth.verifyMcpToken(signedClaims(claims))).rejects.toThrow(
          "MCP token revoked",
        );
      }
      database.user.findUnique.mockResolvedValue({
        mcpRevokedAfter: new Date(NOW - 1000),
      });
      await expect(
        auth.verifyMcpToken(signedClaims(mcpClaims())),
      ).resolves.toMatchObject({ userId: USER_ID });
    });

    test.each([
      ["missing session", null],
      [
        "different owner",
        { userId: "other-user", revokedAt: null, resource: null },
      ],
      [
        "revoked session",
        { userId: USER_ID, revokedAt: new Date(NOW), resource: null },
      ],
    ])("rejects a token linked to a %s", async (_name, session) => {
      database.mcpAssistantSession.findUnique.mockResolvedValue(session);
      await expect(
        auth.verifyMcpToken(
          signedClaims(mcpClaims({ sessionId: "assistant-session" })),
        ),
      ).rejects.toThrow("MCP token revoked");
      expect(database.mcpAssistantSession.findUnique).toHaveBeenCalledWith({
        where: { id: "assistant-session" },
        select: { userId: true, revokedAt: true, resource: true },
      });
    });

    test.each([MCP_RESOURCE, APP_RESOURCE])(
      "verifies linked session ownership and the binding for %s",
      async (resource) => {
        database.mcpAssistantSession.findUnique.mockResolvedValue({
          userId: USER_ID,
          revokedAt: null,
          resource,
        });
        const token = signedClaims(
          boundClaims(resource, { sessionId: "assistant-session" }),
        );
        await expect(auth.verifyMcpToken(token)).resolves.toMatchObject({
          resource,
          sessionId: "assistant-session",
        });
        database.mcpAssistantSession.findUnique.mockResolvedValue({
          userId: USER_ID,
          revokedAt: null,
          resource: resource === MCP_RESOURCE ? APP_RESOURCE : MCP_RESOURCE,
        });
        await expect(auth.verifyMcpToken(token)).rejects.toThrow(
          "MCP token revoked",
        );
        await expect(
          auth.verifyMcpToken(token, { resource, requireResource: true }),
        ).rejects.toThrow("MCP token revoked");
      },
    );

    test("accepts a nonrevoked legacy linked session without introducing a resource requirement", async () => {
      await expect(
        auth.verifyMcpToken(
          signedClaims(mcpClaims({ sessionId: "legacy-session" })),
          { resource: MCP_RESOURCE, requireResource: false },
        ),
      ).resolves.toMatchObject({ sessionId: "legacy-session" });
    });
  });
});
