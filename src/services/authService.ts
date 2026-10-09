import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { EmailService } from "./emailService";
import { config } from "../config";
import {
  formatMcpOAuthScopes,
  getMcpApplicationScopes,
  McpOAuthScope,
  normalizeMcpOAuthScopes,
} from "../mcp/mcpScopes";
import { McpScope } from "../types";

export interface RegisterDto {
  email: string;
  password: string;
  name?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string | null;
    name: string | null;
  };
  token: string;
  refreshToken?: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
}

export interface McpTokenPayload extends JwtPayload {
  tokenType: "mcp";
  scopes: McpScope[];
  oauthScopes?: McpOAuthScope[];
  assistantName?: string;
  clientId?: string;
  sessionId?: string;
  resource?: string;
}

export interface McpTokenResponse {
  token: string;
  tokenType: "Bearer";
  scope: string;
  scopes: McpOAuthScope[];
  expiresAt: string;
  expiresIn: number;
  assistantName?: string;
  clientId?: string;
}

export interface AdminBootstrapStatus {
  enabled: boolean;
  reason?: "not_configured" | "already_admin" | "already_provisioned";
}

export class AuthService {
  private readonly SALT_ROUNDS = 10;
  private readonly ACCESS_JWT_SECRET: string;
  private readonly REFRESH_JWT_SECRET: string;
  private readonly JWT_EXPIRES_IN = "15m"; // Short-lived access token
  private readonly MCP_JWT_EXPIRES_IN = "30d";
  private readonly MCP_JWT_EXPIRES_IN_MS = 30 * 24 * 60 * 60 * 1000;
  private readonly MCP_APP_JWT_EXPIRES_IN = "60m";
  private readonly MCP_APP_JWT_EXPIRES_IN_MS = 60 * 60 * 1000;
  private readonly REFRESH_TOKEN_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
  private emailService: EmailService;

  constructor(private prisma: PrismaClient) {
    // Allow tests to override via process.env before constructing AuthService.
    this.ACCESS_JWT_SECRET =
      process.env.JWT_ACCESS_SECRET ||
      process.env.JWT_SECRET ||
      config.accessJwtSecret;
    this.REFRESH_JWT_SECRET =
      process.env.JWT_REFRESH_SECRET ||
      process.env.JWT_SECRET ||
      config.refreshJwtSecret;
    this.emailService = new EmailService();
  }

  // Keep auth responses off the SMTP critical path.
  private dispatchAsyncTask(
    task: () => Promise<void>,
    onError: (error: unknown) => void,
  ): void {
    void Promise.resolve().then(task).catch(onError);
  }

  dispatchVerificationEmail(
    userId: string,
    failureMessage = "Failed to send verification email:",
  ): void {
    this.dispatchAsyncTask(
      () => this.sendVerificationEmail(userId),
      (error) => {
        console.error(failureMessage, error);
      },
    );
  }

  private dispatchPasswordResetEmail(email: string, token: string): void {
    this.dispatchAsyncTask(
      () => this.emailService.sendPasswordResetEmail(email, token),
      (error) => {
        console.error("Failed to send password reset email:", error);
      },
    );
  }

  /**
   * Register a new user
   * @throws Error if email already exists or validation fails
   */
  async register(dto: RegisterDto): Promise<AuthResponse> {
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new Error("Email already registered");
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, this.SALT_ROUNDS);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
      },
    });

    this.dispatchVerificationEmail(user.id);

    // Generate JWT token and refresh token (email always present for register)
    const token = this.generateToken({
      userId: user.id,
      email: user.email!,
    });
    const refreshToken = await this.createRefreshToken(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      token,
      refreshToken,
    };
  }

  /**
   * Issue JWT access token + refresh token for any authenticated user.
   * Used by social and phone auth flows.
   */
  async issueTokens(
    userId: string,
    email: string | null,
  ): Promise<{ token: string; refreshToken: string }> {
    const token = this.generateToken({
      userId,
      email: email || "",
    });
    const refreshToken = await this.createRefreshToken(userId);
    return { token, refreshToken };
  }

  /**
   * Login user with email and password
   * @throws Error if credentials are invalid
   */
  async login(dto: LoginDto): Promise<AuthResponse> {
    // Fast path: exact normalized email match.
    let user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Backward compatibility for legacy rows that were stored with mixed-case emails.
    if (!user) {
      user = await this.prisma.user.findFirst({
        where: {
          email: {
            equals: dto.email,
            mode: "insensitive",
          },
        },
      });
    }

    if (!user) {
      throw new Error("Invalid credentials");
    }

    // Social/phone-only users have no password — return generic error
    if (!user.password) {
      throw new Error("Invalid credentials");
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new Error("Invalid credentials");
    }

    // Generate JWT token and refresh token (email always present for login)
    const token = this.generateToken({
      userId: user.id,
      email: user.email!,
    });
    const refreshToken = await this.createRefreshToken(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      token,
      refreshToken,
    };
  }

  /**
   * Verify an application access token. Delegated MCP credentials are verified
   * separately and never establish application or account-management authority.
   * @throws Error if token is invalid or expired
   */
  verifyToken(token: string): JwtPayload {
    try {
      const payload = jwt.verify(token, this.ACCESS_JWT_SECRET, {
        algorithms: ["HS256"],
      });
      // This is the complete access-token contract used by login, refresh,
      // social/phone login and runner enrollment. Enrollment can have no email.
      const accessClaims = new Set(["userId", "email", "iat", "exp"]);
      if (
        typeof payload !== "object" ||
        payload === null ||
        Object.keys(payload).some((claim) => !accessClaims.has(claim)) ||
        typeof payload.userId !== "string" ||
        !payload.userId.trim() ||
        (typeof payload.email !== "string" && payload.email !== null) ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number" ||
        !Number.isInteger(payload.iat) ||
        !Number.isInteger(payload.exp) ||
        payload.exp <= payload.iat
      ) {
        throw new jwt.JsonWebTokenError("Invalid application access token");
      }
      return { ...payload, email: payload.email ?? "" } as JwtPayload;
    } catch (error: any) {
      if (error.name === "TokenExpiredError") {
        throw new Error("Token expired");
      }
      if (error.name === "JsonWebTokenError") {
        throw new Error("Invalid token");
      }
      throw new Error("Token verification failed");
    }
  }

  createMcpToken(input: {
    userId: string;
    email: string;
    scopes: McpOAuthScope[];
    assistantName?: string;
    clientId?: string;
    sessionId?: string;
    resource?: string;
  }): McpTokenResponse {
    const normalizedScopes = normalizeMcpOAuthScopes(input.scopes, {
      requireNonEmpty: true,
    });
    const expiresIn = input.resource
      ? this.MCP_APP_JWT_EXPIRES_IN
      : this.MCP_JWT_EXPIRES_IN;
    const expiresInMs = input.resource
      ? this.MCP_APP_JWT_EXPIRES_IN_MS
      : this.MCP_JWT_EXPIRES_IN_MS;
    const token = jwt.sign(
      {
        userId: input.userId,
        email: input.email,
        tokenType: "mcp",
        scopes: normalizedScopes,
        ...(input.assistantName ? { assistantName: input.assistantName } : {}),
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.resource ? { resource: input.resource } : {}),
      },
      this.ACCESS_JWT_SECRET,
      {
        expiresIn,
        ...(input.resource
          ? {
              issuer: config.baseUrl,
              audience: input.resource,
              subject: input.userId,
              jwtid: randomUUID(),
            }
          : {}),
      },
    );

    return {
      token,
      tokenType: "Bearer",
      scope: formatMcpOAuthScopes(normalizedScopes),
      scopes: [...normalizedScopes],
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
      expiresIn: Math.floor(expiresInMs / 1000),
      ...(input.assistantName ? { assistantName: input.assistantName } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
    };
  }

  private decodeVerifiedMcpToken(
    token: string,
    options?: { resource?: string; requireResource?: boolean },
  ): McpTokenPayload & {
    issuedAt: number;
  } {
    try {
      const payload = jwt.verify(token, this.ACCESS_JWT_SECRET, {
        algorithms: ["HS256"],
      }) as Partial<McpTokenPayload> & {
        iat?: unknown;
        exp?: unknown;
        sub?: unknown;
        aud?: unknown;
        iss?: unknown;
        jti?: unknown;
      };

      if (payload.tokenType !== "mcp") {
        throw new Error("Invalid MCP token");
      }

      if (!Array.isArray(payload.scopes)) {
        throw new Error("Invalid MCP token");
      }

      let oauthScopes: McpOAuthScope[];
      try {
        oauthScopes = normalizeMcpOAuthScopes(payload.scopes, {
          requireNonEmpty: true,
        });
      } catch (_error) {
        throw new Error("Invalid MCP token");
      }

      if (
        typeof payload.userId !== "string" ||
        !payload.userId.trim() ||
        typeof payload.email !== "string" ||
        (Object.prototype.hasOwnProperty.call(payload, "sessionId") &&
          (typeof payload.sessionId !== "string" || !payload.sessionId.trim()))
      ) {
        throw new Error("Invalid MCP token");
      }

      if (
        typeof payload.iat !== "number" ||
        !Number.isInteger(payload.iat) ||
        typeof payload.exp !== "number" ||
        !Number.isInteger(payload.exp) ||
        payload.exp <= payload.iat
      ) {
        throw new Error("Invalid MCP token");
      }

      // Legacy local tokens have no resource-binding claims. A partially bound
      // token must never fall back to that compatibility mode.
      const bound = ["resource", "aud", "iss", "sub", "jti"].some((claim) =>
        Object.prototype.hasOwnProperty.call(payload, claim),
      );
      if (bound) {
        const supportedResources = new Set([
          new URL("/mcp", config.baseUrl).toString(),
          new URL("/mcp/app", config.baseUrl).toString(),
        ]);
        if (
          typeof payload.resource !== "string" ||
          !supportedResources.has(payload.resource) ||
          (options?.resource !== undefined &&
            payload.resource !== options.resource) ||
          payload.aud !== payload.resource ||
          payload.iss !== config.baseUrl ||
          payload.sub !== payload.userId ||
          typeof payload.jti !== "string" ||
          !payload.jti.trim() ||
          typeof payload.sessionId !== "string" ||
          !payload.sessionId.trim()
        ) {
          throw new Error("Invalid MCP token");
        }
        jwt.verify(token, this.ACCESS_JWT_SECRET, {
          algorithms: ["HS256"],
          issuer: config.baseUrl,
          audience: payload.resource,
        });
      } else if (options?.requireResource) {
        throw new Error("Invalid MCP token");
      }

      return {
        userId: payload.userId,
        email: payload.email,
        tokenType: "mcp",
        scopes: getMcpApplicationScopes(oauthScopes),
        oauthScopes,
        issuedAt: payload.iat,
        ...(typeof payload.assistantName === "string" &&
        payload.assistantName.trim()
          ? { assistantName: payload.assistantName.trim() }
          : {}),
        ...(typeof payload.clientId === "string" && payload.clientId.trim()
          ? { clientId: payload.clientId.trim() }
          : {}),
        ...(typeof payload.sessionId === "string" && payload.sessionId.trim()
          ? { sessionId: payload.sessionId.trim() }
          : {}),
        ...(typeof payload.resource === "string" && payload.resource.trim()
          ? { resource: payload.resource.trim() }
          : {}),
      };
    } catch (error: any) {
      if (error?.name === "TokenExpiredError") {
        throw new Error("Token expired");
      }
      throw new Error("Invalid MCP token");
    }
  }

  decodeMcpToken(token: string): McpTokenPayload & {
    issuedAt: number;
  } {
    return this.decodeVerifiedMcpToken(token);
  }

  async verifyMcpToken(
    token: string,
    options?: { resource?: string; requireResource?: boolean },
  ): Promise<McpTokenPayload> {
    const decoded = this.decodeVerifiedMcpToken(token, options);
    const issuedAt = decoded.issuedAt * 1000;

    const userRevocation = await this.prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { mcpRevokedAfter: true },
    });

    if (
      !userRevocation ||
      (userRevocation?.mcpRevokedAfter &&
        issuedAt <= userRevocation.mcpRevokedAfter.getTime())
    ) {
      throw new Error("MCP token revoked");
    }

    if (decoded.sessionId) {
      const session = await this.prisma.mcpAssistantSession.findUnique({
        where: { id: decoded.sessionId },
        select: {
          userId: true,
          revokedAt: true,
          resource: true,
        },
      });
      if (
        !session ||
        session.userId !== decoded.userId ||
        session.revokedAt !== null ||
        (session.resource ?? undefined) !== decoded.resource
      ) {
        throw new Error("MCP token revoked");
      }
    }

    return {
      userId: decoded.userId,
      email: decoded.email,
      tokenType: "mcp",
      scopes: decoded.scopes,
      oauthScopes: decoded.oauthScopes,
      ...(decoded.assistantName
        ? { assistantName: decoded.assistantName }
        : {}),
      ...(decoded.clientId ? { clientId: decoded.clientId } : {}),
      ...(decoded.sessionId ? { sessionId: decoded.sessionId } : {}),
      ...(decoded.resource ? { resource: decoded.resource } : {}),
    };
  }

  async revokeAllMcpTokensForUser(userId: string): Promise<string> {
    const revokedAt = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mcpRevokedAfter: revokedAt,
      },
    });
    return revokedAt.toISOString();
  }

  getPrismaClient(): PrismaClient {
    return this.prisma;
  }

  /**
   * Generate JWT token for user
   */
  private generateToken(payload: JwtPayload): string {
    return jwt.sign(payload, this.ACCESS_JWT_SECRET, {
      expiresIn: this.JWT_EXPIRES_IN,
    });
  }

  private hashRefreshToken(token: string): string {
    return createHmac("sha256", this.REFRESH_JWT_SECRET)
      .update(token)
      .digest("hex");
  }

  private timingSafeStringEqual(a: string, b: string): boolean {
    const aBuffer = Buffer.from(a, "utf8");
    const bBuffer = Buffer.from(b, "utf8");
    if (aBuffer.length !== bBuffer.length) {
      return false;
    }
    return timingSafeEqual(aBuffer, bBuffer);
  }

  private isValidAdminBootstrapSecret(secret: string): boolean {
    if (!config.adminBootstrapSecret) {
      return false;
    }

    const expected = createHash("sha256")
      .update(config.adminBootstrapSecret, "utf8")
      .digest();
    const provided = createHash("sha256").update(secret, "utf8").digest();

    return timingSafeEqual(expected, provided);
  }

  /**
   * Get user by ID (without password)
   */
  async getUserById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phoneE164: true,
        isVerified: true,
        role: true,
        plan: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Get user by email (including verification status)
   */
  async getUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        isVerified: true,
        role: true,
        plan: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Update user profile
   * @throws Error if email already in use
   */
  async updateUserProfile(
    userId: string,
    data: { name?: string | null; email?: string },
  ) {
    // Normalize email to lowercase to match registration/login behavior
    const normalizedEmail = data.email
      ? data.email.trim().toLowerCase()
      : undefined;

    // If email is being updated, check if it's already in use
    if (normalizedEmail) {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          email: normalizedEmail,
          NOT: { id: userId },
        },
      });

      if (existingUser) {
        throw new Error("Email already in use");
      }
    }

    // Check if the email is actually changing
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const emailIsChanging =
      normalizedEmail && currentUser && normalizedEmail !== currentUser.email;

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: data.name,
        email: normalizedEmail,
        // Reset verification when email changes
        ...(emailIsChanging && { isVerified: false, verificationToken: null }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        isVerified: true,
        role: true,
        plan: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Send new verification email when email changes
    if (emailIsChanging) {
      this.dispatchVerificationEmail(
        userId,
        "Failed to send verification email after email change:",
      );
    }

    return updatedUser;
  }

  async updateOnboarding(
    userId: string,
    patch: { step?: number; completedAt?: Date | null },
  ): Promise<void> {
    const data: Record<string, unknown> = {};
    if (patch.step !== undefined) data["onboardingStep"] = patch.step;
    if ("completedAt" in patch)
      data["onboardingCompletedAt"] = patch.completedAt;
    if (Object.keys(data).length === 0) return;
    await this.prisma.user.update({ where: { id: userId }, data });
  }

  /**
   * Create a refresh token for a user
   */
  private async createRefreshToken(userId: string): Promise<string> {
    const token = jwt.sign(
      { userId, jti: randomUUID() },
      this.REFRESH_JWT_SECRET,
      {
        expiresIn: "7d",
      },
    );
    const hashedToken = this.hashRefreshToken(token);

    const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_EXPIRES_IN);

    await this.prisma.refreshToken.create({
      data: {
        token: hashedToken,
        userId,
        expiresAt,
      },
    });

    return token;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ token: string; refreshToken: string }> {
    try {
      jwt.verify(refreshToken, this.REFRESH_JWT_SECRET);
    } catch (error) {
      throw new Error("Invalid refresh token");
    }

    const hashedToken = this.hashRefreshToken(refreshToken);

    let storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: hashedToken },
      include: { user: true },
    });

    if (!storedToken) {
      throw new Error("Invalid refresh token");
    }

    if (!this.timingSafeStringEqual(storedToken.token, hashedToken)) {
      throw new Error("Invalid refresh token");
    }

    if (storedToken.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({
        where: { id: storedToken.id },
      });
      throw new Error("Refresh token expired");
    }

    const newAccessToken = this.generateToken({
      userId: storedToken.user.id,
      email: storedToken.user.email || "",
    });

    // Rotate refresh token atomically: delete old + create new in one transaction
    // so a transient failure can't orphan the user with no valid token.
    const newRefreshTokenJwt = jwt.sign(
      { userId: storedToken.user.id, jti: randomUUID() },
      this.REFRESH_JWT_SECRET,
      { expiresIn: "7d" },
    );
    const newHashedToken = this.hashRefreshToken(newRefreshTokenJwt);
    const newExpiresAt = new Date(Date.now() + this.REFRESH_TOKEN_EXPIRES_IN);

    await this.prisma.$transaction([
      this.prisma.refreshToken.delete({
        where: { id: storedToken.id },
      }),
      this.prisma.refreshToken.create({
        data: {
          token: newHashedToken,
          userId: storedToken.user.id,
          expiresAt: newExpiresAt,
        },
      }),
    ]);

    return {
      token: newAccessToken,
      refreshToken: newRefreshTokenJwt,
    };
  }

  /**
   * Revoke a refresh token
   */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const hashedToken = this.hashRefreshToken(refreshToken);
    await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [{ token: hashedToken }, { token: refreshToken }],
      },
    });
  }

  /**
   * Send verification email
   */
  async sendVerificationEmail(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");

    const token = EmailService.generateToken();
    await this.prisma.user.update({
      where: { id: userId },
      data: { verificationToken: token },
    });

    if (!user.email) throw new Error("User has no email to verify");
    await this.emailService.sendVerificationEmail(user.email, token);
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { verificationToken: token },
    });

    if (!user) throw new Error("Invalid verification token");

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        verificationToken: null,
      },
    });
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Don't reveal if email exists
      return;
    }

    const token = EmailService.generateToken();
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: token,
        resetTokenExpiry: expiry,
      },
    });

    if (user.email) {
      this.dispatchPasswordResetEmail(user.email, token);
    }
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { resetToken: token },
    });

    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      throw new Error("Invalid or expired reset token");
    }

    const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

    // Update password and revoke all refresh tokens in parallel
    await Promise.all([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetToken: null,
          resetTokenExpiry: null,
        },
      }),
      this.prisma.refreshToken.deleteMany({
        where: { userId: user.id },
      }),
    ]);
  }

  /**
   * Check if user is admin
   */
  async isAdmin(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user?.role === "admin";
  }

  /**
   * Get all users (admin only)
   */
  async getAllUsers(options?: { limit?: number; offset?: number }) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        plan: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Update user role (admin only)
   */
  async updateUserRole(userId: string, role: "user" | "admin"): Promise<void> {
    if (!["user", "admin"].includes(role)) {
      throw new Error("Invalid role");
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { role },
    });
  }

  /**
   * Delete user (admin only)
   */
  async deleteUser(userId: string): Promise<void> {
    await this.prisma.user.delete({ where: { id: userId } });
  }

  /**
   * Determine whether admin bootstrap is available to the current user.
   */
  async getAdminBootstrapStatus(userId: string): Promise<AdminBootstrapStatus> {
    if (!config.adminBootstrapSecret) {
      return { enabled: false, reason: "not_configured" };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || user.role === "admin") {
      return { enabled: false, reason: "already_admin" };
    }

    const adminCount = await this.prisma.user.count({
      where: { role: "admin" },
    });
    if (adminCount > 0) {
      return { enabled: false, reason: "already_provisioned" };
    }

    return { enabled: true };
  }

  /**
   * Promote current user to admin when no admin exists and secret matches.
   */
  async bootstrapAdmin(userId: string, secret: string) {
    if (!config.adminBootstrapSecret) {
      throw new Error("Admin bootstrap is not configured");
    }
    if (!this.isValidAdminBootstrapSecret(secret)) {
      throw new Error("Invalid bootstrap secret");
    }

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const adminCount = await tx.user.count({
        where: { role: "admin" },
      });
      if (adminCount > 0) {
        throw new Error("Admin already provisioned");
      }

      return tx.user.update({
        where: { id: userId },
        data: { role: "admin" },
        select: {
          id: true,
          email: true,
          name: true,
          isVerified: true,
          role: true,
          plan: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    return updatedUser;
  }
}
