/**
 * captureActions.ts — Action handlers for inbox capture and triage.
 *
 * Actions: capture_inbox_item, list_inbox_items, suggest_capture_route,
 *          promote_inbox_item, triage_capture_item, triage_inbox
 *
 * Also contains the triageCaptureText and suggestCaptureRoute utilities
 * (moved here from agentExecutor.ts file scope).
 */

import * as chrono from "chrono-node";
import {
  validateAgentCaptureInboxItemInput,
  validateAgentListInboxItemsInput,
  validateAgentSuggestCaptureRouteInput,
  validateAgentPromoteInboxItemInput,
  validateAgentTriageCaptureItemInput,
  validateAgentTriageInboxInput,
} from "../../../validation/agentValidation";
import { AgentExecutionError } from "./agentExecutionError";
import type { ActionRegistry, ActionRuntime } from "./actionRegistry";
import type { AgentExecutionContext, AgentExecutionResult } from "./agentTypes";

type RawParams = Record<string, unknown>;

// ── Capture utilities ──────────────────────────────────────────────────────

const ACTION_VERB_RE =
  /^(buy|call|send|write|read|review|schedule|book|fix|update|check|draft|prepare|submit|complete|finish|create|build|test|deploy|refactor|add|remove|delete|merge|close|open|contact|email|research|investigate|plan|organize|clean|sort|discuss|confirm|follow|set|get|make|find|move|copy|install|configure|document|upload|download|publish|cancel|archive|approve|reject|invite|register|verify|report|analyze|design|implement|request|order|pay|sign|file|print|record|backup|restore|monitor|notify|present|remind|track|coordinate|attend|join)\b/i;

export function triageCaptureText(text: string): {
  kind: "create_task" | "discard" | "convert_to_note";
  confidence: number;
  why: string;
  proposedAction: { title: string; status: string } | null;
} {
  const trimmed = text.trim();
  if (/^https?:\/\//.test(trimmed)) {
    return {
      kind: "convert_to_note",
      confidence: 0.8,
      why: "Looks like a URL reference, better stored as a note",
      proposedAction: {
        title: `Review: ${trimmed.slice(0, 60)}`,
        status: "inbox",
      },
    };
  }
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 3 && !ACTION_VERB_RE.test(trimmed)) {
    return {
      kind: "discard",
      confidence: 0.6,
      why: "Very short text with no action verb — likely noise or incomplete thought",
      proposedAction: null,
    };
  }
  if (ACTION_VERB_RE.test(trimmed)) {
    return {
      kind: "create_task",
      confidence: 0.85,
      why: "Starts with a clear action verb — actionable task",
      proposedAction: { title: trimmed, status: "inbox" },
    };
  }
  return {
    kind: "create_task",
    confidence: 0.5,
    why: "No clear action verb but text may be actionable — review before adding",
    proposedAction: { title: trimmed, status: "inbox" },
  };
}

function removeMatchedDatePhrase(
  text: string,
  matchText: string,
  index: number,
): string {
  const rawText = String(text || "");
  const start = Math.max(0, index);
  const end = Math.min(rawText.length, start + String(matchText || "").length);
  if (start >= end) return rawText.trim();
  return `${rawText.slice(0, start)} ${rawText.slice(end)}`
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function suggestCaptureRoute(input: {
  text: string;
  project?: string;
  workspaceView?: string;
}): {
  route: "task" | "triage";
  confidence: number;
  why: string;
  cleanedTitle: string;
  extractedFields: {
    dueDate?: string;
    project?: string;
    priority?: "low" | "medium" | "high" | "urgent";
  };
} {
  const trimmed = input.text.trim();
  const project = String(input.project || "").trim();
  const workspaceView = String(input.workspaceView || "").trim();
  const chronoResults = chrono.parse(trimmed, new Date(), {
    forwardDate: true,
  });
  const chronoMatch = chronoResults.find((entry) => {
    const textValue = String(entry?.text || "").trim();
    return textValue.length >= 2 && /[a-zA-Z]|\/|:/.test(textValue);
  });
  const dueDate = chronoMatch?.start?.date?.();
  const hasDueDate =
    dueDate instanceof Date &&
    !Number.isNaN(dueDate.getTime()) &&
    dueDate.getTime() >= Date.now() - 60_000;
  const cleanedTitle =
    chronoMatch && hasDueDate
      ? removeMatchedDatePhrase(
          trimmed,
          String(chronoMatch.text || ""),
          Number(chronoMatch.index) || 0,
        ) || trimmed
      : trimmed;
  const multiline = /\n/.test(trimmed);
  const looksReference =
    /^https?:\/\//.test(trimmed) ||
    /\b(reference|note|notes|idea|someday|bookmark)\b/i.test(trimmed);
  const actionVerb = ACTION_VERB_RE.test(trimmed);

  if (project) {
    return {
      route: "task",
      confidence: 0.94,
      why: "You are already inside a project, so this is likely ready to become a task.",
      cleanedTitle,
      extractedFields: {
        ...(hasDueDate ? { dueDate: dueDate.toISOString() } : {}),
        project,
      },
    };
  }
  if (actionVerb || hasDueDate) {
    return {
      route: "task",
      confidence: hasDueDate ? 0.88 : 0.84,
      why: hasDueDate
        ? "The text includes a concrete date, which usually indicates a ready-to-create task."
        : "The text starts with a clear action, which usually indicates a ready-to-create task.",
      cleanedTitle,
      extractedFields: {
        ...(hasDueDate ? { dueDate: dueDate.toISOString() } : {}),
      },
    };
  }
  if (multiline || looksReference || trimmed.length > 140) {
    return {
      route: "triage",
      confidence: multiline ? 0.82 : 0.74,
      why: multiline
        ? "This looks like a rough capture with multiple ideas and is better reviewed in triage."
        : "This looks more like reference material or a rough note than a ready task.",
      cleanedTitle,
      extractedFields: {},
    };
  }
  if (workspaceView === "triage") {
    return {
      route: "triage",
      confidence: 0.62,
      why: "You are already triaging work, so saving this for review is the safer default.",
      cleanedTitle,
      extractedFields: {},
    };
  }
  return {
    route: "triage",
    confidence: 0.52,
    why: "The text is still ambiguous, so triage is the safer default until it is clarified.",
    cleanedTitle,
    extractedFields: {},
  };
}

// ── Handler registration ───────────────────────────────────────────────────

export function registerCaptureActions(registry: ActionRegistry): void {
  registry.registerRaw(
    "capture_inbox_item",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      if (!runtime.captureService) {
        throw new AgentExecutionError(
          501,
          "NOT_CONFIGURED",
          "Persistence layer not available",
          false,
        );
      }
      const { text, source } = validateAgentCaptureInboxItemInput(params);
      return runtime.exec.handleIdempotent(
        "capture_inbox_item",
        context,
        { text, source },
        async () => {
          const item = await runtime.captureService!.create(
            context.userId,
            text,
            source,
          );
          return { item };
        },
        201,
      );
    },
  );

  registry.registerRaw(
    "list_inbox_items",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      if (!runtime.captureService) {
        return runtime.exec.success("list_inbox_items", true, context, 200, {
          items: [],
        });
      }
      const { lifecycle, source, limit, since } =
        validateAgentListInboxItemsInput(params);
      let items = await runtime.captureService.findAll(
        context.userId,
        lifecycle,
      );
      if (source) items = items.filter((i) => i.source === source);
      if (since) {
        const sinceDate = new Date(since);
        items = items.filter((i) => new Date(i.capturedAt) >= sinceDate);
      }
      if (limit) items = items.slice(0, limit);
      return runtime.exec.success("list_inbox_items", true, context, 200, {
        items,
        total: items.length,
      });
    },
  );

  registry.registerRaw(
    "suggest_capture_route",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const suggestion = suggestCaptureRoute(
        validateAgentSuggestCaptureRouteInput(params),
      );
      return runtime.exec.success(
        "suggest_capture_route",
        true,
        context,
        200,
        suggestion as unknown as Record<string, unknown>,
      );
    },
  );

  registry.registerRaw(
    "promote_inbox_item",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      if (!runtime.captureService || !runtime.persistencePrisma) {
        throw new AgentExecutionError(
          501,
          "NOT_CONFIGURED",
          "Persistence layer not available",
          false,
        );
      }
      const {
        captureItemId,
        type,
        projectId,
        title: titleOverride,
      } = validateAgentPromoteInboxItemInput(params);
      if (type === "project" && !runtime.projectService) {
        throw new AgentExecutionError(
          501,
          "NOT_CONFIGURED",
          "Project service not available",
          false,
        );
      }
      const result = await runtime.captureService.promote(
        context.userId,
        captureItemId,
        { type, title: titleOverride, projectId, status: "inbox" },
      );
      const promoted =
        result.type === "task"
          ? { type: "task", task: result.task }
          : { type: "project", project: result.project };
      return runtime.exec.success(
        "promote_inbox_item",
        false,
        context,
        result.created ? 201 : 200,
        promoted,
      );
    },
  );

  registry.registerRaw(
    "triage_capture_item",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      if (!runtime.persistencePrisma) {
        throw new AgentExecutionError(
          501,
          "NOT_CONFIGURED",
          "Persistence layer not available",
          false,
        );
      }
      const { captureItemId, mode } =
        validateAgentTriageCaptureItemInput(params);
      const item = await runtime.persistencePrisma.captureItem.findFirst({
        where: { id: captureItemId, userId: context.userId },
      });
      if (!item) {
        throw new AgentExecutionError(
          404,
          "RESOURCE_NOT_FOUND_OR_FORBIDDEN",
          "Capture item not found",
          false,
          "Verify the capture item ID belongs to the authenticated user.",
        );
      }
      const recommendation = triageCaptureText(item.text);
      let applied = false;
      if (mode === "apply") {
        const updated = await runtime.captureService!.updateLifecycle(
          context.userId,
          captureItemId,
          "triaged",
          recommendation,
        );
        const result = updated?.triageResult as { promotedId?: string } | null;
        applied = updated?.lifecycle === "triaged" && !result?.promotedId;
      }
      const policies = await runtime.actionPolicyService.getPolicies(
        context.userId,
      );
      return runtime.exec.success("triage_capture_item", false, context, 200, {
        captureItemId,
        recommendation,
        applied,
        actionMeta: runtime.actionPolicyService.buildActionMeta(
          "triage_capture_item",
          policies,
        ),
      });
    },
  );

  registry.registerRaw(
    "triage_inbox",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      if (!runtime.persistencePrisma) {
        throw new AgentExecutionError(
          501,
          "NOT_CONFIGURED",
          "Persistence layer not available",
          false,
        );
      }
      const { limit, mode } = validateAgentTriageInboxInput(params);
      const items = await runtime.persistencePrisma.captureItem.findMany({
        where: { userId: context.userId, lifecycle: "new" },
        orderBy: { capturedAt: "asc" },
        take: limit ?? 20,
      });
      const triaged = items.map((item) => ({
        captureItemId: item.id,
        recommendation: triageCaptureText(item.text),
      }));
      if (mode === "apply" && items.length > 0) {
        for (const item of items) {
          const rec = triaged.find((t) => t.captureItemId === item.id);
          await runtime.captureService!.updateLifecycle(
            context.userId,
            item.id,
            "triaged",
            rec?.recommendation,
          );
        }
      }
      return runtime.exec.success("triage_inbox", false, context, 200, {
        triaged,
        totalProcessed: items.length,
        mode: mode ?? "suggest",
      });
    },
  );
}
