import assert from "node:assert/strict";

/** This runner has no production mode, endpoint flag, database or auth setup. */
export function assertSyntheticReviewEnvironment(environment = process.env) {
  assert.equal(
    environment.NODE_ENV,
    "test",
    "Synthetic review requires NODE_ENV=test",
  );
  for (const key of [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "DATABASE_URL_TEST",
    "BASE_URL",
    "REVIEW_BASE_URL",
  ]) {
    if (!environment[key]) continue;
    let value;
    try {
      value = new URL(environment[key]);
    } catch {
      throw new Error(`${key} is invalid; value withheld`);
    }
    assert.ok(
      ["127.0.0.1", "[::1]"].includes(value.hostname),
      `${key} must use a literal loopback address; value withheld`,
    );
    assert.ok(
      !value.search && !value.hash,
      `${key} must not contain connection overrides; value withheld`,
    );
    if (key.includes("DATABASE")) {
      assert.ok(
        ["postgres:", "postgresql:"].includes(value.protocol),
        `${key} must use PostgreSQL`,
      );
      assert.ok(
        /^\/(?:planwren_review_disposable|planwren_review_test|todos_test)$/.test(
          value.pathname,
        ),
        `${key} must name a disposable review/test database; value withheld`,
      );
    } else {
      assert.equal(
        value.protocol,
        "http:",
        `${key} must use plain HTTP on loopback for this local runner`,
      );
      assert.ok(
        !value.username && !value.password,
        `${key} must not include credentials`,
      );
    }
  }
}
