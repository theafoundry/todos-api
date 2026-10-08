import { test as base, expect, type Page } from "@playwright/test";
import {
  installMobileFixture,
  MOBILE_TASK_ID,
  MOBILE_TASK_TITLE,
  mobileTask,
  openMobileApp,
  openTaskEditor,
  pointerDrag,
  taskRow,
  touchDrag,
  type MobileFixture,
} from "./helpers/mobile-fixture";

const test = base.extend<{ mobileApi: MobileFixture }>({
  mobileApi: async ({ context, baseURL }, use) => {
    const api = await installMobileFixture(context, baseURL!);
    await use(api);
    api.assertIsolated();
  },
});

test.use({ serviceWorkers: "block", timezoneId: "America/Los_Angeles" });
test.skip(({ isMobile }) => !isMobile, "These journeys require emulated touch");

async function revealDetails(page: Page) {
  const disclosure = page.getByRole("button", {
    name: "More details",
    exact: true,
  });
  if ((await disclosure.getAttribute("aria-expanded")) !== "true")
    await disclosure.tap();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
}

test("touch Edit, disclosure, and body gestures preserve the composed editor", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  const editor = await openTaskEditor(page);
  const status = editor.getByRole("button", { name: /^Status Next/ });
  await status.tap();
  await expect(
    editor.getByRole("group", { name: "Status options", exact: true }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Waiting", exact: true }).tap();
  await expect(
    editor.getByRole("button", { name: /^Status Waiting/ }),
  ).toHaveAttribute("aria-expanded", "false");
  await revealDetails(page);
  await expect(editor.getByLabel("Notes", { exact: true })).toBeVisible();
  await touchDrag(page, ".m-mobile-modal__body", 0, 150);
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAccessibleName("Edit task");
  await expect(
    page.getByRole("button", { name: "More details", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  const scroller = editor.locator(".m-mobile-modal__body");
  const maximum = await scroller.evaluate(
    (element) => element.scrollHeight - element.clientHeight,
  );
  expect(maximum).toBeGreaterThan(0);
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(
    editor.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  expect(mobileApi.writes).toEqual([]);
});

test("typing stays local; a gated Save keeps the complete draft and prevents competing writes", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  const editor = await openTaskEditor(page);
  await editor
    .getByLabel("Task title", { exact: true })
    .fill("Updated mobile plan");
  await revealDetails(page);
  const notes = editor.getByLabel("Notes", { exact: true });
  await notes.fill("");
  await notes.pressSequentially("abc");
  await expect(notes).toHaveValue("abc");
  expect(mobileApi.writes).toEqual([]);
  const save = mobileApi.holdNextWrite();
  await editor.getByRole("button", { name: "Save", exact: true }).tap();
  const request = await save.request();
  expect(request.body).toMatchObject({
    title: "Updated mobile plan",
    notes: "abc",
  });
  await expect(
    editor.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  expect(mobileApi.writes).toHaveLength(1);
  await expect(notes).toHaveValue("abc");
  save.respond();
  await expect(
    page.getByRole("dialog", { name: "Task details", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saved task");
  expect(mobileApi.todos()[0]).toMatchObject({
    title: "Updated mobile plan",
    notes: "abc",
  });
});

test("failed Save retains the draft and Retry sends one coherent update", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  const editor = await openTaskEditor(page);
  await editor
    .getByLabel("Task title", { exact: true })
    .fill("Keep this failed draft");
  const save = mobileApi.holdNextWrite();
  await editor.getByRole("button", { name: "Save", exact: true }).tap();
  await save.request();
  save.respond({ status: 422 });
  await expect(editor.getByRole("alert")).toBeVisible();
  await expect(editor.getByLabel("Task title", { exact: true })).toHaveValue(
    "Keep this failed draft",
  );
  expect(mobileApi.todos()[0].title).toBe(MOBILE_TASK_TITLE);
  const retry = mobileApi.holdNextWrite();
  await editor.getByRole("button", { name: "Retry", exact: true }).tap();
  expect((await retry.request()).body.title).toBe("Keep this failed draft");
  retry.respond();
  await expect(
    page.getByRole("dialog", { name: "Task details", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saved task");
  expect(mobileApi.writes).toHaveLength(2);
});

test("Cancel confirms an unsaved draft and discards without an API write", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  const editor = await openTaskEditor(page);
  await editor.getByLabel("Task title", { exact: true }).fill("Unsaved title");
  await editor.getByRole("button", { name: "Cancel", exact: true }).tap();
  await page.getByRole("button", { name: "Keep editing", exact: true }).tap();
  await expect(editor.getByLabel("Task title", { exact: true })).toHaveValue(
    "Unsaved title",
  );
  await editor.getByRole("button", { name: "Cancel", exact: true }).tap();
  await page.getByRole("button", { name: /^Discard(?: changes)?$/ }).tap();
  await expect(
    page.getByRole("dialog", { name: "Edit task", exact: true }),
  ).toBeHidden();
  expect(mobileApi.writes).toEqual([]);
  expect(mobileApi.todos()[0].title).toBe(MOBILE_TASK_TITLE);
});

test("the modal traps keyboard focus, restores its opener, and keeps touch targets usable", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  const row = taskRow(page);
  const complete = page.getByRole("button", {
    name: `Complete ${MOBILE_TASK_TITLE}`,
    exact: true,
  });
  const hitArea = await complete.boundingBox();
  expect(hitArea?.width).toBeGreaterThanOrEqual(44);
  expect(hitArea?.height).toBeGreaterThanOrEqual(44);
  await row.focus();
  await row.tap();
  const details = page.getByRole("dialog", {
    name: "Task details",
    exact: true,
  });
  await expect(details).toBeVisible();
  const close = details.getByRole("button", {
    name: "Close Task details",
    exact: true,
  });
  await expect(close).toBeFocused();
  await expect(page.locator(".m-tab-bar")).toHaveAttribute("inert", "");
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(
      () => document.activeElement?.closest('[role="dialog"]') !== null,
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(row).toBeFocused();
  await expect(page.locator(".m-tab-bar")).not.toHaveAttribute("inert", "");
  expect(mobileApi.writes).toEqual([]);
});

test("capture blocks duplicate submits while pending and reports success", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  await page.getByRole("button", { name: "Quick capture", exact: true }).tap();
  const capture = page.getByRole("dialog", {
    name: "Quick capture",
    exact: true,
  });
  await capture
    .getByLabel("Task title", { exact: true })
    .fill("One captured task");
  const create = mobileApi.holdNextWrite("POST", "/todos");
  await capture.getByRole("button", { name: "Add Task", exact: true }).tap();
  expect((await create.request()).body.title).toBe("One captured task");
  await expect(
    capture.getByRole("button", { name: "Adding…", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  expect(mobileApi.writes).toHaveLength(1);
  create.respond();
  await expect(capture).toBeHidden();
  expect(
    mobileApi.todos().filter((todo) => todo.title === "One captured task"),
  ).toHaveLength(1);
  await expect(page.getByRole("status")).toContainText(/Added|Created|Saved/);
});

test("failed capture retains input and explicit Retry creates once", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  await page.getByRole("button", { name: "Quick capture", exact: true }).tap();
  const capture = page.getByRole("dialog", {
    name: "Quick capture",
    exact: true,
  });
  await capture
    .getByLabel("Task title", { exact: true })
    .fill("Recover capture");
  const create = mobileApi.holdNextWrite("POST", "/todos");
  await capture.getByRole("button", { name: "Add Task", exact: true }).tap();
  await create.request();
  create.respond({ status: 422 });
  await expect(capture.getByRole("alert")).toBeVisible();
  await expect(capture.getByLabel("Task title", { exact: true })).toHaveValue(
    "Recover capture",
  );
  expect(mobileApi.todos()).toHaveLength(1);
  const retry = mobileApi.holdNextWrite("POST", "/todos");
  await capture.getByRole("button", { name: "Retry", exact: true }).tap();
  await retry.request();
  retry.respond();
  await expect(capture).toBeHidden();
  expect(
    mobileApi.todos().filter((todo) => todo.title === "Recover capture"),
  ).toHaveLength(1);
});

test("an uncertain create keeps the draft and blocks a blind duplicate retry", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  await page.getByRole("button", { name: "Quick capture", exact: true }).tap();
  const capture = page.getByRole("dialog", {
    name: "Quick capture",
    exact: true,
  });
  await capture
    .getByLabel("Task title", { exact: true })
    .fill("Uncertain capture");
  const create = mobileApi.holdNextWrite("POST", "/todos");
  await capture.getByRole("button", { name: "Add Task", exact: true }).tap();
  await create.request();
  create.respond({ status: 500 });
  await expect(capture.getByRole("alert")).toContainText(
    /uncertain|check your tasks/i,
  );
  await expect(capture.getByLabel("Task title", { exact: true })).toHaveValue(
    "Uncertain capture",
  );
  await expect(
    capture.getByRole("button", { name: "Add Task", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  expect(mobileApi.writes).toHaveLength(1);
});

test("rescheduling changes planned time without changing an existing deadline", async ({
  page,
  context,
  baseURL,
}) => {
  const deadline = "2026-10-10T06:59:59.999Z";
  const api = await installMobileFixture(context, baseURL!, [
    mobileTask({ dueDate: deadline }),
  ]);
  await openMobileApp(page);
  await page.getByRole("tab", { name: "Everything", exact: true }).tap();
  await taskRow(page).tap();
  await page
    .getByRole("dialog", { name: "Task details", exact: true })
    .getByRole("button", { name: "Reschedule", exact: true })
    .tap();
  const reschedule = page.getByRole("dialog", {
    name: "Plan for…",
    exact: true,
  });
  const planned = api.holdNextWrite();
  await reschedule.getByRole("button", { name: /^Tomorrow/ }).tap();
  const request = await planned.request();
  expect(request.body).toEqual({ scheduledDate: "2026-10-08T16:00:00.000Z" });
  planned.respond();
  await expect(reschedule).toBeHidden();
  expect(api.todos()[0].dueDate).toBe(deadline);
  expect(api.todos()[0].scheduledDate).toBe("2026-10-08T16:00:00.000Z");
  api.assertIsolated();
});

test("completion failure restores the row; successful completion exposes a working Undo", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  const failed = mobileApi.holdNextWrite();
  await page
    .getByRole("button", { name: `Complete ${MOBILE_TASK_TITLE}`, exact: true })
    .tap();
  expect((await failed.request()).body.completed).toBe(true);
  failed.respond({ status: 422 });
  await expect(page.getByRole("alert")).toContainText(
    /rejected|Could not|Failed/,
  );
  await expect(taskRow(page)).toBeVisible();
  expect(mobileApi.todos()[0].completed).toBe(false);
  const complete = mobileApi.holdNextWrite();
  await page
    .getByRole("button", { name: `Complete ${MOBILE_TASK_TITLE}`, exact: true })
    .tap();
  await complete.request();
  complete.respond();
  await expect(page.getByRole("status")).toContainText("Completed task");
  const undo = mobileApi.holdNextWrite();
  await page.getByRole("button", { name: "Undo", exact: true }).tap();
  expect((await undo.request()).body.completed).toBe(false);
  undo.respond();
  await expect(
    page.getByRole("button", {
      name: `Complete ${MOBILE_TASK_TITLE}`,
      exact: true,
    }),
  ).toBeVisible();
  expect(mobileApi.todos()[0].completed).toBe(false);
});

test("a failed Undo remains completed and offers an explicit recovery", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  await page
    .getByRole("button", { name: `Complete ${MOBILE_TASK_TITLE}`, exact: true })
    .tap();
  await expect(page.getByRole("status")).toContainText("Completed task");
  const undo = mobileApi.holdNextWrite();
  await page.getByRole("button", { name: "Undo", exact: true }).tap();
  await undo.request();
  undo.respond({ status: 422 });
  await expect(page.getByRole("alert")).toContainText(
    /rejected|Could not|Failed/,
  );
  expect(mobileApi.todos()[0].completed).toBe(true);
  const retry = mobileApi.holdNextWrite();
  await page.getByRole("button", { name: "Retry", exact: true }).tap();
  expect((await retry.request()).body.completed).toBe(false);
  retry.respond();
  await expect(
    page.getByRole("button", {
      name: `Complete ${MOBILE_TASK_TITLE}`,
      exact: true,
    }),
  ).toBeVisible();
});

test("pending deletion owns its dialog until the server confirms the result", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  await taskRow(page).tap();
  const details = page.getByRole("dialog", {
    name: "Task details",
    exact: true,
  });
  await details
    .getByRole("button", { name: "More actions", exact: true })
    .tap();
  await details.getByRole("button", { name: "Delete task", exact: true }).tap();
  const deletion = mobileApi.holdNextWrite("DELETE");
  await details
    .getByRole("button", { name: "Confirm delete", exact: true })
    .tap();
  await deletion.request();
  await expect(details).toBeVisible();
  await expect(
    details.getByRole("button", { name: "Close Task details", exact: true }),
  ).toBeDisabled();
  await page.goBack();
  await expect(details).toBeVisible();
  await expect(page.locator(".m-tab-bar")).toHaveAttribute("inert", "");
  deletion.respond();
  await expect(details).toBeHidden();
  expect(mobileApi.todos()).toEqual([]);
  await page.getByRole("button", { name: "Quick capture", exact: true }).tap();
  const capture = page.getByRole("dialog", {
    name: "Quick capture",
    exact: true,
  });
  await capture
    .getByLabel("Task title", { exact: true })
    .fill("A later capture");
  await expect(capture.getByLabel("Task title", { exact: true })).toHaveValue(
    "A later capture",
  );
  expect(mobileApi.writes).toHaveLength(1);
});

test("failed deletion restores the task and keeps an explicit recovery on its details", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  await taskRow(page).tap();
  const details = page.getByRole("dialog", {
    name: "Task details",
    exact: true,
  });
  await details
    .getByRole("button", { name: "More actions", exact: true })
    .tap();
  await details.getByRole("button", { name: "Delete task", exact: true }).tap();
  const deletion = mobileApi.holdNextWrite("DELETE");
  await details
    .getByRole("button", { name: "Confirm delete", exact: true })
    .tap();
  await deletion.request();
  deletion.respond({ status: 422 });
  await expect(details.getByRole("alert")).toBeVisible();
  await expect(
    details.getByText(MOBILE_TASK_TITLE, { exact: true }),
  ).toBeVisible();
  await expect(
    details.getByRole("button", { name: "Close Task details", exact: true }),
  ).toBeEnabled();
  expect(mobileApi.todos()).toHaveLength(1);
  await expect(
    details.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
});

test("an offline edit stays local until an explicit retry after reconnecting", async ({
  page,
  context,
  mobileApi,
}) => {
  await openMobileApp(page);
  const editor = await openTaskEditor(page);
  await editor
    .getByLabel("Task title", { exact: true })
    .fill("Offline local draft");
  await context.setOffline(true);
  await editor.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(editor.getByRole("alert")).toContainText(/offline|reconnect/i);
  await expect(editor.getByLabel("Task title", { exact: true })).toHaveValue(
    "Offline local draft",
  );
  expect(mobileApi.writes).toEqual([]);
  await context.setOffline(false);
  const retry = mobileApi.holdNextWrite();
  await editor.getByRole("button", { name: "Retry", exact: true }).tap();
  expect((await retry.request()).body.title).toBe("Offline local draft");
  retry.respond();
  await expect(page.getByRole("status")).toContainText("Saved task");
});

test("a legacy queued response is uncertain and cannot masquerade as a saved task", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  const editor = await openTaskEditor(page);
  await editor
    .getByLabel("Task title", { exact: true })
    .fill("Queued uncertain draft");
  const save = mobileApi.holdNextWrite();
  await editor.getByRole("button", { name: "Save", exact: true }).tap();
  await save.request();
  save.respond({
    status: 202,
    body: { queued: true, id: "legacy-queue-record" },
  });
  await expect(editor.getByRole("alert")).toContainText(
    /queued|refresh|check/i,
  );
  await expect(editor.getByLabel("Task title", { exact: true })).toHaveValue(
    "Queued uncertain draft",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Saved task" }),
  ).toHaveCount(0);
  expect(mobileApi.todos()[0].id).toBe(MOBILE_TASK_ID);
  expect(mobileApi.todos()[0].title).toBe(MOBILE_TASK_TITLE);
  await page.keyboard.press("Enter");
  expect(mobileApi.writes).toHaveLength(1);
});

test("planned time and deadline remain distinct in the device timezone", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  const editor = await openTaskEditor(page);
  await editor.getByLabel("Due by", { exact: true }).fill("2026-10-08");
  await editor.getByLabel("Plan for", { exact: true }).fill("2026-10-08T09:00");
  expect(mobileApi.writes).toEqual([]);
  const save = mobileApi.holdNextWrite();
  await editor.getByRole("button", { name: "Save", exact: true }).tap();
  const request = await save.request();
  expect(request.body).toMatchObject({
    scheduledDate: "2026-10-08T16:00:00.000Z",
    dueDate: "2026-10-09T06:59:59.999Z",
  });
  save.respond();
  await expect(
    page.getByRole("dialog", { name: "Task details", exact: true }),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: /Edit/ }).tap();
  await expect(page.getByLabel("Due by", { exact: true })).toHaveValue(
    "2026-10-08",
  );
  await expect(page.getByLabel("Plan for", { exact: true })).toHaveValue(
    "2026-10-08T09:00",
  );
});

test("planning beyond a deadline is rejected locally without moving the deadline", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  const editor = await openTaskEditor(page);
  await editor.getByLabel("Due by", { exact: true }).fill("2026-10-08");
  await editor.getByLabel("Plan for", { exact: true }).fill("2026-10-09T09:00");
  await editor.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(editor.getByLabel("Plan for", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(editor.locator(".m-task-editor__field-error")).toContainText(
    /deadline|Due by|due date/i,
  );
  expect(mobileApi.writes).toEqual([]);
  expect(mobileApi.todos()[0].dueDate).toBeNull();
});

test("legacy midnight deadlines retain their calendar day and unchanged payload", async ({
  page,
  context,
  baseURL,
}) => {
  const api = await installMobileFixture(context, baseURL!, [
    mobileTask({ dueDate: "2026-10-08T00:00:00.000Z" }),
  ]);
  await openMobileApp(page);
  await page.getByRole("tab", { name: "Everything", exact: true }).tap();
  const editor = await openTaskEditor(page);
  await expect(editor.getByLabel("Due by", { exact: true })).toHaveValue(
    "2026-10-08",
  );
  await editor
    .getByLabel("Task title", { exact: true })
    .fill("Changed only title");
  const save = api.holdNextWrite("PUT", `/todos/${MOBILE_TASK_ID}`);
  await editor.getByRole("button", { name: "Save", exact: true }).tap();
  const request = await save.request();
  expect(
    request.body.dueDate === undefined ||
      request.body.dueDate === "2026-10-08T00:00:00.000Z",
  ).toBe(true);
  save.respond();
  await expect(page.getByRole("status")).toContainText("Saved task");
  expect(api.todos()[0].dueDate).toBe("2026-10-08T00:00:00.000Z");
  api.assertIsolated();
});

test("Back asks before discarding capture and Forward cannot reopen the discarded draft", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  await page.getByRole("button", { name: "Quick capture", exact: true }).tap();
  const capture = page.getByRole("dialog", {
    name: "Quick capture",
    exact: true,
  });
  await capture
    .getByLabel("Task title", { exact: true })
    .fill("Back-owned capture");
  await page.goBack();
  await expect(capture).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep editing", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).tap();
  await expect(capture.getByLabel("Task title", { exact: true })).toHaveValue(
    "Back-owned capture",
  );
  await page.goBack();
  await page.getByRole("button", { name: /^Discard(?: changes)?$/ }).tap();
  await expect(capture).toBeHidden();
  await page.goForward();
  await expect(capture).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  expect(mobileApi.writes).toEqual([]);
});

test("Back preserves a dirty editor and cannot dismiss a pending Save", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  const editor = await openTaskEditor(page);
  await editor
    .getByLabel("Task title", { exact: true })
    .fill("Back-owned edit");
  await page.goBack();
  await page.getByRole("button", { name: "Keep editing", exact: true }).tap();
  await expect(editor.getByLabel("Task title", { exact: true })).toHaveValue(
    "Back-owned edit",
  );
  const save = mobileApi.holdNextWrite();
  await editor.getByRole("button", { name: "Save", exact: true }).tap();
  await save.request();
  await page.goBack();
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Discard changes", exact: true }),
  ).toHaveCount(0);
  save.respond();
  await expect(
    page.getByRole("dialog", { name: "Task details", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goForward();
  await expect(
    page.getByRole("dialog", { name: "Edit task", exact: true }),
  ).toHaveCount(0);
  expect(mobileApi.todos()[0].title).toBe("Back-owned edit");
});

test("reload reads the saved task, restores the active tab, and clears transient details", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  const editor = await openTaskEditor(page);
  await editor
    .getByLabel("Task title", { exact: true })
    .fill("Reloaded saved title");
  await editor.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(
    page.getByRole("dialog", { name: "Task details", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await page.getByRole("tab", { name: "Everything", exact: true }).tap();
  const readsBefore = mobileApi.reads.filter(
    (path) => path === "/todos",
  ).length;
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Everything", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(taskRow(page, "Reloaded saved title")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    mobileApi.reads.filter((path) => path === "/todos").length,
  ).toBeGreaterThan(readsBefore);
  expect(mobileApi.writes).toHaveLength(1);
});

test("native list offset survives tab changes and a reload without leaving the tab first", async ({
  page,
  mobileApi,
}) => {
  mobileApi.replaceTodos(
    Array.from({ length: 30 }, (_, index) =>
      mobileTask({
        id: `scroll-${index}`,
        title: `Task ${index + 1} in the persisted mobile list`,
        order: index,
      }),
    ),
  );
  await openMobileApp(page);
  const scroller = page.locator(".m-shell__content");
  await scroller.evaluate((element) => {
    element.scrollTop = 500;
  });
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBe(500);
  await page.getByRole("tab", { name: "Everything", exact: true }).tap();
  await page.getByRole("tab", { name: "Today", exact: true }).tap();
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBe(500);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Today", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBe(500);
  expect(mobileApi.writes).toEqual([]);
});

function cardBrief(todos: ReturnType<typeof mobileTask>[]) {
  const provenance = {
    source: "deterministic",
    method: "Local browser fixture",
  };
  return {
    pinned: {
      rightNow: {
        narrative: "Start with the mobile reliability review.",
        urgentItems: [],
        topRecommendation: {
          title: todos[0].title,
          taskId: todos[0].id,
          reasoning: "This unlocks the next implementation phase.",
        },
      },
      todayAgenda: todos.map((todo) => ({
        id: todo.id,
        title: todo.title,
        dueDate: todo.dueDate,
        estimateMinutes: todo.estimateMinutes,
        priority: todo.priority,
        overdue: false,
        completed: false,
      })),
      rightNowProvenance: provenance,
      todayAgendaProvenance: provenance,
    },
    rankedPanels: [] as Record<string, unknown>[],
    generatedAt: "2026-10-07T17:00:00.000Z",
    expiresAt: "2026-12-07T00:00:00.000Z",
    cached: false,
    isStale: false,
  };
}

test("Focus controls are reachable and the complete crowded agenda has one scrolling face", async ({
  page,
  mobileApi,
}) => {
  const todos = Array.from({ length: 8 }, (_, index) =>
    mobileTask({
      id: `agenda-${index}`,
      title: `Task ${index + 1}: Review the long mobile accessibility findings and agree on the smallest coherent implementation phases`,
      dueDate: "2026-10-08T06:59:59.999Z",
    }),
  );
  mobileApi.replaceTodos(todos);
  mobileApi.setFocusBrief(cardBrief(todos));
  await openMobileApp(page);
  await page.getByRole("tab", { name: "Focus", exact: true }).tap();
  await expect(page.getByText("8 tasks today", { exact: true })).toBeVisible();
  const second = page.getByRole("button", { name: "Card 2 of 2", exact: true });
  const carousel = await page.locator(".m-carousel").boundingBox();
  const dot = await second.boundingBox();
  const tabBar = await page.locator(".m-tab-bar").boundingBox();
  expect(dot?.width).toBeGreaterThanOrEqual(44);
  expect(dot?.height).toBeGreaterThanOrEqual(44);
  expect(dot!.y + dot!.height).toBeLessThanOrEqual(
    carousel!.y + carousel!.height + 1,
  );
  expect(dot!.y + dot!.height).toBeLessThanOrEqual(tabBar!.y + 1);
  await second.tap();
  await expect(second).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".m-carousel__position")).toHaveText("Card 2 of 2");
  const front = page.locator(
    '.m-carousel__slide[aria-hidden="false"] .flip-card__front',
  );
  expect(
    await front.evaluate((element) => getComputedStyle(element).overflowY),
  ).toBe("auto");
  await front.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => front.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(
    front.getByRole("button", { name: todos[7].title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Strongest action/ }),
  ).toHaveCount(0);
  expect(mobileApi.writes).toEqual([]);
});

test("card flip ownership prevents swipe and explicit navigation restores a usable front", async ({
  page,
  mobileApi,
}) => {
  mobileApi.setFocusBrief(cardBrief([mobileTask()]));
  await openMobileApp(page);
  await page.getByRole("tab", { name: "Focus", exact: true }).tap();
  await page.getByRole("button", { name: "Card 2 of 2", exact: true }).tap();
  const activeFront = page.locator(
    '.m-carousel__slide[aria-hidden="false"] .flip-card__front',
  );
  const activeBack = page.locator(
    '.m-carousel__slide[aria-hidden="false"] .flip-card__back',
  );
  await expect(activeBack).toBeHidden();
  const about = page.getByRole("button", {
    name: "About this card",
    exact: true,
  });
  await expect(about).toHaveCount(1);
  const hitArea = await about.boundingBox();
  expect(hitArea?.width).toBeGreaterThanOrEqual(44);
  expect(hitArea?.height).toBeGreaterThanOrEqual(44);
  await about.focus();
  await page.keyboard.press("Enter");
  await expect(activeFront).toBeHidden();
  await expect(activeBack).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show card front", exact: true }),
  ).toBeFocused();
  await pointerDrag(page, ".m-carousel__track", 170, 0);
  await expect(page.locator(".m-carousel__position")).toHaveText("Card 2 of 2");
  await page.getByRole("button", { name: "Card 1 of 2", exact: true }).tap();
  await page.getByRole("button", { name: "Card 2 of 2", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "About this card", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show card front", exact: true }),
  ).toHaveCount(0);
  await pointerDrag(page, ".m-carousel__track", 170, 150);
  await expect(page.locator(".m-carousel__position")).toHaveText("Card 2 of 2");
  await pointerDrag(page, ".m-carousel__track", 170, 0, true);
  await expect(page.locator(".m-carousel__position")).toHaveText("Card 2 of 2");
  expect(mobileApi.writes).toEqual([]);
});

test("an ambiguous committed Save refreshes before any second write and rebases the retained draft", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  const editor = await openTaskEditor(page);
  await editor
    .getByLabel("Task title", { exact: true })
    .fill("Committed before response failed");
  const save = mobileApi.holdNextWrite();
  await editor.getByRole("button", { name: "Save", exact: true }).tap();
  await save.request();
  save.respond({ status: 500, commit: true });
  await expect(editor.getByRole("alert")).toContainText(/refresh/i);
  await expect(
    editor.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  expect(mobileApi.writes).toHaveLength(1);
  const refresh = mobileApi.holdNextRead();
  await editor.getByRole("button", { name: "Refresh", exact: true }).tap();
  await refresh.request();
  await expect(
    editor.getByRole("button", { name: "Refreshing…", exact: true }),
  ).toBeDisabled();
  refresh.respond();
  await expect(editor.getByRole("status")).toHaveText(
    "Your changes match the refreshed task.",
  );
  await expect(editor.getByLabel("Task title", { exact: true })).toHaveValue(
    "Committed before response failed",
  );
  await expect(
    editor.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  expect(mobileApi.writes).toHaveLength(1);
  await editor.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(
    page
      .getByRole("dialog", { name: "Task details", exact: true })
      .getByText("Committed before response failed", { exact: true }),
  ).toBeVisible();
});

test("uncertain completion reconciles its committed result without repeating the command", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  const complete = mobileApi.holdNextWrite();
  await page
    .getByRole("button", { name: `Complete ${MOBILE_TASK_TITLE}`, exact: true })
    .tap();
  await complete.request();
  complete.respond({ status: 500, commit: true });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toHaveCount(0);
  const refreshed = mobileApi.holdNextRead();
  await page.getByRole("button", { name: "Refresh", exact: true }).tap();
  await refreshed.request();
  refreshed.respond();
  await expect(page.getByRole("status")).toContainText(/Refreshed tasks/);
  await expect(
    page.getByRole("button", {
      name: `Complete ${MOBILE_TASK_TITLE}`,
      exact: true,
    }),
  ).toHaveCount(0);
  expect(mobileApi.todos()[0].completed).toBe(true);
  expect(mobileApi.writes).toHaveLength(1);
});

test("refresh failure preserves visible tasks and an explicit Retry applies a fresh read", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  await expect(taskRow(page)).toBeVisible();
  const failed = mobileApi.holdNextRead();
  await touchDrag(page, ".m-screen--today .m-header", 0, 300);
  await failed.request();
  await expect(page.locator(".m-pull-refresh")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  failed.respond({ status: 500 });
  await expect(
    page.locator(".m-pull-refresh__feedback[role=alert]"),
  ).toContainText(/refresh/i);
  await expect(taskRow(page)).toBeVisible();
  mobileApi.replaceTodos([
    mobileTask({ title: "Fresh task after refresh retry" }),
  ]);
  const retry = mobileApi.holdNextRead();
  await page.getByRole("button", { name: "Retry refresh", exact: true }).tap();
  await retry.request();
  retry.respond();
  await expect(taskRow(page, "Fresh task after refresh retry")).toBeVisible();
  await expect(
    page.locator(".m-pull-refresh__feedback[role=status]"),
  ).toHaveText("Refresh complete");
  expect(
    mobileApi.writes.filter((write) => write.path.startsWith("/todos")),
  ).toEqual([]);
});

test("vertical and cancelled row gestures do not complete, and a scrolled list does not refresh", async ({
  page,
  mobileApi,
}) => {
  mobileApi.replaceTodos(
    Array.from({ length: 30 }, (_, index) =>
      mobileTask({
        id: `gesture-${index}`,
        title: `Gesture task ${index + 1}`,
      }),
    ),
  );
  await openMobileApp(page);
  const row =
    ".m-today__group-list .m-swipe-row:first-child .m-swipe-row__content";
  await touchDrag(page, row, 170, 150);
  await touchDrag(page, row, 170, 0, true);
  expect(mobileApi.writes).toEqual([]);
  const reads = mobileApi.reads.filter((path) => path === "/todos").length;
  const scroller = page.locator(".m-shell__content");
  await scroller.evaluate((element) => {
    element.scrollTop = 300;
  });
  await touchDrag(page, ".m-screen--today .m-header", 0, 300);
  expect(mobileApi.reads.filter((path) => path === "/todos")).toHaveLength(
    reads,
  );
  await expect(page.locator(".m-pull-refresh")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(mobileApi.writes).toEqual([]);
});

test("Focus project selection opens its task list and reload preserves that project", async ({
  page,
  mobileApi,
}) => {
  const todo = mobileTask({ dueDate: "2026-10-07T06:59:59.999Z" });
  mobileApi.replaceTodos([todo]);
  const brief = cardBrief([todo]);
  brief.rankedPanels.push({
    type: "projectsToNudge",
    reason: "A project needs attention",
    data: {
      type: "projectsToNudge",
      items: [
        {
          id: "mobile-project",
          name: "Mobile project",
          overdueCount: 1,
          waitingCount: 0,
          dueSoonCount: 0,
        },
      ],
    },
    provenance: { source: "deterministic" },
  });
  mobileApi.setFocusBrief(brief);
  await openMobileApp(page);
  await page.getByRole("tab", { name: "Focus", exact: true }).tap();
  await page.getByRole("button", { name: "Card 3 of 3", exact: true }).tap();
  await page.getByRole("button", { name: /Mobile project/ }).tap();
  await expect(
    page.getByRole("heading", { name: "Mobile project", exact: true }),
  ).toBeVisible();
  await expect(taskRow(page)).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Projects", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Mobile project", exact: true }),
  ).toBeVisible();
  await expect(taskRow(page)).toBeVisible();
  await page.getByRole("button", { name: /Back/ }).tap();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  expect(mobileApi.writes).toEqual([]);
});

test("a refreshed Focus brief clamps a removed active card to an available card", async ({
  page,
  mobileApi,
}) => {
  const brief = cardBrief([mobileTask()]);
  brief.rankedPanels.push({
    type: "whatNext",
    reason: "A useful next task",
    data: {
      type: "whatNext",
      items: [
        {
          id: MOBILE_TASK_ID,
          title: MOBILE_TASK_TITLE,
          reason: "Small clear task",
          impact: "high",
          effort: "25 minutes",
        },
      ],
    },
    provenance: { source: "deterministic" },
  });
  mobileApi.setFocusBrief(brief);
  await openMobileApp(page);
  await page.getByRole("tab", { name: "Focus", exact: true }).tap();
  await page.getByRole("button", { name: "Card 3 of 3", exact: true }).tap();
  await expect(page.locator(".m-carousel__position")).toHaveText("Card 3 of 3");
  mobileApi.setFocusBrief(cardBrief([mobileTask()]));
  const refreshed = mobileApi.holdNextRead("/ai/focus-brief");
  await page.getByRole("button", { name: "Refresh tasks", exact: true }).tap();
  await refreshed.request();
  refreshed.respond();
  await expect(page.locator(".m-carousel__position")).toHaveText("Card 2 of 2");
  await expect(
    page.getByRole("button", { name: "Card 2 of 2", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    page.getByRole("button", { name: "Card 3 of 3", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator('.m-carousel__slide[aria-hidden="false"] .tarot-name').first(),
  ).toHaveText("The Dawn");
});

test("cached Focus task references follow live completion, undo, editing, and deletion", async ({
  page,
  mobileApi,
}) => {
  const todo = mobileTask({ dueDate: "2026-10-08T06:59:59.999Z" });
  const cachedBrief = cardBrief([todo]);
  mobileApi.replaceTodos([todo]);
  mobileApi.setFocusBrief(cachedBrief);
  await openMobileApp(page);
  await page
    .getByRole("button", { name: `Complete ${MOBILE_TASK_TITLE}`, exact: true })
    .tap();
  await expect(
    page.getByRole("status").filter({ hasText: "Completed task" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Focus", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: /^Strongest action/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Card 2 of 2", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: MOBILE_TASK_TITLE, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: `Complete ${MOBILE_TASK_TITLE}`,
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: MOBILE_TASK_TITLE, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: MOBILE_TASK_TITLE, exact: true })
    .tap();
  await page
    .getByRole("dialog", { name: "Task details", exact: true })
    .getByRole("button", { name: "Edit", exact: true })
    .tap();
  const editor = page.getByRole("dialog", { name: "Edit task", exact: true });
  await editor
    .getByLabel("Task title", { exact: true })
    .fill("Current title despite cached AI brief");
  await editor.getByRole("button", { name: "Save", exact: true }).tap();
  const details = page.getByRole("dialog", {
    name: "Task details",
    exact: true,
  });
  await expect(details).toBeVisible();
  await details
    .getByRole("button", { name: "Close Task details", exact: true })
    .tap();
  await expect(
    page.getByRole("button", {
      name: "Current title despite cached AI brief",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: MOBILE_TASK_TITLE, exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Current title despite cached AI brief",
      exact: true,
    })
    .tap();
  await details
    .getByRole("button", { name: "More actions", exact: true })
    .tap();
  await details.getByRole("button", { name: "Delete task", exact: true }).tap();
  await details
    .getByRole("button", { name: "Confirm delete", exact: true })
    .tap();
  await expect(details).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: "Current title despite cached AI brief",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(mobileApi.todos()).toEqual([]);
  expect(cachedBrief.pinned.todayAgenda[0].title).toBe(MOBILE_TASK_TITLE);
});

test("an uncertain planned-date save keeps its selection and requires Refresh before explicit retry", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  await taskRow(page).tap();
  await page
    .getByRole("dialog", { name: "Task details", exact: true })
    .getByRole("button", { name: "Reschedule", exact: true })
    .tap();
  const planned = page.getByRole("dialog", { name: "Plan for…", exact: true });
  const save = mobileApi.holdNextWrite();
  await planned.getByRole("button", { name: /^Tomorrow/ }).tap();
  const original = await save.request();
  save.respond({ status: 500, commit: true });
  await expect(planned.getByRole("alert")).toContainText(/refresh/i);
  await expect(planned.getByLabel("Plan for", { exact: true })).toHaveValue(
    "2026-10-08T09:00",
  );
  await expect(
    planned.getByRole("button", { name: /^(Save|Retry) planned date$/ }),
  ).toBeDisabled();
  const refresh = mobileApi.holdNextRead();
  await planned.getByRole("button", { name: "Refresh", exact: true }).tap();
  await refresh.request();
  refresh.respond();
  await expect(planned.getByRole("status")).toContainText(/Refreshed task/);
  expect(mobileApi.writes).toHaveLength(1);
  const retry = mobileApi.holdNextWrite();
  await planned
    .getByRole("button", { name: /^(Save|Retry) planned date$/ })
    .tap();
  expect((await retry.request()).body).toEqual(original.body);
  retry.respond();
  await expect(planned).toBeHidden();
  expect(mobileApi.todos()[0].scheduledDate).toBe("2026-10-08T16:00:00.000Z");
  expect(mobileApi.todos()[0].dueDate).toBeNull();
});

test("uncertain capture Fresh check retains the current draft, reports possible matches, and never repeats POST", async ({
  page,
  mobileApi,
}) => {
  await openMobileApp(page);
  await page.getByRole("button", { name: "Quick capture", exact: true }).tap();
  const capture = page.getByRole("dialog", {
    name: "Quick capture",
    exact: true,
  });
  await capture
    .getByLabel("Task title", { exact: true })
    .fill("Uncertain submitted task");
  const create = mobileApi.holdNextWrite("POST", "/todos");
  await capture.getByRole("button", { name: "Add Task", exact: true }).tap();
  await create.request();
  create.respond({ status: 500, commit: true });
  await expect(capture.getByRole("alert")).toContainText(/uncertain/i);
  await capture
    .getByLabel("Task title", { exact: true })
    .fill("Continue revising this retained draft");
  const refresh = mobileApi.holdNextRead();
  await capture
    .getByRole("button", { name: "Refresh and check", exact: true })
    .tap();
  await refresh.request();
  await expect(
    capture.getByRole("button", { name: "Refreshing…", exact: true }),
  ).toBeDisabled();
  refresh.respond();
  await expect(capture.getByRole("status")).toContainText(
    /possible matches.*may predate/i,
  );
  await expect(
    capture.getByRole("list", { name: "Possible existing items", exact: true }),
  ).toContainText("Uncertain submitted task");
  await expect(capture.getByLabel("Task title", { exact: true })).toHaveValue(
    "Continue revising this retained draft",
  );
  await expect(
    capture.getByRole("button", { name: "Add Task", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  expect(
    mobileApi.writes.filter(
      (write) => write.method === "POST" && write.path === "/todos",
    ),
  ).toHaveLength(1);
});

test("scrolling the still-visible list during a gated refresh is retained when the read settles", async ({
  page,
  mobileApi,
}) => {
  mobileApi.replaceTodos(
    Array.from({ length: 30 }, (_, index) =>
      mobileTask({
        id: `during-refresh-${index}`,
        title: `Task ${index + 1} while refreshing`,
        order: index,
      }),
    ),
  );
  await openMobileApp(page);
  await expect(page.locator(".m-todo-row")).toHaveCount(30);
  const refresh = mobileApi.holdNextRead();
  await touchDrag(page, ".m-screen--today .m-header", 0, 300);
  await refresh.request();
  const scroller = page.locator(".m-shell__content");
  await scroller.evaluate((element) => {
    element.scrollTop = 400;
  });
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBe(400);
  refresh.respond();
  await expect(page.locator(".m-pull-refresh")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  // Native scroll anchoring may compensate for the disappearing60px indicator;
  // a completed read must never restore the old zero offset over the new user scroll.
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThanOrEqual(300);
  await page.getByRole("tab", { name: "Everything", exact: true }).tap();
  await page.getByRole("tab", { name: "Today", exact: true }).tap();
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThanOrEqual(300);
  expect(
    mobileApi.writes.filter((write) => write.path.startsWith("/todos")),
  ).toEqual([]);
});
