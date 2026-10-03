import {
  Router,
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import { randomUUID } from "crypto";
import { AuthService } from "../services/authService";
import { McpOAuthService } from "../services/mcpOAuthService";
import { SocialAuthService } from "../services/socialAuthService";
import { GoogleAuthService } from "../services/googleAuthService";
import { resolveGoogleWebRedirectUri } from "../services/googleWebAuthOrigin";
import { AppleAuthService } from "../services/appleAuthService";
import { PhoneAuthService } from "../services/phoneAuthService";
import {
  validateRegister,
  validateLogin,
  validatePhoneE164,
  validateOtpCode,
} from "../validation/authValidation";
import { config } from "../config";
import { HttpError } from "../errorHandling";
import { buildStructuredMcpError, mapAgentFacingError } from "../mcp/mcpErrors";
import {
  validateCreateMcpAuthorizationCodeInput,
  validateCreateMcpTokenInput,
  validateExchangeMcpAuthorizationCodeInput,
  validateRevokeMcpSessionInput,
} from "../validation/mcpValidation";

interface AuthRouterDeps {
  authService?: AuthService;
  mcpOAuthService: McpOAuthService;
  socialAuthService?: SocialAuthService;
  googleAuthService?: GoogleAuthService;
  appleAuthService?: AppleAuthService;
  phoneAuthService?: PhoneAuthService;
  authLimiter: RequestHandler;
  emailActionLimiter: RequestHandler;
  requireAuthIfConfigured: RequestHandler;
}

const POST_AUTH_REDIRECT_COOKIE = "post_auth_redirect";
const POST_AUTH_REDIRECT_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;
const ALLOWED_POST_AUTH_PREFIXES = [
  "/app",
  "/app-react",
  "/app-classic",
  "/feedback",
];

function normalizePostAuthRedirect(
  input: unknown,
  origin = config.baseUrl,
): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed, origin);
    if (url.origin !== origin) {
      return null;
    }

    const pathname = url.pathname;
    const isAllowed = ALLOWED_POST_AUTH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    if (!isAllowed) {
      return null;
    }

    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function getPostAuthRedirectCookieOptions() {
  return {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax" as const,
    path: "/auth",
  };
}

function setPostAuthRedirect(res: Response, next: string | null) {
  const cookieOptions = getPostAuthRedirectCookieOptions();
  if (next) {
    res.cookie(POST_AUTH_REDIRECT_COOKIE, next, {
      ...cookieOptions,
      maxAge: POST_AUTH_REDIRECT_COOKIE_MAX_AGE_MS,
    });
    return;
  }

  res.clearCookie(POST_AUTH_REDIRECT_COOKIE, cookieOptions);
}

function buildLinkRequestId(req: Request): string {
  const headerId =
    req.header("x-mcp-request-id") || req.header("x-agent-request-id");
  return typeof headerId === "string" && headerId.trim()
    ? headerId.trim()
    : randomUUID();
}

function logMcpLinkEvent(input: {
  requestId: string;
  event:
    | "authorize_success"
    | "authorize_error"
    | "token_exchange_success"
    | "token_exchange_error"
    | "legacy_token_success"
    | "legacy_token_error"
    | "session_list_success"
    | "session_list_error"
    | "session_revoke_success"
    | "session_revoke_error";
  userId?: string;
  clientId?: string;
  assistantName?: string;
  scopes?: string[];
  errorCode?: string;
}) {
  console.info(
    JSON.stringify({
      type: "assistant_mcp_auth",
      requestId: input.requestId,
      event: input.event,
      userId: input.userId,
      clientId: input.clientId,
      assistantName: input.assistantName,
      scopes: input.scopes,
      errorCode: input.errorCode,
      ts: new Date().toISOString(),
    }),
  );
}

function sendStructuredError(
  res: Response,
  status: number,
  error: ReturnType<typeof buildStructuredMcpError>,
) {
  return res.status(status).json({ error });
}

async function resolveAppUserForMcpLink(
  req: Request,
  authService?: AuthService,
): Promise<
  | {
      user: {
        id: string;
        email: string | null;
        name: string | null;
        isVerified: boolean;
      };
    }
  | { httpStatus: number; error: ReturnType<typeof buildStructuredMcpError> }
> {
  if (!authService) {
    return {
      httpStatus: 501,
      error: buildStructuredMcpError({
        code: "MCP_NOT_CONFIGURED",
        message: "Authentication not configured",
        retryable: false,
        hint: "Enable application authentication before linking an assistant.",
      }),
    };
  }

  const authHeader = req.header("authorization");
  if (!authHeader) {
    return {
      httpStatus: 401,
      error: buildStructuredMcpError({
        code: "MCP_LINK_UNAUTHENTICATED",
        message: "Authorization header missing",
        retryable: false,
        hint: "Sign in to the app and send the app bearer token when starting account linking.",
      }),
    };
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return {
      httpStatus: 401,
      error: buildStructuredMcpError({
        code: "MCP_LINK_INVALID_AUTHORIZATION",
        message: "Invalid authorization format. Expected: Bearer <token>",
        retryable: false,
        hint: "Send the app access token as a bearer token.",
      }),
    };
  }

  try {
    const payload = authService.verifyToken(parts[1]);
    const user = await authService.getUserById(payload.userId);
    if (!user) {
      return {
        httpStatus: 401,
        error: buildStructuredMcpError({
          code: "MCP_LINK_INVALID_SESSION",
          message: "App session no longer maps to a valid user",
          retryable: false,
          hint: "Sign in again before linking an assistant.",
        }),
      };
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isVerified: user.isVerified,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const mapped =
      message === "Token expired"
        ? buildStructuredMcpError({
            code: "MCP_LINK_AUTH_EXPIRED",
            message: "App access token expired",
            retryable: false,
            hint: "Refresh the app session or sign in again before linking an assistant.",
          })
        : buildStructuredMcpError({
            code: "MCP_LINK_INVALID_TOKEN",
            message: "Invalid app access token",
            retryable: false,
            hint: "Use a valid app access token when starting the account-link flow.",
          });
    return {
      httpStatus: 401,
      error: mapped,
    };
  }
}

function mapAuthorizationCodeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  switch (message) {
    case "Invalid authorization code":
      return {
        status: 401,
        error: buildStructuredMcpError({
          code: "MCP_AUTH_CODE_INVALID",
          message: "Authorization code is invalid",
          retryable: false,
          hint: "Restart the assistant linking flow to mint a fresh code.",
        }),
      };
    case "Authorization code expired":
      return {
        status: 401,
        error: buildStructuredMcpError({
          code: "MCP_AUTH_CODE_EXPIRED",
          message: "Authorization code expired",
          retryable: false,
          hint: "Restart the assistant linking flow and exchange the new code promptly.",
        }),
      };
    case "Authorization code already used":
      return {
        status: 409,
        error: buildStructuredMcpError({
          code: "MCP_AUTH_CODE_ALREADY_USED",
          message: "Authorization code already used",
          retryable: false,
          hint: "Start a new assistant linking flow to mint a fresh code.",
        }),
      };
    case "Authorization code binding mismatch":
      return {
        status: 401,
        error: buildStructuredMcpError({
          code: "MCP_AUTH_CODE_BINDING_MISMATCH",
          message: "Authorization code client binding mismatch",
          retryable: false,
          hint: "Retry the exchange with the same clientId and redirectUri used during authorization.",
        }),
      };
    case "Invalid code verifier":
      return {
        status: 401,
        error: buildStructuredMcpError({
          code: "MCP_INVALID_CODE_VERIFIER",
          message: "Code verifier did not match the authorization challenge",
          retryable: false,
          hint: "Use the original PKCE verifier that matches the code challenge.",
        }),
      };
    case "Invalid refresh token":
      return {
        status: 401,
        error: buildStructuredMcpError({
          code: "MCP_REFRESH_TOKEN_INVALID",
          message: "Refresh token is invalid",
          retryable: false,
          hint: "Start a new assistant link flow or use the newest refresh token.",
        }),
      };
    case "Refresh token expired":
      return {
        status: 401,
        error: buildStructuredMcpError({
          code: "MCP_REFRESH_TOKEN_EXPIRED",
          message: "Refresh token expired",
          retryable: false,
          hint: "Repeat the assistant link flow to mint a fresh token set.",
        }),
      };
    case "Refresh token already rotated":
      return {
        status: 409,
        error: buildStructuredMcpError({
          code: "MCP_REFRESH_TOKEN_REUSED",
          message: "Refresh token already rotated",
          retryable: false,
          hint: "Retry with the newest refresh token returned by the previous exchange.",
        }),
      };
    case "Refresh token client mismatch":
      return {
        status: 401,
        error: buildStructuredMcpError({
          code: "MCP_REFRESH_TOKEN_CLIENT_MISMATCH",
          message: "Refresh token client binding mismatch",
          retryable: false,
          hint: "Use the same clientId that originally received the refresh token.",
        }),
      };
    case "Assistant session revoked":
      return {
        status: 401,
        error: buildStructuredMcpError({
          code: "MCP_ASSISTANT_SESSION_REVOKED",
          message: "Assistant session has been revoked",
          retryable: false,
          hint: "Reconnect the assistant to mint a fresh MCP token set.",
        }),
      };
    default:
      return mapAgentFacingError(error);
  }
}

export function createAuthRouter({
  authService,
  mcpOAuthService,
  socialAuthService,
  googleAuthService,
  appleAuthService,
  phoneAuthService,
  authLimiter,
  emailActionLimiter,
  requireAuthIfConfigured,
}: AuthRouterDeps): Router {
  const router = Router();

  router.post(
    "/register",
    authLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!authService) {
        return res.status(501).json({ error: "Authentication not configured" });
      }

      try {
        const validation = validateRegister(req.body);

        if (!validation.valid) {
          return res.status(400).json({
            error: "Validation failed",
            errors: validation.errors,
          });
        }

        const result = await authService.register(validation.dto!);
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/login",
    authLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!authService) {
        return res.status(501).json({ error: "Authentication not configured" });
      }

      try {
        const validation = validateLogin(req.body);

        if (!validation.valid) {
          return res.status(400).json({
            error: "Validation failed",
            errors: validation.errors,
          });
        }

        const result = await authService.login(validation.dto!);
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/refresh",
    authLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!authService) {
        return res.status(501).json({ error: "Authentication not configured" });
      }

      try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
          throw new HttpError(400, "Refresh token required");
        }

        const result = await authService.refreshAccessToken(refreshToken);
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/logout",
    authLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!authService) {
        return res.status(501).json({ error: "Authentication not configured" });
      }

      try {
        const { refreshToken } = req.body;

        if (refreshToken) {
          await authService.revokeRefreshToken(refreshToken);
        }

        res.json({ message: "Logged out successfully" });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/verify",
    authLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!authService) {
        return res.status(501).json({ error: "Authentication not configured" });
      }

      const acceptHeader = req.get("accept") || "";
      const wantsHtml =
        req.accepts("html") === "html" || acceptHeader.includes("text/html");

      try {
        const token = req.query.token as string;

        if (!token || typeof token !== "string") {
          throw new HttpError(400, "Verification token required");
        }

        await authService.verifyEmail(token);
        if (wantsHtml) {
          return res.redirect(303, "/?verified=1");
        }
        res.json({ message: "Email verified successfully" });
      } catch (error) {
        if (wantsHtml) {
          return res.redirect(303, "/?verified=0");
        }
        next(error);
      }
    },
  );

  router.post(
    "/resend-verification",
    emailActionLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!authService) {
        return res.status(501).json({ error: "Authentication not configured" });
      }

      try {
        const { email } = req.body;
        const normalizedEmail =
          typeof email === "string" ? email.trim().toLowerCase() : "";

        if (!normalizedEmail) {
          return res.status(400).json({ error: "Email required" });
        }

        const user = await authService.getUserByEmail(normalizedEmail);

        if (user && !user.isVerified) {
          authService.dispatchVerificationEmail(
            user.id,
            "Failed to send verification email after resend request:",
          );
        }

        res.json({
          message:
            "If the email exists and is not verified, a verification link has been sent",
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/mcp/token",
    authLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const requestId = buildLinkRequestId(req);
        const resolvedUser = await resolveAppUserForMcpLink(req, authService);
        if ("error" in resolvedUser) {
          logMcpLinkEvent({
            requestId,
            event: "legacy_token_error",
            errorCode: resolvedUser.error.code,
          });
          return sendStructuredError(
            res,
            resolvedUser.httpStatus,
            resolvedUser.error,
          );
        }

        const input = validateCreateMcpTokenInput(req.body);
        const session = await mcpOAuthService.createAssistantSession({
          userId: resolvedUser.user.id,
          scopes: input.scopes,
          assistantName: input.assistantName,
          clientId: input.clientId,
          source: "local",
        });
        const token = authService!.createMcpToken({
          userId: resolvedUser.user.id,
          email: resolvedUser.user.email || "",
          scopes: input.scopes,
          assistantName: input.assistantName,
          clientId: input.clientId,
          sessionId: session.id,
        });
        await mcpOAuthService.recordAccessTokenIssued(session.id);

        logMcpLinkEvent({
          requestId,
          event: "legacy_token_success",
          userId: resolvedUser.user.id,
          clientId: input.clientId,
          assistantName: input.assistantName,
          scopes: input.scopes,
        });
        res.status(201).json({
          ...token,
          sessionId: session.id,
        });
      } catch (error) {
        const requestId = buildLinkRequestId(req);
        const mapped = mapAgentFacingError(error);
        logMcpLinkEvent({
          requestId,
          event: "legacy_token_error",
          errorCode: mapped.error.code,
        });
        sendStructuredError(res, mapped.status, mapped.error);
      }
    },
  );

  router.post(
    "/mcp/oauth/authorize",
    authLimiter,
    async (req: Request, res: Response) => {
      const requestId = buildLinkRequestId(req);

      try {
        const resolvedUser = await resolveAppUserForMcpLink(req, authService);
        if ("error" in resolvedUser) {
          logMcpLinkEvent({
            requestId,
            event: "authorize_error",
            errorCode: resolvedUser.error.code,
          });
          return sendStructuredError(
            res,
            resolvedUser.httpStatus,
            resolvedUser.error,
          );
        }

        const input = validateCreateMcpAuthorizationCodeInput(req.body);
        const authCode = await mcpOAuthService.createAuthorizationCode({
          userId: resolvedUser.user.id,
          email: resolvedUser.user.email || "",
          clientId: input.clientId,
          redirectUri: input.redirectUri,
          scopes: input.scopes,
          assistantName: input.assistantName,
          state: input.state,
          codeChallenge: input.codeChallenge,
          codeChallengeMethod: input.codeChallengeMethod,
        });

        logMcpLinkEvent({
          requestId,
          event: "authorize_success",
          userId: resolvedUser.user.id,
          clientId: input.clientId,
          assistantName: input.assistantName,
          scopes: input.scopes,
        });
        res.status(201).json({
          authorizationCode: authCode.code,
          expiresAt: authCode.expiresAt,
          redirectUri: authCode.redirectUri,
          scopes: authCode.scopes,
          ...(authCode.assistantName
            ? { assistantName: authCode.assistantName }
            : {}),
          ...(authCode.state ? { state: authCode.state } : {}),
          tokenEndpoint: "/auth/mcp/oauth/token",
        });
      } catch (error) {
        const mapped = mapAgentFacingError(error);
        logMcpLinkEvent({
          requestId,
          event: "authorize_error",
          errorCode: mapped.error.code,
        });
        sendStructuredError(res, mapped.status, mapped.error);
      }
    },
  );

  router.post(
    "/mcp/oauth/token",
    authLimiter,
    async (req: Request, res: Response) => {
      const requestId = buildLinkRequestId(req);

      try {
        if (!authService) {
          const error = buildStructuredMcpError({
            code: "MCP_NOT_CONFIGURED",
            message: "Authentication not configured",
            retryable: false,
            hint: "Enable application authentication before linking an assistant.",
          });
          logMcpLinkEvent({
            requestId,
            event: "token_exchange_error",
            errorCode: error.code,
          });
          return sendStructuredError(res, 501, error);
        }

        const input = validateExchangeMcpAuthorizationCodeInput(req.body);
        const exchange =
          input.grantType === "authorization_code"
            ? await mcpOAuthService.exchangeAuthorizationCode({
                code: input.code,
                clientId: input.clientId,
                redirectUri: input.redirectUri,
                codeVerifier: input.codeVerifier,
              })
            : null;
        const refreshExchange =
          input.grantType === "refresh_token"
            ? await mcpOAuthService.exchangeRefreshToken({
                refreshToken: input.refreshToken,
                clientId: input.clientId,
              })
            : null;
        const linkedSession = exchange || refreshExchange!;
        const user = await authService.getUserById(linkedSession.userId);
        if (!user) {
          const error = buildStructuredMcpError({
            code: "MCP_INVALID_SESSION",
            message: "Linked user account no longer exists",
            retryable: false,
            hint: "Link the assistant again from an active app user account.",
          });
          logMcpLinkEvent({
            requestId,
            event: "token_exchange_error",
            clientId: input.clientId,
            errorCode: error.code,
          });
          return sendStructuredError(res, 401, error);
        }

        const existingSessionId =
          "sessionId" in linkedSession ? linkedSession.sessionId : undefined;
        const session = existingSessionId
          ? { id: existingSessionId }
          : await mcpOAuthService.createAssistantSession({
              userId: linkedSession.userId,
              scopes: linkedSession.scopes,
              assistantName: linkedSession.assistantName,
              clientId: linkedSession.clientId,
              source: "oauth",
            });
        const token = authService.createMcpToken({
          userId: linkedSession.userId,
          email: linkedSession.email,
          scopes: linkedSession.scopes,
          assistantName: linkedSession.assistantName,
          clientId: linkedSession.clientId,
          sessionId: session.id,
        });
        await mcpOAuthService.recordAccessTokenIssued(session.id);
        const refreshToken =
          input.grantType === "authorization_code"
            ? await mcpOAuthService.createRefreshToken({
                userId: linkedSession.userId,
                email: linkedSession.email,
                scopes: linkedSession.scopes,
                assistantName: linkedSession.assistantName,
                clientId: linkedSession.clientId,
                sessionId: session.id,
              })
            : null;
        const refreshTokenPayload = refreshExchange
          ? {
              refreshToken: refreshExchange.refreshToken,
              expiresAt: refreshExchange.refreshTokenExpiresAt,
              expiresIn: refreshExchange.refreshTokenExpiresIn,
            }
          : refreshToken;

        logMcpLinkEvent({
          requestId,
          event: "token_exchange_success",
          userId: linkedSession.userId,
          clientId: linkedSession.clientId,
          assistantName: linkedSession.assistantName,
          scopes: linkedSession.scopes,
        });
        res.status(200).json({
          accessToken: token.token,
          tokenType: token.tokenType,
          expiresAt: token.expiresAt,
          expiresIn: token.expiresIn,
          scope: token.scope,
          scopes: token.scopes,
          ...(token.assistantName
            ? { assistantName: token.assistantName }
            : {}),
          ...(token.clientId ? { clientId: token.clientId } : {}),
          sessionId: session.id,
          refreshToken: refreshTokenPayload!.refreshToken,
          refreshTokenExpiresAt: refreshTokenPayload!.expiresAt,
          refreshTokenExpiresIn: refreshTokenPayload!.expiresIn,
        });
      } catch (error) {
        const mapped = mapAuthorizationCodeError(error);
        logMcpLinkEvent({
          requestId,
          event: "token_exchange_error",
          errorCode: mapped.error.code,
        });
        sendStructuredError(res, mapped.status, mapped.error);
      }
    },
  );

  router.get(
    "/mcp/sessions",
    authLimiter,
    async (req: Request, res: Response) => {
      const requestId = buildLinkRequestId(req);

      try {
        const resolvedUser = await resolveAppUserForMcpLink(req, authService);
        if ("error" in resolvedUser) {
          logMcpLinkEvent({
            requestId,
            event: "session_list_error",
            errorCode: resolvedUser.error.code,
          });
          return sendStructuredError(
            res,
            resolvedUser.httpStatus,
            resolvedUser.error,
          );
        }

        const sessions = await mcpOAuthService.listAssistantSessions(
          resolvedUser.user.id,
        );
        logMcpLinkEvent({
          requestId,
          event: "session_list_success",
          userId: resolvedUser.user.id,
        });
        return res.status(200).json({ sessions });
      } catch (error) {
        const mapped = mapAgentFacingError(error);
        logMcpLinkEvent({
          requestId,
          event: "session_list_error",
          errorCode: mapped.error.code,
        });
        return sendStructuredError(res, mapped.status, mapped.error);
      }
    },
  );

  router.post(
    "/mcp/sessions/revoke",
    authLimiter,
    async (req: Request, res: Response) => {
      const requestId = buildLinkRequestId(req);

      try {
        const resolvedUser = await resolveAppUserForMcpLink(req, authService);
        if ("error" in resolvedUser) {
          logMcpLinkEvent({
            requestId,
            event: "session_revoke_error",
            errorCode: resolvedUser.error.code,
          });
          return sendStructuredError(
            res,
            resolvedUser.httpStatus,
            resolvedUser.error,
          );
        }

        const input = validateRevokeMcpSessionInput(req.body);
        if ("revokeAll" in input && input.revokeAll) {
          const revokedAt = await authService!.revokeAllMcpTokensForUser(
            resolvedUser.user.id,
          );
          const revokedSessionCount =
            await mcpOAuthService.revokeAllAssistantSessions(
              resolvedUser.user.id,
            );
          logMcpLinkEvent({
            requestId,
            event: "session_revoke_success",
            userId: resolvedUser.user.id,
          });
          return res.status(200).json({
            revokedAll: true,
            revokedAt,
            revokedSessionCount,
          });
        }

        const revoked = await mcpOAuthService.revokeAssistantSession({
          userId: resolvedUser.user.id,
          sessionId: input.sessionId,
        });

        if (!revoked) {
          const error = buildStructuredMcpError({
            code: "MCP_ASSISTANT_SESSION_NOT_FOUND",
            message: "Assistant session not found",
            retryable: false,
            hint: "Fetch active assistant sessions first and retry with a current sessionId.",
          });
          logMcpLinkEvent({
            requestId,
            event: "session_revoke_error",
            userId: resolvedUser.user.id,
            errorCode: error.code,
          });
          return sendStructuredError(res, 404, error);
        }

        logMcpLinkEvent({
          requestId,
          event: "session_revoke_success",
          userId: resolvedUser.user.id,
        });
        return res.status(200).json({
          revoked: true,
          sessionId: input.sessionId,
        });
      } catch (error) {
        const mapped = mapAgentFacingError(error);
        logMcpLinkEvent({
          requestId,
          event: "session_revoke_error",
          errorCode: mapped.error.code,
        });
        return sendStructuredError(res, mapped.status, mapped.error);
      }
    },
  );

  router.post(
    "/forgot-password",
    emailActionLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!authService) {
        return res.status(501).json({ error: "Authentication not configured" });
      }

      try {
        const email = req.body.email as string;
        const normalizedEmail =
          typeof email === "string" ? email.trim().toLowerCase() : "";

        if (!normalizedEmail) {
          return res.status(400).json({ error: "Email required" });
        }

        await authService.requestPasswordReset(normalizedEmail);
        res.json({
          message: "If the email exists, a reset link has been sent",
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/reset-password",
    authLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!authService) {
        return res.status(501).json({ error: "Authentication not configured" });
      }

      try {
        const token = req.body.token as string;
        const password = req.body.password as string;

        if (!token || !password) {
          return res.status(400).json({ error: "Token and password required" });
        }

        if (password.length < 8) {
          return res
            .status(400)
            .json({ error: "Password must be at least 8 characters" });
        }

        if (password.length > 72) {
          return res
            .status(400)
            .json({ error: "Password cannot exceed 72 characters" });
        }

        await authService.resetPassword(token, password);
        res.json({ message: "Password reset successfully" });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/bootstrap-admin/status",
    requireAuthIfConfigured,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!authService) {
        return res.status(501).json({ error: "Authentication not configured" });
      }

      try {
        const userId = req.user?.userId;
        if (!userId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const status = await authService.getAdminBootstrapStatus(userId);
        res.json(status);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/bootstrap-admin",
    authLimiter,
    requireAuthIfConfigured,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!authService) {
        return res.status(501).json({ error: "Authentication not configured" });
      }

      try {
        const userId = req.user?.userId;
        if (!userId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const secret =
          typeof req.body.secret === "string" ? req.body.secret.trim() : "";
        if (!secret) {
          return res.status(400).json({ error: "Bootstrap secret required" });
        }

        const user = await authService.bootstrapAdmin(userId, secret);
        res.json({ message: "Admin access granted", user });
      } catch (error) {
        next(error);
      }
    },
  );

  // ── Provider discovery ────────────────────────────────────────────

  router.get("/providers", (_req: Request, res: Response) => {
    const providers = socialAuthService
      ? socialAuthService.getEnabledProviders()
      : { google: false, apple: false, phone: false };
    res.json(providers);
  });

  // ── Google OAuth ─────────────────────────────────────────────────

  // CLI OAuth: starts Google login with a localhost callback redirect
  router.get("/cli/google", authLimiter, (req: Request, res: Response) => {
    if (!googleAuthService || !config.googleLoginEnabled) {
      return res.status(404).json({ error: "Google login not enabled" });
    }

    const portStr = req.query.port as string;
    const port = parseInt(portStr, 10);
    if (!portStr || isNaN(port) || port < 1024 || port > 65535) {
      return res.status(400).json({ error: "Invalid port parameter" });
    }

    const redirectUri = resolveGoogleWebRedirectUri(req);
    if (!redirectUri) {
      return res
        .status(400)
        .json({ error: "Unsupported Google sign-in origin" });
    }
    const { url, state } = googleAuthService.generateAuthUrl(redirectUri);

    res.cookie("oauth_state", state, {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
      path: "/auth/google",
    });

    // Store CLI port so the callback knows to redirect to localhost
    res.cookie("cli_port", String(port), {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
      path: "/auth/google",
    });

    res.redirect(url);
  });

  router.get("/google/start", authLimiter, (req: Request, res: Response) => {
    if (!googleAuthService || !config.googleLoginEnabled) {
      return res.status(404).json({ error: "Google login not enabled" });
    }

    const redirectUri = resolveGoogleWebRedirectUri(req);
    if (!redirectUri) {
      return res
        .status(400)
        .json({ error: "Unsupported Google sign-in origin" });
    }
    const { url, state } = googleAuthService.generateAuthUrl(redirectUri);
    const next = normalizePostAuthRedirect(
      req.query.next,
      new URL(redirectUri).origin,
    );

    // Store state in httpOnly cookie for CSRF validation
    res.cookie("oauth_state", state, {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000, // 10 minutes
      path: "/auth/google",
    });
    // A subsequent web login must not inherit an abandoned CLI loopback target.
    res.clearCookie("cli_port", {
      path: "/auth/google",
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
    });
    setPostAuthRedirect(res, next);

    // If user is authenticated, store userId for linking
    const authHeader = req.header("authorization");
    if (authHeader && authService) {
      try {
        const parts = authHeader.split(" ");
        if (parts.length === 2 && parts[0] === "Bearer") {
          const payload = authService.verifyToken(parts[1]);
          res.cookie("link_to_user", payload.userId, {
            httpOnly: true,
            secure: config.nodeEnv === "production",
            sameSite: "lax",
            maxAge: 10 * 60 * 1000,
            path: "/auth/google",
          });
        }
      } catch {
        // Not authenticated — proceed with normal login flow
      }
    }

    res.redirect(url);
  });

  router.get(
    "/google/callback",
    authLimiter,
    async (req: Request, res: Response) => {
      if (!googleAuthService || !socialAuthService || !authService) {
        return res.status(404).json({ error: "Google login not enabled" });
      }

      const redirectUri = resolveGoogleWebRedirectUri(req);
      if (!redirectUri) {
        return res
          .status(400)
          .json({ error: "Unsupported Google sign-in origin" });
      }
      const origin = new URL(redirectUri).origin;

      try {
        // Validate state
        const state = req.query.state;
        const storedState = req.cookies?.oauth_state;
        if (
          typeof state !== "string" ||
          !state ||
          typeof storedState !== "string" ||
          state !== storedState
        ) {
          console.error("Google OAuth state mismatch", {
            hasState: !!state,
            hasStoredState: !!storedState,
            cookieKeys: Object.keys(req.cookies || {}),
          });
          const next = normalizePostAuthRedirect(
            req.cookies?.[POST_AUTH_REDIRECT_COOKIE],
            origin,
          );
          setPostAuthRedirect(res, null);
          const params = new URLSearchParams({
            auth: "error",
            message: "Invalid OAuth state — please try again",
          });
          if (next) {
            params.set("next", next);
          }
          return res.redirect(`/auth?${params.toString()}`);
        }

        // Clear state cookie (include all original options so the browser matches it)
        res.clearCookie("oauth_state", {
          path: "/auth/google",
          httpOnly: true,
          secure: config.nodeEnv === "production",
          sameSite: "lax",
        });
        const next = normalizePostAuthRedirect(
          req.cookies?.[POST_AUTH_REDIRECT_COOKIE],
          origin,
        );
        setPostAuthRedirect(res, null);

        const code = req.query.code;
        if (typeof code !== "string" || !code) {
          const params = new URLSearchParams({
            auth: "error",
            message: "Missing authorization code",
          });
          if (next) {
            params.set("next", next);
          }
          return res.redirect(`/auth?${params.toString()}`);
        }

        const profile = await googleAuthService.handleCallback(
          code,
          redirectUri,
        );
        const result = await socialAuthService.findOrCreateSocialUser(
          profile,
          (userId, email) => authService!.issueTokens(userId, email),
        );

        // Clear link cookie
        res.clearCookie("link_to_user", {
          path: "/auth/google",
          httpOnly: true,
          secure: config.nodeEnv === "production",
          sameSite: "lax",
        });

        // Check if this is a CLI login flow
        const cliPort = req.cookies?.cli_port;
        if (cliPort) {
          res.clearCookie("cli_port", {
            path: "/auth/google",
            httpOnly: true,
            secure: config.nodeEnv === "production",
            sameSite: "lax",
          });

          const port = parseInt(cliPort, 10);
          if (!isNaN(port) && port >= 1024 && port <= 65535) {
            const cliParams = new URLSearchParams({
              token: result.token,
              refreshToken: result.refreshToken,
              email: result.user?.email || "",
            });
            return res.redirect(
              `http://127.0.0.1:${port}/callback?${cliParams.toString()}`,
            );
          }
        }

        // Redirect to app with tokens (default web flow)
        const params = new URLSearchParams({
          auth: "success",
          token: result.token,
          refreshToken: result.refreshToken,
          userId: result.user.id,
          email: result.user.email ?? "",
        });
        if (next) {
          params.set("next", next);
        }
        res.redirect(`/auth?${params.toString()}`);
      } catch (error) {
        console.error("Google OAuth callback error:", error);
        const next = normalizePostAuthRedirect(
          req.cookies?.[POST_AUTH_REDIRECT_COOKIE],
          origin,
        );
        setPostAuthRedirect(res, null);

        // Check for CLI flow on error too
        const cliPort = req.cookies?.cli_port;
        if (cliPort) {
          res.clearCookie("cli_port", {
            path: "/auth/google",
            httpOnly: true,
            secure: config.nodeEnv === "production",
            sameSite: "lax",
          });
          const port = parseInt(cliPort, 10);
          if (!isNaN(port) && port >= 1024 && port <= 65535) {
            return res.redirect(
              `http://127.0.0.1:${port}/callback?error=${encodeURIComponent("Google login failed")}`,
            );
          }
        }

        const params = new URLSearchParams({
          auth: "error",
          message: "Google login failed",
        });
        if (next) {
          params.set("next", next);
        }
        res.redirect(`/auth?${params.toString()}`);
      }
    },
  );

  // ── Apple Sign-In ────────────────────────────────────────────────

  router.get("/apple/start", authLimiter, (req: Request, res: Response) => {
    if (!appleAuthService || !config.appleLoginEnabled) {
      return res.status(404).json({ error: "Apple login not enabled" });
    }

    const { url, state, nonce } = appleAuthService.generateAuthUrl();
    const next = normalizePostAuthRedirect(req.query.next);

    // Store state + nonce in httpOnly cookie
    res.cookie("apple_oauth", JSON.stringify({ state, nonce }), {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
      path: "/auth/apple",
    });
    setPostAuthRedirect(res, next);

    res.redirect(url);
  });

  router.post(
    "/apple/callback",
    authLimiter,
    async (req: Request, res: Response) => {
      if (!appleAuthService || !socialAuthService || !authService) {
        return res.status(404).json({ error: "Apple login not enabled" });
      }

      try {
        // Validate state
        const state = req.body.state as string;
        const cookieRaw = req.cookies?.apple_oauth;
        let storedState: string | undefined;
        let storedNonce: string | undefined;

        try {
          const parsed = JSON.parse(cookieRaw || "{}");
          storedState = parsed.state;
          storedNonce = parsed.nonce;
        } catch {
          // Invalid cookie
        }

        if (!state || !storedState || state !== storedState) {
          const next = normalizePostAuthRedirect(
            req.cookies?.[POST_AUTH_REDIRECT_COOKIE],
          );
          setPostAuthRedirect(res, null);
          const params = new URLSearchParams({
            auth: "error",
            message: "Invalid OAuth state",
          });
          if (next) {
            params.set("next", next);
          }
          return res.redirect(`/auth?${params.toString()}`);
        }

        res.clearCookie("apple_oauth", { path: "/auth/apple" });
        const next = normalizePostAuthRedirect(
          req.cookies?.[POST_AUTH_REDIRECT_COOKIE],
        );
        setPostAuthRedirect(res, null);

        const idToken = req.body.id_token as string;
        if (!idToken) {
          const params = new URLSearchParams({
            auth: "error",
            message: "Missing ID token",
          });
          if (next) {
            params.set("next", next);
          }
          return res.redirect(`/auth?${params.toString()}`);
        }

        // Apple sends user info only on first auth
        let userName: string | null = null;
        if (req.body.user) {
          try {
            const userInfo =
              typeof req.body.user === "string"
                ? JSON.parse(req.body.user)
                : req.body.user;
            if (userInfo.name) {
              const parts = [
                userInfo.name.firstName,
                userInfo.name.lastName,
              ].filter(Boolean);
              userName = parts.join(" ") || null;
            }
          } catch {
            // Ignore parse errors for user info
          }
        }

        const profile = await appleAuthService.verifyIdToken(
          idToken,
          storedNonce,
        );

        // Override name from the form_post body (only available on first auth)
        if (userName) {
          profile.name = userName;
        }

        const result = await socialAuthService.findOrCreateSocialUser(
          profile,
          (userId, email) => authService!.issueTokens(userId, email),
        );

        const params = new URLSearchParams({
          auth: "success",
          token: result.token,
          refreshToken: result.refreshToken,
          userId: result.user.id,
          email: result.user.email ?? "",
        });
        if (next) {
          params.set("next", next);
        }
        res.redirect(`/auth?${params.toString()}`);
      } catch (error) {
        console.error("Apple Sign-In callback error:", error);
        const next = normalizePostAuthRedirect(
          req.cookies?.[POST_AUTH_REDIRECT_COOKIE],
        );
        setPostAuthRedirect(res, null);
        const params = new URLSearchParams({
          auth: "error",
          message: "Apple login failed",
        });
        if (next) {
          params.set("next", next);
        }
        res.redirect(`/auth?${params.toString()}`);
      }
    },
  );

  // ── Phone / SMS OTP ──────────────────────────────────────────────

  router.post(
    "/phone/send-otp",
    authLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!phoneAuthService || !config.phoneLoginEnabled) {
        return res.status(404).json({ error: "Phone login not enabled" });
      }

      try {
        const phoneValidation = validatePhoneE164(req.body.phone);
        if (!phoneValidation.valid) {
          return res.status(400).json({
            error: "Validation failed",
            errors: phoneValidation.errors,
          });
        }

        const result = await phoneAuthService.sendVerification(
          phoneValidation.phoneE164!,
        );
        res.json(result);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("Premium-rate") ||
            error.message.includes("Phone number must") ||
            error.message.includes("Invalid phone"))
        ) {
          return res.status(400).json({ error: error.message });
        }
        next(error);
      }
    },
  );

  router.post(
    "/phone/verify-otp",
    authLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!phoneAuthService || !authService || !config.phoneLoginEnabled) {
        return res.status(404).json({ error: "Phone login not enabled" });
      }

      try {
        const phoneValidation = validatePhoneE164(req.body.phone);
        if (!phoneValidation.valid) {
          return res.status(400).json({
            error: "Validation failed",
            errors: phoneValidation.errors,
          });
        }

        const codeValidation = validateOtpCode(req.body.code);
        if (!codeValidation.valid) {
          return res.status(400).json({
            error: "Validation failed",
            errors: codeValidation.errors,
          });
        }

        const result = await phoneAuthService.checkVerification(
          phoneValidation.phoneE164!,
          codeValidation.code!,
          (userId, email) => authService!.issueTokens(userId, email),
        );

        res.json(result);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Invalid or expired code"
        ) {
          return res.status(401).json({ error: "Invalid or expired code" });
        }
        next(error);
      }
    },
  );

  // ── Account management ───────────────────────────────────────────

  router.get(
    "/linked-providers",
    requireAuthIfConfigured,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!socialAuthService || !authService) {
        return res.status(501).json({ error: "Not configured" });
      }

      try {
        const userId = req.user?.userId;
        if (!userId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const providers = await socialAuthService.getLinkedProviders(userId);
        const user = await authService.getUserById(userId);
        const userWithPw = await authService.getPrismaClient().user.findUnique({
          where: { id: userId },
          select: { password: true },
        });
        res.json({
          providers,
          hasPassword: !!userWithPw?.password,
          phoneE164: user?.phoneE164 || null,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/unlink-provider",
    authLimiter,
    requireAuthIfConfigured,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!socialAuthService) {
        return res.status(501).json({ error: "Not configured" });
      }

      try {
        const userId = req.user?.userId;
        if (!userId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const { provider, providerSubject } = req.body;
        if (
          !provider ||
          typeof provider !== "string" ||
          !providerSubject ||
          typeof providerSubject !== "string"
        ) {
          return res
            .status(400)
            .json({ error: "provider and providerSubject are required" });
        }

        await socialAuthService.unlinkProvider(
          userId,
          provider,
          providerSubject,
        );
        res.json({ message: "Provider unlinked" });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Cannot remove your only sign-in method"
        ) {
          return res.status(400).json({ error: error.message });
        }
        next(error);
      }
    },
  );

  router.post(
    "/set-password",
    authLimiter,
    requireAuthIfConfigured,
    async (req: Request, res: Response, next: NextFunction) => {
      if (!authService) {
        return res.status(501).json({ error: "Not configured" });
      }

      try {
        const userId = req.user?.userId;
        if (!userId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const { password } = req.body;
        if (!password || typeof password !== "string") {
          return res.status(400).json({ error: "Password is required" });
        }
        if (password.length < 8) {
          return res
            .status(400)
            .json({ error: "Password must be at least 8 characters" });
        }
        if (password.length > 72) {
          return res
            .status(400)
            .json({ error: "Password cannot exceed 72 characters" });
        }

        // Only allow setting password when user doesn't have one
        const user = await authService.getUserById(userId);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        // Check if user already has a password via a raw query
        const fullUser = await authService.getPrismaClient().user.findUnique({
          where: { id: userId },
          select: { password: true },
        });
        if (fullUser?.password) {
          return res.status(400).json({
            error:
              "Password already set. Use change-password or reset-password instead.",
          });
        }

        const bcrypt = await import("bcrypt");
        const hashedPassword = await bcrypt.hash(password, 10);
        await authService.getPrismaClient().user.update({
          where: { id: userId },
          data: { password: hashedPassword },
        });

        res.json({ message: "Password set successfully" });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
