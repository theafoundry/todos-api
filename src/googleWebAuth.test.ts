import express, { RequestHandler } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthService } from "./services/authService";
import type { GoogleAuthService } from "./services/googleAuthService";
import type { SocialAuthService } from "./services/socialAuthService";
import type { McpOAuthService } from "./services/mcpOAuthService";

jest.mock("./config", () => {
  const actual = jest.requireActual<typeof import("./config")>("./config");
  return {
    ...actual,
    config: {
      ...actual.config,
      nodeEnv: "production",
      baseUrl: "https://todos.theafoundry.com",
      googleLoginEnabled: true,
      googleRedirectUri: "https://todos.thealabs.dev/auth/google/callback",
    },
  };
});

import { config } from "./config";
import { createAuthRouter } from "./routes/authRouter";

const CANONICAL_HOST = "todos.theafoundry.com";
const WWW_HOST = "www.planwren.com";
const STATE = "isolated-google-state";
const COOKIE = `oauth_state=${STATE}`;
const pass: RequestHandler = (_req, _res, next) => next();

function fixture() {
  const profile = {
    provider: "google" as const,
    providerSubject: "isolated-provider-subject",
    email: "isolated@example.test",
    emailVerified: true,
    name: "Isolated fixture",
  };
  const google = {
    generateAuthUrl: jest.fn((redirectUri: string) => ({
      url: `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ redirect_uri: redirectUri, state: STATE })}`,
      state: STATE,
    })),
    handleCallback: jest.fn().mockResolvedValue(profile),
  };
  const social = {
    getEnabledProviders: jest.fn(() => ({
      google: true,
      apple: false,
      phone: false,
    })),
    findOrCreateSocialUser: jest.fn().mockResolvedValue({
      user: { id: "isolated-user", email: profile.email, name: profile.name },
      token: "isolated-access-fixture",
      refreshToken: "isolated-refresh-fixture",
      isNewUser: false,
    }),
  };
  const auth = { issueTokens: jest.fn(), verifyToken: jest.fn() };
  const app = express();
  app.set("trust proxy", 1);
  app.use(cookieParser());
  app.use(
    "/auth",
    createAuthRouter({
      googleAuthService: google as unknown as GoogleAuthService,
      socialAuthService: social as unknown as SocialAuthService,
      authService: auth as unknown as AuthService,
      mcpOAuthService: {} as McpOAuthService,
      authLimiter: pass,
      emailActionLimiter: pass,
      requireAuthIfConfigured: pass,
    }),
  );
  return { app, google, social, profile };
}

function cookies(response: request.Response): string[] {
  const value = response.headers["set-cookie"];
  return Array.isArray(value) ? value : value ? [value] : [];
}

describe("Google web callback origins and state", () => {
  beforeEach(() => {
    config.nodeEnv = "production";
    config.googleLoginEnabled = true;
    config.googleRedirectUri =
      "https://todos.thealabs.dev/auth/google/callback";
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([CANONICAL_HOST, WWW_HOST])(
    "starts and exchanges on the initiating permitted host %s",
    async (host) => {
      const { app, google, social, profile } = fixture();
      const callback = `https://${host}/auth/google/callback`;
      const start = await request(app)
        .get("/auth/google/start")
        .set("Host", host)
        .set("X-Forwarded-Proto", "https")
        .expect(302);
      expect(
        new URL(start.headers.location).searchParams.get("redirect_uri"),
      ).toBe(callback);
      expect(google.generateAuthUrl).toHaveBeenCalledWith(callback);
      const stateCookie = cookies(start).find((v) =>
        v.startsWith("oauth_state="),
      );
      expect(stateCookie).toContain("Path=/auth/google");
      expect(stateCookie).toContain("HttpOnly");
      expect(stateCookie).toContain("Secure");
      expect(stateCookie).toContain("SameSite=Lax");
      expect(stateCookie).toContain("Max-Age=600");
      expect(stateCookie).not.toMatch(/Domain=/i);

      const result = await request(app)
        .get(`/auth/google/callback?state=${STATE}&code=isolated-code`)
        .set("Host", host)
        .set("X-Forwarded-Proto", "https")
        .set("Cookie", COOKIE)
        .expect(302);
      expect(google.handleCallback).toHaveBeenCalledWith(
        "isolated-code",
        callback,
      );
      expect(social.findOrCreateSocialUser).toHaveBeenCalledWith(
        profile,
        expect.any(Function),
      );
      expect(result.headers.location).toMatch(/^\/auth\?/);
      expect(new URL(result.headers.location, `https://${host}`).origin).toBe(
        `https://${host}`,
      );
      const cleared = cookies(result).find((v) => v.startsWith("oauth_state="));
      expect(cleared).toContain("Expires=Thu, 01 Jan 1970");
      expect(cleared).toContain("Secure");
      expect(cleared).not.toMatch(/Domain=/i);
    },
  );

  it.each([
    "evil.example",
    "todos.theafoundry.com.evil.example",
    "www.planwren.com.evil.example",
    "evil@www.planwren.com",
    "www.planwren.com:8443",
    "todos.thealabs.dev",
  ])(
    "rejects unapproved authority %s before setting state or exchanging",
    async (host) => {
      const { app, google, social } = fixture();
      for (const path of [
        "/auth/google/start",
        `/auth/google/callback?state=${STATE}&code=isolated-code`,
      ]) {
        const response = await request(app)
          .get(path)
          .set("Host", host)
          .set("X-Forwarded-Proto", "https")
          .set("Cookie", COOKIE)
          .expect(400);
        expect(response.headers.location).toBeUndefined();
        expect(cookies(response)).toEqual([]);
      }
      expect(google.generateAuthUrl).not.toHaveBeenCalled();
      expect(google.handleCallback).not.toHaveBeenCalled();
      expect(social.findOrCreateSocialUser).not.toHaveBeenCalled();
    },
  );

  it("does not trust forwarded hosts or a caller-provided callback", async () => {
    const { app, google } = fixture();
    const response = await request(app)
      .get(
        "/auth/google/start?redirect_uri=https%3A%2F%2Fevil.example%2Fcallback",
      )
      .set("Host", CANONICAL_HOST)
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "evil.example")
      .expect(302);
    expect(
      new URL(response.headers.location).searchParams.get("redirect_uri"),
    ).toBe(`https://${CANONICAL_HOST}/auth/google/callback`);
    expect(google.generateAuthUrl).toHaveBeenCalledTimes(1);
    await request(app)
      .get("/auth/google/start")
      .set("Host", "evil.example")
      .set("X-Forwarded-Host", WWW_HOST)
      .set("X-Forwarded-Proto", "https")
      .expect(400);
    expect(google.generateAuthUrl).toHaveBeenCalledTimes(1);
  });

  it("rejects plaintext production initiation", async () => {
    const { app, google } = fixture();
    await request(app)
      .get("/auth/google/start")
      .set("Host", WWW_HOST)
      .expect(400);
    expect(google.generateAuthUrl).not.toHaveBeenCalled();
  });

  it("normalizes case and the standard HTTPS port to the fixed origin", async () => {
    const { app, google } = fixture();
    await request(app)
      .get("/auth/google/start")
      .set("Host", "WWW.PLANWREN.COM:443")
      .set("X-Forwarded-Proto", "https")
      .expect(302);
    expect(google.generateAuthUrl).toHaveBeenCalledWith(
      `https://${WWW_HOST}/auth/google/callback`,
    );
  });

  it.each([
    ["", COOKIE],
    [`state=${STATE}`, ""],
    ["state=wrong-state", COOKIE],
    [`state=${STATE}&state=second-state`, COOKIE],
  ])(
    "rejects missing, mismatched or repeated state (%s) before user operations",
    async (query, cookie) => {
      const { app, google, social } = fixture();
      const response = await request(app)
        .get(`/auth/google/callback?${query}&code=isolated-code`)
        .set("Host", WWW_HOST)
        .set("X-Forwarded-Proto", "https")
        .set("Cookie", cookie)
        .expect(302);
      expect(
        new URL(
          response.headers.location,
          `https://${WWW_HOST}`,
        ).searchParams.get("auth"),
      ).toBe("error");
      expect(google.handleCallback).not.toHaveBeenCalled();
      expect(social.findOrCreateSocialUser).not.toHaveBeenCalled();
    },
  );

  it.each(["", "code=one&code=two"])(
    "rejects missing or repeated code (%s) before exchange",
    async (query) => {
      const { app, google, social } = fixture();
      await request(app)
        .get(`/auth/google/callback?state=${STATE}&${query}`)
        .set("Host", WWW_HOST)
        .set("X-Forwarded-Proto", "https")
        .set("Cookie", COOKIE)
        .expect(302);
      expect(google.handleCallback).not.toHaveBeenCalled();
      expect(social.findOrCreateSocialUser).not.toHaveBeenCalled();
    },
  );

  it("accepts a permitted same-origin destination and keeps success local", async () => {
    const { app } = fixture();
    const next = `https://${WWW_HOST}/app?view=today#plan`;
    const start = await request(app)
      .get(`/auth/google/start?next=${encodeURIComponent(next)}`)
      .set("Host", WWW_HOST)
      .set("X-Forwarded-Proto", "https")
      .expect(302);
    expect(
      cookies(start).some((v) =>
        v.startsWith("post_auth_redirect=%2Fapp%3Fview%3Dtoday%23plan;"),
      ),
    ).toBe(true);
    const result = await request(app)
      .get(`/auth/google/callback?state=${STATE}&code=isolated-code`)
      .set("Host", WWW_HOST)
      .set("X-Forwarded-Proto", "https")
      .set(
        "Cookie",
        `${COOKIE}; post_auth_redirect=${encodeURIComponent(next)}`,
      )
      .expect(302);
    const location = new URL(result.headers.location, `https://${WWW_HOST}`);
    expect(location.origin).toBe(`https://${WWW_HOST}`);
    expect(location.searchParams.get("next")).toBe("/app?view=today#plan");
  });

  it.each([
    "https://evil.example/app",
    "//evil.example/app",
    `https://${CANONICAL_HOST}/app`,
    "/oauth/token",
    "/app-evil",
  ])(
    "drops unapproved post-auth destination %s on start and callback",
    async (next) => {
      const { app } = fixture();
      const start = await request(app)
        .get(`/auth/google/start?next=${encodeURIComponent(next)}`)
        .set("Host", WWW_HOST)
        .set("X-Forwarded-Proto", "https")
        .expect(302);
      expect(
        cookies(start).find((v) => v.startsWith("post_auth_redirect=")),
      ).toContain("Expires=Thu, 01 Jan 1970");
      const result = await request(app)
        .get(`/auth/google/callback?state=${STATE}&code=isolated-code`)
        .set("Host", WWW_HOST)
        .set("X-Forwarded-Proto", "https")
        .set(
          "Cookie",
          `${COOKIE}; post_auth_redirect=${encodeURIComponent(next)}`,
        )
        .expect(302);
      const location = new URL(result.headers.location, `https://${WWW_HOST}`);
      expect(location.origin).toBe(`https://${WWW_HOST}`);
      expect(location.searchParams.has("next")).toBe(false);
    },
  );

  it("retains CLI loopback completion with the canonical provider callback", async () => {
    const { app, google } = fixture();
    const start = await request(app)
      .get("/auth/cli/google?port=54321")
      .set("Host", CANONICAL_HOST)
      .set("X-Forwarded-Proto", "https")
      .expect(302);
    expect(
      new URL(start.headers.location).searchParams.get("redirect_uri"),
    ).toBe(`https://${CANONICAL_HOST}/auth/google/callback`);
    const result = await request(app)
      .get(`/auth/google/callback?state=${STATE}&code=isolated-code`)
      .set("Host", CANONICAL_HOST)
      .set("X-Forwarded-Proto", "https")
      .set("Cookie", `${COOKIE}; cli_port=54321`)
      .expect(302);
    expect(google.handleCallback).toHaveBeenCalledWith(
      "isolated-code",
      `https://${CANONICAL_HOST}/auth/google/callback`,
    );
    expect(new URL(result.headers.location).origin).toBe(
      "http://127.0.0.1:54321",
    );
  });

  it("clears a stale CLI destination when starting a web login", async () => {
    const { app } = fixture();
    const response = await request(app)
      .get("/auth/google/start")
      .set("Host", WWW_HOST)
      .set("X-Forwarded-Proto", "https")
      .set("Cookie", "cli_port=54321")
      .expect(302);
    expect(cookies(response).find((v) => v.startsWith("cli_port="))).toContain(
      "Expires=Thu, 01 Jan 1970",
    );
  });

  it("retains the explicitly configured development callback", async () => {
    config.nodeEnv = "development";
    config.googleRedirectUri = "http://localhost:3000/auth/google/callback";
    const { app, google } = fixture();
    await request(app)
      .get("/auth/google/start")
      .set("Host", "localhost:3000")
      .expect(302);
    expect(google.generateAuthUrl).toHaveBeenCalledWith(
      config.googleRedirectUri,
    );
    await request(app)
      .get("/auth/google/start")
      .set("Host", "evil.example")
      .expect(400);
    expect(google.generateAuthUrl).toHaveBeenCalledTimes(1);
  });

  it("preserves disabled-provider behavior", async () => {
    config.googleLoginEnabled = false;
    const { app, google } = fixture();
    await request(app)
      .get("/auth/google/start")
      .set("Host", WWW_HOST)
      .set("X-Forwarded-Proto", "https")
      .expect(404);
    expect(google.generateAuthUrl).not.toHaveBeenCalled();
  });
});
