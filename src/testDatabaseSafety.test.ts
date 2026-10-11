import {
  assertTestDatabaseIdentity,
  validateTestDatabaseUrl,
  type TestDatabaseIdentity,
} from "../test/testDatabaseSafety";

const target = "postgresql://fixture@127.0.0.1:55581/planwren_test";
const identity: TestDatabaseIdentity = {
  databaseName: "planwren_test",
  serverAddress: "127.0.0.1",
  serverPort: 55581,
};
const validate = (url: string, allowRemote = false) =>
  validateTestDatabaseUrl(url, { allowRemote, environment: {} });

describe("Disposable database connection guards", () => {
  test.each([
    target,
    `${target}?schema=public`,
    "postgres://fixture@localhost:55581/planwren_test",
    "postgresql://fixture@[::1]:55581/planwren_test",
  ])("supports established local test URLs %s", (url) => {
    expect(validate(url).pathname).toBe("/planwren_test");
  });

  test.each([
    "host=remote.example.test",
    "hostaddr=192.0.2.1",
    "port=5432",
    "dbname=production",
    "user=other",
    "password=synthetic",
    "options=-csearch_path%3Dproduction",
    "sslmode=require",
    "service=production",
    "%68ost=remote.example.test",
    "schema=public&host=remote.example.test",
    "schema=public&schema=public",
    "schema=production",
    "schema=public%26host%3Dremote.example.test",
  ])(
    "rejects driver query overrides before any database access: %s",
    (query) => {
      expect(() => validate(`${target}?${query}`)).toThrow(
        "Test database connection overrides are not allowed",
      );
    },
  );

  test.each([
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
  ])("rejects inherited client override %s", (key) => {
    expect(() =>
      validateTestDatabaseUrl(target, {
        environment: { [key]: "synthetic-override" },
      }),
    ).toThrow("Test database connection overrides are not allowed");
  });

  test.each([
    `${target}#connection-override`,
    "https://127.0.0.1:55581/planwren_test",
    "postgresql://test-user@127.0.0.1:55581/production",
    "not a PostgreSQL URL",
  ])("rejects unsafe scheme/fragment/database URLs %s", (url) => {
    expect(() => validate(url)).toThrow();
  });

  test("remote test access requires the existing explicit opt-in", () => {
    const remote =
      "postgresql://fixture@remote.example.test:6432/planwren_test";
    expect(() => validate(remote)).toThrow(
      "Test fixtures require a local PostgreSQL database",
    );
    const parsed = validate(remote, true);
    expect(() =>
      assertTestDatabaseIdentity(
        parsed,
        {
          databaseName: "planwren_test",
          serverAddress: "192.0.2.1",
          serverPort: 5432,
        },
        { allowRemote: true },
      ),
    ).not.toThrow();
    expect(() => assertTestDatabaseIdentity(parsed, identity)).toThrow();
    expect(() => validate(`${remote}?host=other.example.test`, true)).toThrow();
  });

  test("requires read-only server proof to match the exact local database/address/port", () => {
    expect(() =>
      assertTestDatabaseIdentity(validate(target), identity),
    ).not.toThrow();
    expect(() =>
      assertTestDatabaseIdentity(
        validate("postgresql://fixture@[::1]:55581/planwren_test"),
        { ...identity, serverAddress: "::1" },
      ),
    ).not.toThrow();
    expect(() =>
      assertTestDatabaseIdentity(
        validate("postgresql://fixture@localhost/planwren_test"),
        { ...identity, serverPort: 5432 },
      ),
    ).not.toThrow();
  });

  test.each([
    { databaseName: "production" },
    { serverAddress: "192.0.2.1" },
    { serverAddress: null },
    { serverPort: 5432 },
    { serverPort: null },
    { serverPort: 0 },
    { serverPort: 55581.5 },
  ])("rejects mismatched connected server evidence %p", (override) => {
    expect(() =>
      assertTestDatabaseIdentity(validate(target), {
        ...identity,
        ...override,
      }),
    ).toThrow(
      "Connected test database identity does not match the approved target",
    );
  });
});
