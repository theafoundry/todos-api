import { createHash } from "node:crypto";
import type { AiProviderAdmissionService } from "./aiProviderAdmissionService";
import {
  bindAiProviderContext,
  getAiProviderAdmission,
  getAiProviderContext,
  nextAiProviderAdmissionKey,
  runWithAiProviderContext,
  type AiProviderSource,
} from "./aiProviderContext";

const admissionA = { name: "app-a" } as unknown as AiProviderAdmissionService;
const admissionB = { name: "app-b" } as unknown as AiProviderAdmissionService;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Authenticated AI provider context", () => {
  test("direct calls have no actor, admission dependency or key", () => {
    expect(getAiProviderContext()).toBeUndefined();
    expect(getAiProviderAdmission()).toBeUndefined();
    expect(() => nextAiProviderAdmissionKey("planner.plan_today")).toThrow(
      "Authenticated provider context is required",
    );
  });

  test.each<AiProviderSource>([
    "application",
    "admin",
    "agent",
    "legacy-mcp",
    "native-mcp",
  ])("binds a frozen verified actor for %s", (source) => {
    const input = { userId: "verified-account", source };
    runWithAiProviderContext(
      input,
      () => {
        input.userId = "changed-input";
        const context = getAiProviderContext()!;
        expect(context).toEqual({
          userId: "verified-account",
          source,
          requestKey: expect.stringMatching(
            /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
          ),
        });
        expect(Object.isFrozen(context)).toBe(true);
        expect(Object.keys(context).sort()).toEqual([
          "requestKey",
          "source",
          "userId",
        ]);
        expect(getAiProviderAdmission()).toBe(admissionA);
      },
      admissionA,
    );
    expect(getAiProviderContext()).toBeUndefined();
    expect(getAiProviderAdmission()).toBeUndefined();
  });

  test.each([undefined, null, "", "  ", " account ", 12, [], {}])(
    "rejects a malformed runtime actor %p without running the callback",
    (userId) => {
      const callback = jest.fn();
      expect(() =>
        runWithAiProviderContext(
          { userId: userId as string, source: "application" },
          callback,
          admissionA,
        ),
      ).toThrow("A verified account and provider source are required");
      expect(callback).not.toHaveBeenCalled();
    },
  );

  test("rejects unknown sources instead of accepting a caller tier", () => {
    expect(() =>
      runWithAiProviderContext(
        { userId: "account", source: "pro" as AiProviderSource },
        jest.fn(),
      ),
    ).toThrow("A verified account and provider source are required");
  });

  test("isolates interleaved authenticated requests and application dependencies", async () => {
    const firstReady = deferred();
    const secondReady = deferred();
    const observations: string[] = [];
    const first = runWithAiProviderContext(
      { userId: "account-a", source: "application" },
      async () => {
        firstReady.resolve();
        await secondReady.promise;
        observations.push(getAiProviderContext()!.userId);
        expect(getAiProviderAdmission()).toBe(admissionA);
        await Promise.resolve();
        expect(getAiProviderContext()!.userId).toBe("account-a");
      },
      admissionA,
    );
    const second = runWithAiProviderContext(
      { userId: "account-b", source: "admin" },
      async () => {
        await firstReady.promise;
        secondReady.resolve();
        observations.push(getAiProviderContext()!.userId);
        expect(getAiProviderAdmission()).toBe(admissionB);
        await Promise.resolve();
        expect(getAiProviderContext()!.source).toBe("admin");
      },
      admissionB,
    );
    await Promise.all([first, second]);
    expect(observations.sort()).toEqual(["account-a", "account-b"]);
    expect(getAiProviderContext()).toBeUndefined();
  });

  test("nested identities never inherit a service implicitly and restore the outer frame", () => {
    runWithAiProviderContext(
      { userId: "account-a", source: "application" },
      () => {
        const parent = getAiProviderContext();
        runWithAiProviderContext(
          { userId: "account-b", source: "agent" },
          () => {
            expect(getAiProviderContext()!.userId).toBe("account-b");
            expect(getAiProviderAdmission()).toBeUndefined();
          },
        );
        expect(getAiProviderContext()).toBe(parent);
        expect(getAiProviderAdmission()).toBe(admissionA);
      },
      admissionA,
    );
  });

  test("every dispatch key uses its shared private ordinal and fresh server request key", () => {
    const keys = new Set<string>();
    for (let request = 0; request < 2; request += 1) {
      runWithAiProviderContext(
        { userId: "same-account", source: "agent" },
        () => {
          const requestKey = getAiProviderContext()!.requestKey;
          const first = nextAiProviderAdmissionKey("planner.plan_today");
          const bound = bindAiProviderContext(() =>
            nextAiProviderAdmissionKey("planner.plan_today"),
          );
          const second = bound();
          const third = nextAiProviderAdmissionKey("planner.plan_today");
          for (const [ordinal, key] of [first, second, third].entries()) {
            expect(key).toMatch(/^[a-f0-9]{64}$/);
            expect(key).toBe(
              createHash("sha256")
                .update(
                  JSON.stringify([
                    requestKey,
                    "agent",
                    "planner.plan_today",
                    ordinal + 1,
                  ]),
                )
                .digest("hex"),
            );
            keys.add(key);
          }
        },
        admissionA,
      );
    }
    expect(keys.size).toBe(6);
  });

  test.each(["", " ", "caller request id", "x".repeat(101), null, 10])(
    "rejects unbounded or malformed operation labels %p",
    (operation) => {
      runWithAiProviderContext({ userId: "account", source: "agent" }, () => {
        expect(() => nextAiProviderAdmissionKey(operation as string)).toThrow(
          "A bounded server provider operation is required",
        );
      });
    },
  );

  test("bound deferred work retains its actor, service and ordinal under another request", async () => {
    const bound = runWithAiProviderContext(
      { userId: "account-a", source: "agent" },
      () => {
        nextAiProviderAdmissionKey("planner.plan_today");
        return bindAiProviderContext(async (value: number) => {
          await Promise.resolve();
          expect(getAiProviderContext()!.userId).toBe("account-a");
          expect(getAiProviderAdmission()).toBe(admissionA);
          return [value, nextAiProviderAdmissionKey("planner.plan_today")];
        });
      },
      admissionA,
    );
    await runWithAiProviderContext(
      { userId: "account-b", source: "application" },
      async () => {
        const result = await bound(42);
        expect(result[0]).toBe(42);
        expect(getAiProviderContext()!.userId).toBe("account-b");
        expect(getAiProviderAdmission()).toBe(admissionB);
      },
      admissionB,
    );
  });

  test("work bound without authentication clears an unrelated ambient identity", async () => {
    const bound = bindAiProviderContext(async () => {
      expect(getAiProviderContext()).toBeUndefined();
      expect(getAiProviderAdmission()).toBeUndefined();
      await Promise.resolve();
      expect(getAiProviderContext()).toBeUndefined();
    });
    await runWithAiProviderContext(
      { userId: "account", source: "application" },
      async () => {
        await bound();
        expect(getAiProviderContext()!.userId).toBe("account");
      },
      admissionA,
    );
  });

  test("a thrown callback cannot leak its account into later work", () => {
    expect(() =>
      runWithAiProviderContext(
        { userId: "account", source: "admin" },
        () => {
          throw new Error("test failure");
        },
        admissionA,
      ),
    ).toThrow("test failure");
    expect(getAiProviderContext()).toBeUndefined();
    expect(getAiProviderAdmission()).toBeUndefined();
  });
});
