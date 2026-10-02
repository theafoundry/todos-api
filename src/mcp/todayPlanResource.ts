import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps";
import { TODAY_PLAN_RESOURCE_URI } from "./appContract";

export const TODAY_PLAN_RESOURCE_MIME_TYPE =
  "text/html;profile=mcp-app" as const;
export const TODAY_PLAN_WIDGET_DOMAIN = "https://todos.theafoundry.com";

export const TODAY_PLAN_RESOURCE_META = {
  ui: {
    prefersBorder: true,
    domain: TODAY_PLAN_WIDGET_DOMAIN,
    csp: {
      connectDomains: [],
      resourceDomains: [],
    },
  } satisfies McpUiResourceMeta,
} as const;

export const TODAY_PLAN_RESOURCE_DESCRIPTOR = {
  uri: TODAY_PLAN_RESOURCE_URI,
  name: "todos-today-plan",
  title: "Today's plan",
  description:
    "A compact, interactive view of an authoritative Todos day plan.",
  mimeType: TODAY_PLAN_RESOURCE_MIME_TYPE,
  _meta: TODAY_PLAN_RESOURCE_META,
} as const;

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const TODAY_PLAN_WIDGET_TEMPLATE = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Today's plan</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: var(--font-sans, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      --surface: var(--color-background-primary, #fbfaf7);
      --surface-soft: var(--color-background-secondary, #f2f0e9);
      --ink: var(--color-text-primary, #1d2623);
      --muted: var(--color-text-secondary, #5d6864);
      --line: var(--color-border-secondary, #d8ddd8);
      --accent: #276450;
      --accent-soft: #e1eee8;
      --warning: #7a4e12;
      --warning-soft: #fff4dd;
      --danger: #8a332c;
      --focus: var(--color-ring-primary, #156f55);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: transparent; color: var(--ink); }
    body { min-width: 0; }
    button, input { font: inherit; }
    button, a { -webkit-tap-highlight-color: transparent; }
    .card {
      width: 100%;
      min-width: 0;
      padding: clamp(14px, 4vw, 22px);
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 18px;
      overflow-wrap: anywhere;
    }
    .eyebrow { margin: 0 0 4px; color: var(--accent); font-size: .75rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(1.25rem, 5vw, 1.7rem); line-height: 1.15; }
    .subhead { margin: 6px 0 0; color: var(--muted); font-size: .85rem; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 16px 0; }
    .stat { min-width: 0; padding: 10px; background: var(--surface-soft); border-radius: 12px; }
    .stat strong { display: block; font-size: 1rem; line-height: 1.2; }
    .stat span { display: block; margin-top: 3px; color: var(--muted); font-size: .7rem; }
    .warning { margin: 0 0 14px; padding: 11px 12px 11px 30px; border: 1px solid #e7c98f; border-radius: 12px; background: var(--warning-soft); color: var(--warning); font-size: .82rem; }
    .warning li + li { margin-top: 6px; }
    .task-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
    .task { min-width: 0; padding: 13px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .task:nth-child(-n+3) { border-left: 4px solid var(--accent); background: linear-gradient(90deg, var(--accent-soft), var(--surface) 35%); }
    .task[data-completed="true"] .task-title { text-decoration: line-through; color: var(--muted); }
    .task[data-pending="true"] { opacity: .68; }
    .task-head { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: start; }
    .rank { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: .76rem; font-weight: 800; }
    .task-title { margin: 1px 0 0; font-size: .96rem; line-height: 1.3; }
    .task-meta { display: flex; flex-wrap: wrap; gap: 5px 10px; margin: 7px 0 0; color: var(--muted); font-size: .75rem; }
    .overdue { color: var(--danger); font-weight: 700; }
    .reason { margin: 8px 0 0; color: var(--muted); font-size: .8rem; line-height: 1.4; }
    .actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
    .button { min-height: 36px; padding: 7px 11px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); cursor: pointer; font-weight: 650; font-size: .78rem; }
    .button.primary { border-color: var(--accent); background: var(--accent); color: #fff; }
    .button:hover:not(:disabled) { border-color: var(--accent); }
    .button:disabled { cursor: wait; opacity: .58; }
    .button:focus-visible, a:focus-visible, input:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .reschedule { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 7px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
    .reschedule label { grid-column: 1 / -1; color: var(--muted); font-size: .75rem; font-weight: 650; }
    .reschedule input { min-width: 0; width: 100%; padding: 7px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--ink); }
    .empty { padding: 22px 12px; border: 1px dashed var(--line); border-radius: 14px; text-align: center; }
    .empty h2 { margin: 0; font-size: 1rem; }
    .empty p { margin: 6px 0 0; color: var(--muted); font-size: .82rem; }
    .toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; align-items: center; margin-top: 14px; }
    .open-link { color: var(--accent); font-size: .82rem; font-weight: 700; text-underline-offset: 3px; }
    .status { min-height: 1.25rem; margin: 10px 0 0; color: var(--muted); font-size: .78rem; }
    .status[data-kind="error"] { color: var(--danger); }
    .skeleton { display: grid; gap: 9px; margin-top: 16px; }
    .skeleton span { display: block; height: 54px; border-radius: 12px; background: var(--surface-soft); animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .5; } }
    @media (prefers-reduced-motion: reduce) { .skeleton span { animation: none; } }
    @media (max-width: 390px) {
      .summary { grid-template-columns: 1fr; }
      .stat { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
      .stat span { margin: 0; }
      .reschedule { grid-template-columns: 1fr 1fr; }
      .reschedule input { grid-column: 1 / -1; }
      .actions .button { flex: 1 1 42%; }
    }
    @media (prefers-color-scheme: dark) {
      :root { --surface: #161c1a; --surface-soft: #202825; --ink: #edf3f0; --muted: #aebbb5; --line: #3a4641; --accent: #76c5a7; --accent-soft: #203d33; --warning: #f0c776; --warning-soft: #3a2d16; --danger: #f09a92; }
      .button.primary { color: #10221b; }
    }
  </style>
</head>
<body>
  <main id="card" class="card" data-state="initializing" aria-labelledby="plan-title">
    <p class="eyebrow">Todos</p>
    <h1 id="plan-title">Today's plan</h1>
    <p id="subhead" class="subhead">Connecting to your authoritative plan…</p>
    <div id="skeleton" class="skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
    <section id="content" hidden>
      <div class="summary" aria-label="Plan summary">
        <div class="stat"><strong id="available">—</strong><span>available</span></div>
        <div class="stat"><strong id="planned">—</strong><span>planned</span></div>
        <div class="stat"><strong id="remaining">—</strong><span>remaining</span></div>
      </div>
      <ul id="warnings" class="warning" aria-label="Plan updates" hidden></ul>
      <ol id="tasks" class="task-list" aria-label="Planned tasks"></ol>
      <div id="empty" class="empty" hidden><h2>Your day is clear</h2><p>No eligible tasks fit this plan right now.</p></div>
      <div class="toolbar">
        <button id="refresh" class="button" type="button">Refresh plan</button>
        <a id="open" class="open-link" href="__TODOS_APP_URL__" target="_blank" rel="noopener noreferrer">Open in Todos</a>
      </div>
    </section>
    <p id="status" class="status" role="status" aria-live="polite" aria-atomic="true">Loading today's plan…</p>
  </main>
  <script>
    (function () {
      "use strict";
      var PROTOCOL_VERSION = "2026-01-26";
      var pendingRequests = new Map();
      var nextRequestId = 1;
      var connected = false;
      var hostCapabilities = {};
      var toolInput = null;
      var plan = null;
      var phase = "initializing";
      var pendingTaskId = null;
      var openFormTaskId = null;
      var card = document.getElementById("card");
      var content = document.getElementById("content");
      var skeleton = document.getElementById("skeleton");
      var status = document.getElementById("status");
      var tasksElement = document.getElementById("tasks");
      var warningsElement = document.getElementById("warnings");
      var emptyElement = document.getElementById("empty");
      var refreshButton = document.getElementById("refresh");
      var openLink = document.getElementById("open");

      function send(message) {
        window.parent.postMessage(message, "*");
      }

      function request(method, params) {
        var id = nextRequestId++;
        send({ jsonrpc: "2.0", id: id, method: method, params: params });
        return new Promise(function (resolve, reject) {
          pendingRequests.set(id, { resolve: resolve, reject: reject });
        });
      }

      function notify(method, params) {
        send({ jsonrpc: "2.0", method: method, params: params || {} });
      }

      function setStatus(message, kind) {
        status.textContent = message || "";
        status.dataset.kind = kind || "info";
      }

      function setPhase(nextPhase, message, kind) {
        phase = nextPhase;
        card.dataset.state = nextPhase;
        if (message !== undefined) setStatus(message, kind);
      }

      function minutes(value) {
        return String(Number(value) || 0) + " min";
      }

      function formatPlanDate(value) {
        try {
          return new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: "UTC" }).format(new Date(value + "T12:00:00Z"));
        } catch (_error) {
          return value;
        }
      }

      function formatDateTime(value) {
        if (!value) return null;
        try {
          return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: plan && plan.timezone ? plan.timezone : "UTC"
          }).format(new Date(value));
        } catch (_error) {
          return value;
        }
      }

      function appendText(parent, className, text) {
        var span = document.createElement("span");
        if (className) span.className = className;
        span.textContent = text;
        parent.appendChild(span);
      }

      function isAuthError(result) {
        var error = result && result.structuredContent && result.structuredContent.error;
        var code = error && String(error.code || "");
        return Boolean(
          result && result._meta && result._meta["mcp/www_authenticate"] ||
          /AUTH|TOKEN|SCOPE|UNAUTHENTICATED/i.test(code)
        );
      }

      function resultError(result) {
        if (!result) return "Todos did not return a result.";
        var error = result.structuredContent && result.structuredContent.error;
        if (error && error.message) return String(error.message);
        if (result.isError && Array.isArray(result.content)) {
          var textBlock = result.content.find(function (item) { return item && item.type === "text"; });
          if (textBlock && textBlock.text) return String(textBlock.text);
        }
        return result.isError ? "Todos could not complete that action." : null;
      }

      function localDateTimeToIso(value, timeZone) {
        var parts = value.split(/[-T:]/).map(Number);
        if (parts.length < 5 || parts.some(Number.isNaN)) throw new Error("Choose a valid date and time.");
        var desiredUtc = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], 0);
        var formatter = new Intl.DateTimeFormat("en-CA", {
          timeZone: timeZone,
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
        });
        var guess = desiredUtc;
        for (var attempt = 0; attempt < 2; attempt += 1) {
          var mapped = {};
          formatter.formatToParts(new Date(guess)).forEach(function (part) { mapped[part.type] = part.value; });
          var representedUtc = Date.UTC(Number(mapped.year), Number(mapped.month) - 1, Number(mapped.day), Number(mapped.hour), Number(mapped.minute), Number(mapped.second));
          guess += desiredUtc - representedUtc;
        }
        return new Date(guess).toISOString();
      }

      function tomorrowAtNine() {
        var date = new Date(plan.date + "T12:00:00Z");
        date.setUTCDate(date.getUTCDate() + 1);
        return date.toISOString().slice(0, 10) + "T09:00";
      }

      function reconcileTask(authoritativeTask) {
        if (!plan || !authoritativeTask) return;
        plan.tasks = plan.tasks.map(function (task) {
          if (task.id !== authoritativeTask.id) return task;
          return Object.assign({}, task, authoritativeTask, { rank: task.rank, reason: task.reason });
        });
      }

      function renderRescheduleForm(task, item) {
        var form = document.createElement("form");
        form.className = "reschedule";
        form.hidden = openFormTaskId !== task.id;
        var inputId = "reschedule-" + task.id;
        var label = document.createElement("label");
        label.htmlFor = inputId;
        label.textContent = "New date and time for " + task.title;
        var input = document.createElement("input");
        input.id = inputId;
        input.name = "scheduledDate";
        input.type = "datetime-local";
        input.required = true;
        input.value = tomorrowAtNine();
        var save = document.createElement("button");
        save.type = "submit";
        save.className = "button primary";
        save.textContent = "Save";
        var cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "button";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", function () { openFormTaskId = null; render(); });
        form.append(label, input, save, cancel);
        form.addEventListener("submit", function (event) {
          event.preventDefault();
          runTaskMutation(task, "reschedule_task", {
            taskId: task.id,
            scheduledDate: localDateTimeToIso(input.value, plan.timezone)
          }, "Rescheduled " + task.title + ".");
        });
        item.appendChild(form);
      }

      function actionButton(label, action, primary) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "button" + (primary ? " primary" : "");
        button.textContent = label;
        button.setAttribute("aria-label", label);
        button.disabled = phase === "mutation-pending" || phase === "auth-expired" || phase === "stale";
        button.addEventListener("click", action);
        return button;
      }

      function renderTask(task) {
        var item = document.createElement("li");
        item.className = "task";
        item.dataset.taskId = task.id;
        item.dataset.completed = String(Boolean(task.completed));
        item.dataset.pending = String(pendingTaskId === task.id);
        var head = document.createElement("div");
        head.className = "task-head";
        var rank = document.createElement("span");
        rank.className = "rank";
        rank.setAttribute("aria-label", "Plan position " + task.rank);
        rank.textContent = String(task.rank);
        var details = document.createElement("div");
        var title = document.createElement("h2");
        title.className = "task-title";
        title.textContent = task.title;
        details.appendChild(title);
        var meta = document.createElement("p");
        meta.className = "task-meta";
        if (task.project && task.project.name) appendText(meta, "", task.project.name);
        if (task.estimateMinutes !== null && task.estimateMinutes !== undefined) appendText(meta, "", minutes(task.estimateMinutes));
        var scheduled = formatDateTime(task.scheduledDate);
        var due = formatDateTime(task.dueDate);
        if (scheduled) appendText(meta, "", "Scheduled " + scheduled);
        if (due) appendText(meta, task.overdue ? "overdue" : "", (task.overdue ? "Overdue · " : "Due ") + due);
        if (task.completed) appendText(meta, "", "Completed");
        details.appendChild(meta);
        var reason = document.createElement("p");
        reason.className = "reason";
        reason.textContent = task.reason;
        details.appendChild(reason);
        head.append(rank, details);
        item.appendChild(head);
        var actions = document.createElement("div");
        actions.className = "actions";
        var completeLabel = task.completed ? "Undo completion for " + task.title : "Complete " + task.title;
        actions.appendChild(actionButton(completeLabel, function () {
          runTaskMutation(task, "complete_task", { taskId: task.id, completed: !task.completed }, task.completed ? "Reopened " + task.title + "." : "Completed " + task.title + ".");
        }, true));
        actions.appendChild(actionButton("Move " + task.title + " to tomorrow", function () {
          runTaskMutation(task, "reschedule_task", {
            taskId: task.id,
            scheduledDate: localDateTimeToIso(tomorrowAtNine(), plan.timezone)
          }, "Moved " + task.title + " to tomorrow.");
        }, false));
        actions.appendChild(actionButton("Pick a date and time for " + task.title, function () {
          openFormTaskId = openFormTaskId === task.id ? null : task.id;
          render();
          if (openFormTaskId) document.getElementById("reschedule-" + task.id).focus();
        }, false));
        item.appendChild(actions);
        renderRescheduleForm(task, item);
        return item;
      }

      function render() {
        if (!plan) return;
        skeleton.hidden = true;
        content.hidden = false;
        document.getElementById("subhead").textContent = formatPlanDate(plan.date) + " · " + plan.timezone + " · " + String(plan.energy).replace(/^./, function (c) { return c.toUpperCase(); }) + " energy";
        document.getElementById("available").textContent = minutes(plan.availableMinutes);
        document.getElementById("planned").textContent = minutes(plan.totalMinutes);
        document.getElementById("remaining").textContent = minutes(plan.remainingMinutes);
        warningsElement.replaceChildren();
        (plan.warnings || []).forEach(function (warning) {
          var item = document.createElement("li");
          item.textContent = warning;
          warningsElement.appendChild(item);
        });
        warningsElement.hidden = warningsElement.children.length === 0;
        tasksElement.replaceChildren();
        plan.tasks.slice(0, 12).forEach(function (task) { tasksElement.appendChild(renderTask(task)); });
        tasksElement.hidden = plan.tasks.length === 0;
        emptyElement.hidden = plan.tasks.length !== 0;
        refreshButton.disabled = phase === "mutation-pending";
      }

      function applyPlan(nextPlan, message) {
        if (!nextPlan || !Array.isArray(nextPlan.tasks)) throw new Error("Todos returned an invalid plan.");
        plan = Object.assign({}, nextPlan, { tasks: nextPlan.tasks.slice(0, 12) });
        pendingTaskId = null;
        openFormTaskId = null;
        var isStale = (plan.warnings || []).some(function (warning) { return /omitted|order changed|refresh/i.test(String(warning)); });
        if (isStale) setPhase("stale", "This plan changed. Refresh before taking another action.", "error");
        else if (plan.tasks.length === 0) setPhase("empty", message || "Your plan is up to date.");
        else setPhase("ready", message || "Your plan is ready.");
        render();
      }

      async function runTaskMutation(task, name, argumentsValue, successMessage) {
        var previousPlan = plan;
        pendingTaskId = task.id;
        setPhase("mutation-pending", "Saving changes…");
        render();
        try {
          var result = await request("tools/call", { name: name, arguments: argumentsValue });
          if (isAuthError(result)) {
            plan = previousPlan;
            pendingTaskId = null;
            setPhase("auth-expired", "Your Todos connection expired. Reconnect in ChatGPT, then refresh.", "error");
            render();
            return;
          }
          var error = resultError(result);
          if (error) throw new Error(error);
          reconcileTask(result.structuredContent && result.structuredContent.task);
          pendingTaskId = null;
          openFormTaskId = null;
          setPhase("mutation-succeeded", successMessage);
          render();
        } catch (error) {
          plan = previousPlan;
          pendingTaskId = null;
          setPhase("recoverable-failure", error && error.message ? error.message : "That change could not be saved. Try again.", "error");
          render();
        }
      }

      async function refreshPlan() {
        if (!plan || !toolInput) return;
        var previousPlan = plan;
        setPhase("mutation-pending", "Refreshing your plan…");
        render();
        try {
          var result = await request("tools/call", {
            name: "plan_today",
            arguments: {
              date: toolInput.date || plan.date,
              availableMinutes: toolInput.availableMinutes || plan.availableMinutes,
              energy: toolInput.energy || plan.energy
            }
          });
          if (isAuthError(result)) {
            plan = previousPlan;
            setPhase("auth-expired", "Your Todos connection expired. Reconnect in ChatGPT, then refresh.", "error");
            render();
            return;
          }
          var error = resultError(result);
          if (error) throw new Error(error);
          applyPlan(result.structuredContent, "Plan refreshed from Todos.");
        } catch (error) {
          plan = previousPlan;
          setPhase("recoverable-failure", error && error.message ? error.message : "The plan could not be refreshed. Try again.", "error");
          render();
        }
      }

      window.addEventListener("message", function (event) {
        if (event.source !== window.parent) return;
        var message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;
        if (message.id !== undefined && pendingRequests.has(message.id)) {
          var pending = pendingRequests.get(message.id);
          pendingRequests.delete(message.id);
          if (message.error) pending.reject(message.error);
          else pending.resolve(message.result);
          return;
        }
        if (message.method === "ui/notifications/tool-input") {
          toolInput = message.params && message.params.arguments ? message.params.arguments : {};
        }
        if (message.method === "ui/notifications/tool-result") {
          var result = message.params || {};
          if (isAuthError(result)) {
            setPhase("auth-expired", "Your Todos connection expired. Reconnect in ChatGPT, then refresh.", "error");
          } else {
            var error = resultError(result);
            if (error) setPhase("recoverable-failure", error, "error");
            else if (result.structuredContent) applyPlan(result.structuredContent);
          }
        }
      }, { passive: true });

      refreshButton.addEventListener("click", refreshPlan);
      openLink.addEventListener("click", function (event) {
        if (!connected || !hostCapabilities.openLinks) return;
        event.preventDefault();
        request("ui/open-link", { url: openLink.href }).catch(function () {
          setStatus("Open Todos from its web app if this link is blocked.", "error");
        });
      });

      request("ui/initialize", {
        appInfo: { name: "todos-today-plan", version: "1.0.0" },
        appCapabilities: { availableDisplayModes: ["inline"] },
        protocolVersion: PROTOCOL_VERSION
      }).then(function (result) {
        connected = true;
        hostCapabilities = result && result.hostCapabilities ? result.hostCapabilities : {};
        notify("ui/notifications/initialized", {});
      }).catch(function () {
        skeleton.hidden = true;
        setPhase("recoverable-failure", "The Today Plan component could not connect. The plan is still available in the conversation.", "error");
      });
    })();
  </script>
</body>
</html>`;

export function buildTodayPlanWidgetHtml(baseUrl: string): string {
  const appUrl = new URL("/app", baseUrl).toString();
  return TODAY_PLAN_WIDGET_TEMPLATE.replace(
    "__TODOS_APP_URL__",
    escapeHtmlAttribute(appUrl),
  );
}

export function buildTodayPlanResourceContents(baseUrl: string) {
  return {
    uri: TODAY_PLAN_RESOURCE_URI,
    mimeType: TODAY_PLAN_RESOURCE_MIME_TYPE,
    text: buildTodayPlanWidgetHtml(baseUrl),
    _meta: TODAY_PLAN_RESOURCE_META,
  } as const;
}
