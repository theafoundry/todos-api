export const REVIEW_DATABASE_NAME = "planwren_review_disposable";
export const REVIEW_DATABASE_MARKER =
  "PLANWREN_DISPOSABLE_LOCAL_REVIEW_FIXTURES_ONLY";
export const REVIEW_ACCOUNT_EMAIL = "fixture@example.invalid";
export const REVIEW_RESET_CONFIRMATION = "RESET_DEDICATED_REVIEW_ACCOUNT";
export const REVIEW_DISPOSABLE_CONFIRMATION =
  "RESET_LOCAL_DISPOSABLE_REVIEW_DATABASE";

// Only errors created by these guards are safe to print to shared logs.
export class ReviewResetSafetyError extends Error {}

export interface ReviewResetConfig {
  readonly databaseUrl: string;
  readonly userId: string;
  readonly email: string;
  readonly timezone: string;
}

export interface ReviewDatabaseProof {
  databaseName: string | null;
  serverAddress: string | null;
  marker: string | null;
}

interface ReviewAccount {
  id: string;
  email: string | null;
  isVerified: boolean;
}

interface ReviewEnrollment {
  timezone: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = (env[name] || "").trim();
  if (!value) throw new ReviewResetSafetyError(`${name} is required`);
  return value;
}

// Pure validation only: never load dotenv, a database client, or account data.
export function validateReviewResetEnvironment(
  env: NodeJS.ProcessEnv,
): ReviewResetConfig {
  if (env.NODE_ENV !== "test") {
    throw new ReviewResetSafetyError("Review reset requires NODE_ENV=test");
  }
  if (
    required(env, "REVIEW_RESET_DISPOSABLE_CONFIRM") !==
    REVIEW_DISPOSABLE_CONFIRMATION
  ) {
    throw new ReviewResetSafetyError(
      "REVIEW_RESET_DISPOSABLE_CONFIRM must confirm the local disposable database",
    );
  }
  if (required(env, "REVIEW_RESET_CONFIRM") !== REVIEW_RESET_CONFIRMATION) {
    throw new ReviewResetSafetyError(
      "REVIEW_RESET_CONFIRM must confirm the dedicated account",
    );
  }

  // PostgreSQL driver defaults must not come from an inherited shell session.
  if (
    Object.entries(env).some(([key, value]) => /^PG[A-Z_]*$/.test(key) && value)
  ) {
    throw new ReviewResetSafetyError(
      "Remove inherited PostgreSQL connection environment settings",
    );
  }

  const databaseUrl = required(env, "DATABASE_URL");
  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new ReviewResetSafetyError(
      "DATABASE_URL must be a local disposable PostgreSQL URL",
    );
  }
  if (
    target.search ||
    target.hash ||
    databaseUrl !== env.DATABASE_URL ||
    /[\s\\]/.test(databaseUrl)
  ) {
    throw new ReviewResetSafetyError(
      "DATABASE_URL must not contain URL options or unsafe syntax",
    );
  }
  // Match the original authority as well as parsed fields; DNS aliases, encoded
  // hosts, shorthand IPs, Unix sockets, and forwarded URL options are excluded.
  const literalTarget = databaseUrl.match(
    /^postgres(?:ql)?:\/\/(?:[^@/?#]+@)?(127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})\/planwren_review_disposable$/,
  );
  if (
    !literalTarget ||
    Number(literalTarget[2]) > 65535 ||
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.pathname !== `/${REVIEW_DATABASE_NAME}` ||
    !target.username
  ) {
    throw new ReviewResetSafetyError(
      "DATABASE_URL requires a literal loopback address, explicit port and user, and the dedicated disposable database",
    );
  }

  const userId = required(env, "REVIEW_ACCOUNT_USER_ID");
  const email = required(env, "REVIEW_ACCOUNT_EMAIL").toLowerCase();
  if (email !== REVIEW_ACCOUNT_EMAIL) {
    throw new ReviewResetSafetyError(
      "REVIEW_ACCOUNT_EMAIL must identify the reserved fixture account",
    );
  }
  const timezone = (env.REVIEW_TIMEZONE || "UTC").trim();
  if (timezone !== "UTC") {
    throw new ReviewResetSafetyError(
      "REVIEW_TIMEZONE must be UTC for the local review fixture baseline",
    );
  }

  return Object.freeze({ databaseUrl, userId, email, timezone });
}

// The URL is insufficient: loopback ports can forward elsewhere. Check proof
// from the same transaction that will mutate fixtures, before reading an account.
export function assertReviewResetDatabase(proof: ReviewDatabaseProof): void {
  if (
    proof.databaseName !== REVIEW_DATABASE_NAME ||
    !["127.0.0.1", "::1"].includes(proof.serverAddress || "") ||
    proof.marker !== REVIEW_DATABASE_MARKER
  ) {
    throw new ReviewResetSafetyError(
      "Review reset requires a loopback PostgreSQL server and the disposable database marker",
    );
  }
}

export function assertReviewResetAccount(
  account: ReviewAccount | null,
  config: ReviewResetConfig,
): asserts account is ReviewAccount {
  if (
    !account ||
    account.id !== config.userId ||
    account.email?.toLowerCase() !== config.email
  ) {
    throw new ReviewResetSafetyError(
      "REVIEW_ACCOUNT_USER_ID and REVIEW_ACCOUNT_EMAIL must identify the same existing fixture account",
    );
  }
  if (!account.isVerified) {
    throw new ReviewResetSafetyError(
      "The local fixture account must already be verified",
    );
  }
}

export function assertReviewResetEnrollment(
  enrollment: ReviewEnrollment | null,
): void {
  if (!enrollment || enrollment.timezone !== "UTC") {
    throw new ReviewResetSafetyError(
      "Review reset requires an existing UTC agent enrollment; provisioning and timezone changes are outside this tool",
    );
  }
}
