import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const insecureDefaultJwtSecret = "your-secret-key-change-in-production";
const nodeEnv = process.env.NODE_ENV || "development";
const accessJwtSecret =
  process.env.JWT_ACCESS_SECRET ||
  process.env.JWT_SECRET ||
  insecureDefaultJwtSecret;
const refreshJwtSecret =
  process.env.JWT_REFRESH_SECRET ||
  process.env.JWT_SECRET ||
  insecureDefaultJwtSecret;
const testDatabaseUrlEnvRaw = process.env.TEST_DATABASE_URL;
const testDatabaseUrlFromAlias =
  typeof testDatabaseUrlEnvRaw === "string" ? testDatabaseUrlEnvRaw.trim() : "";
const databaseUrlTestRaw = (process.env.DATABASE_URL_TEST || "").trim();
const databaseUrl =
  nodeEnv === "test"
    ? testDatabaseUrlFromAlias || databaseUrlTestRaw
    : process.env.DATABASE_URL;
const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
const adminBootstrapSecret =
  nodeEnv === "test"
    ? process.env.ADMIN_BOOTSTRAP_SECRET || "test-admin-bootstrap-secret"
    : (process.env.ADMIN_BOOTSTRAP_SECRET || "").trim();
const emailFeaturesEnabled =
  (process.env.EMAIL_FEATURES_ENABLED || "true").toLowerCase() === "true";
const smtpHost = (process.env.SMTP_HOST || "").trim();
const smtpPortRaw = (process.env.SMTP_PORT || "").trim();
const smtpPort = smtpPortRaw ? Number.parseInt(smtpPortRaw, 10) : NaN;
const smtpUser = (process.env.SMTP_USER || "").trim();
const smtpPass = (process.env.SMTP_PASS || "").trim();
const smtpFrom = (process.env.SMTP_FROM || "").trim();
const baseUrl = (process.env.BASE_URL || "").trim();
const requestBodyLimit = (process.env.REQUEST_BODY_LIMIT || "256kb").trim();
const formBodyLimit = (process.env.FORM_BODY_LIMIT || "64kb").trim();
const requestTimeoutMsRaw = (process.env.REQUEST_TIMEOUT_MS || "30000").trim();
const headersTimeoutMsRaw = (process.env.HEADERS_TIMEOUT_MS || "35000").trim();
const keepAliveTimeoutMsRaw = (
  process.env.KEEP_ALIVE_TIMEOUT_MS || "5000"
).trim();
const mcpOauthSessionCookieName = (
  process.env.MCP_OAUTH_SESSION_COOKIE_NAME || "mcp_link_session"
).trim();
const mcpOauthSessionMaxAgeMsRaw = (
  process.env.MCP_OAUTH_SESSION_MAX_AGE_MS || "900000"
).trim();
const aiProviderEnabled =
  (process.env.AI_PROVIDER_ENABLED || "false").toLowerCase() === "true";
const aiProviderBaseUrl = (
  process.env.AI_PROVIDER_BASE_URL || "https://api.openai.com/v1"
).trim();
const aiProviderApiKey = (process.env.AI_PROVIDER_API_KEY || "").trim();
const aiProviderModel = (process.env.AI_PROVIDER_MODEL || "gpt-4o-mini").trim();

// Financial limits have no defaults: enabling a key alone must never authorize spend.
function positiveIntegerSetting(name: string): number | undefined {
  const raw = (process.env[name] || "").trim();
  if (!/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function usdMicrosSetting(name: string): number | undefined {
  const raw = (process.env[name] || "").trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) return undefined;
  const [whole, fraction = ""] = raw.split(".");
  const value = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : undefined;
}

const providerRequestLimits = {
  free: positiveIntegerSetting("AI_PROVIDER_DAILY_REQUEST_LIMIT_FREE"),
  pro: positiveIntegerSetting("AI_PROVIDER_DAILY_REQUEST_LIMIT_PRO"),
  team: positiveIntegerSetting("AI_PROVIDER_DAILY_REQUEST_LIMIT_TEAM"),
};
const hasProviderRequestOverride = ["FREE", "PRO", "TEAM"].some(
  (plan) =>
    (process.env[`AI_PROVIDER_DAILY_REQUEST_LIMIT_${plan}`] || "").trim()
      .length > 0,
);
const githubRepo = (process.env.GITHUB_REPO || "karthikg80/todos-api").trim();
const githubApiBaseUrl = (
  process.env.GITHUB_API_BASE_URL || "https://api.github.com"
).trim();
const githubToken = (
  process.env.GITHUB_TOKEN ||
  process.env.GITHUB_API_TOKEN ||
  process.env.GH_TOKEN ||
  ""
).trim();
const aiDailySuggestionLimitRaw = (
  process.env.AI_DAILY_SUGGESTION_LIMIT || "50"
).trim();
const aiDailySuggestionLimit = Number.parseInt(aiDailySuggestionLimitRaw, 10);
const aiDailySuggestionLimitFreeRaw = (
  process.env.AI_DAILY_SUGGESTION_LIMIT_FREE || ""
).trim();
const aiDailySuggestionLimitProRaw = (
  process.env.AI_DAILY_SUGGESTION_LIMIT_PRO || ""
).trim();
const aiDailySuggestionLimitTeamRaw = (
  process.env.AI_DAILY_SUGGESTION_LIMIT_TEAM || ""
).trim();
const aiDailySuggestionLimitFree = Number.parseInt(
  aiDailySuggestionLimitFreeRaw,
  10,
);
const aiDailySuggestionLimitPro = Number.parseInt(
  aiDailySuggestionLimitProRaw,
  10,
);
const aiDailySuggestionLimitTeam = Number.parseInt(
  aiDailySuggestionLimitTeamRaw,
  10,
);
const suggestionLimitsByPlan = {
  free:
    Number.isInteger(aiDailySuggestionLimitFree) &&
    aiDailySuggestionLimitFree > 0
      ? aiDailySuggestionLimitFree
      : Number.isInteger(aiDailySuggestionLimit) && aiDailySuggestionLimit > 0
        ? aiDailySuggestionLimit
        : 50,
  pro:
    Number.isInteger(aiDailySuggestionLimitPro) && aiDailySuggestionLimitPro > 0
      ? aiDailySuggestionLimitPro
      : 250,
  team:
    Number.isInteger(aiDailySuggestionLimitTeam) &&
    aiDailySuggestionLimitTeam > 0
      ? aiDailySuggestionLimitTeam
      : 1000,
};
const aiDecisionAssistEnabled = ["1", "true"].includes(
  (process.env.AI_DECISION_ASSIST || "false").toLowerCase(),
);
const enableEvalPromptOverride =
  (process.env.ENABLE_EVAL_PROMPT_OVERRIDE || "false").toLowerCase() === "true";

// Social / phone auth feature flags
const googleLoginEnabled =
  (process.env.GOOGLE_LOGIN_ENABLED || "false").toLowerCase() === "true";
const appleLoginEnabled =
  (process.env.APPLE_LOGIN_ENABLED || "false").toLowerCase() === "true";
const phoneLoginEnabled =
  (process.env.PHONE_LOGIN_ENABLED || "false").toLowerCase() === "true";

// Google OAuth
const googleClientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
const googleClientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
const googleRedirectUri = (process.env.GOOGLE_REDIRECT_URI || "").trim();

// Apple Sign-In
const appleClientId = (process.env.APPLE_CLIENT_ID || "").trim();
const appleTeamId = (process.env.APPLE_TEAM_ID || "").trim();
const appleKeyId = (process.env.APPLE_KEY_ID || "").trim();
const applePrivateKey = (process.env.APPLE_PRIVATE_KEY || "").trim();

// Twilio Verify
const twilioAccountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
const twilioAuthToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
const twilioVerifyServiceSid = (
  process.env.TWILIO_VERIFY_SERVICE_SID || ""
).trim();
const requestTimeoutMs = Number.parseInt(requestTimeoutMsRaw, 10);
const headersTimeoutMs = Number.parseInt(headersTimeoutMsRaw, 10);
const keepAliveTimeoutMs = Number.parseInt(keepAliveTimeoutMsRaw, 10);
const mcpOauthSessionMaxAgeMs = Number.parseInt(mcpOauthSessionMaxAgeMsRaw, 10);

if (nodeEnv === "production") {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set in production");
  }

  if (accessJwtSecret === insecureDefaultJwtSecret) {
    throw new Error(
      "JWT_ACCESS_SECRET must be set to a strong non-default value in production",
    );
  }

  if (refreshJwtSecret === insecureDefaultJwtSecret) {
    throw new Error(
      "JWT_REFRESH_SECRET must be set to a strong non-default value in production",
    );
  }

  if (accessJwtSecret === refreshJwtSecret) {
    throw new Error(
      "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different in production",
    );
  }

  if (corsOrigins.length === 0) {
    throw new Error("CORS_ORIGINS must be configured in production");
  }

  if (!baseUrl) {
    throw new Error("BASE_URL must be set in production");
  }

  if (emailFeaturesEnabled) {
    if (!smtpHost) {
      throw new Error(
        "SMTP_HOST must be set in production when EMAIL_FEATURES_ENABLED=true",
      );
    }
    if (!Number.isInteger(smtpPort) || smtpPort <= 0) {
      throw new Error(
        "SMTP_PORT must be a positive integer in production when EMAIL_FEATURES_ENABLED=true",
      );
    }
    if (!smtpUser || !smtpPass) {
      throw new Error(
        "SMTP_USER and SMTP_PASS must be set in production when EMAIL_FEATURES_ENABLED=true",
      );
    }
    if (!smtpFrom) {
      throw new Error(
        "SMTP_FROM must be set in production when EMAIL_FEATURES_ENABLED=true",
      );
    }
  }
}

if (nodeEnv === "test" || testDatabaseUrlEnvRaw !== undefined) {
  if (testDatabaseUrlEnvRaw !== undefined && !testDatabaseUrlFromAlias) {
    throw new Error("TEST_DATABASE_URL must be non-empty when provided");
  }

  const testDbUrlToValidate = testDatabaseUrlFromAlias || databaseUrlTestRaw;
  if (testDbUrlToValidate) {
    const isPostgresUrl = /^postgres(ql)?:\/\//i.test(testDbUrlToValidate);
    if (!isPostgresUrl) {
      throw new Error(
        "TEST_DATABASE_URL/DATABASE_URL_TEST must be a valid PostgreSQL URL",
      );
    }
  }
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv,
  databaseUrl,
  accessJwtSecret,
  refreshJwtSecret,
  corsOrigins,
  adminBootstrapSecret,
  emailFeaturesEnabled,
  smtpHost,
  smtpPort: Number.isInteger(smtpPort) && smtpPort > 0 ? smtpPort : 587,
  smtpUser,
  smtpPass,
  smtpFrom,
  baseUrl: baseUrl || "http://localhost:3000",
  requestBodyLimit,
  formBodyLimit,
  requestTimeoutMs:
    Number.isInteger(requestTimeoutMs) && requestTimeoutMs > 0
      ? requestTimeoutMs
      : 30000,
  headersTimeoutMs:
    Number.isInteger(headersTimeoutMs) && headersTimeoutMs > 0
      ? headersTimeoutMs
      : 35000,
  keepAliveTimeoutMs:
    Number.isInteger(keepAliveTimeoutMs) && keepAliveTimeoutMs >= 0
      ? keepAliveTimeoutMs
      : 5000,
  mcpOauthSessionCookieName: mcpOauthSessionCookieName || "mcp_link_session",
  mcpOauthSessionMaxAgeMs:
    Number.isInteger(mcpOauthSessionMaxAgeMs) && mcpOauthSessionMaxAgeMs > 0
      ? mcpOauthSessionMaxAgeMs
      : 15 * 60 * 1000,
  aiProviderEnabled,
  aiProviderBaseUrl,
  aiProviderApiKey,
  aiProviderModel,
  aiProviderDailyBudgetMicros: usdMicrosSetting("AI_PROVIDER_DAILY_BUDGET_USD"),
  aiProviderDailyRequestLimitByPlan: !hasProviderRequestOverride
    ? { ...suggestionLimitsByPlan }
    : providerRequestLimits.free &&
        providerRequestLimits.pro &&
        providerRequestLimits.team
      ? {
          free: providerRequestLimits.free,
          pro: providerRequestLimits.pro,
          team: providerRequestLimits.team,
        }
      : undefined,
  aiProviderBillingModel: (process.env.AI_PROVIDER_BILLING_MODEL || "").trim(),
  aiProviderBillingBaseUrl: (
    process.env.AI_PROVIDER_BILLING_BASE_URL || ""
  ).trim(),
  aiProviderInputPriceMicrosPerMillionTokens: usdMicrosSetting(
    "AI_PROVIDER_INPUT_USD_PER_MILLION_TOKENS",
  ),
  aiProviderOutputPriceMicrosPerMillionTokens: usdMicrosSetting(
    "AI_PROVIDER_OUTPUT_USD_PER_MILLION_TOKENS",
  ),
  // This must be the verified provider/model context ceiling, including protocol overhead.
  aiProviderInputTokenCeiling: positiveIntegerSetting(
    "AI_PROVIDER_INPUT_TOKEN_CEILING",
  ),
  aiProviderMaxPromptBytes:
    positiveIntegerSetting("AI_PROVIDER_MAX_PROMPT_BYTES") ?? 32_768,
  aiProviderMaxOutputTokens:
    positiveIntegerSetting("AI_PROVIDER_MAX_OUTPUT_TOKENS") ?? 1_500,
  aiProviderMaxResponseBytes:
    positiveIntegerSetting("AI_PROVIDER_MAX_RESPONSE_BYTES") ?? 131_072,
  aiProviderTimeoutMs:
    positiveIntegerSetting("AI_PROVIDER_TIMEOUT_MS") ?? 15_000,
  aiProviderMaxConcurrent:
    positiveIntegerSetting("AI_PROVIDER_MAX_CONCURRENT") ?? 4,
  aiProviderMaxConcurrentPerUser:
    positiveIntegerSetting("AI_PROVIDER_MAX_CONCURRENT_PER_USER") ?? 1,
  githubRepo,
  githubApiBaseUrl,
  githubToken,
  aiDailySuggestionLimit:
    Number.isInteger(aiDailySuggestionLimit) && aiDailySuggestionLimit > 0
      ? aiDailySuggestionLimit
      : 50,
  aiDailySuggestionLimitByPlan: suggestionLimitsByPlan,
  aiDecisionAssistEnabled,
  enableEvalPromptOverride,

  // Social / phone auth
  googleLoginEnabled,
  googleClientId,
  googleClientSecret,
  googleRedirectUri:
    googleRedirectUri ||
    `${baseUrl || "http://localhost:3000"}/auth/google/callback`,
  appleLoginEnabled,
  appleClientId,
  appleTeamId,
  appleKeyId,
  applePrivateKey,
  phoneLoginEnabled,
  twilioAccountSid,
  twilioAuthToken,
  twilioVerifyServiceSid,
};
