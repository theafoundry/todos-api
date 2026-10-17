// Requires a compiled dist/ (npm run eval:all builds it first).
const assert = require("node:assert/strict");
const test = require("node:test");

const { AuthService } = require("../../dist/services/authService");
const {
  buildMcpSession,
  createMcpEvalApp,
  withAuthFixtureParity,
} = require("./app-harness");

async function settle(promise) {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

// A real AuthService method the eval mock deliberately does not implement.
function unimplementedAuthMethod(authService) {
  const name = Object.getOwnPropertyNames(AuthService.prototype).find(
    (method) =>
      method !== "constructor" &&
      !Object.prototype.hasOwnProperty.call(authService, method),
  );
  assert.ok(name, "expected AuthService to have a method the mock omits");
  return name;
}

for (const value of [undefined, null, false, 0, ""]) {
  test(`propagates a trial rejecting with ${JSON.stringify(value) ?? "undefined"}`, async () => {
    const result = await settle(
      withAuthFixtureParity(async () => {
        throw value;
      })({}),
    );

    assert.equal(result.ok, false, "falsy rejection must not pass the trial");
    assert.ok(Object.is(result.error, value));
  });
}

test("propagates an Error rejection unchanged", async () => {
  const failure = new Error("trial assertion failed");
  const result = await settle(
    withAuthFixtureParity(async () => {
      throw failure;
    })({}),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, failure);
});

test("resolves a passing trial with its output, including undefined", async () => {
  const output = { toolCount: 3 };
  assert.equal(await withAuthFixtureParity(async () => output)({}), output);
  assert.equal(
    await withAuthFixtureParity(async () => undefined)({}),
    undefined,
  );
});

test("passes the runner context through to the trial", async () => {
  const context = { writeJson() {} };
  let received;
  await withAuthFixtureParity(async (ctx) => {
    received = ctx;
  })(context);
  assert.equal(received, context);
});

test("reports auth fixture drift even when the trial itself passes", async () => {
  let missingMethod;
  const result = await settle(
    withAuthFixtureParity(async () => {
      const { auth } = createMcpEvalApp({
        session: buildMcpSession("user-1", ["tasks.read"]),
      });
      missingMethod = unimplementedAuthMethod(auth.authService);
      void auth.authService[missingMethod];
      return { ok: true };
    })({}),
  );

  assert.equal(result.ok, false);
  assert.match(
    result.error.message,
    new RegExp(
      `missing AuthService methods the app called: ${missingMethod}\\.`,
    ),
  );
  assert.equal(Object.hasOwn(result.error, "cause"), false);
});

for (const value of [new Error("downstream 400"), undefined, 0]) {
  test(`reports drift ahead of a ${value instanceof Error ? "Error" : String(value)} rejection and keeps it as the cause`, async () => {
    const result = await settle(
      withAuthFixtureParity(async () => {
        const { auth } = createMcpEvalApp({
          session: buildMcpSession("user-1", ["tasks.read"]),
        });
        void auth.authService[unimplementedAuthMethod(auth.authService)];
        throw value;
      })({}),
    );

    assert.equal(result.ok, false);
    assert.match(result.error.message, /Eval auth fixture is missing/);
    assert.equal(Object.hasOwn(result.error, "cause"), true);
    assert.ok(Object.is(result.error.cause, value));
  });
}

test("only attributes drift from fixtures created during the wrapped trial", async () => {
  const { auth } = createMcpEvalApp({
    session: buildMcpSession("user-1", ["tasks.read"]),
  });
  void auth.authService[unimplementedAuthMethod(auth.authService)];

  assert.deepEqual(await withAuthFixtureParity(async () => "ok")({}), "ok");
});
