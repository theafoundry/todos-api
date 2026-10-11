import { hasLocalPostgresContainerProof } from "./localPostgresContainerProof";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const connectionOverrides = [
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGPASSFILE",
  "PGOPTIONS",
];

export function validateTestDatabaseUrl(
  rawUrl: string,
  options: { allowRemote?: boolean; environment?: NodeJS.ProcessEnv } = {},
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Test database URL must be a valid PostgreSQL URL");
  }
  const parameters = Array.from(parsed.searchParams.entries());
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hash ||
    (parameters.length > 0 &&
      !(
        parameters.length === 1 &&
        parameters[0][0] === "schema" &&
        parameters[0][1] === "public"
      )) ||
    connectionOverrides.some(
      (key) => !!(options.environment ?? process.env)[key],
    )
  ) {
    throw new Error("Test database connection overrides are not allowed");
  }
  if (!parsed.pathname.toLowerCase().includes("test")) {
    throw new Error("Test database name must identify a test database");
  }
  if (
    !options.allowRemote &&
    !loopbackHosts.has(parsed.hostname.toLowerCase())
  ) {
    throw new Error("Test fixtures require a local PostgreSQL database");
  }
  return parsed;
}

export interface TestDatabaseIdentity {
  databaseName: string;
  serverAddress: string | null;
  serverPort: number | null;
}

/** Validate read-only server evidence before any reset or fixture cleanup. */
export function assertTestDatabaseIdentity(
  parsed: URL,
  identity: TestDatabaseIdentity,
  options: { allowRemote?: boolean } = {},
): void {
  const expectedName = decodeURIComponent(parsed.pathname.slice(1));
  const local = loopbackHosts.has(parsed.hostname.toLowerCase());
  if (
    identity.databaseName !== expectedName ||
    !identity.serverAddress ||
    !Number.isInteger(identity.serverPort) ||
    !identity.serverPort ||
    (!local && !options.allowRemote)
  ) {
    throw new Error(
      "Connected test database identity does not match the approved target",
    );
  }
  if (
    local &&
    !(
      loopbackAddresses.has(identity.serverAddress) &&
      identity.serverPort === Number(parsed.port || 5432)
    ) &&
    !hasLocalPostgresContainerProof({
      serverAddress: identity.serverAddress,
      serverPort: identity.serverPort,
      hostPort: Number(parsed.port || 5432),
    })
  ) {
    throw new Error(
      "Connected test database identity does not match the approved target",
    );
  }
}
