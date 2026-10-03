import { randomBytes } from "crypto";
import { OAuth2Client } from "google-auth-library";
import { GoogleAuthService } from "./services/googleAuthService";

const clientId = "google-client-for-unit-tests";
const clientSecret = "fake-google-secret-for-unit-tests";
const defaultCallback = "https://todos.theafoundry.com/auth/google/callback";

jest.mock("./config", () => ({
  config: {
    googleClientId: "google-client-for-unit-tests",
    googleClientSecret: "fake-google-secret-for-unit-tests",
    googleRedirectUri: "https://todos.theafoundry.com/auth/google/callback",
  },
}));

jest.mock("google-auth-library", () => ({ OAuth2Client: jest.fn() }));
jest.mock("crypto", () => ({
  ...jest.requireActual("crypto"),
  randomBytes: jest.fn(jest.requireActual("crypto").randomBytes),
}));

interface MockGoogleClient {
  generateAuthUrl: jest.Mock;
  getToken: jest.Mock;
  verifyIdToken: jest.Mock;
}

describe("GoogleAuthService", () => {
  const constructor = OAuth2Client as unknown as jest.Mock;
  let clients: MockGoogleClient[];
  let payload: Record<string, unknown> | null | undefined;
  let service: GoogleAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    clients = [];
    payload = {
      iss: "https://accounts.google.com",
      sub: "google-subject",
      email: "unit-test@example.test",
      email_verified: true,
      name: "Unit Test",
    };
    constructor.mockImplementation(
      (_id: string, _secret: string, callback: string) => {
        const client: MockGoogleClient = {
          generateAuthUrl: jest.fn((options) => {
            const query = new URLSearchParams({
              state: options.state,
              redirect_uri: options.redirect_uri || callback,
            });
            return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
          }),
          getToken: jest.fn().mockResolvedValue({
            tokens: { id_token: "unit-test-google-id-token" },
          }),
          verifyIdToken: jest.fn().mockResolvedValue({
            getPayload: () => payload,
          }),
        };
        clients.push(client);
        return client;
      },
    );
    service = new GoogleAuthService();
  });

  test("generates fresh cryptographic state and preserves identity scopes", () => {
    const first = service.generateAuthUrl();
    const second = service.generateAuthUrl();

    expect(randomBytes).toHaveBeenNthCalledWith(1, 32);
    expect(randomBytes).toHaveBeenNthCalledWith(2, 32);
    expect(first.state).toMatch(/^[a-f0-9]{64}$/);
    expect(second.state).toMatch(/^[a-f0-9]{64}$/);
    expect(second.state).not.toBe(first.state);
    expect(clients[0].generateAuthUrl).toHaveBeenCalledWith({
      access_type: "offline",
      scope: ["openid", "email", "profile"],
      state: first.state,
      prompt: "select_account",
    });
    const url = new URL(first.url);
    expect(url.searchParams.get("state")).toBe(first.state);
    expect(url.searchParams.get("redirect_uri")).toBe(defaultCallback);
  });

  test.each([
    "https://todos.theafoundry.com/auth/google/callback",
    "https://www.planwren.com/auth/google/callback",
    "https://todos.theafoundry.com/oauth/authorize/google/callback",
  ])(
    "uses the same override for authorization and exchange: %s",
    async (callback) => {
      const authorization = service.generateAuthUrl(callback);
      await service.handleCallback("unit-test-authorization-code", callback);

      expect(clients[0].generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          redirect_uri: callback,
          state: authorization.state,
          scope: ["openid", "email", "profile"],
        }),
      );
      expect(new URL(authorization.url).searchParams.get("redirect_uri")).toBe(
        callback,
      );
      expect(constructor).toHaveBeenNthCalledWith(
        2,
        clientId,
        clientSecret,
        callback,
      );
      expect(clients[0].getToken).not.toHaveBeenCalled();
      expect(clients[1].getToken).toHaveBeenCalledWith(
        "unit-test-authorization-code",
      );
      expect(clients[1].verifyIdToken).toHaveBeenCalledWith({
        idToken: "unit-test-google-id-token",
        audience: clientId,
      });
    },
  );

  test("retains the configured client for callers without a callback override", async () => {
    await expect(service.handleCallback("unit-test-code")).resolves.toEqual({
      provider: "google",
      providerSubject: "google-subject",
      email: "unit-test@example.test",
      emailVerified: true,
      name: "Unit Test",
    });
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(constructor).toHaveBeenCalledWith(
      clientId,
      clientSecret,
      defaultCallback,
    );
    expect(clients[0].getToken).toHaveBeenCalledWith("unit-test-code");
    expect(clients[0].verifyIdToken).toHaveBeenCalledWith({
      idToken: "unit-test-google-id-token",
      audience: clientId,
    });
  });

  test("requires an ID token before trusting a Google response", async () => {
    clients[0].getToken.mockResolvedValueOnce({
      tokens: { access_token: "unit-test-access-token-only" },
    });
    await expect(service.handleCallback("unit-test-code")).rejects.toThrow(
      "Google did not return an ID token",
    );
    expect(clients[0].verifyIdToken).not.toHaveBeenCalled();
  });

  test("propagates audience or signature verification failure", async () => {
    clients[0].verifyIdToken.mockRejectedValueOnce(
      new Error("Wrong recipient, payload audience != required audience"),
    );
    await expect(service.handleCallback("unit-test-code")).rejects.toThrow(
      "Wrong recipient",
    );
    expect(clients[0].verifyIdToken).toHaveBeenCalledWith({
      idToken: "unit-test-google-id-token",
      audience: clientId,
    });
  });

  test.each(["accounts.google.com", "https://accounts.google.com"])(
    "accepts only the supported Google issuer form %s",
    async (issuer) => {
      payload!.iss = issuer;
      await expect(service.handleCallback("unit-test-code")).resolves.toEqual(
        expect.objectContaining({ providerSubject: "google-subject" }),
      );
    },
  );

  test.each([
    "https://accounts.google.com.attacker.test",
    "https://attacker.test",
    undefined,
  ])("rejects an invalid issuer %s", async (issuer) => {
    payload!.iss = issuer;
    await expect(service.handleCallback("unit-test-code")).rejects.toThrow(
      "Invalid Google ID token issuer",
    );
  });

  test.each([null, undefined, {}, { sub: "" }])(
    "rejects a missing payload or subject: %p",
    async (invalidPayload) => {
      payload = invalidPayload;
      await expect(service.handleCallback("unit-test-code")).rejects.toThrow(
        "Invalid Google ID token payload",
      );
    },
  );

  test("does not promote unverified or missing profile claims", async () => {
    payload = {
      iss: "https://accounts.google.com",
      sub: "google-subject",
      email_verified: "true",
    };
    await expect(service.handleCallback("unit-test-code")).resolves.toEqual({
      provider: "google",
      providerSubject: "google-subject",
      email: null,
      emailVerified: false,
      name: null,
    });
  });
});
