import childProcess from "node:child_process";
import { hasLocalPostgresContainerProof } from "../test/localPostgresContainerProof";
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
  beforeEach(() => {
    jest.spyOn(childProcess, "execFileSync").mockImplementation(() => {
      throw new Error("Unexpected Docker access in offline guard tests");
    });
  });
  afterEach(() => jest.restoreAllMocks());
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

describe("Local PostgreSQL container routing proof", () => {
  const firstId = "a".repeat(12);
  const secondId = "b".repeat(12);
  const observed = {
    serverAddress: "172.18.0.2",
    serverPort: 5432,
    hostPort: 55581,
  };
  const metadata = () => ({
    running: true,
    image: "postgres:16",
    networks: {
      fixture: { IPAddress: observed.serverAddress, GlobalIPv6Address: "" },
    },
    ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "55581" }] },
  });
  let execute: jest.SpyInstance;
  beforeEach(() => {
    execute = jest
      .spyOn(childProcess, "execFileSync")
      .mockImplementation((_file, args) => {
        return args?.includes("ps")
          ? `${firstId}\n`
          : JSON.stringify(metadata());
      });
  });
  afterEach(() => jest.restoreAllMocks());

  test("accepts CI NAT only with exact running PostgreSQL address and port evidence", () => {
    const parsed = validate(
      "postgresql://fixture@localhost:55581/planwren_test?schema=public",
    );
    expect(() =>
      assertTestDatabaseIdentity(parsed, {
        databaseName: "planwren_test",
        serverAddress: observed.serverAddress,
        serverPort: 5432,
      }),
    ).not.toThrow();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][1]).toEqual([
      "--host",
      "unix:///var/run/docker.sock",
      "ps",
      "--filter",
      "status=running",
      "--filter",
      "publish=5432/tcp",
      "--format",
      "{{.ID}}",
    ]);
    const inspectArgs = execute.mock.calls[1][1] as string[];
    expect(inspectArgs).toContain("inspect");
    expect(inspectArgs.join(" ")).not.toMatch(/\.Config\.Env/);
    for (const [, , options] of execute.mock.calls) {
      expect(options).toMatchObject({
        timeout: 1000,
        maxBuffer: 65536,
        stdio: ["ignore", "pipe", "ignore"],
      });
      expect(options.env.DOCKER_HOST).toBeUndefined();
      expect(options.env.DOCKER_CONTEXT).toBeUndefined();
    }
  });

  test.each([
    "postgres:16-alpine",
    "docker.io/library/postgres:16",
    `postgres@sha256:${"a".repeat(64)}`,
  ])("accepts official image %s with loopback publication", (image) => {
    const value = metadata();
    value.image = image;
    value.ports["5432/tcp"][0].HostIp = "127.0.0.1";
    execute.mockImplementation((_file, args) =>
      args?.includes("ps") ? firstId : JSON.stringify(value),
    );
    expect(hasLocalPostgresContainerProof(observed)).toBe(true);
  });
  test("matches IPv6 network evidence and wildcard binding", () => {
    const value = metadata();
    value.networks.fixture.GlobalIPv6Address = "fd00::2";
    value.ports["5432/tcp"][0].HostIp = "::";
    execute.mockImplementation((_file, args) =>
      args?.includes("ps") ? firstId : JSON.stringify(value),
    );
    expect(
      hasLocalPostgresContainerProof({ ...observed, serverAddress: "fd00::2" }),
    ).toBe(true);
  });

  test.each([
    "stopped",
    "image",
    "address",
    "target port",
    "host port",
    "binding",
    "missing networks",
    "missing ports",
  ])("rejects mismatched %s", (reason) => {
    const value: any = metadata();
    if (reason === "stopped") value.running = false;
    if (reason === "image") value.image = "example/postgres:16";
    if (reason === "address") value.networks.fixture.IPAddress = "172.18.0.3";
    if (reason === "target port")
      value.ports = { "5433/tcp": value.ports["5432/tcp"] };
    if (reason === "host port") value.ports["5432/tcp"][0].HostPort = "55582";
    if (reason === "binding") value.ports["5432/tcp"][0].HostIp = "192.0.2.1";
    if (reason === "missing networks") delete value.networks;
    if (reason === "missing ports") delete value.ports;
    execute.mockImplementation((_file, args) =>
      args?.includes("ps") ? firstId : JSON.stringify(value),
    );
    expect(hasLocalPostgresContainerProof(observed)).toBe(false);
  });
  test.each([
    "",
    "not-an-id",
    `${firstId}\n${firstId}`,
    Array.from({ length: 9 }, (_, i) => i.toString(16).padStart(12, "0")).join(
      "\n",
    ),
  ])("rejects absent, malformed or excessive candidate list %s", (ids) => {
    execute.mockReturnValue(ids);
    expect(hasLocalPostgresContainerProof(observed)).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  test("rejects ambiguous matching containers", () => {
    execute.mockImplementation((_file, args) =>
      args?.includes("ps")
        ? `${firstId}\n${secondId}`
        : JSON.stringify(metadata()),
    );
    expect(hasLocalPostgresContainerProof(observed)).toBe(false);
    expect(execute).toHaveBeenCalledTimes(3);
  });
  test.each(["failure", "invalid JSON"])("fails closed on %s", (reason) => {
    execute.mockImplementation((_file, args) => {
      if (args?.includes("ps")) return firstId;
      if (reason === "failure") throw new Error("Synthetic Docker failure");
      return "not JSON";
    });
    expect(hasLocalPostgresContainerProof(observed)).toBe(false);
  });
  test("direct loopback, wrong database and remote URL never request Docker proof", () => {
    expect(() =>
      assertTestDatabaseIdentity(validate(target), identity),
    ).not.toThrow();
    expect(() =>
      assertTestDatabaseIdentity(validate(target), {
        ...identity,
        databaseName: "production",
        serverAddress: observed.serverAddress,
      }),
    ).toThrow();
    expect(() =>
      validate("postgresql://fixture@remote.example.test:55581/planwren_test"),
    ).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  test("does not use a caller's remote Docker host or context", () => {
    const originalHost = process.env.DOCKER_HOST;
    const originalContext = process.env.DOCKER_CONTEXT;
    try {
      process.env.DOCKER_HOST = "tcp://remote.example.test:2375";
      process.env.DOCKER_CONTEXT = "remote-fixture";
      expect(hasLocalPostgresContainerProof(observed)).toBe(true);
      for (const [, args, options] of execute.mock.calls) {
        expect(args.slice(0, 2)).toEqual([
          "--host",
          "unix:///var/run/docker.sock",
        ]);
        expect(options.env.DOCKER_HOST).toBeUndefined();
        expect(options.env.DOCKER_CONTEXT).toBeUndefined();
      }
    } finally {
      if (originalHost === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = originalHost;
      if (originalContext === undefined) delete process.env.DOCKER_CONTEXT;
      else process.env.DOCKER_CONTEXT = originalContext;
    }
  });
});
