import { NextFunction, Request, Response } from "express";
import { ValidationError } from "./validation/validation";
import { AppError } from "./domains/tasks/domainErrors";

type ErrorCodeCarrier = { code?: unknown };
type DriverErrorCarrier = {
  meta?: {
    driverAdapterError?: {
      cause?: { originalCode?: unknown; kind?: unknown; message?: unknown };
    };
  };
};

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function hasPrismaCode(error: unknown, codes: string[]): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  const code = (error as ErrorCodeCarrier).code;
  return typeof code === "string" && codes.includes(code);
}

export function isPrismaInvalidUuidError(error: unknown): boolean {
  if (hasPrismaCode(error, ["P2023"])) return true;
  if (!hasPrismaCode(error, ["P2007"])) return false;

  // Prisma 7's PostgreSQL adapter reports malformed UUID filters as P2007.
  // Other invalid input values must retain their original error behavior.
  const cause = (error as DriverErrorCarrier).meta?.driverAdapterError?.cause;
  return (
    cause?.originalCode === "22P02" &&
    cause.kind === "InvalidInputValue" &&
    typeof cause.message === "string" &&
    cause.message.startsWith("invalid input syntax for type uuid:")
  );
}

export function mapError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  // Domain errors from domains/tasks/domainErrors.ts — carry their own status
  if (error instanceof AppError) {
    return new HttpError(error.status, error.message);
  }

  // Validation errors from validation/validation.ts (no status field)
  if (error instanceof ValidationError) {
    return new HttpError(400, error.message);
  }

  // Legacy string-matching for errors thrown from services that haven't
  // migrated to typed domain errors yet. Each block should be removed
  // as the corresponding service adopts AppError subclasses.
  if (error instanceof Error) {
    if (
      error.message === "Email already registered" ||
      error.message === "Email already in use"
    ) {
      return new HttpError(409, error.message);
    }
    if (
      error.message === "Invalid credentials" ||
      error.message === "Invalid token" ||
      error.message === "Token expired" ||
      error.message.includes("Invalid refresh token")
    ) {
      return new HttpError(401, error.message);
    }
    if (
      error.message === "Invalid verification token" ||
      error.message === "Invalid or expired reset token" ||
      error.message === "Invalid role" ||
      error.message === "Admin bootstrap is not configured"
    ) {
      return new HttpError(400, error.message);
    }
    if (error.message === "Invalid bootstrap secret") {
      return new HttpError(403, error.message);
    }
    if (
      error.message === "Admin already provisioned" ||
      error.message === "Refresh token expired"
    ) {
      return new HttpError(409, error.message);
    }
    if (
      error.message === "Refresh token required" ||
      error.message === "Email required"
    ) {
      return new HttpError(400, error.message);
    }
  }

  if (isPrismaInvalidUuidError(error)) {
    return new HttpError(400, "Invalid ID format");
  }
  if (hasPrismaCode(error, ["P2025"])) {
    return new HttpError(404, "Resource not found");
  }

  return new HttpError(500, "Internal server error");
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const mapped = mapError(err);

  if (mapped.status >= 500) {
    console.error(err);
  }

  res.status(mapped.status).json({ error: mapped.message });
}
