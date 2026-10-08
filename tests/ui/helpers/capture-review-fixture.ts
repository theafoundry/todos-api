import { expect, type BrowserContext } from "@playwright/test";
import type { CaptureItemDto } from "../../../client-react/src/api/inbox";
import {
  installMobileFixture,
  mobileTask,
  MOBILE_NOW,
  WriteGate,
  type FixtureWrite,
} from "./mobile-fixture";

export function captureItem(
  patch: Partial<CaptureItemDto> = {},
): CaptureItemDto {
  return {
    id: "capture-conversation",
    text: "Ask Maya for the launch checklist\nKeep the pilot to two weeks.",
    source: "api",
    capturedAt: MOBILE_NOW.toISOString(),
    lifecycle: "new",
    triageResult: null,
    createdAt: MOBILE_NOW.toISOString(),
    updatedAt: MOBILE_NOW.toISOString(),
    ...patch,
  };
}

/** Capture review is stateful, local-only, and never contacts a real API. */
export async function installCaptureReviewFixture(
  context: BrowserContext,
  baseURL: string,
  initialCaptures = [captureItem()],
) {
  const api = await installMobileFixture(context, baseURL, []);
  const origin = new URL(baseURL).origin;
  let captures = structuredClone(initialCaptures);
  let nextId = 0;
  const writes: FixtureWrite[] = [];
  const reads: string[] = [];
  const unexpected: string[] = [];
  const gates: WriteGate[] = [];
  const captureKeys: string[] = [];
  const capturedByKey = new Map<string, CaptureItemDto>();
  let readStatus = 200;

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.fallback();
    const method = request.method();
    const path = url.pathname;
    if (
      method === "GET" &&
      (path === "/activity-events" || /^\/todos\/[^/]+\/subtasks$/.test(path))
    ) {
      reads.push(path);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    }
    if (
      method === "POST" &&
      [
        "/agent/read/suggest_capture_route",
        "/ai/decision-assist/stub",
      ].includes(path)
    ) {
      reads.push(path);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          path === "/agent/read/suggest_capture_route"
            ? {
                data: {
                  route: "triage",
                  confidence: 1,
                  why: "Review this intention in Inbox",
                },
              }
            : { suggestions: [] },
        ),
      });
    }
    if (
      !path.startsWith("/capture") &&
      path !== "/agent/write/capture_inbox_item"
    )
      return route.fallback();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    if (method === "GET") reads.push(`${path}${url.search}`);
    else writes.push({ method, path, body });
    if (path === "/agent/write/capture_inbox_item") {
      const key = request.headers()["idempotency-key"];
      expect(key).toMatch(/^[0-9a-f-]{36}$/i);
      expect(request.headers()["x-planwren-offline-mode"]).toBe("manual");
      captureKeys.push(key);
    }
    const gateIndex = gates.findIndex(
      (gate) => gate.method === method && gate.path === path,
    );
    let response: { status?: number; body?: unknown; commit?: boolean } = {};
    if (gateIndex >= 0) {
      const [gate] = gates.splice(gateIndex, 1);
      gate.observed.resolve({ method, path, body });
      response = await gate.response.promise;
    }
    if ((response.status ?? 200) >= 400 && !response.commit)
      return json(
        { error: "Fixture could not save this capture" },
        response.status,
      );
    if (method === "GET" && path === "/capture") {
      if (url.searchParams.get("review") !== "pending") {
        unexpected.push(`${method} ${path}${url.search}`);
        return json(
          { error: "Capture review must request pending captures" },
          501,
        );
      }
      if (readStatus >= 400)
        return json({ error: "Fixture could not load Inbox" }, readStatus);
      return json(
        response.body ??
          captures.filter((item) => {
            const metadata = item.triageResult as Record<
              string,
              unknown
            > | null;
            return item.lifecycle !== "discarded" && !metadata?.promotedId;
          }),
      );
    }
    if (method === "POST" && path === "/agent/write/capture_inbox_item") {
      const key = request.headers()["idempotency-key"];
      let item = capturedByKey.get(key);
      if (!item) {
        item = captureItem({
          id: `created-capture-${++nextId}`,
          text: String(body.text),
          source: String(body.source),
        });
        captures.push(item);
        capturedByKey.set(key, item);
      }
      return json(
        response.body ?? {
          data: { item },
          trace: { operation: "capture_inbox_item" },
        },
        response.status ?? 201,
      );
    }
    const match = path.match(/^\/capture\/([^/]+)\/(accept|discard)$/);
    const item = captures.find((capture) => capture.id === match?.[1]);
    if (method === "POST" && match && item) {
      if (match[2] === "discard") {
        item.lifecycle = "discarded";
        return json(response.body ?? item, response.status);
      }
      const taskId = `accepted-${item.id}`;
      let task = api.todos().find((todo) => todo.id === taskId);
      const created = !task;
      if (!task) {
        task = mobileTask({
          id: taskId,
          title:
            typeof body.title === "string"
              ? body.title
              : item.text.trim().slice(0, 200),
          description: null,
          notes: `Captured from ${item.source ?? "unspecified source"} at ${item.capturedAt}\n\n${item.text}`,
          projectId: null,
          status: "next",
          tags: [],
          priority: "medium",
          energy: null,
          estimateMinutes: null,
        });
        api.replaceTodos([...api.todos(), task]);
        item.lifecycle = "triaged";
        item.triageResult = { promotedAs: "task", promotedId: taskId };
      }
      return json(
        response.body ??
          ((response.status ?? 200) >= 400
            ? { error: "Acceptance committed before the response failed" }
            : { task, created }),
        response.status,
      );
    }
    unexpected.push(`${method} ${path}`);
    return json({ error: "Unexpected capture API request blocked" }, 501);
  });

  return {
    api,
    writes,
    reads,
    captureKeys,
    setReadStatus(status: number) {
      readStatus = status;
    },
    replaceCaptures(next: CaptureItemDto[]) {
      captures = structuredClone(next);
    },
    captures: () => structuredClone(captures),
    holdNext(method = "POST", path = "/capture/capture-conversation/accept") {
      const gate = new WriteGate(method, path);
      gates.push(gate);
      return gate;
    },
    assertIsolated() {
      expect(unexpected).toEqual([]);
      api.assertIsolated();
    },
  };
}

export type CaptureReviewFixture = Awaited<
  ReturnType<typeof installCaptureReviewFixture>
>;
