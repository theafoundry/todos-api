import { expect, Page, test } from "@playwright/test";
import { buildTodayPlanWidgetHtml } from "../../src/mcp/todayPlanResource";

const TASK_ONE = "00000000-0000-4000-8000-000000000010";
const TASK_TWO = "00000000-0000-4000-8000-000000000011";
const TASK_THREE = "00000000-0000-4000-8000-000000000012";

function task(
  id: string,
  title: string,
  rank: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    title,
    status: "next",
    completed: false,
    dueDate: "2026-08-11T16:00:00.000Z",
    scheduledDate: null,
    priority: "high",
    estimateMinutes: 30,
    energy: "medium",
    overdue: false,
    project: { id: "00000000-0000-4000-8000-000000000100", name: "Launch" },
    rank,
    reason: "Due today and fits the available time.",
    ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-08-11",
    timezone: "America/New_York",
    availableMinutes: 120,
    energy: "medium",
    tasks: [
      task(TASK_ONE, "Review launch plan", 1, { overdue: true }),
      task(TASK_TWO, "Draft release notes", 2, {
        scheduledDate: "2026-08-11T14:00:00.000Z",
      }),
      task(TASK_THREE, "Confirm rollout owner", 3),
    ],
    totalMinutes: 90,
    remainingMinutes: 30,
    warnings: [],
    ...overrides,
  };
}

type MountOptions = {
  panel?: boolean;
  initialPlan?: ReturnType<typeof plan>;
  deferInitialize?: boolean;
  initialAuthError?: boolean;
  refreshPlan?: ReturnType<typeof plan>;
  initialPlanningInputs?: Pick<
    ReturnType<typeof plan>,
    "date" | "availableMinutes" | "energy"
  >;
  budgetMultiplier?: number;
  forwardToolNotifications?: boolean;
  forwardToolResults?: boolean;
  notifyBeforeReply?: boolean;
};

async function mountWidget(page: Page, options: MountOptions = {}) {
  const html = buildTodayPlanWidgetHtml("https://todos.example/");
  const initialPlan = options.initialPlan ?? plan();
  await page.setContent(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><main style="width:100%;max-width:720px;margin:auto"><iframe id="widget" title="Today Plan component" style="display:block;width:100%;height:900px;border:0"></iframe></main></body></html>',
  );
  await page.evaluate(
    ({ html, initialPlan, options }) => {
      const bridgeCalls: Array<{ method: string; params: any }> = [];
      let authoritativePlan = structuredClone(initialPlan);
      let failNext = false;
      let authNext = false;
      let initializeRequest: any = null;
      let deferNextReply = false;
      const heldReplies: Array<{ id: number; value: unknown }> = [];
      const iframe = document.getElementById("widget") as HTMLIFrameElement;

      function post(message: unknown) {
        iframe.contentWindow?.postMessage(message, "*");
      }

      function result(id: number, value: unknown) {
        post({ jsonrpc: "2.0", id, result: value });
      }

      function toolError(message: string, auth = false) {
        return {
          content: [{ type: "text", text: message }],
          isError: true,
          structuredContent: {
            error: {
              code: auth ? "MCP_UNAUTHENTICATED" : "TEMPORARY_FAILURE",
              message,
              retryable: !auth,
            },
          },
          ...(auth
            ? {
                _meta: {
                  "mcp/www_authenticate": ['Bearer error="invalid_token"'],
                },
              }
            : {}),
        };
      }

      function makePlan(inputs: any) {
        const nextPlan = options.refreshPlan
          ? structuredClone(options.refreshPlan)
          : structuredClone(authoritativePlan);
        const budget = Math.round(
          inputs.availableMinutes * (options.budgetMultiplier ?? 1),
        );
        Object.assign(nextPlan, {
          date: inputs.date,
          availableMinutes: budget,
          energy: inputs.energy,
          remainingMinutes: budget - nextPlan.totalMinutes,
        });
        authoritativePlan = nextPlan;
        return { structuredContent: nextPlan, content: [] };
      }

      function respondToToolCall(id: number, params: any) {
        if (options.forwardToolNotifications !== false) {
          post({
            jsonrpc: "2.0",
            method: "ui/notifications/tool-input",
            params: { arguments: params.arguments },
          });
        }
        function reply(value: unknown) {
          function forwardResult() {
            if (
              options.forwardToolNotifications !== false &&
              options.forwardToolResults !== false
            )
              post({
                jsonrpc: "2.0",
                method: "ui/notifications/tool-result",
                params: value,
              });
          }
          if (options.notifyBeforeReply) forwardResult();
          if (deferNextReply) {
            deferNextReply = false;
            heldReplies.push({ id, value });
          } else result(id, value);
          if (!options.notifyBeforeReply) forwardResult();
        }
        if (authNext) {
          authNext = false;
          reply(toolError("Your connection expired.", true));
          return;
        }
        if (failNext) {
          failNext = false;
          reply(toolError("That change could not be saved."));
          return;
        }
        if (params.name === "plan_today") {
          reply(makePlan(params.arguments));
          return;
        }
        const taskId = params.arguments.taskId;
        const currentTask = authoritativePlan.tasks.find(
          (entry: any) => entry.id === taskId,
        );
        if (!currentTask) {
          reply(toolError("That task is no longer in this plan."));
          return;
        }
        if (params.name === "complete_task") {
          Object.assign(currentTask, {
            completed: params.arguments.completed,
            status: params.arguments.completed ? "done" : "next",
          });
          reply({
            structuredContent: {
              task: structuredClone(currentTask),
              changed: true,
            },
            content: [],
          });
          return;
        }
        if (params.name === "reschedule_task") {
          const previousScheduledDate = currentTask.scheduledDate;
          Object.assign(currentTask, {
            scheduledDate: params.arguments.scheduledDate,
          });
          reply({
            structuredContent: {
              task: structuredClone(currentTask),
              changed: true,
              previousScheduledDate,
              previousDueDate: currentTask.dueDate,
              timezone: authoritativePlan.timezone,
            },
            content: [],
          });
          return;
        }
        reply(toolError("Unexpected tool call."));
      }

      window.addEventListener("message", (event) => {
        if (event.source !== iframe.contentWindow) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0" || !message.method) return;
        bridgeCalls.push({ method: message.method, params: message.params });
        if (message.method === "ui/initialize") {
          initializeRequest = message;
          if (!options.deferInitialize) {
            result(message.id, {
              protocolVersion: "2026-01-26",
              hostInfo: { name: "widget-test-host", version: "1.0.0" },
              hostCapabilities: { openLinks: {}, serverTools: {} },
              hostContext: {
                displayMode: options.panel ? "fullscreen" : "inline",
                theme: "light",
              },
            });
          }
          return;
        }
        if (message.method === "ui/notifications/initialized") {
          post({
            jsonrpc: "2.0",
            method: "ui/notifications/tool-input",
            params: {
              arguments: options.panel
                ? {}
                : {
                    date: initialPlan.date,
                    taskIds: initialPlan.tasks.map((entry: any) => entry.id),
                    availableMinutes: initialPlan.availableMinutes,
                    energy: initialPlan.energy,
                    ...options.initialPlanningInputs,
                  },
            },
          });
          post({
            jsonrpc: "2.0",
            method: "ui/notifications/tool-result",
            params: options.initialAuthError
              ? toolError("Your connection expired.", true)
              : {
                  structuredContent: options.panel
                    ? {
                        state: "setup",
                        date: initialPlan.date,
                        timezone: initialPlan.timezone,
                      }
                    : structuredClone(initialPlan),
                  content: [],
                },
          });
          return;
        }
        if (message.method === "tools/call") {
          respondToToolCall(message.id, message.params);
          return;
        }
        if (message.method === "ui/open-link") {
          result(message.id, {});
        }
      });

      Object.assign(window, {
        __bridgeCalls: bridgeCalls,
        __widgetControls: {
          deferNextReply() {
            deferNextReply = true;
          },
          heldReplyCount() {
            return heldReplies.length;
          },
          finishToolReply() {
            const held = heldReplies.shift();
            if (!held) throw new Error("No held tool reply");
            result(held.id, held.value);
          },
          publishResultOnly(nextPlan: any) {
            post({
              jsonrpc: "2.0",
              method: "ui/notifications/tool-result",
              params: { structuredContent: nextPlan, content: [] },
            });
          },
          publishPlan(inputs: any, failure = false) {
            post({
              jsonrpc: "2.0",
              method: "ui/notifications/tool-input",
              params: { arguments: inputs },
            });
            post({
              jsonrpc: "2.0",
              method: "ui/notifications/tool-result",
              params: failure
                ? toolError("That change could not be saved.")
                : makePlan(inputs),
            });
          },
          failNext() {
            failNext = true;
          },
          authNext() {
            authNext = true;
          },
          finishInitialize() {
            if (!initializeRequest)
              throw new Error("Initialize request not received");
            result(initializeRequest.id, {
              protocolVersion: "2026-01-26",
              hostInfo: { name: "widget-test-host", version: "1.0.0" },
              hostCapabilities: { openLinks: {}, serverTools: {} },
              hostContext: {
                displayMode: options.panel ? "fullscreen" : "inline",
                theme: "light",
              },
            });
          },
        },
      });
      iframe.srcdoc = html;
    },
    { html, initialPlan, options },
  );

  const frame = page.frameLocator("#widget");
  return { frame };
}

async function bridgeCalls(page: Page) {
  return page.evaluate(() => (window as any).__bridgeCalls);
}

test("opens the conversation panel from the initial setup result without planning or writes", async ({
  page,
}) => {
  const { frame } = await mountWidget(page, { panel: true });
  await expect(frame.locator("#card")).toHaveAttribute("data-state", "setup");
  await expect(frame.locator("#skeleton")).toBeHidden();
  await expect(frame.getByLabel("Date", { exact: true })).toHaveValue(
    "2026-08-11",
  );
  await expect(frame.getByText("America/New_York")).toBeVisible();
  await expect(frame.getByLabel("Available minutes")).toHaveValue("");
  await expect(frame.getByLabel("Energy", { exact: true })).toHaveValue("");
  await expect(frame.getByRole("list", { name: "Planned tasks" })).toBeHidden();
  const calls = await bridgeCalls(page);
  expect(calls.filter((call: any) => call.method === "tools/call")).toEqual([]);
  expect(
    calls.find((call: any) => call.method === "ui/initialize").params
      .appCapabilities.availableDisplayModes,
  ).toEqual(["inline", "fullscreen"]);
  await frame.locator("#card").screenshot({
    path: test.info().outputPath("panel-setup.png"),
    animations: "disabled",
  });
});

test("requires explicit planning inputs and preserves submitted values for refresh and existing mutations", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { frame } = await mountWidget(page, { panel: true });
  await expect(frame.locator("#card")).toHaveAttribute("data-state", "setup");
  await frame.getByRole("button", { name: "Make plan", exact: true }).click();
  expect(
    (await bridgeCalls(page)).filter(
      (call: any) => call.method === "tools/call",
    ),
  ).toEqual([]);
  await frame.getByLabel("Available minutes").fill("90");
  await frame.getByRole("button", { name: "Make plan", exact: true }).click();
  expect(
    (await bridgeCalls(page)).filter(
      (call: any) => call.method === "tools/call",
    ),
  ).toEqual([]);
  await frame.getByLabel("Energy", { exact: true }).selectOption("low");
  await frame.getByRole("button", { name: "Make plan", exact: true }).click();
  await expect(frame.locator("#card")).toHaveAttribute("data-state", "ready");
  await expect(frame.locator("#skeleton")).toBeHidden();
  await expect(frame.locator(".reschedule").first()).toBeHidden();
  const height = await frame
    .locator("#card")
    .evaluate((card) => card.scrollHeight);
  await page.locator("#widget").evaluate((iframe, height) => {
    (iframe as HTMLElement).style.height = height + "px";
  }, height);
  await frame.locator("#card").screenshot({
    path: test.info().outputPath("panel-plan.png"),
    animations: "disabled",
  });
  const planningCall = (await bridgeCalls(page)).filter(
    (call: any) => call.method === "tools/call",
  );
  expect(planningCall).toEqual([
    {
      method: "tools/call",
      params: {
        name: "plan_today",
        arguments: { date: "2026-08-11", availableMinutes: 90, energy: "low" },
      },
    },
  ]);
  await frame
    .getByRole("button", { name: "Complete Review launch plan", exact: true })
    .click();
  await expect(
    frame.getByRole("button", {
      name: "Undo completion for Review launch plan",
    }),
  ).toBeVisible();
  await frame
    .getByRole("button", { name: "Undo completion for Review launch plan" })
    .click();
  await expect(
    frame.getByRole("button", {
      name: "Complete Review launch plan",
      exact: true,
    }),
  ).toBeVisible();
  // Draft controls do not change Refresh until Update plan succeeds.
  await frame.getByLabel("Available minutes").fill("60");
  await page.evaluate(() => (window as any).__widgetControls.failNext());
  await frame.getByRole("button", { name: "Update plan", exact: true }).click();
  await expect(frame.locator("#card")).toHaveAttribute(
    "data-state",
    "recoverable-failure",
  );
  await frame.getByRole("button", { name: "Refresh plan" }).click();
  await expect(frame.getByRole("status")).toHaveText(
    "Plan refreshed from Todos.",
  );
  const calls = (await bridgeCalls(page)).filter(
    (call: any) => call.method === "tools/call",
  );
  expect(calls.at(-1).params).toEqual({
    name: "plan_today",
    arguments: { date: "2026-08-11", availableMinutes: 90, energy: "low" },
  });
  await frame.getByLabel("Available minutes").fill("120");
  await frame.getByLabel("Energy", { exact: true }).selectOption("high");
  await frame.getByRole("button", { name: "Update plan", exact: true }).click();
  await expect(frame.locator("#card")).toHaveAttribute("data-state", "ready");
  await frame.getByRole("button", { name: "Refresh plan" }).click();
  await expect(frame.getByRole("status")).toHaveText(
    "Plan refreshed from Todos.",
  );
  const refreshed = (await bridgeCalls(page)).filter(
    (call: any) => call.method === "tools/call",
  );
  expect(refreshed.at(-1).params).toEqual({
    name: "plan_today",
    arguments: { date: "2026-08-11", availableMinutes: 120, energy: "high" },
  });
  expect(errors).toEqual([]);
});

test("keeps planning pending until its correlated reply despite an early forwarded result", async ({
  page,
}) => {
  const { frame } = await mountWidget(page, {
    panel: true,
    initialPlan: plan({
      tasks: plan().tasks.map((entry) => ({ ...entry, estimateMinutes: 10 })),
      totalMinutes: 30,
      remainingMinutes: 90,
    }),
    budgetMultiplier: 0.7,
    notifyBeforeReply: true,
  });
  await expect(frame.locator("#card")).toHaveAttribute("data-state", "setup");
  await frame.getByLabel("Available minutes").fill("100");
  await frame.getByLabel("Energy", { exact: true }).selectOption("low");
  await page.evaluate(() => (window as any).__widgetControls.deferNextReply());
  await frame.getByRole("button", { name: "Make plan", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__widgetControls.heldReplyCount()),
    )
    .toBe(1);
  await expect(frame.locator("#card")).toHaveAttribute(
    "data-state",
    "mutation-pending",
  );
  await expect(frame.getByLabel("Available minutes")).toBeDisabled();
  await expect(frame.locator("#plan-submit")).toBeDisabled();
  await page.evaluate(() => (window as any).__widgetControls.finishToolReply());
  await expect(frame.locator("#card")).toHaveAttribute("data-state", "ready");
  await expect(frame.locator("#available")).toHaveText("70 min");
  await frame.getByLabel("Date", { exact: true }).fill("2026-08-13");
  await frame.getByLabel("Available minutes").fill("200");
  await frame.getByLabel("Energy", { exact: true }).selectOption("high");
  await frame.getByRole("button", { name: "Update plan", exact: true }).click();
  await expect(frame.locator("#available")).toHaveText("140 min");
  for (let refresh = 0; refresh < 2; refresh++) {
    await frame.getByRole("button", { name: "Refresh plan" }).click();
    await expect(frame.getByRole("status")).toHaveText(
      "Plan refreshed from Todos.",
    );
    await expect(frame.locator("#available")).toHaveText("140 min");
    const calls = (await bridgeCalls(page)).filter(
      (call: any) => call.method === "tools/call",
    );
    expect(calls.at(-1).params).toEqual({
      name: "plan_today",
      arguments: { date: "2026-08-13", availableMinutes: 200, energy: "high" },
    });
  }
});

test("clears input-only failed planning candidates before a later result-only notification", async ({
  page,
}) => {
  const initialPlan = plan({
    tasks: [task(TASK_ONE, "Focus work", 1, { estimateMinutes: 10 })],
    availableMinutes: 70,
    totalMinutes: 10,
    remainingMinutes: 60,
    energy: "low",
  });
  const { frame } = await mountWidget(page, {
    panel: true,
    initialPlan,
    budgetMultiplier: 0.7,
    forwardToolResults: false,
  });
  await expect(frame.locator("#card")).toHaveAttribute("data-state", "setup");
  await frame.getByLabel("Available minutes").fill("100");
  await frame.getByLabel("Energy", { exact: true }).selectOption("low");
  await frame.getByRole("button", { name: "Make plan", exact: true }).click();
  await expect(frame.locator("#card")).toHaveAttribute("data-state", "ready");
  await frame.getByLabel("Available minutes").fill("160");
  await page.evaluate(() => (window as any).__widgetControls.failNext());
  await frame.getByRole("button", { name: "Update plan", exact: true }).click();
  await expect(frame.locator("#card")).toHaveAttribute(
    "data-state",
    "recoverable-failure",
  );
  await page.evaluate(
    (initialPlan) =>
      (window as any).__widgetControls.publishResultOnly(initialPlan),
    initialPlan,
  );
  await expect(frame.locator("#card")).toHaveAttribute("data-state", "ready");
  await frame.getByRole("button", { name: "Refresh plan" }).click();
  await expect(frame.getByRole("status")).toHaveText(
    "Plan refreshed from Todos.",
  );
  await expect(frame.locator("#available")).toHaveText("70 min");
  const calls = (await bridgeCalls(page)).filter(
    (call: any) => call.method === "tools/call",
  );
  expect(calls.at(-1).params).toEqual({
    name: "plan_today",
    arguments: { date: "2026-08-11", availableMinutes: 100, energy: "low" },
  });
});

const budgetCases = [
  ...[
    { mode: "normal", multiplier: 1 },
    { mode: "travel", multiplier: 0.7 },
    { mode: "rescue", multiplier: 0.6 },
  ].flatMap((mode) =>
    [true, false].map((panel) => ({ ...mode, panel, forward: true })),
  ),
  { mode: "travel", multiplier: 0.7, panel: true, forward: false },
];

for (const { mode, multiplier, panel, forward } of budgetCases) {
  test(`keeps raw planning inputs through repeated ${mode} refresh, failures and updates in ${panel ? "panel" : "inline"} ${forward ? "with notifications" : "with replies only"}`, async ({
    page,
  }) => {
    const originalInputs = {
      date: "2026-08-11",
      availableMinutes: 100,
      energy: "low",
    };
    const effectiveMinutes = Math.round(100 * multiplier);
    const initialPlan = plan({
      tasks: plan().tasks.map((entry) => ({ ...entry, estimateMinutes: 10 })),
      availableMinutes: effectiveMinutes,
      energy: originalInputs.energy,
      totalMinutes: 30,
      remainingMinutes: effectiveMinutes - 30,
    });
    const { frame } = await mountWidget(page, {
      panel,
      initialPlan,
      initialPlanningInputs: originalInputs,
      budgetMultiplier: multiplier,
      forwardToolNotifications: forward,
    });
    await expect(frame.locator("#card")).toHaveAttribute(
      "data-state",
      panel ? "setup" : "ready",
    );

    async function changePlan(inputs: typeof originalInputs, failure = false) {
      if (panel) {
        await frame.getByLabel("Date", { exact: true }).fill(inputs.date);
        await frame
          .getByLabel("Available minutes")
          .fill(String(inputs.availableMinutes));
        await frame
          .getByLabel("Energy", { exact: true })
          .selectOption(inputs.energy);
        if (failure)
          await page.evaluate(() =>
            (window as any).__widgetControls.failNext(),
          );
        await frame.locator("#plan-submit").click();
      } else {
        await page.evaluate(
          ({ inputs, failure }) =>
            (window as any).__widgetControls.publishPlan(inputs, failure),
          { inputs, failure },
        );
      }
      await expect(frame.locator("#card")).toHaveAttribute(
        "data-state",
        failure ? "recoverable-failure" : "ready",
      );
    }

    async function refreshTimes(inputs: typeof originalInputs, count = 3) {
      for (let index = 0; index < count; index++) {
        await frame.getByRole("button", { name: "Refresh plan" }).click();
        await expect(frame.getByRole("status")).toHaveText(
          "Plan refreshed from Todos.",
        );
        const effective = Math.round(inputs.availableMinutes * multiplier);
        await expect(frame.locator("#available")).toHaveText(
          `${effective} min`,
        );
        await expect(frame.locator("#planned")).toHaveText("30 min");
        await expect(frame.locator("#remaining")).toHaveText(
          `${effective - 30} min`,
        );
        const calls = (await bridgeCalls(page)).filter(
          (call: any) => call.method === "tools/call",
        );
        expect(calls.at(-1).params).toEqual({
          name: "plan_today",
          arguments: inputs,
        });
      }
    }

    if (panel) await changePlan(originalInputs);
    await refreshTimes(originalInputs);
    if (panel) {
      await frame.getByLabel("Date", { exact: true }).fill("2026-08-15");
      await frame.getByLabel("Available minutes").fill("180");
      await frame.getByLabel("Energy", { exact: true }).selectOption("high");
      await refreshTimes(originalInputs, 1);
    }
    await changePlan(
      { date: "2026-08-12", availableMinutes: 160, energy: "high" },
      true,
    );
    await refreshTimes(originalInputs);
    const latestInputs = {
      date: "2026-08-13",
      availableMinutes: 200,
      energy: "high",
    };
    await changePlan(latestInputs);
    await refreshTimes(latestInputs);
    await page.evaluate(() => (window as any).__widgetControls.failNext());
    await frame.getByRole("button", { name: "Refresh plan" }).click();
    await expect(frame.locator("#card")).toHaveAttribute(
      "data-state",
      "recoverable-failure",
    );
    await refreshTimes(latestInputs);
  });
}

for (const panel of [true, false]) {
  test(`shows all tasks and correct totals for plans with more than 12 tasks after ${panel ? "panel planning" : "inline refresh"}`, async ({
    page,
  }) => {
    const plannedTasks = Array.from({ length: 15 }, (_, index) =>
      task(
        "00000000-0000-4000-8000-" + String(200 + index).padStart(12, "0"),
        `Planned task ${index + 1}`,
        index + 1,
        { estimateMinutes: 10 },
      ),
    );
    const fullPlan = plan({
      availableMinutes: 180,
      tasks: plannedTasks,
      totalMinutes: 150,
      remainingMinutes: 30,
    });
    const { frame } = await mountWidget(page, {
      panel,
      initialPlan: plan({ availableMinutes: 180, remainingMinutes: 90 }),
      refreshPlan: fullPlan,
    });
    await expect(frame.locator("#card")).toHaveAttribute(
      "data-state",
      panel ? "setup" : "ready",
    );
    if (panel) {
      await frame.getByLabel("Available minutes").fill("180");
      await frame.getByLabel("Energy", { exact: true }).selectOption("medium");
      await frame
        .getByRole("button", { name: "Make plan", exact: true })
        .click();
    } else {
      await frame.getByRole("button", { name: "Refresh plan" }).click();
    }
    await expect(frame.locator("#available")).toHaveText("180 min");
    await expect(frame.locator("#planned")).toHaveText("150 min");
    await expect(frame.locator("#remaining")).toHaveText("30 min");
    const rows = frame
      .getByRole("list", { name: "Planned tasks" })
      .locator("li");
    await expect(rows).toHaveCount(plannedTasks.length);
    await expect(rows.locator(".task-title")).toHaveText(
      plannedTasks.map((entry) => entry.title),
    );
    await expect(rows.locator(".task-meta")).toContainText(
      plannedTasks.map(() => "10 min"),
    );
    await expect(
      frame.getByRole("heading", { name: "Planned task 15", exact: true }),
    ).toBeVisible();
    await frame
      .getByRole("button", { name: "Complete Planned task 15", exact: true })
      .click();
    await expect(
      frame.locator(`[data-task-id="${plannedTasks[14].id}"]`),
    ).toHaveAttribute("data-completed", "true");
    await expect(rows).toHaveCount(plannedTasks.length);
    await expect(frame.locator("#planned")).toHaveText("150 min");
    await expect(frame.locator("#remaining")).toHaveText("30 min");
    const calls = (await bridgeCalls(page)).filter(
      (call: any) => call.method === "tools/call",
    );
    expect(calls.at(-1).params).toEqual({
      name: "complete_task",
      arguments: { taskId: plannedTasks[14].id, completed: true },
    });
    await frame
      .getByRole("button", {
        name: "Undo completion for Planned task 15",
        exact: true,
      })
      .click();
    await expect(
      frame.locator(`[data-task-id="${plannedTasks[14].id}"]`),
    ).toHaveAttribute("data-completed", "false");
    await frame.getByRole("button", { name: "Refresh plan" }).click();
    await expect(rows).toHaveCount(plannedTasks.length);
    await expect(frame.locator("#planned")).toHaveText("150 min");
    await expect(frame.locator("#remaining")).toHaveText("30 min");
  });
}

test("keeps panel setup retryable on planning failure and disables it on auth expiry", async ({
  page,
}) => {
  const { frame } = await mountWidget(page, { panel: true });
  await expect(frame.locator("#card")).toHaveAttribute("data-state", "setup");
  await frame.getByLabel("Available minutes").fill("90");
  await frame.getByLabel("Energy", { exact: true }).selectOption("medium");
  await page.evaluate(() => (window as any).__widgetControls.failNext());
  await frame.getByRole("button", { name: "Make plan", exact: true }).click();
  await expect(frame.locator("#card")).toHaveAttribute(
    "data-state",
    "recoverable-failure",
  );
  await expect(frame.getByRole("list", { name: "Planned tasks" })).toBeHidden();
  await expect(
    frame.getByRole("button", { name: "Make plan", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => (window as any).__widgetControls.authNext());
  await frame.getByRole("button", { name: "Make plan", exact: true }).click();
  await expect(frame.locator("#card")).toHaveAttribute(
    "data-state",
    "auth-expired",
  );
  await expect(frame.getByLabel("Available minutes")).toBeDisabled();
  await expect(
    frame.getByRole("button", { name: "Make plan", exact: true }),
  ).toBeDisabled();
});

test("keeps panel instances independent and setup usable at narrow width and 200% zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 820 });
  const { frame } = await mountWidget(page, { panel: true });
  await expect(frame.locator("#card")).toHaveAttribute("data-state", "setup");
  await frame.locator("html").evaluate((element) => {
    (element as HTMLElement).style.fontSize = "200%";
  });
  await frame.getByLabel("Available minutes").fill("90");
  const otherPage = await page.context().newPage();
  const other = await mountWidget(otherPage, { panel: true });
  await expect(other.frame.locator("#card")).toHaveAttribute(
    "data-state",
    "setup",
  );
  await expect(other.frame.getByLabel("Available minutes")).toHaveValue("");
  await expect(frame.getByLabel("Available minutes")).toHaveValue("90");
  expect(
    await frame
      .locator("body")
      .evaluate((body) => body.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await expect(
    frame.getByRole("button", { name: "Make plan", exact: true }),
  ).toBeVisible();
  await otherPage.close();
});

test("shows an initializing state until the MCP Apps handshake completes", async ({
  page,
}) => {
  const { frame } = await mountWidget(page, { deferInitialize: true });

  await expect(frame.locator("#card")).toHaveAttribute(
    "data-state",
    "initializing",
  );
  await expect(frame.getByRole("status")).toContainText("Loading today's plan");
  await page.evaluate(() =>
    (window as any).__widgetControls.finishInitialize(),
  );
  await expect(frame.locator("#card")).toHaveAttribute("data-state", "ready");
});

test("renders the authoritative ready and empty states with accessible structure", async ({
  page,
}) => {
  const { frame } = await mountWidget(page);

  await expect(frame.locator("#card")).toHaveAttribute("data-state", "ready");
  await expect(
    frame.getByRole("heading", { name: "Today's plan" }),
  ).toBeVisible();
  await expect(frame.getByText("America/New_York")).toBeVisible();
  await expect(
    frame.getByRole("list", { name: "Planned tasks" }).locator("li"),
  ).toHaveCount(3);
  await expect(
    frame.getByRole("heading", { name: "Review launch plan" }),
  ).toBeVisible();
  await expect(frame.getByText("Launch").first()).toBeVisible();
  await expect(frame.getByText("Overdue", { exact: false })).toBeVisible();
  await expect(frame.locator('[data-task-id="' + TASK_ONE + '"]')).toHaveCSS(
    "border-left-width",
    "4px",
  );
  await expect(
    frame.getByRole("button", { name: "Complete Review launch plan" }),
  ).toBeVisible();

  const emptyPage = await page.context().newPage();
  const empty = await mountWidget(emptyPage, {
    initialPlan: plan({ tasks: [], totalMinutes: 0, remainingMinutes: 120 }),
  });
  await expect(empty.frame.locator("#card")).toHaveAttribute(
    "data-state",
    "empty",
  );
  await expect(empty.frame.getByText("Your day is clear")).toBeVisible();
  await emptyPage.close();
});

test("marks stale and expired plans without exposing unsafe actions", async ({
  page,
}) => {
  const { frame } = await mountWidget(page, {
    initialPlan: plan({
      warnings: [
        "1 selected task was omitted because the authoritative plan changed. Refresh the plan.",
      ],
    }),
  });

  await expect(frame.locator("#card")).toHaveAttribute("data-state", "stale");
  await expect(frame.getByRole("status")).toContainText("Refresh");
  await expect(
    frame.getByRole("button", { name: "Complete Review launch plan" }),
  ).toBeDisabled();

  const expiredPage = await page.context().newPage();
  const expired = await mountWidget(expiredPage, { initialAuthError: true });
  await expect(expired.frame.locator("#card")).toHaveAttribute(
    "data-state",
    "auth-expired",
  );
  await expect(expired.frame.getByRole("status")).toContainText("Reconnect");
  await expiredPage.close();
});

test("complete and undo reconcile only from authoritative tool results", async ({
  page,
}) => {
  const { frame } = await mountWidget(page);
  const complete = frame.getByRole("button", {
    name: "Complete Review launch plan",
  });

  await complete.click();
  await expect(
    frame.locator('[data-task-id="' + TASK_ONE + '"]'),
  ).toHaveAttribute("data-completed", "true");
  await expect(frame.locator("#card")).toHaveAttribute(
    "data-state",
    "mutation-succeeded",
  );
  await frame
    .getByRole("button", { name: "Undo completion for Review launch plan" })
    .click();
  await expect(
    frame.locator('[data-task-id="' + TASK_ONE + '"]'),
  ).toHaveAttribute("data-completed", "false");

  const calls = await bridgeCalls(page);
  expect(calls.filter((call: any) => call.method === "tools/call")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        params: {
          name: "complete_task",
          arguments: { taskId: TASK_ONE, completed: true },
        },
      }),
      expect.objectContaining({
        params: {
          name: "complete_task",
          arguments: { taskId: TASK_ONE, completed: false },
        },
      }),
    ]),
  );
});

test("moves tasks to tomorrow and supports keyboard date-time rescheduling", async ({
  page,
}) => {
  const { frame } = await mountWidget(page);

  await frame
    .getByRole("button", { name: "Move Review launch plan to tomorrow" })
    .click();
  await expect(frame.getByRole("status")).toContainText(
    "Moved Review launch plan",
  );

  const picker = frame.getByRole("button", {
    name: "Pick a date and time for Review launch plan",
  });
  await picker.focus();
  await page.keyboard.press("Enter");
  const input = frame.getByLabel("New date and time for Review launch plan");
  await input.fill("2026-08-14T15:30");
  await input.locator("xpath=..").getByRole("button", { name: "Save" }).click();
  await expect(frame.getByRole("status")).toContainText(
    "Rescheduled Review launch plan",
  );

  const calls = (await bridgeCalls(page)).filter(
    (call: any) =>
      call.method === "tools/call" && call.params.name === "reschedule_task",
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].params.arguments.scheduledDate).toMatch(
    /^2026-08-12T13:00:00\.000Z$/,
  );
  expect(calls[1].params.arguments.scheduledDate).toMatch(
    /^2026-08-14T19:30:00\.000Z$/,
  );
});

test("refreshes through plan_today and rolls back a failed mutation", async ({
  page,
}) => {
  const refreshed = plan({
    tasks: [task(TASK_TWO, "Draft release notes", 1)],
    totalMinutes: 30,
    remainingMinutes: 90,
  });
  const { frame } = await mountWidget(page, { refreshPlan: refreshed });

  await page.evaluate(() => (window as any).__widgetControls.failNext());
  await frame
    .getByRole("button", { name: "Complete Review launch plan" })
    .click();
  await expect(frame.locator("#card")).toHaveAttribute(
    "data-state",
    "recoverable-failure",
  );
  await expect(
    frame.locator('[data-task-id="' + TASK_ONE + '"]'),
  ).toHaveAttribute("data-completed", "false");

  await frame.getByRole("button", { name: "Refresh plan" }).click();
  await expect(frame.locator("#card")).toHaveAttribute("data-state", "ready");
  await expect(
    frame.getByRole("heading", { name: "Draft release notes" }),
  ).toBeVisible();
  await expect(
    frame.getByRole("heading", { name: "Review launch plan" }),
  ).toBeHidden();
  const refreshCall = (await bridgeCalls(page)).find(
    (call: any) =>
      call.method === "tools/call" && call.params.name === "plan_today",
  );
  expect(refreshCall.params.arguments).toEqual({
    date: "2026-08-11",
    availableMinutes: 120,
    energy: "medium",
  });
});

test("handles auth expiry during mutation and opens Todos through the standard bridge", async ({
  page,
}) => {
  const { frame } = await mountWidget(page);
  await page.evaluate(() => (window as any).__widgetControls.authNext());
  await frame
    .getByRole("button", { name: "Complete Review launch plan" })
    .click();
  await expect(frame.locator("#card")).toHaveAttribute(
    "data-state",
    "auth-expired",
  );
  await expect(frame.getByRole("status")).toContainText("Reconnect");

  await frame.getByRole("link", { name: "Open in Todos" }).click();
  await expect
    .poll(async () =>
      (await bridgeCalls(page)).find(
        (call: any) => call.method === "ui/open-link",
      ),
    )
    .toEqual(
      expect.objectContaining({
        params: { url: "https://todos.example/app" },
      }),
    );
});

test("remains usable at narrow width and 200% zoom without console errors or direct fetch", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 820 });
  const { frame } = await mountWidget(page);
  await frame.locator("html").evaluate((element) => {
    (element as HTMLElement).style.fontSize = "200%";
  });

  await expect(frame.locator("#card")).toHaveAttribute("data-state", "ready");
  const box = await frame.locator("#card").boundingBox();
  expect(box?.width).toBeLessThanOrEqual(320);
  await expect(
    frame.getByRole("button", { name: "Refresh plan" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(buildTodayPlanWidgetHtml("https://todos.example/")).not.toMatch(
    /fetch\s*\(|XMLHttpRequest|\/api\//i,
  );
});
