import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/authService";

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        tokenType?: "mcp";
      };
    }
  }
}

/**
 * Middleware to authenticate JWT tokens
 * Expects Authorization header: "Bearer <token>"
 */
export function authMiddleware(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        res.status(401).json({ error: "Authorization header missing" });
        return;
      }

      // Check Bearer format
      const parts = authHeader.split(" ");
      if (parts.length !== 2 || parts[0] !== "Bearer") {
        res.status(401).json({
          error: "Invalid authorization format. Expected: Bearer <token>",
        });
        return;
      }

      const token = parts[1];

      // Verify token
      const payload = authService.verifyToken(token);

      // Attach user to request
      req.user = {
        userId: payload.userId,
        email: payload.email,
        ...(payload.tokenType !== undefined
          ? { tokenType: payload.tokenType }
          : {}),
      };

      next();
    } catch (error: any) {
      if (error.message === "Token expired") {
        res.status(401).json({ error: "Token expired" });
        return;
      }
      if (error.message === "Invalid token") {
        res.status(401).json({ error: "Invalid token" });
        return;
      }
      res.status(401).json({ error: "Authentication failed" });
    }
  };
}
