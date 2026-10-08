import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { Project, Todo } from "../../../client-react/src/types";
import { bootstrapTodosContext, MOCK_USER } from "./todos-view";

export const MOBILE_TASK_ID = "mobile-task";
export const MOBILE_TASK_TITLE = "Write the mobile plan";
export const MOBILE_NOW = new Date("2026-10-07T17:00:00.000Z"); // 10am Pacific

export function mobileTask(patch: Partial<Todo> = {}): Todo {
  return {
    id: MOBILE_TASK_ID,
    title: MOBILE_TASK_TITLE,
    description: "A task served by the isolated browser fixture",
    notes: "Original notes",
    status: "next",
    completed: false,
    completedAt: null,
    projectId: "mobile-project",
    tags: ["mobile"],
    dependsOnTaskIds: [],
    order: 1,
    priority: "medium",
    archived: false,
    energy: "medium",
    estimateMinutes: 25,
    dueDate: null,
    scheduledDate: null,
    userId: MOCK_USER.id,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
    subtasks: [],
    ...patch,
  };
}

export interface FixtureWrite {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

interface GateResponse {
  status?: number;
  /** Optional snapshot for simulating an older server response. */
  body?: unknown;
  /** Simulate a mutation committed before an ambiguous error reached the client. */
  commit?: boolean;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Hold a request until the test has inspected pending UI and explicitly releases it. */
export class WriteGate {
  readonly observed = deferred<FixtureWrite>();
  readonly response = deferred<GateResponse>();
  constructor(
    readonly method: string,
    readonly path: string,
  ) {}
  request() {
    return this.observed.promise;
  }
  respond(response: GateResponse = {}) {
    this.response.resolve(response);
  }
}

export async function installMobileFixture(
  context: BrowserContext,
  baseURL: string,
  initialTodos: Todo[] = [mobileTask()],
) {
  const origin = new URL(baseURL).origin;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)) {
    throw new Error("Mobile fixtures must never navigate a production origin");
  }
  await bootstrapTodosContext(context);
  await context.addInitScript(() => {
    localStorage.setItem("darkMode", "false");
    localStorage.setItem("mobile:customTab", "all");
  });
  let todos = structuredClone(initialTodos);
  let nextId = 0;
  const writes: FixtureWrite[] = [];
  const reads: string[] = [];
  const unexpected: string[] = [];
  const external: string[] = [];
  const pageErrors: string[] = [];
  const observeErrors = (page: Page) =>
    page.on("pageerror", (error) => pageErrors.push(error.message));
  context.pages().forEach(observeErrors);
  context.on("page", observeErrors);
  const gates: WriteGate[] = [];
  let focusBrief: Record<string, unknown> = {
    pinned: {
      rightNow: {
        narrative: "Your local mobile test plan",
        urgentItems: [],
        topRecommendation: null,
      },
      todayAgenda: [],
      rightNowProvenance: { source: "deterministic" },
      todayAgendaProvenance: { source: "deterministic" },
    },
    rankedPanels: [],
    generatedAt: MOBILE_NOW.toISOString(),
    expiresAt: "2026-12-07T00:00:00.000Z",
    cached: false,
    isStale: false,
  };
  const projects: Project[] = [
    {
      id: "mobile-project",
      name: "Mobile project",
      status: "active",
      archived: false,
      userId: MOCK_USER.id,
      createdAt: MOBILE_NOW.toISOString(),
      updatedAt: MOBILE_NOW.toISOString(),
    },
  ];

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      external.push(request.url());
      await route.abort();
      return;
    }
    const path = url.pathname;
    const method = request.method();
    // Only application assets may reach the loopback server; every API route is intercepted.
    if (
      !/^\/(?:auth|users|todos|projects|ai|api|agent|admin|tuneup|activity|search)(?:\/|$)/.test(
        path,
      )
    ) {
      await route.continue();
      return;
    }
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (method === "GET") {
      reads.push(path);
      const readGateIndex = gates.findIndex(
        (gate) => gate.method === method && gate.path === path,
      );
      if (readGateIndex >= 0) {
        const [gate] = gates.splice(readGateIndex, 1);
        gate.observed.resolve({ method, path, body: {} });
        const response = await gate.response.promise;
        if ((response.status ?? 200) >= 400)
          return json({ error: "Fixture read failed" }, response.status);
        if (response.body !== undefined)
          return json(response.body, response.status);
      }
      if (path === "/users/me") return json(MOCK_USER);
      if (path === "/users/me/settings") return json({});
      if (path === "/todos") return json(todos);
      if (path === "/projects") return json(projects);
      if (path === "/api/agent-profiles") return json({ agents: [] });
      if (path === "/ai/focus-brief") return json(focusBrief);
    }
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      const write = { method, path, body };
      writes.push(write);
      const gateIndex = gates.findIndex(
        (gate) => gate.method === method && gate.path === path,
      );
      let response: GateResponse = {};
      if (gateIndex >= 0) {
        const [gate] = gates.splice(gateIndex, 1);
        gate.observed.resolve(write);
        response = await gate.response.promise;
      }
      if ((response.status ?? 200) >= 400 && !response.commit)
        return json({ error: "Fixture rejected this change" }, response.status);
      if (response.status === 202 && !response.commit)
        return json(response.body ?? { queued: true }, 202);
      const taskIndex = todos.findIndex((todo) => path === `/todos/${todo.id}`);
      if (method === "PUT" && taskIndex >= 0) {
        const updated = {
          ...todos[taskIndex],
          ...body,
          updatedAt: MOBILE_NOW.toISOString(),
        } as Todo;
        todos[taskIndex] = updated;
        return json(
          response.body ??
            ((response.status ?? 200) >= 400
              ? {
                  error:
                    "Fixture committed this change before the response failed",
                }
              : updated),
          response.status,
        );
      }
      if (method === "POST" && path === "/todos") {
        const created = mobileTask({
          ...body,
          id: `created-${++nextId}`,
          status: "inbox",
        } as Partial<Todo>);
        todos.push(created);
        return json(response.body ?? created, response.status ?? 201);
      }
      if (method === "POST" && path === "/projects") {
        const created = {
          ...projects[0],
          ...body,
          id: `project-${++nextId}`,
        } as Project;
        projects.push(created);
        return json(created, 201);
      }
      if (method === "DELETE" && taskIndex >= 0) {
        todos.splice(taskIndex, 1);
        return json(response.body ?? { success: true }, response.status);
      }
      if (method === "POST" && path === "/ai/focus-brief/refresh")
        return json({ success: true }, response.status);
    }
    unexpected.push(`${method} ${path}`);
    return json(
      { error: "Unknown API request blocked by mobile fixture" },
      501,
    );
  });
  return {
    writes,
    reads,
    unexpected,
    external,
    todos: () => structuredClone(todos),
    setFocusBrief(brief: Record<string, unknown>) {
      focusBrief = structuredClone(brief);
    },
    replaceTodos(next: Todo[]) {
      todos = structuredClone(next);
    },
    holdNextRead(path = "/todos") {
      const gate = new WriteGate("GET", path);
      gates.push(gate);
      return gate;
    },
    holdNextWrite(method = "PUT", path = `/todos/${MOBILE_TASK_ID}`) {
      const gate = new WriteGate(method, path);
      gates.push(gate);
      return gate;
    },
    assertIsolated() {
      expect(unexpected).toEqual([]);
      expect(pageErrors).toEqual([]);
    },
  };
}

export type MobileFixture = Awaited<ReturnType<typeof installMobileFixture>>;

export async function openMobileApp(page: Page) {
  await page.clock.setFixedTime(MOBILE_NOW);
  await page.goto("/app/");
  await expect(page.locator(".m-shell")).toBeVisible();
  await page.getByRole("tab", { name: "Today", exact: true }).tap();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
}

export function taskRow(page: Page, title = MOBILE_TASK_TITLE) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) }).first();
}

export async function openTaskEditor(page: Page) {
  await taskRow(page).tap();
  const details = page.getByRole("dialog");
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: /Edit/, exact: false }).tap();
  const editor = page.getByRole("dialog");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAccessibleName("Edit task");
  return editor;
}

/** Dispatch DOM touch events in both engines; real tap journeys use Locator.tap(). */
export async function touchDrag(
  page: Page,
  selector: string,
  deltaX: number,
  deltaY: number,
  cancel = false,
) {
  await page.locator(selector).evaluate(
    async (element, delta) => {
      const bounds = element.getBoundingClientRect();
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + Math.min(bounds.height / 2, 100);
      const frame = () =>
        new Promise<void>((done) => requestAnimationFrame(() => done()));
      const send = (type: string, dx: number, dy: number) => {
        const touch = {
          identifier: 1,
          target: element,
          clientX: x + dx,
          clientY: y + dy,
        };
        // WebKit's Touch constructor is not callable. DOM touch-shaped events test
        // gesture ownership; Locator.tap() above exercises actual emulated taps.
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          touches: {
            value: type === "touchend" || type === "touchcancel" ? [] : [touch],
          },
          changedTouches: { value: [touch] },
          targetTouches: {
            value: type === "touchend" || type === "touchcancel" ? [] : [touch],
          },
        });
        element.dispatchEvent(event);
      };
      send("touchstart", 0, 0);
      await frame();
      send("touchmove", delta.x / 2, delta.y / 2);
      await frame();
      send("touchmove", delta.x, delta.y);
      await frame();
      send(delta.cancel ? "touchcancel" : "touchend", delta.x, delta.y);
    },
    { x: deltaX, y: deltaY, cancel },
  );
}

/** Synthetic pointer gestures exercise axis/cancel ownership; native capture needs browser input. */
export async function pointerDrag(
  page: Page,
  selector: string,
  deltaX: number,
  deltaY: number,
  cancel: boolean | "lostcapture" = false,
) {
  await page.locator(selector).evaluate(
    async (element, delta) => {
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + Math.min(rect.height / 2, 100);
      const track = element.closest<HTMLElement>(".m-carousel__track");
      const send = (type: string, dx: number, dy: number) =>
        (type === "lostpointercapture" && track
          ? track
          : element
        ).dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: "touch",
            isPrimary: true,
            clientX: x + dx,
            clientY: y + dy,
          }),
        );
      const captureMethods = [
        "setPointerCapture",
        "hasPointerCapture",
        "releasePointerCapture",
      ] as const;
      const originalDescriptors = captureMethods.map((name) =>
        track ? Object.getOwnPropertyDescriptor(track, name) : undefined,
      );
      let captured = false;
      // Synthetic pointer ids are absent from the browser input pipeline. Model
      // capture locally; the CDP test checks native capture and touch scrolling.
      if (track) {
        Object.defineProperties(track, {
          setPointerCapture: {
            configurable: true,
            value: () => (captured = true),
          },
          hasPointerCapture: { configurable: true, value: () => captured },
          releasePointerCapture: {
            configurable: true,
            value: () => (captured = false),
          },
        });
      }
      try {
        send("pointerdown", 0, 0);
        await new Promise<void>((done) => requestAnimationFrame(() => done()));
        send("pointermove", delta.x / 2, delta.y / 2);
        await new Promise<void>((done) => requestAnimationFrame(() => done()));
        send("pointermove", delta.x, delta.y);
        await new Promise<void>((done) => requestAnimationFrame(() => done()));
        send(
          delta.cancel === "lostcapture"
            ? "lostpointercapture"
            : delta.cancel
              ? "pointercancel"
              : "pointerup",
          delta.x,
          delta.y,
        );
      } finally {
        if (track) {
          captureMethods.forEach((name, index) => {
            const original = originalDescriptors[index];
            if (original) Object.defineProperty(track, name, original);
            else delete (track as unknown as Record<string, unknown>)[name];
          });
        }
      }
    },
    { x: deltaX, y: deltaY, cancel },
  );
}
