import { NextFunction, Request, Response } from "express";
import { AuthService } from "../services/authService";
import { getAgentRequestContext } from "../agent/agentContext";

function getAgentRouteMetadata(req: Request): {
  action: string;
  readOnly: boolean;
} {
  const path = req.path || "";
  const parts = path.split("/").filter(Boolean);
  const scope = parts[0];
  const action = parts[1] || "unknown_action";

  return {
    action,
    readOnly: scope === "read",
  };
}

function buildTrace(req: Request) {
  const context = getAgentRequestContext(req);
  return {
    requestId: context.requestId,
    actor: context.actor,
    ...(context.idempotencyKey
      ? { idempotencyKey: context.idempotencyKey }
      : {}),
    timestamp: new Date().toISOString(),
  };
}

function sendAgentAuthError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
  hint: string,
): void {
  const route = getAgentRouteMetadata(req);
  res.status(status).json({
    ok: false,
    action: route.action,
    readOnly: route.readOnly,
    error: {
      code,
      message,
      retryable: false,
      hint,
    },
    trace: buildTrace(req),
  });
}

export function agentAuthMiddleware(authService: AuthService) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      sendAgentAuthError(
        req,
        res,
        401,
        "AUTH_REQUIRED",
        "Authorization header missing",
        "Provide Authorization: Bearer <token>.",
      );
      return;
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      sendAgentAuthError(
        req,
        res,
        401,
        "INVALID_AUTHORIZATION_FORMAT",
        "Invalid authorization format. Expected: Bearer <token>",
        "Send a bearer token using the Authorization header.",
      );
      return;
    }

    const token = parts[1];

    try {
      const payload = await authService.verifyActiveToken(token);
      req.user = {
        userId: payload.userId,
        email: payload.email,
      };
      next();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      if (message === "Token expired") {
        sendAgentAuthError(
          req,
          res,
          401,
          "TOKEN_EXPIRED",
          "Token expired",
          "Refresh the access token and retry the action.",
        );
        return;
      }
      if (message === "Invalid token") {
        sendAgentAuthError(
          req,
          res,
          401,
          "INVALID_TOKEN",
          "Invalid token",
          "Refresh the access token or obtain a new bearer token.",
        );
        return;
      }
      sendAgentAuthError(
        req,
        res,
        401,
        "AUTHENTICATION_FAILED",
        "Authentication failed",
        "Verify the bearer token and retry.",
      );
    }
  };
}
