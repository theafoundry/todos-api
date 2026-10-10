import { test as base, expect, type Page } from "@playwright/test";
import {
  installCaptureReviewFixture,
  captureItem,
  captureProject,
  type CaptureReviewFixture,
} from "./helpers/capture-review-fixture";
import { mobileTask, MOBILE_NOW } from "./helpers/mobile-fixture";

const test = base.extend<{ captures: CaptureReviewFixture }>({
  captures: async ({ context, baseURL }, use) => {
    const fixture = await installCaptureReviewFixture(context, baseURL!);
    await use(fixture);
    fixture.assertIsolated();
  },
});
test.use({ serviceWorkers: "block", timezoneId: "America/Los_Angeles" });

const original =
  "Ask Maya for the launch checklist\nKeep the pilot to two weeks.";
const edited = "Send Maya the two-week pilot checklist";

async function openInbox(page: Page) {
  await page.clock.setFixedTime(MOBILE_NOW);
  await page.goto("/app/");
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  return page.getByRole("region", { name: "Inbox review", exact: true });
}

async function showTasks(page: Page, isMobile: boolean) {
  if (isMobile)
    await page.getByRole("tab", { name: "Tasks", exact: true }).click();
  else await page.locator('button[data-workspace-view="all"]').click();
  if (isMobile)
    await expect(
      page.getByRole("heading", { name: "Tasks", exact: true }),
    ).toBeVisible();
  else await expect(page.locator("#todosListHeaderTitle")).toHaveText("Tasks");
}

async function showInbox(page: Page, isMobile: boolean) {
  if (isMobile)
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  else await page.locator('button[data-workspace-view="inbox"]').click();
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
}

async function screenshot(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

test("pending conversational captures are visible by default and title review stays local until acceptance", async ({
  page,
  captures,
  isMobile,
}) => {
  const inbox = await openInbox(page);
  const row = inbox.locator(".inbox-review__item");
  await expect(row.getByRole("heading")).toHaveText(original);
  await expect(row.getByText("Agent or API", { exact: true })).toBeVisible();
  await expect(row.locator("time")).toHaveAttribute(
    "datetime",
    MOBILE_NOW.toISOString(),
  );
  await row.getByRole("button", { name: "Edit title", exact: true }).click();
  await row
    .getByLabel("Task title", { exact: true })
    .fill("Discard this local title draft");
  await row
    .getByRole("button", { name: "Cancel title edit", exact: true })
    .click();
  await expect(row.getByRole("heading")).toHaveText(original);
  expect(captures.writes).toEqual([]);
  await row.getByRole("button", { name: "Edit title", exact: true }).click();
  await row.getByLabel("Task title", { exact: true }).fill(edited);
  await expect(
    row.getByText("Original capture", { exact: true }),
  ).toBeVisible();
  await expect(row.locator(".inbox-review__context")).toContainText(original);
  await row.getByRole("button", { name: "Done editing", exact: true }).click();
  expect(captures.writes).toEqual([]);
  await screenshot(page, "capture-title-review");

  const accept = captures.holdNext();
  await row
    .getByRole("button", { name: "Accept to Tasks", exact: true })
    .click();
  expect((await accept.request()).body).toEqual({ title: edited });
  await expect(
    row.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(
    row.getByRole("button", { name: "Discard", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  expect(captures.writes).toHaveLength(1);
  accept.respond();
  await expect(inbox.locator(".inbox-review__notice")).toContainText(
    "Accepted to Tasks",
  );
  await expect(row).toHaveCount(0);
  expect(captures.api.todos()).toHaveLength(1);
  expect(captures.api.todos()[0].title).toBe(edited);
  expect(captures.api.todos()[0].notes).toBe(
    `Captured from api at ${MOBILE_NOW.toISOString()}\n\n${original}`,
  );
  await screenshot(page, "capture-accepted");

  await showTasks(page, isMobile);
  const task = isMobile
    ? page.getByRole("button", { name: new RegExp(`^${edited}`) }).first()
    : page.locator('[data-todo-id="accepted-capture-conversation"]');
  await expect(task).toBeVisible();
  await page.reload();
  await showTasks(page, isMobile);
  await expect(task).toBeVisible();
  expect(captures.api.todos()).toHaveLength(1);
  await showInbox(page, isMobile);
  await expect(
    inbox.getByRole("heading", { name: "Inbox is clear", exact: true }),
  ).toBeVisible();
  expect(captures.writes).toHaveLength(1);
});

test("a failed Inbox load is explicit and retry restores pending captures", async ({
  page,
  captures,
}) => {
  captures.setReadStatus(503);
  const inbox = await openInbox(page);
  await expect(inbox.getByRole("alert")).toBeVisible();
  await expect(
    inbox.getByRole("heading", { name: "Inbox is clear", exact: true }),
  ).toHaveCount(0);
  captures.setReadStatus(200);
  await inbox
    .getByRole("button", { name: "Retry loading Inbox", exact: true })
    .click();
  await expect(inbox.locator(".inbox-review__item")).toHaveCount(1);
  await expect(inbox.getByRole("alert")).toHaveCount(0);
  expect(captures.reads.length).toBeGreaterThanOrEqual(2);
  expect(
    captures.reads.every((path) => path === "/capture?review=pending"),
  ).toBe(true);
  expect(captures.writes).toEqual([]);
});

test("discard requires confirmation, cancel is local, and a failed discard can be retried", async ({
  page,
  captures,
}) => {
  const inbox = await openInbox(page);
  const row = inbox.locator(".inbox-review__item");
  await row.getByRole("button", { name: "Discard", exact: true }).click();
  await row.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Accept to Tasks", exact: true }),
  ).toBeVisible();
  expect(captures.writes).toEqual([]);
  await row.getByRole("button", { name: "Discard", exact: true }).click();
  const discard = captures.holdNext(
    "POST",
    "/capture/capture-conversation/discard",
  );
  await row
    .getByRole("button", { name: "Confirm discard", exact: true })
    .click();
  await discard.request();
  await expect(
    row.getByRole("button", { name: "Discarding…", exact: true }),
  ).toBeDisabled();
  await expect(
    row.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  discard.respond({ status: 422 });
  await expect(row.getByRole("alert")).toBeVisible();
  expect(captures.captures()[0].lifecycle).toBe("new");
  await row
    .getByRole("button", { name: "Confirm discard", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(captures.captures()[0].lifecycle).toBe("discarded");
  expect(captures.api.todos()).toEqual([]);
  await page.reload();
  await expect(
    inbox.getByRole("heading", { name: "Inbox is clear", exact: true }),
  ).toBeVisible();
  expect(captures.writes).toHaveLength(2);
});

test("ambiguous committed acceptance retains the edited draft and retry resolves to the same task", async ({
  page,
  captures,
  isMobile,
}) => {
  const inbox = await openInbox(page);
  const row = inbox.locator(".inbox-review__item");
  await row.getByRole("button", { name: "Edit title", exact: true }).click();
  await row.getByLabel("Task title", { exact: true }).fill(edited);
  const accept = captures.holdNext();
  await row
    .getByRole("button", { name: "Accept to Tasks", exact: true })
    .click();
  await accept.request();
  accept.respond({ status: 500, commit: true });
  await expect(row.getByRole("alert")).toBeVisible();
  await expect(row.getByLabel("Task title", { exact: true })).toHaveValue(
    edited,
  );
  expect(captures.api.todos()).toHaveLength(1);
  const savedId = captures.api.todos()[0].id;
  await row
    .getByRole("button", { name: "Accept to Tasks", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(captures.writes).toHaveLength(2);
  expect(captures.writes.map((write) => write.body)).toEqual([
    { title: edited },
    { title: edited },
  ]);
  expect(captures.api.todos()).toHaveLength(1);
  expect(captures.api.todos()[0].id).toBe(savedId);
  await showTasks(page, isMobile);
  await expect(page.getByText(edited, { exact: true })).toBeVisible();
});

test("manual Inbox capture requires a confirmed response and checks an ambiguous save before repeating it", async ({
  page,
  captures,
}) => {
  const inbox = await openInbox(page);
  const draft = "Save the pricing comparison from our conversation";
  const input = inbox.getByRole("textbox", {
    name: "Save an intention for review",
    exact: true,
  });
  await input.fill(draft);
  const save = captures.holdNext("POST", "/agent/write/capture_inbox_item");
  await inbox
    .getByRole("button", { name: "Save to Inbox", exact: true })
    .click();
  expect((await save.request()).body).toEqual({
    text: draft,
    source: "manual",
  });
  save.respond({ status: 500, commit: true });
  await expect(inbox.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue(draft);
  await expect(
    inbox.getByRole("button", { name: "Save to Inbox", exact: true }),
  ).toBeDisabled();
  await inbox.getByRole("button", { name: "Check Inbox", exact: true }).click();
  await expect(inbox.getByRole("alert")).toContainText(
    "matching capture is in Inbox",
  );
  await expect(inbox.locator(".inbox-review__item")).toHaveCount(2);
  await expect(
    inbox.getByRole("button", { name: "Save to Inbox", exact: true }),
  ).toBeDisabled();
  await inbox.getByRole("button", { name: "Clear draft", exact: true }).click();
  await expect(input).toHaveValue("");
  expect(captures.writes).toHaveLength(1);
  expect(
    captures.captures().filter((item) => item.text === draft),
  ).toHaveLength(1);
});

test("an accepted task uses the existing mobile reschedule and completion flows", async ({
  page,
  captures,
  isMobile,
}) => {
  test.skip(
    !isMobile,
    "Mobile task actions already have isolated stateful coverage",
  );
  const inbox = await openInbox(page);
  await inbox
    .locator(".inbox-review__item")
    .getByRole("button", { name: "Accept to Tasks", exact: true })
    .click();
  await expect(inbox.locator(".inbox-review__notice")).toContainText(
    "Accepted to Tasks",
  );
  await inbox.getByRole("button", { name: "Open task", exact: true }).click();
  const details = page.getByRole("dialog", {
    name: "Task details",
    exact: true,
  });
  await expect(details).toBeVisible();
  await details
    .getByRole("button", { name: "Reschedule", exact: true })
    .click();
  const schedule = page.getByRole("dialog", { name: "Plan for…", exact: true });
  await schedule.getByRole("button", { name: /^Tomorrow/ }).click();
  await expect(schedule).toBeHidden();
  expect(captures.api.todos()[0].scheduledDate).toBe(
    "2026-10-08T16:00:00.000Z",
  );
  await details.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(details).toBeHidden();
  expect(captures.api.todos()[0].completed).toBe(true);
  expect(captures.api.writes).toHaveLength(2);
  expect(captures.writes).toHaveLength(1);

  await expect(
    inbox.getByRole("heading", { name: "Inbox is clear", exact: true }),
  ).toBeVisible();
});

test("title and capture drafts survive navigation and pending acceptance updates the visible Tasks view", async ({
  page,
  captures,
  isMobile,
}) => {
  const inbox = await openInbox(page);
  const draft = "An intention still being written";
  await inbox
    .getByRole("textbox", { name: "Save an intention for review", exact: true })
    .fill(draft);
  const row = inbox.locator(".inbox-review__item");
  await row.getByRole("button", { name: "Edit title", exact: true }).click();
  await row.getByLabel("Task title", { exact: true }).fill(edited);
  await showTasks(page, isMobile);
  await showInbox(page, isMobile);
  await expect(
    inbox.getByRole("textbox", {
      name: "Save an intention for review",
      exact: true,
    }),
  ).toHaveValue(draft);
  await expect(row.getByLabel("Task title", { exact: true })).toHaveValue(
    edited,
  );
  expect(captures.writes).toEqual([]);
  const accept = captures.holdNext();
  await row
    .getByRole("button", { name: "Accept to Tasks", exact: true })
    .click();
  await accept.request();
  await showTasks(page, isMobile);
  await expect(page.getByText(edited, { exact: true })).toHaveCount(0);
  accept.respond();
  await expect(page.getByText(edited, { exact: true })).toBeVisible();
  expect(captures.api.todos()).toHaveLength(1);
  expect(captures.writes).toHaveLength(1);
  await screenshot(page, "accepted-task-after-navigation");
  await showInbox(page, isMobile);
  await expect(inbox.locator(".inbox-review__item")).toHaveCount(0);
  await expect(
    inbox.getByRole("textbox", {
      name: "Save an intention for review",
      exact: true,
    }),
  ).toHaveValue(draft);
});

test("desktop Inbox capture and title drafts survive Today, Tasks, Horizon, Settings and Activity navigation", async ({
  page,
  captures,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop navigation uses a bounded view cache");
  const inbox = await openInbox(page);
  const draft = "An unsaved intention beyond the navigation cache";
  const input = inbox.getByRole("textbox", {
    name: "Save an intention for review",
    exact: true,
  });
  const row = inbox.locator(".inbox-review__item");
  await input.fill(draft);
  await row.getByRole("button", { name: "Edit title", exact: true }).click();
  await row.getByLabel("Task title", { exact: true }).fill(edited);
  for (const view of ["today", "all", "horizon"]) {
    const navigation = page.locator(`button[data-workspace-view="${view}"]`);
    await navigation.click();
    await expect(navigation).toHaveClass(/projects-rail-item--active/);
    await expect(inbox).toBeHidden();
  }
  await showInbox(page, false);
  await screenshot(page, "desktop-inbox-drafts-after-navigation");
  await expect.soft(input).toHaveValue(draft);
  await expect
    .soft(row.getByLabel("Task title", { exact: true }))
    .toHaveValue(edited);
  await page.locator(".profile-launcher__trigger").click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(inbox).toBeHidden();
  expect(
    await page.evaluate(() =>
      Boolean(
        document
          .querySelector('[aria-label="Inbox review"]')
          ?.contains(document.activeElement),
      ),
    ),
  ).toBe(false);
  await showInbox(page, false);
  await expect(input).toHaveValue(draft);
  await expect(row.getByLabel("Task title", { exact: true })).toHaveValue(
    edited,
  );
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Agent Activity", exact: true }),
  ).toBeVisible();
  await expect(inbox).toBeHidden();
  expect(
    await page.evaluate(() =>
      Boolean(
        document
          .querySelector('[aria-label="Inbox review"]')
          ?.contains(document.activeElement),
      ),
    ),
  ).toBe(false);
  await showInbox(page, false);
  await inbox
    .getByRole("button", { name: "Refresh Inbox", exact: true })
    .click();
  await expect(input).toHaveValue(draft);
  await expect(row.getByLabel("Task title", { exact: true })).toHaveValue(
    edited,
  );
  expect(captures.writes).toEqual([]);
  expect(captures.captures()[0].text).toBe(original);
});

test("refreshing Inbox after a committed acceptance response is lost restores Tasks without retrying acceptance", async ({
  page,
  captures,
  isMobile,
}) => {
  const inbox = await openInbox(page);
  const row = inbox.locator(".inbox-review__item");
  await row.getByRole("button", { name: "Edit title", exact: true }).click();
  await row.getByLabel("Task title", { exact: true }).fill(edited);
  captures.dropNextCommittedAcceptResponse();
  await row
    .getByRole("button", { name: "Accept to Tasks", exact: true })
    .click();
  await expect(row.getByRole("alert")).toBeVisible();
  expect(captures.api.todos()).toHaveLength(1);
  const saved = captures.api.todos()[0];
  expect(saved.title).toBe(edited);
  expect(saved.notes).toContain(original);
  expect(captures.writes).toHaveLength(1);
  await inbox
    .getByRole("button", { name: "Refresh Inbox", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await expect(
    inbox.getByRole("heading", { name: "Inbox is clear", exact: true }),
  ).toBeVisible();
  await showTasks(page, isMobile);
  await screenshot(page, "task-after-lost-acceptance-and-inbox-refresh");
  const task = isMobile
    ? page.getByRole("button", { name: new RegExp(`^${edited}`) }).first()
    : page.locator(`[data-todo-id="${saved.id}"]`);
  await expect(task).toBeVisible();
  expect(captures.writes).toHaveLength(1);
  expect(captures.api.todos()).toHaveLength(1);
  expect(captures.api.todos()[0].id).toBe(saved.id);
});

test("a delayed Inbox refresh cannot replace the selected project's tasks with other projects", async ({
  page,
  captures,
  isMobile,
}) => {
  test.skip(
    isMobile,
    "Desktop project navigation shares the filtered Tasks store",
  );
  const pine = captureProject({ id: "project-pine", name: "Project Pine" });
  const oak = captureProject({ id: "project-oak", name: "Project Oak" });
  const pineTask = mobileTask({
    id: "task-pine",
    title: "Keep the Pine task scoped",
    projectId: pine.id,
  });
  const oakTask = mobileTask({
    id: "task-oak",
    title: "Keep the Oak task out of Pine",
    projectId: oak.id,
  });
  captures.replaceProjects([pine, oak]);
  captures.api.replaceTodos([pineTask, oakTask]);
  const inbox = await openInbox(page);
  await expect(inbox.locator(".inbox-review__item")).toHaveCount(1);
  const refresh = captures.holdNext("GET", "/capture");
  await inbox
    .getByRole("button", { name: "Refresh Inbox", exact: true })
    .click();
  await refresh.request();
  const projectNavigation = page.locator(
    'button[data-project-key="Project Pine"]',
  );
  await projectNavigation.click();
  await expect(projectNavigation).toHaveClass(/projects-rail-item--active/);
  const visiblePine = page.getByRole("button", {
    name: pineTask.title,
    exact: true,
  });
  const visibleOak = page.getByRole("button", {
    name: oakTask.title,
    exact: true,
  });
  await expect(visiblePine).toBeVisible();
  await expect(visibleOak).toHaveCount(0);
  const readsBeforeRelease = captures.scopedTodoReads.length;
  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/capture" &&
      response.request().method() === "GET",
  );
  refresh.respond();
  await refreshed;
  await page.waitForLoadState("networkidle");
  expect(captures.scopedTodoReads.length).toBeGreaterThan(readsBeforeRelease);
  expect(
    new URL(
      captures.scopedTodoReads.at(-1)!,
      "http://127.0.0.1",
    ).searchParams.get("projectId"),
  ).toBe(pine.id);
  await expect(projectNavigation).toHaveClass(/projects-rail-item--active/);
  await expect(visiblePine).toBeVisible();
  await expect(visibleOak).toHaveCount(0);
  expect(captures.writes).toEqual([]);
  expect(captures.api.todos()).toHaveLength(2);
  await screenshot(page, "project-task-scope-after-delayed-inbox-refresh");
});

test("an ambiguous manual save with no confirmed match reuses its opaque key when retried", async ({
  page,
  captures,
}) => {
  const inbox = await openInbox(page);
  const draft = "Save the next steps from our agent conversation";
  await inbox
    .getByRole("textbox", { name: "Save an intention for review", exact: true })
    .fill(draft);
  const save = captures.holdNext("POST", "/agent/write/capture_inbox_item");
  await inbox
    .getByRole("button", { name: "Save to Inbox", exact: true })
    .click();
  await save.request();
  save.respond({ status: 500 });
  await expect(
    inbox.getByRole("button", { name: "Save to Inbox", exact: true }),
  ).toBeDisabled();
  await inbox.getByRole("button", { name: "Check Inbox", exact: true }).click();
  await expect(inbox.getByRole("alert")).toContainText("No matching capture");
  await inbox
    .getByRole("button", { name: "Save to Inbox", exact: true })
    .click();
  await expect(inbox.locator(".inbox-review__notice")).toContainText(
    "Saved to Inbox for review",
  );
  expect(captures.captureKeys).toHaveLength(2);
  expect(captures.captureKeys[0]).toBe(captures.captureKeys[1]);
  expect(
    captures.captures().filter((item) => item.text === draft),
  ).toHaveLength(1);
  expect(captures.writes.every((write) => write.body.source === "manual")).toBe(
    true,
  );
});

test("pending review includes an agent-triaged intention until it has a promoted task", async ({
  page,
  captures,
}) => {
  const triaged = "A previously triaged intention still needs your decision";
  captures.replaceCaptures([
    captureItem(),
    captureItem({
      id: "capture-triaged",
      text: triaged,
      lifecycle: "triaged",
      triageResult: { route: "task", confidence: 0.9 },
    }),
    captureItem({
      id: "capture-promoted",
      text: "Already accepted intention",
      lifecycle: "triaged",
      triageResult: { promotedAs: "task", promotedId: "existing-task" },
    }),
    captureItem({
      id: "capture-discarded",
      text: "Already discarded intention",
      lifecycle: "discarded",
    }),
  ]);
  const inbox = await openInbox(page);
  await expect(inbox.locator(".inbox-review__item")).toHaveCount(2);
  const row = inbox.locator(".inbox-review__item").filter({ hasText: triaged });
  await row
    .getByRole("button", { name: "Accept to Tasks", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(captures.api.todos()[0].title).toBe(triaged);
  expect(captures.api.todos()[0].notes).toContain(triaged);
  await page.reload();
  await expect(inbox.locator(".inbox-review__item")).toHaveCount(1);
  expect(captures.writes).toHaveLength(1);
});

test("desktop task composer retains an ambiguous Inbox draft and retry confirms one capture with the same key", async ({
  page,
  captures,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop composer surface");
  await openInbox(page);
  await page
    .getByRole("button", { name: "New Task", exact: true })
    .first()
    .click();
  const composer = page.getByRole("dialog", { name: "New task", exact: true });
  const draft = "Save our workshop idea for review later";
  await composer.getByPlaceholder("Task title", { exact: true }).fill(draft);
  const save = captures.holdNext("POST", "/agent/write/capture_inbox_item");
  await composer
    .getByRole("button", { name: "Save to Inbox", exact: true })
    .click();
  expect((await save.request()).body).toEqual({
    text: draft,
    source: "manual",
  });
  save.respond({ status: 500, commit: true });
  await expect(composer.getByRole("alert")).toBeVisible();
  await expect(
    composer.getByPlaceholder("Task title", { exact: true }),
  ).toHaveValue(draft);
  await composer
    .getByRole("button", { name: "Save to Inbox", exact: true })
    .click();
  await expect(composer).toBeHidden();
  expect(captures.captureKeys).toHaveLength(2);
  expect(captures.captureKeys[0]).toBe(captures.captureKeys[1]);
  expect(
    captures.captures().filter((item) => item.text === draft),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Open Inbox", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Inbox review", exact: true })
      .getByRole("heading", { name: draft, exact: true }),
  ).toBeVisible();
  await screenshot(page, "desktop-composer-inbox-capture");
});

test("accepting a short task title preserves the full long capture and provenance in task notes", async ({
  page,
  captures,
  isMobile,
}) => {
  const raw =
    "Workshop decisions from our conversation:\n" +
    "Use the original constraints when reviewing the plan.\n".repeat(34);
  captures.replaceCaptures([captureItem({ text: raw })]);
  const inbox = await openInbox(page);
  const row = inbox.locator(".inbox-review__item");
  await expect(row.locator(".inbox-review__context")).toContainText(raw);
  await row.getByRole("button", { name: "Edit title", exact: true }).click();
  await row
    .getByLabel("Task title", { exact: true })
    .fill("Review the workshop constraints");
  await row
    .getByRole("button", { name: "Accept to Tasks", exact: true })
    .click();
  await expect(inbox.locator(".inbox-review__notice")).toContainText(
    "Accepted to Tasks",
  );
  const notes = `Captured from api at ${MOBILE_NOW.toISOString()}\n\n${raw}`;
  expect(captures.api.todos()[0].notes).toBe(notes);
  await inbox.getByRole("button", { name: "Open task", exact: true }).click();
  const details = page.getByRole("dialog", {
    name: "Task details",
    exact: true,
  });
  await expect(details).toBeVisible();
  if (isMobile)
    await expect(details.locator(".m-task-details__notes")).toHaveText(notes);
  else {
    await details
      .getByRole("button", { name: "View all fields →", exact: true })
      .click();
    await expect(
      page.getByPlaceholder("Private notes, links, context…", { exact: true }),
    ).toHaveValue(notes);
  }
  await screenshot(page, "accepted-task-source-context");
});

test("editing a multi-line capture title keeps words separated and the original context intact", async ({
  page,
  captures,
}) => {
  const inbox = await openInbox(page);
  const row = inbox.locator(".inbox-review__item");
  const flattened = original.replace("\n", " ");
  await row.getByRole("button", { name: "Edit title", exact: true }).click();
  const input = row.getByLabel("Task title", { exact: true });
  await expect(input).toHaveValue(flattened);
  // Emulated mobile keyboards ignore End, so place the caret explicitly.
  await input.focus();
  await input.evaluate((el: HTMLInputElement) =>
    el.setSelectionRange(el.value.length, el.value.length),
  );
  await input.pressSequentially(" today");
  await expect(row.locator(".inbox-review__context")).toContainText(original, {
    useInnerText: true,
  });
  const accept = captures.holdNext();
  await row
    .getByRole("button", { name: "Accept to Tasks", exact: true })
    .click();
  expect((await accept.request()).body).toEqual({
    title: `${flattened} today`,
  });
  accept.respond();
  await expect(row).toHaveCount(0);
  expect(captures.api.todos()[0].notes).toContain(original);
});

// Crossing 700px swaps AppShell and MobileShell, remounting the Inbox. The
// desktop project drives both directions with explicit viewport sizes.
const WIDE = { width: 1280, height: 900 };
const NARROW = { width: 600, height: 900 };

async function crossBreakpoint(page: Page, size: typeof WIDE) {
  await page.setViewportSize(size);
  await showInbox(page, size === NARROW);
  return page.getByRole("region", { name: "Inbox review", exact: true });
}

// A controlled textarea mirrors its value into the label's text, so match by role.
const captureBox = (inbox: ReturnType<Page["getByRole"]>) =>
  inbox.getByRole("textbox", {
    name: "Save an intention for review",
    exact: true,
  });

test("unsaved Inbox capture and title drafts survive crossing the mobile breakpoint both ways", async ({
  page,
  captures,
  isMobile,
}) => {
  test.skip(isMobile, "The desktop project resizes across 700px explicitly");
  await page.setViewportSize(WIDE);
  let inbox = await openInbox(page);
  await captureBox(inbox).fill("Unsaved breakpoint draft");
  let row = inbox.locator(".inbox-review__item");
  await row.getByRole("button", { name: "Edit title", exact: true }).click();
  await row.getByLabel("Task title", { exact: true }).fill(edited);

  inbox = await crossBreakpoint(page, NARROW);
  await expect(page.locator(".m-shell")).toBeVisible();
  row = inbox.locator(".inbox-review__item");
  await expect(captureBox(inbox)).toHaveValue("Unsaved breakpoint draft");
  await expect(row.getByLabel("Task title", { exact: true })).toHaveValue(
    edited,
  );
  await captureBox(inbox).fill("Unsaved mobile draft");

  inbox = await crossBreakpoint(page, WIDE);
  await expect(page.locator(".m-shell")).toHaveCount(0);
  row = inbox.locator(".inbox-review__item");
  await expect(captureBox(inbox)).toHaveValue("Unsaved mobile draft");
  await expect(row.getByLabel("Task title", { exact: true })).toHaveValue(
    edited,
  );
  expect(captures.writes).toEqual([]);
  expect(
    await page.evaluate(() =>
      [localStorage, sessionStorage].some((storage) =>
        Object.values({ ...storage }).some((value) =>
          String(value).includes("Unsaved"),
        ),
      ),
    ),
  ).toBe(false);
});

test("a pending accept stays blocked across the breakpoint and settles without another click", async ({
  page,
  captures,
  isMobile,
}) => {
  test.skip(isMobile, "The desktop project resizes across 700px explicitly");
  await page.setViewportSize(WIDE);
  let inbox = await openInbox(page);
  let row = inbox.locator(".inbox-review__item");
  await row.getByRole("button", { name: "Edit title", exact: true }).click();
  await row.getByLabel("Task title", { exact: true }).fill(edited);
  const accept = captures.holdNext();
  await row
    .getByRole("button", { name: "Accept to Tasks", exact: true })
    .click();
  expect((await accept.request()).body).toEqual({ title: edited });

  inbox = await crossBreakpoint(page, NARROW);
  row = inbox.locator(".inbox-review__item");
  await expect(
    row.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(
    row.getByRole("button", { name: "Discard", exact: true }),
  ).toBeDisabled();
  expect(captures.writes).toHaveLength(1);
  accept.respond();
  await expect(row).toHaveCount(0);
  await expect(inbox.getByText("Inbox is clear")).toBeVisible();
  expect(captures.writes).toHaveLength(1);
  expect(captures.api.todos().map((todo) => todo.title)).toEqual([edited]);

  inbox = await crossBreakpoint(page, WIDE);
  await expect(inbox.getByText("Inbox is clear")).toBeVisible();
  await expect(inbox.getByLabel("Task title", { exact: true })).toHaveCount(0);
});

test("a capture save confirmed after crossing the breakpoint clears the draft without resurrecting it", async ({
  page,
  captures,
  isMobile,
}) => {
  test.skip(isMobile, "The desktop project resizes across 700px explicitly");
  await page.setViewportSize(NARROW);
  await page.clock.setFixedTime(MOBILE_NOW);
  await page.goto("/app/");
  let inbox = await crossBreakpoint(page, NARROW);
  await captureBox(inbox).fill("Breakpoint intention");
  const save = captures.holdNext("POST", "/agent/write/capture_inbox_item");
  await inbox
    .getByRole("button", { name: "Save to Inbox", exact: true })
    .click();
  await save.request();

  inbox = await crossBreakpoint(page, WIDE);
  await expect(captureBox(inbox)).toHaveValue("Breakpoint intention");
  await expect(captureBox(inbox)).toBeDisabled();
  await expect(
    inbox.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  save.respond();
  await expect(captureBox(inbox)).toHaveValue("");
  await expect(
    inbox.getByRole("heading", { name: "Breakpoint intention", exact: true }),
  ).toBeVisible();

  inbox = await crossBreakpoint(page, NARROW);
  await expect(captureBox(inbox)).toHaveValue("");
  await expect(
    inbox.getByRole("heading", { name: "Breakpoint intention", exact: true }),
  ).toBeVisible();
  expect(captures.captureKeys).toHaveLength(1);
});
