import { randomBytes, randomUUID } from "crypto";
import { Request, Response, Router } from "express";
import { AuthService } from "../services/authService";
import { McpOAuthService } from "../services/mcpOAuthService";
import { McpClientService } from "../services/mcpClientService";
import {
  renderOAuthConsentPage,
  renderOAuthErrorPage,
  renderOAuthLoginPage,
  renderOAuthRedirectPage,
  renderOAuthRegisterPage,
} from "../mcp/mcpOAuthPages";
import {
  describeMcpScopes,
  validateExchangeMcpAuthorizationCodeInput,
  validateOAuthAuthorizeRequest,
  validateRegisterMcpClientInput,
  validateRevokeMcpOAuthTokenInput,
} from "../validation/mcpValidation";
import { config } from "../config";
import { validateRegister } from "../validation/authValidation";
import { GoogleAuthService } from "../services/googleAuthService";
import { SocialAuthService } from "../services/socialAuthService";
import { getMcpAppResource } from "../mcp/appContract";
import { ALL_MCP_OAUTH_SCOPES, McpOAuthScope } from "../mcp/mcpScopes";

interface McpPublicRouterDeps {
  authService?: AuthService;
  mcpOAuthService: McpOAuthService;
  mcpClientService: McpClientService;
  googleAuthService?: GoogleAuthService;
  socialAuthService?: SocialAuthService;
}

interface LinkSession {
  token: string;
  userId: string;
  email: string;
}

function buildRequestId(req: Request): string {
  const headerId =
    req.header("x-request-id") ||
    req.header("x-mcp-request-id") ||
    req.header("x-agent-request-id");
  return typeof headerId === "string" && headerId.trim()
    ? headerId.trim()
    : randomUUID();
}

function readCookies(req: Request): Record<string, string> {
  const rawCookie = req.header("cookie");
  if (!rawCookie) {
    return {};
  }

  return rawCookie
    .split(";")
    .reduce<Record<string, string>>((cookies, part) => {
      const [name, ...rest] = part.split("=");
      if (!name || rest.length === 0) {
        return cookies;
      }
      cookies[name.trim()] = decodeURIComponent(rest.join("=").trim());
      return cookies;
    }, {});
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAgeSeconds?: number;
    expires?: string;
  } = {},
) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/oauth",
    "HttpOnly",
    "SameSite=Lax",
    config.nodeEnv === "production" ? "Secure" : "",
  ].filter(Boolean);

  if (typeof options.maxAgeSeconds === "number") {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires}`);
  }

  return parts.join("; ");
}

function appendQuery(url: string, params: Record<string, string | undefined>) {
  const nextUrl = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 0) {
      nextUrl.searchParams.set(key, value);
    }
  }
  return nextUrl.toString();
}

function buildAuthorizeSearchParams(input: {
  clientId: string;
  redirectUri: string;
  responseType: "code";
  scope: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource?: string;
}) {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: input.responseType,
    scope: input.scope,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod,
  });
  if (input.state) {
    params.set("state", input.state);
  }
  if (input.resource) {
    params.set("resource", input.resource);
  }
  return params.toString();
}

function buildPublicOauthUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, config.baseUrl).toString();
}

function buildOAuthHtmlCsp(options: { scriptNonce?: string } = {}): string {
  const directives = [
    "default-src 'self'",
    options.scriptNonce
      ? `script-src 'nonce-${options.scriptNonce}'`
      : "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https:",
    `form-action 'self' ${new URL(config.baseUrl).origin}`,
  ];
  return directives.join("; ");
}

function setOAuthHtmlCsp(
  res: Response,
  options: { scriptNonce?: string } = {},
) {
  res.setHeader("Content-Security-Policy", buildOAuthHtmlCsp(options));
}

function setRequestId(res: Response, requestId: string) {
  res.setHeader("x-request-id", requestId);
}

function setNoStoreHeaders(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function requestsVerifiedEmail(scopes: readonly McpOAuthScope[]): boolean {
  return scopes.includes("email");
}

async function assertIdentityScopeEligibility(input: {
  authService: AuthService;
  userId: string;
  scopes: readonly McpOAuthScope[];
}) {
  const user = await input.authService.getUserById(input.userId);
  if (!user) {
    throw new Error("Linked user account no longer exists");
  }
  if (
    requestsVerifiedEmail(input.scopes) &&
    (!user.email || !user.isVerified)
  ) {
    throw new Error("Verified email required");
  }
  return user;
}

function readBearerToken(req: Request): string | undefined {
  const authorization = req.header("authorization");
  if (!authorization) {
    return undefined;
  }
  const match = /^Bearer ([^\s]+)$/i.exec(authorization.trim());
  return match?.[1];
}

function setUserInfoChallenge(
  res: Response,
  input: {
    error: "invalid_token" | "insufficient_scope";
    description: string;
    scopes?: string[];
  },
) {
  const parts = [
    'Bearer realm="todos-api-userinfo"',
    `error="${input.error}"`,
    `error_description="${input.description.replace(/"/g, "")}"`,
  ];
  if (input.scopes?.length) {
    parts.push(`scope="${input.scopes.join(" ")}"`);
  }
  res.setHeader("WWW-Authenticate", parts.join(", "));
}

function resolveLinkSession(
  req: Request,
  authService?: AuthService,
): LinkSession | null {
  if (!authService) {
    return null;
  }

  const cookieToken = readCookies(req)[config.mcpOauthSessionCookieName];
  if (!cookieToken) {
    return null;
  }

  try {
    const payload = authService.verifyToken(cookieToken);
    return {
      token: cookieToken,
      userId: payload.userId,
      email: payload.email,
    };
  } catch (_error) {
    return null;
  }
}

function clearLinkSession(res: Response) {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(config.mcpOauthSessionCookieName, "", {
      expires: new Date(0).toUTCString(),
      maxAgeSeconds: 0,
    }),
  );
}

function setLinkSession(res: Response, token: string) {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(config.mcpOauthSessionCookieName, token, {
      maxAgeSeconds: Math.floor(config.mcpOauthSessionMaxAgeMs / 1000),
    }),
  );
}

function logMcpOauthEvent(input: {
  requestId: string;
  event:
    | "registration_success"
    | "registration_error"
    | "authorize_view"
    | "authorize_error"
    | "login_success"
    | "login_error"
    | "signup_view"
    | "signup_success"
    | "signup_error"
    | "google_start"
    | "google_callback_success"
    | "google_callback_error"
    | "approve_success"
    | "approve_error"
    | "deny"
    | "token_success"
    | "token_error"
    | "revoke_success"
    | "revoke_error";
  userId?: string;
  clientId?: string;
  clientName?: string;
  scopes?: string[];
  errorCode?: string;
}) {
  console.info(
    JSON.stringify({
      type: "assistant_mcp_oauth",
      requestId: input.requestId,
      event: input.event,
      userId: input.userId,
      clientId: input.clientId,
      clientName: input.clientName,
      scopes: input.scopes,
      errorCode: input.errorCode,
      ts: new Date().toISOString(),
    }),
  );
}

function renderRegistrationError(
  res: Response,
  req: Request,
  errorMessage: string,
  clientName?: string,
) {
  const hiddenFields = {
    client_id:
      typeof req.body.client_id === "string" ? req.body.client_id : undefined,
    redirect_uri:
      typeof req.body.redirect_uri === "string"
        ? req.body.redirect_uri
        : undefined,
    response_type:
      typeof req.body.response_type === "string"
        ? req.body.response_type
        : undefined,
    scope: typeof req.body.scope === "string" ? req.body.scope : undefined,
    state: typeof req.body.state === "string" ? req.body.state : undefined,
    code_challenge:
      typeof req.body.code_challenge === "string"
        ? req.body.code_challenge
        : undefined,
    code_challenge_method:
      typeof req.body.code_challenge_method === "string"
        ? req.body.code_challenge_method
        : undefined,
    resource:
      typeof req.body.resource === "string" ? req.body.resource : undefined,
  };
  setOAuthHtmlCsp(res);
  return res.status(200).send(
    renderOAuthRegisterPage({
      error: errorMessage,
      formAction: buildPublicOauthUrl("/oauth/authorize/register"),
      hiddenFields,
      clientName,
    }),
  );
}

function sendOAuthTokenError(
  res: Response,
  status: number,
  input: {
    error: string;
    description: string;
    code: string;
    hint?: string;
  },
) {
  setNoStoreHeaders(res);
  return res.status(status).json({
    error: input.error,
    error_description: input.description,
    error_details: {
      code: input.code,
      message: input.description,
      retryable: false,
      ...(input.hint ? { hint: input.hint } : {}),
    },
  });
}

function mapTokenExchangeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  switch (message) {
    case "Invalid authorization code":
      return {
        status: 401,
        error: "invalid_grant",
        description: "Authorization code is invalid",
        code: "MCP_AUTH_CODE_INVALID",
        hint: "Restart the connector auth flow and try again.",
      };
    case "Authorization code expired":
      return {
        status: 401,
        error: "invalid_grant",
        description: "Authorization code expired",
        code: "MCP_AUTH_CODE_EXPIRED",
        hint: "Restart the connector auth flow and exchange the new code promptly.",
      };
    case "Authorization code already used":
      return {
        status: 409,
        error: "invalid_grant",
        description: "Authorization code already used",
        code: "MCP_AUTH_CODE_ALREADY_USED",
        hint: "Start a new auth flow to mint a fresh code.",
      };
    case "Authorization code binding mismatch":
    case "OAuth redirect URI mismatch":
      return {
        status: 401,
        error: "invalid_grant",
        description: "Authorization code binding mismatch",
        code: "MCP_AUTH_CODE_BINDING_MISMATCH",
        hint: "Retry with the same client_id and redirect_uri used during authorization.",
      };
    case "Authorization code resource mismatch":
      return {
        status: 401,
        error: "invalid_target",
        description: "Authorization code resource binding mismatch",
        code: "MCP_AUTH_CODE_RESOURCE_MISMATCH",
        hint: "Repeat the exact resource value from the authorization request.",
      };
    case "Invalid code verifier":
      return {
        status: 401,
        error: "invalid_grant",
        description: "Code verifier did not match the PKCE challenge",
        code: "MCP_INVALID_CODE_VERIFIER",
        hint: "Use the original PKCE verifier from the authorization request.",
      };
    case "Invalid refresh token":
      return {
        status: 401,
        error: "invalid_grant",
        description: "Refresh token is invalid",
        code: "MCP_REFRESH_TOKEN_INVALID",
        hint: "Start a new auth flow or use the latest refresh token.",
      };
    case "Refresh token expired":
      return {
        status: 401,
        error: "invalid_grant",
        description: "Refresh token expired",
        code: "MCP_REFRESH_TOKEN_EXPIRED",
        hint: "Restart the connector auth flow to mint a fresh token set.",
      };
    case "Refresh token already rotated":
      return {
        status: 409,
        error: "invalid_grant",
        description: "Refresh token already used",
        code: "MCP_REFRESH_TOKEN_REUSED",
        hint: "Retry with the newest refresh token returned by the prior exchange.",
      };
    case "Refresh token client mismatch":
      return {
        status: 401,
        error: "invalid_grant",
        description: "Refresh token client binding mismatch",
        code: "MCP_REFRESH_TOKEN_CLIENT_MISMATCH",
        hint: "Use the same client_id that originally received the refresh token.",
      };
    case "Refresh token resource mismatch":
      return {
        status: 401,
        error: "invalid_target",
        description: "Refresh token resource binding mismatch",
        code: "MCP_REFRESH_TOKEN_RESOURCE_MISMATCH",
        hint: "Repeat the exact resource value bound to the refresh token.",
      };
    case "Assistant session revoked":
      return {
        status: 401,
        error: "invalid_grant",
        description: "Assistant session has been revoked",
        code: "MCP_ASSISTANT_SESSION_REVOKED",
        hint: "Reconnect the assistant to mint a fresh token set.",
      };
    case "Invalid OAuth client":
    case "OAuth client expired":
      return {
        status: 401,
        error: "invalid_client",
        description: "OAuth client is invalid",
        code: "MCP_INVALID_CLIENT",
        hint: "Register the client again and retry.",
      };
    case "Linked user account no longer exists":
      return {
        status: 401,
        error: "invalid_grant",
        description: "Linked user account no longer exists",
        code: "MCP_INVALID_SESSION",
        hint: "Have the user sign in again and reconnect the assistant.",
      };
    case "Verified email required":
      return {
        status: 401,
        error: "invalid_grant",
        description:
          "The linked Planwren account needs a verified email address",
        code: "MCP_VERIFIED_EMAIL_REQUIRED",
        hint: "Verify the account email, then restart the connector auth flow.",
      };
    default:
      return {
        status: 500,
        error: "server_error",
        description: "OAuth token exchange failed",
        code: "MCP_OAUTH_TOKEN_EXCHANGE_FAILED",
        hint: "Retry the exchange. If it persists, inspect the server logs using the request ID.",
      };
  }
}

function mapAuthorizeError(message: string): {
  title: string;
  description: string;
  code: string;
} {
  switch (message) {
    case "Invalid OAuth client":
    case "OAuth client expired":
      return {
        title: "Invalid Client",
        description: "This assistant client is not registered or has expired.",
        code: "MCP_INVALID_CLIENT",
      };
    case "OAuth redirect URI mismatch":
      return {
        title: "Redirect URI Mismatch",
        description:
          "The redirect URI does not match the assistant client registration.",
        code: "MCP_REDIRECT_URI_MISMATCH",
      };
    case "Verified email required":
      return {
        title: "Verified Email Required",
        description:
          "Verify the email address on this Planwren account, then restart the connection flow.",
        code: "MCP_VERIFIED_EMAIL_REQUIRED",
      };
    default:
      return {
        title: "Authorization Error",
        description:
          message || "The assistant authorization request is invalid.",
        code: "MCP_OAUTH_AUTHORIZE_INVALID",
      };
  }
}

const MCP_GOOGLE_STATE_COOKIE = "mcp_google_state";
const MCP_GOOGLE_PARAMS_COOKIE = "mcp_google_params";

function buildMcpGoogleRedirectUri(): string {
  return `${config.baseUrl}/oauth/authorize/google/callback`;
}

export function createMcpPublicRouter({
  authService,
  mcpOAuthService,
  mcpClientService,
  googleAuthService,
  socialAuthService,
}: McpPublicRouterDeps): Router {
  const router = Router();

  const handleUserInfo = async (req: Request, res: Response) => {
    const requestId = buildRequestId(req);
    setRequestId(res, requestId);
    setNoStoreHeaders(res);

    if (!authService) {
      return res.status(501).json({
        error: "server_error",
        error_description: "Authentication not configured",
      });
    }

    const token = readBearerToken(req);
    if (!token) {
      setUserInfoChallenge(res, {
        error: "invalid_token",
        description: "A bearer access token is required",
      });
      return res.status(401).json({
        error: "invalid_token",
        error_description: "A bearer access token is required",
      });
    }

    try {
      const session = await authService.verifyMcpToken(token, {
        resource: getMcpAppResource(config.baseUrl),
        requireResource: true,
      });
      const oauthScopes = session.oauthScopes ?? session.scopes;
      const requiredScopes = ["openid", "email"] as const;
      if (requiredScopes.some((scope) => !oauthScopes.includes(scope))) {
        setUserInfoChallenge(res, {
          error: "insufficient_scope",
          description: "UserInfo requires the openid and email scopes",
          scopes: [...requiredScopes],
        });
        return res.status(403).json({
          error: "insufficient_scope",
          error_description: "UserInfo requires the openid and email scopes",
        });
      }

      const user = await assertIdentityScopeEligibility({
        authService,
        userId: session.userId,
        scopes: oauthScopes,
      });
      if (session.sessionId) {
        await mcpOAuthService.recordAssistantSessionUsage(session.sessionId);
      }

      return res.status(200).json({
        sub: user.id,
        email: user.email,
        email_verified: true,
      });
    } catch (_error) {
      setUserInfoChallenge(res, {
        error: "invalid_token",
        description: "The access token is invalid, expired, or revoked",
      });
      return res.status(401).json({
        error: "invalid_token",
        error_description: "The access token is invalid, expired, or revoked",
      });
    }
  };

  router.get("/oauth/logout", (_req, res) => {
    clearLinkSession(res);
    res.status(200).send(
      renderOAuthErrorPage({
        title: "Signed Out",
        message:
          "The local MCP linking session has been cleared on this device.",
        hint: "Disconnect active assistant sessions from the app or call POST /oauth/revoke to revoke issued MCP tokens.",
      }),
    );
  });

  router.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.status(200).json({
      resource: `${config.baseUrl}/mcp`,
      authorization_servers: [config.baseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: [
        "tasks.read",
        "tasks.write",
        "projects.read",
        "projects.write",
      ],
    });
  });

  router.get("/.well-known/oauth-protected-resource/mcp/app", (_req, res) => {
    res.status(200).json({
      resource: getMcpAppResource(config.baseUrl),
      authorization_servers: [config.baseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: ["tasks.read", "tasks.write", "projects.read"],
    });
  });

  router.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.status(200).json({
      issuer: config.baseUrl,
      authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
      token_endpoint: `${config.baseUrl}/oauth/token`,
      revocation_endpoint: `${config.baseUrl}/oauth/revoke`,
      registration_endpoint: `${config.baseUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ALL_MCP_OAUTH_SCOPES,
    });
  });

  router.get("/.well-known/openid-configuration", (_req, res) => {
    res.status(200).json({
      issuer: config.baseUrl,
      authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
      token_endpoint: `${config.baseUrl}/oauth/token`,
      userinfo_endpoint: `${config.baseUrl}/oauth/userinfo`,
      revocation_endpoint: `${config.baseUrl}/oauth/revoke`,
      registration_endpoint: `${config.baseUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ALL_MCP_OAUTH_SCOPES,
      claims_supported: ["sub", "email", "email_verified"],
    });
  });

  router.get("/oauth/userinfo", handleUserInfo);
  router.post("/oauth/userinfo", handleUserInfo);

  router.post("/oauth/register", (req, res) => {
    const requestId = buildRequestId(req);
    setRequestId(res, requestId);
    setNoStoreHeaders(res);

    try {
      const input = validateRegisterMcpClientInput(req.body);
      const registeredClient = mcpClientService.registerClient(input);

      logMcpOauthEvent({
        requestId,
        event: "registration_success",
        clientId: registeredClient.clientId,
        clientName: registeredClient.clientName,
      });

      res.status(201).json({
        client_id: registeredClient.clientId,
        client_id_issued_at: registeredClient.clientIdIssuedAt,
        redirect_uris: registeredClient.redirectUris,
        grant_types: registeredClient.grantTypes,
        response_types: registeredClient.responseTypes,
        token_endpoint_auth_method: registeredClient.tokenEndpointAuthMethod,
        ...(registeredClient.clientName
          ? { client_name: registeredClient.clientName }
          : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid client";
      const mapped = mapAuthorizeError(message);
      logMcpOauthEvent({
        requestId,
        event: "registration_error",
        errorCode: mapped.code,
      });
      sendOAuthTokenError(res, 400, {
        error: "invalid_client_metadata",
        description: mapped.description,
        code: mapped.code,
      });
    }
  });

  router.get("/oauth/authorize", async (req, res) => {
    const requestId = buildRequestId(req);
    setRequestId(res, requestId);
    setNoStoreHeaders(res);

    try {
      if (!authService) {
        logMcpOauthEvent({
          requestId,
          event: "authorize_error",
          errorCode: "MCP_NOT_CONFIGURED",
        });
        return res.status(501).send(
          renderOAuthErrorPage({
            title: "MCP Not Configured",
            message: "Authentication is not configured on this server.",
          }),
        );
      }

      const authorize = validateOAuthAuthorizeRequest(req.query);
      const client = mcpClientService.assertRedirectUri(
        authorize.clientId,
        authorize.redirectUri,
      );
      const scopeString = describeMcpScopes(authorize.scopes);
      const hiddenFields = {
        client_id: authorize.clientId,
        redirect_uri: authorize.redirectUri,
        response_type: authorize.responseType,
        scope: scopeString,
        state: authorize.state,
        code_challenge: authorize.codeChallenge,
        code_challenge_method: authorize.codeChallengeMethod,
        resource: authorize.resource,
      };

      const linkSession = resolveLinkSession(req, authService);
      if (!linkSession) {
        logMcpOauthEvent({
          requestId,
          event: "authorize_view",
          clientId: authorize.clientId,
          clientName: client.clientName,
          scopes: authorize.scopes,
        });
        const authorizeSearchParams = buildAuthorizeSearchParams({
          clientId: authorize.clientId,
          redirectUri: authorize.redirectUri,
          responseType: authorize.responseType,
          scope: describeMcpScopes(authorize.scopes),
          state: authorize.state,
          codeChallenge: authorize.codeChallenge,
          codeChallengeMethod: authorize.codeChallengeMethod,
          resource: authorize.resource,
        });
        const registerUrl = buildPublicOauthUrl(
          `/oauth/authorize/register?${authorizeSearchParams}`,
        );
        const googleUrl = googleAuthService
          ? buildPublicOauthUrl(
              `/oauth/authorize/google/start?${authorizeSearchParams}`,
            )
          : undefined;
        setOAuthHtmlCsp(res);
        return res.status(200).send(
          renderOAuthLoginPage({
            formAction: buildPublicOauthUrl("/oauth/authorize/login"),
            hiddenFields,
            clientName: client.clientName,
            registerUrl,
            googleUrl,
          }),
        );
      }

      logMcpOauthEvent({
        requestId,
        event: "authorize_view",
        userId: linkSession.userId,
        clientId: authorize.clientId,
        clientName: client.clientName,
        scopes: authorize.scopes,
      });
      setOAuthHtmlCsp(res);
      res.status(200).send(
        renderOAuthConsentPage({
          clientName: client.clientName,
          userEmail: linkSession.email,
          scopes: authorize.scopes,
          formAction: buildPublicOauthUrl("/oauth/authorize/decision"),
          hiddenFields,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const mapped = mapAuthorizeError(message);
      logMcpOauthEvent({
        requestId,
        event: "authorize_error",
        errorCode: mapped.code,
      });
      res.status(400).send(
        renderOAuthErrorPage({
          title: mapped.title,
          message: mapped.description,
        }),
      );
    }
  });

  router.post("/oauth/authorize/login", async (req, res) => {
    const requestId = buildRequestId(req);
    setRequestId(res, requestId);
    setNoStoreHeaders(res);

    try {
      if (!authService) {
        throw new Error("Authentication not configured");
      }

      const authorize = validateOAuthAuthorizeRequest(req.body);
      const client = mcpClientService.assertRedirectUri(
        authorize.clientId,
        authorize.redirectUri,
      );
      const login = await authService.login({
        email: String(req.body.email || "")
          .trim()
          .toLowerCase(),
        password: String(req.body.password || ""),
      });

      setLinkSession(res, login.token);
      logMcpOauthEvent({
        requestId,
        event: "login_success",
        userId: login.user.id,
        clientId: authorize.clientId,
        clientName: client.clientName,
        scopes: authorize.scopes,
      });

      res.redirect(
        303,
        `/oauth/authorize?${buildAuthorizeSearchParams({
          clientId: authorize.clientId,
          redirectUri: authorize.redirectUri,
          responseType: authorize.responseType,
          scope: describeMcpScopes(authorize.scopes),
          state: authorize.state,
          codeChallenge: authorize.codeChallenge,
          codeChallengeMethod: authorize.codeChallengeMethod,
          resource: authorize.resource,
        })}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to sign in";
      let mappedMessage = "Unable to sign in";
      if (
        message === "Invalid credentials" ||
        message === "Invalid token" ||
        message === "Token expired"
      ) {
        mappedMessage = "Email or password was incorrect.";
      } else if (message === "Authentication not configured") {
        mappedMessage = "Authentication is not configured on this server.";
      }

      const clientName =
        typeof req.body.client_id === "string"
          ? (() => {
              try {
                return mcpClientService.resolveClient(req.body.client_id)
                  .clientName;
              } catch (_error) {
                return undefined;
              }
            })()
          : undefined;

      logMcpOauthEvent({
        requestId,
        event: "login_error",
        clientId:
          typeof req.body.client_id === "string"
            ? req.body.client_id
            : undefined,
        clientName,
        errorCode: "MCP_OAUTH_LOGIN_FAILED",
      });

      setOAuthHtmlCsp(res);
      res.status(401).send(
        renderOAuthLoginPage({
          error: mappedMessage,
          formAction: buildPublicOauthUrl("/oauth/authorize/login"),
          hiddenFields: {
            client_id:
              typeof req.body.client_id === "string"
                ? req.body.client_id
                : undefined,
            redirect_uri:
              typeof req.body.redirect_uri === "string"
                ? req.body.redirect_uri
                : undefined,
            response_type:
              typeof req.body.response_type === "string"
                ? req.body.response_type
                : undefined,
            scope:
              typeof req.body.scope === "string" ? req.body.scope : undefined,
            state:
              typeof req.body.state === "string" ? req.body.state : undefined,
            code_challenge:
              typeof req.body.code_challenge === "string"
                ? req.body.code_challenge
                : undefined,
            code_challenge_method:
              typeof req.body.code_challenge_method === "string"
                ? req.body.code_challenge_method
                : undefined,
            resource:
              typeof req.body.resource === "string"
                ? req.body.resource
                : undefined,
          },
          clientName,
        }),
      );
    }
  });

  router.get("/oauth/authorize/register", async (req, res) => {
    const requestId = buildRequestId(req);
    setRequestId(res, requestId);
    setNoStoreHeaders(res);

    try {
      if (!authService) {
        return res.status(501).send(
          renderOAuthErrorPage({
            title: "MCP Not Configured",
            message: "Authentication is not configured on this server.",
          }),
        );
      }

      const authorize = validateOAuthAuthorizeRequest(req.query);
      const client = mcpClientService.assertRedirectUri(
        authorize.clientId,
        authorize.redirectUri,
      );
      const scopeString = describeMcpScopes(authorize.scopes);
      const hiddenFields = {
        client_id: authorize.clientId,
        redirect_uri: authorize.redirectUri,
        response_type: authorize.responseType,
        scope: scopeString,
        state: authorize.state,
        code_challenge: authorize.codeChallenge,
        code_challenge_method: authorize.codeChallengeMethod,
        resource: authorize.resource,
      };

      const regAuthorizeSearchParams = buildAuthorizeSearchParams({
        clientId: authorize.clientId,
        redirectUri: authorize.redirectUri,
        responseType: authorize.responseType,
        scope: scopeString,
        state: authorize.state,
        codeChallenge: authorize.codeChallenge,
        codeChallengeMethod: authorize.codeChallengeMethod,
        resource: authorize.resource,
      });
      const loginUrl = buildPublicOauthUrl(
        `/oauth/authorize?${regAuthorizeSearchParams}`,
      );
      const googleRegUrl = googleAuthService
        ? buildPublicOauthUrl(
            `/oauth/authorize/google/start?${regAuthorizeSearchParams}`,
          )
        : undefined;

      logMcpOauthEvent({
        requestId,
        event: "signup_view",
        clientId: authorize.clientId,
        clientName: client.clientName,
        scopes: authorize.scopes,
      });

      setOAuthHtmlCsp(res);
      res.status(200).send(
        renderOAuthRegisterPage({
          formAction: buildPublicOauthUrl("/oauth/authorize/register"),
          hiddenFields,
          clientName: client.clientName,
          loginUrl,
          googleUrl: googleRegUrl,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const mapped = mapAuthorizeError(message);
      logMcpOauthEvent({
        requestId,
        event: "signup_error",
        errorCode: mapped.code,
      });
      res.status(400).send(
        renderOAuthErrorPage({
          title: mapped.title,
          message: mapped.description,
        }),
      );
    }
  });

  router.post("/oauth/authorize/register", async (req, res) => {
    const requestId = buildRequestId(req);
    setRequestId(res, requestId);
    setNoStoreHeaders(res);

    try {
      if (!authService) {
        throw new Error("Authentication not configured");
      }

      const authorize = validateOAuthAuthorizeRequest(req.body);
      const client = mcpClientService.assertRedirectUri(
        authorize.clientId,
        authorize.redirectUri,
      );
      const scopeString = describeMcpScopes(authorize.scopes);

      // Validate registration input
      const validation = validateRegister({
        name: req.body.name,
        email: req.body.email,
        password: req.body.password,
      });

      if (!validation.valid || !validation.dto) {
        const errorMessage = validation.errors.map((e) => e.message).join(". ");
        return renderRegistrationError(
          res,
          req,
          errorMessage,
          client.clientName,
        );
      }

      // Create the user account (reuses authService.register logic)
      let registeredUser: { id: string; email: string | null };
      try {
        const result = await authService.register(validation.dto);
        registeredUser = result.user;
      } catch (regError) {
        const regMessage =
          regError instanceof Error ? regError.message : "Registration failed";
        const displayMessage =
          regMessage === "Email already registered"
            ? "An account with this email already exists"
            : regMessage;
        return renderRegistrationError(
          res,
          req,
          displayMessage,
          client.clientName,
        );
      }

      await assertIdentityScopeEligibility({
        authService,
        userId: registeredUser.id,
        scopes: authorize.scopes,
      });

      // Issue authorization code for the newly registered user
      const authCode = await mcpOAuthService.createAuthorizationCode({
        userId: registeredUser.id,
        email: registeredUser.email || validation.dto.email,
        clientId: authorize.clientId,
        redirectUri: authorize.redirectUri,
        scopes: authorize.scopes,
        assistantName: client.clientName,
        state: authorize.state,
        codeChallenge: authorize.codeChallenge,
        codeChallengeMethod: authorize.codeChallengeMethod,
        resource: authorize.resource,
      });

      logMcpOauthEvent({
        requestId,
        event: "signup_success",
        userId: registeredUser.id,
        clientId: authorize.clientId,
        clientName: client.clientName,
        scopes: authorize.scopes,
      });

      const finalRedirectUri = appendQuery(authorize.redirectUri, {
        code: authCode.code,
        state: authorize.state,
      });
      const nonce = randomBytes(16).toString("base64");
      res
        .status(303)
        .setHeader("Location", finalRedirectUri)
        .setHeader(
          "Content-Security-Policy",
          buildOAuthHtmlCsp({ scriptNonce: nonce }),
        )
        .send(
          renderOAuthRedirectPage({ redirectUri: finalRedirectUri, nonce }),
        );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const mapped = mapAuthorizeError(message);
      logMcpOauthEvent({
        requestId,
        event: "signup_error",
        errorCode: mapped.code,
      });
      res.status(400).send(
        renderOAuthErrorPage({
          title: mapped.title,
          message: mapped.description,
        }),
      );
    }
  });

  // ── Google OAuth flow for MCP authorize ─────────────────────────────

  router.get("/oauth/authorize/google/start", async (req, res) => {
    const requestId = buildRequestId(req);
    setRequestId(res, requestId);
    setNoStoreHeaders(res);

    try {
      if (!googleAuthService || !authService) {
        return res.status(501).send(
          renderOAuthErrorPage({
            title: "Google Login Not Available",
            message: "Google login is not configured on this server.",
          }),
        );
      }

      const authorize = validateOAuthAuthorizeRequest(req.query);
      mcpClientService.assertRedirectUri(
        authorize.clientId,
        authorize.redirectUri,
      );

      const mcpGoogleRedirectUri = buildMcpGoogleRedirectUri();
      const { url, state } =
        googleAuthService.generateAuthUrl(mcpGoogleRedirectUri);

      // Store the Google CSRF state in a cookie
      const cookies: string[] = [];
      cookies.push(
        serializeCookie(MCP_GOOGLE_STATE_COOKIE, state, {
          maxAgeSeconds: 600,
        }),
      );

      // Store the MCP OAuth params so we can resume after Google callback
      const oauthParams = JSON.stringify({
        client_id: authorize.clientId,
        redirect_uri: authorize.redirectUri,
        response_type: authorize.responseType,
        scope: describeMcpScopes(authorize.scopes),
        state: authorize.state,
        code_challenge: authorize.codeChallenge,
        code_challenge_method: authorize.codeChallengeMethod,
        resource: authorize.resource,
      });
      cookies.push(
        serializeCookie(MCP_GOOGLE_PARAMS_COOKIE, oauthParams, {
          maxAgeSeconds: 600,
        }),
      );

      res.setHeader("Set-Cookie", cookies);

      logMcpOauthEvent({
        requestId,
        event: "google_start",
        clientId: authorize.clientId,
      });

      res.redirect(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const mapped = mapAuthorizeError(message);
      logMcpOauthEvent({
        requestId,
        event: "google_callback_error",
        errorCode: mapped.code,
      });
      res.status(400).send(
        renderOAuthErrorPage({
          title: mapped.title,
          message: mapped.description,
        }),
      );
    }
  });

  router.get("/oauth/authorize/google/callback", async (req, res) => {
    const requestId = buildRequestId(req);
    setRequestId(res, requestId);
    setNoStoreHeaders(res);

    try {
      if (!googleAuthService || !socialAuthService || !authService) {
        return res.status(501).send(
          renderOAuthErrorPage({
            title: "Google Login Not Available",
            message: "Google login is not configured on this server.",
          }),
        );
      }

      const cookies = readCookies(req);

      // Validate CSRF state
      const queryState = req.query.state as string | undefined;
      const storedState = cookies[MCP_GOOGLE_STATE_COOKIE];
      if (!queryState || !storedState || queryState !== storedState) {
        return res.status(400).send(
          renderOAuthErrorPage({
            title: "Invalid State",
            message: "OAuth state mismatch. Please try again.",
            hint: "Return to the assistant and restart the connection flow.",
          }),
        );
      }

      // Recover MCP OAuth params
      const rawParams = cookies[MCP_GOOGLE_PARAMS_COOKIE];
      if (!rawParams) {
        return res.status(400).send(
          renderOAuthErrorPage({
            title: "Session Expired",
            message:
              "The authorization session could not be recovered. Please try again.",
            hint: "Return to the assistant and restart the connection flow.",
          }),
        );
      }

      let oauthParams: Record<string, string>;
      try {
        oauthParams = JSON.parse(rawParams);
      } catch {
        return res.status(400).send(
          renderOAuthErrorPage({
            title: "Invalid Session",
            message: "The authorization session data is corrupted.",
            hint: "Return to the assistant and restart the connection flow.",
          }),
        );
      }

      // Clear Google cookies
      const clearCookies: string[] = [
        serializeCookie(MCP_GOOGLE_STATE_COOKIE, "", {
          expires: new Date(0).toUTCString(),
          maxAgeSeconds: 0,
        }),
        serializeCookie(MCP_GOOGLE_PARAMS_COOKIE, "", {
          expires: new Date(0).toUTCString(),
          maxAgeSeconds: 0,
        }),
      ];

      // Check for Google error
      if (req.query.error) {
        res.setHeader("Set-Cookie", clearCookies);
        return res.status(400).send(
          renderOAuthErrorPage({
            title: "Google Login Failed",
            message: "Google sign-in was cancelled or failed.",
            hint: "Return to the assistant and try again.",
          }),
        );
      }

      const code = req.query.code as string | undefined;
      if (!code) {
        res.setHeader("Set-Cookie", clearCookies);
        return res.status(400).send(
          renderOAuthErrorPage({
            title: "Missing Code",
            message: "Google did not return an authorization code.",
            hint: "Return to the assistant and try again.",
          }),
        );
      }

      // Validate MCP OAuth params
      const authorize = validateOAuthAuthorizeRequest(oauthParams);
      const client = mcpClientService.assertRedirectUri(
        authorize.clientId,
        authorize.redirectUri,
      );

      // Exchange Google code for user profile
      const mcpGoogleRedirectUri = buildMcpGoogleRedirectUri();
      const profile = await googleAuthService.handleCallback(
        code,
        mcpGoogleRedirectUri,
      );

      // Find or create user via social auth service
      const socialResult = await socialAuthService.findOrCreateSocialUser(
        profile,
        (userId, email) => authService!.issueTokens(userId, email),
      );

      await assertIdentityScopeEligibility({
        authService,
        userId: socialResult.user.id,
        scopes: authorize.scopes,
      });

      // Issue MCP authorization code directly (implicit consent for Google sign-in)
      const authCode = await mcpOAuthService.createAuthorizationCode({
        userId: socialResult.user.id,
        email: socialResult.user.email || profile.email || "",
        clientId: authorize.clientId,
        redirectUri: authorize.redirectUri,
        scopes: authorize.scopes,
        assistantName: client.clientName,
        state: authorize.state,
        codeChallenge: authorize.codeChallenge,
        codeChallengeMethod: authorize.codeChallengeMethod,
        resource: authorize.resource,
      });

      logMcpOauthEvent({
        requestId,
        event: "google_callback_success",
        userId: socialResult.user.id,
        clientId: authorize.clientId,
        clientName: client.clientName,
        scopes: authorize.scopes,
      });

      const finalRedirectUri = appendQuery(authorize.redirectUri, {
        code: authCode.code,
        state: authorize.state,
      });
      const nonce = randomBytes(16).toString("base64");
      res
        .status(303)
        .setHeader("Location", finalRedirectUri)
        .setHeader(
          "Content-Security-Policy",
          buildOAuthHtmlCsp({ scriptNonce: nonce }),
        );

      // Append clear cookies to any existing Set-Cookie headers
      const existingCookies = res.getHeader("Set-Cookie");
      const allCookies = [
        ...(Array.isArray(existingCookies)
          ? existingCookies
          : existingCookies
            ? [String(existingCookies)]
            : []),
        ...clearCookies,
      ];
      res.setHeader("Set-Cookie", allCookies);

      res.send(
        renderOAuthRedirectPage({ redirectUri: finalRedirectUri, nonce }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const mapped = mapAuthorizeError(message);
      logMcpOauthEvent({
        requestId,
        event: "google_callback_error",
        errorCode: mapped.code,
      });
      res.status(400).send(
        renderOAuthErrorPage({
          title: mapped.title,
          message: mapped.description,
        }),
      );
    }
  });

  router.post("/oauth/authorize/decision", async (req, res) => {
    const requestId = buildRequestId(req);
    setRequestId(res, requestId);
    setNoStoreHeaders(res);

    try {
      if (!authService) {
        throw new Error("Authentication not configured");
      }

      const authorize = validateOAuthAuthorizeRequest(req.body);
      const client = mcpClientService.assertRedirectUri(
        authorize.clientId,
        authorize.redirectUri,
      );
      const linkSession = resolveLinkSession(req, authService);
      if (!linkSession) {
        throw new Error("Authorization session missing");
      }

      if (String(req.body.decision || "") !== "approve") {
        clearLinkSession(res);
        logMcpOauthEvent({
          requestId,
          event: "deny",
          userId: linkSession.userId,
          clientId: authorize.clientId,
          clientName: client.clientName,
          scopes: authorize.scopes,
        });
        return res.redirect(
          303,
          appendQuery(authorize.redirectUri, {
            error: "access_denied",
            state: authorize.state,
          }),
        );
      }

      await assertIdentityScopeEligibility({
        authService,
        userId: linkSession.userId,
        scopes: authorize.scopes,
      });

      const authCode = await mcpOAuthService.createAuthorizationCode({
        userId: linkSession.userId,
        email: linkSession.email,
        clientId: authorize.clientId,
        redirectUri: authorize.redirectUri,
        scopes: authorize.scopes,
        assistantName: client.clientName,
        state: authorize.state,
        codeChallenge: authorize.codeChallenge,
        codeChallengeMethod: authorize.codeChallengeMethod,
        resource: authorize.resource,
      });

      logMcpOauthEvent({
        requestId,
        event: "approve_success",
        userId: linkSession.userId,
        clientId: authorize.clientId,
        clientName: client.clientName,
        scopes: authorize.scopes,
      });

      const finalRedirectUri = appendQuery(authorize.redirectUri, {
        code: authCode.code,
        state: authorize.state,
      });
      // Use 303 + Location for server-side OAuth clients, but also send a
      // rich HTML body so embedded webviews / in-app browsers (e.g. ChatGPT)
      // can redirect via meta-refresh or JS when the Location header is not
      // automatically followed.
      // A per-response CSP nonce allows the inline redirect script through
      // the global Helmet CSP (which blocks inline scripts by default).
      const nonce = randomBytes(16).toString("base64");
      res
        .status(303)
        .setHeader("Location", finalRedirectUri)
        .setHeader(
          "Content-Security-Policy",
          buildOAuthHtmlCsp({ scriptNonce: nonce }),
        )
        .send(
          renderOAuthRedirectPage({ redirectUri: finalRedirectUri, nonce }),
        );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const mapped = mapAuthorizeError(message);
      logMcpOauthEvent({
        requestId,
        event: "approve_error",
        errorCode: mapped.code,
      });
      res.status(400).send(
        renderOAuthErrorPage({
          title: mapped.title,
          message: mapped.description,
        }),
      );
    }
  });

  router.post("/oauth/token", async (req, res) => {
    const requestId = buildRequestId(req);
    setRequestId(res, requestId);

    try {
      if (!authService) {
        logMcpOauthEvent({
          requestId,
          event: "token_error",
          errorCode: "MCP_NOT_CONFIGURED",
        });
        return sendOAuthTokenError(res, 501, {
          error: "server_error",
          description: "Authentication not configured",
          code: "MCP_NOT_CONFIGURED",
        });
      }

      const input = validateExchangeMcpAuthorizationCodeInput({
        grantType: req.body.grant_type || req.body.grantType,
        code: req.body.code,
        clientId: req.body.client_id || req.body.clientId,
        redirectUri: req.body.redirect_uri || req.body.redirectUri,
        codeVerifier: req.body.code_verifier || req.body.codeVerifier,
        refreshToken: req.body.refresh_token || req.body.refreshToken,
        resource: req.body.resource,
      });
      const client =
        input.grantType === "authorization_code"
          ? mcpClientService.assertRedirectUri(
              input.clientId,
              input.redirectUri,
            )
          : mcpClientService.resolveClient(input.clientId);
      const exchange =
        input.grantType === "authorization_code"
          ? await mcpOAuthService.exchangeAuthorizationCode({
              code: input.code,
              clientId: input.clientId,
              redirectUri: input.redirectUri,
              codeVerifier: input.codeVerifier,
              resource: input.resource,
            })
          : null;
      const refreshExchange =
        input.grantType === "refresh_token"
          ? await mcpOAuthService.exchangeRefreshToken({
              refreshToken: input.refreshToken,
              clientId: input.clientId,
              resource: input.resource,
            })
          : null;
      const linkedSession = exchange || refreshExchange!;
      await assertIdentityScopeEligibility({
        authService,
        userId: linkedSession.userId,
        scopes: linkedSession.scopes,
      });

      const existingSessionId =
        "sessionId" in linkedSession ? linkedSession.sessionId : undefined;
      const session = existingSessionId
        ? { id: existingSessionId }
        : await mcpOAuthService.createAssistantSession({
            userId: linkedSession.userId,
            scopes: linkedSession.scopes,
            assistantName: linkedSession.assistantName || client.clientName,
            clientId: linkedSession.clientId,
            source: "oauth",
            resource: linkedSession.resource,
            timezone: linkedSession.timezone,
          });
      const token = authService.createMcpToken({
        userId: linkedSession.userId,
        email: linkedSession.email,
        scopes: linkedSession.scopes,
        assistantName: linkedSession.assistantName || client.clientName,
        clientId: linkedSession.clientId,
        sessionId: session.id,
        resource: linkedSession.resource,
      });
      await mcpOAuthService.recordAccessTokenIssued(session.id);
      const shouldIssueRefreshToken =
        client.grantTypes.includes("refresh_token") ||
        input.grantType === "refresh_token";
      const issuedRefreshToken =
        shouldIssueRefreshToken && input.grantType === "authorization_code"
          ? await mcpOAuthService.createRefreshToken({
              userId: linkedSession.userId,
              email: linkedSession.email,
              scopes: linkedSession.scopes,
              assistantName: linkedSession.assistantName || client.clientName,
              clientId: linkedSession.clientId,
              sessionId: session.id,
              resource: linkedSession.resource,
              timezone: linkedSession.timezone,
            })
          : null;
      const rotatedRefreshToken =
        shouldIssueRefreshToken && refreshExchange
          ? {
              refreshToken: refreshExchange.refreshToken,
              expiresAt: refreshExchange.refreshTokenExpiresAt,
              expiresIn: refreshExchange.refreshTokenExpiresIn,
            }
          : null;
      const refreshTokenPayload = issuedRefreshToken || rotatedRefreshToken;

      logMcpOauthEvent({
        requestId,
        event: "token_success",
        userId: linkedSession.userId,
        clientId: linkedSession.clientId,
        clientName: client.clientName,
        scopes: linkedSession.scopes,
      });

      setNoStoreHeaders(res);
      res.status(200).json({
        access_token: token.token,
        token_type: token.tokenType,
        expires_in: token.expiresIn,
        scope: token.scope,
        ...(token.expiresAt ? { expires_at: token.expiresAt } : {}),
        session_id: session.id,
        ...(refreshTokenPayload
          ? {
              refresh_token: refreshTokenPayload.refreshToken,
              refresh_token_expires_at: refreshTokenPayload.expiresAt,
              refresh_token_expires_in: refreshTokenPayload.expiresIn,
            }
          : {}),
      });
    } catch (error) {
      const mapped = mapTokenExchangeError(error);
      logMcpOauthEvent({
        requestId,
        event: "token_error",
        errorCode: mapped.code,
      });
      sendOAuthTokenError(res, mapped.status, {
        error: mapped.error,
        description: mapped.description,
        code: mapped.code,
        hint: mapped.hint,
      });
    }
  });

  router.post("/oauth/revoke", async (req, res) => {
    const requestId = buildRequestId(req);
    setRequestId(res, requestId);
    setNoStoreHeaders(res);

    try {
      if (!authService) {
        logMcpOauthEvent({
          requestId,
          event: "revoke_error",
          errorCode: "MCP_NOT_CONFIGURED",
        });
        return sendOAuthTokenError(res, 501, {
          error: "server_error",
          description: "Authentication not configured",
          code: "MCP_NOT_CONFIGURED",
        });
      }

      const input = validateRevokeMcpOAuthTokenInput({
        token: req.body.token,
        clientId: req.body.client_id || req.body.clientId,
        tokenTypeHint: req.body.token_type_hint || req.body.tokenTypeHint,
      });

      let userId: string | undefined;
      if (input.tokenTypeHint !== "access_token") {
        const revokedRefreshToken = await mcpOAuthService.revokeRefreshToken({
          refreshToken: input.token,
          clientId: input.clientId,
        });
        if (revokedRefreshToken.userId) {
          userId = revokedRefreshToken.userId;
        }
      }

      if (!userId && input.tokenTypeHint !== "refresh_token") {
        try {
          const decoded = authService.decodeMcpToken(input.token);
          userId = decoded.userId;
          if (decoded.sessionId) {
            await mcpOAuthService.revokeAssistantSession({
              userId: decoded.userId,
              sessionId: decoded.sessionId,
            });
          } else {
            await authService.revokeAllMcpTokensForUser(decoded.userId);
            await mcpOAuthService.revokeAllAssistantSessions(decoded.userId);
          }
        } catch (_error) {
          // OAuth revocation is intentionally idempotent for invalid or expired tokens.
        }
      }

      logMcpOauthEvent({
        requestId,
        event: "revoke_success",
        userId,
        clientId: input.clientId,
      });
      return res.status(200).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "Refresh token client mismatch") {
        logMcpOauthEvent({
          requestId,
          event: "revoke_error",
          errorCode: "MCP_REFRESH_TOKEN_CLIENT_MISMATCH",
        });
        return sendOAuthTokenError(res, 401, {
          error: "invalid_client",
          description: "Refresh token client binding mismatch",
          code: "MCP_REFRESH_TOKEN_CLIENT_MISMATCH",
          hint: "Use the same client_id that originally received the refresh token.",
        });
      }

      logMcpOauthEvent({
        requestId,
        event: "revoke_error",
        errorCode: "MCP_OAUTH_REVOKE_FAILED",
      });
      return sendOAuthTokenError(res, 500, {
        error: "server_error",
        description: "OAuth revocation failed",
        code: "MCP_OAUTH_REVOKE_FAILED",
        hint: "Retry the revoke request. If it persists, inspect the server logs using the request ID.",
      });
    }
  });

  return router;
}
