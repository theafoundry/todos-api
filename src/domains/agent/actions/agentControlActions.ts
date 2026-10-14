/**
 * agentControlActions.ts — Write/record action handlers for the agent control plane.
 *
 * Actions: claim_job_run, complete_job_run, fail_job_run,
 *          record_failed_action, resolve_failed_action,
 *          update_agent_config, replay_job_run,
 *          record_metric, record_recommendation_feedback,
 *          set_day_context,
 *          record_learning_recommendation, apply_learning_recommendation,
 *          update_action_policy
 *
 * All services are already present in ActionRuntime — no extra deps needed.
 */

import { Prisma } from "@prisma/client";
import {
  validateAgentClaimJobRunInput,
  validateAgentCompleteJobRunInput,
  validateAgentFailJobRunInput,
  validateAgentRecordFailedActionInput,
  validateAgentResolveFailedActionInput,
  validateAgentUpdateAgentConfigInput,
  validateAgentReplayJobRunInput,
  validateAgentRecordMetricInput,
  validateAgentRecordFeedbackInput,
  validateAgentSetDayContextInput,
  validateAgentRecordLearningRecInput,
  validateAgentApplyLearningRecInput,
  validateAgentUpdateActionPolicyInput,
} from "../../../validation/agentValidation";
import { getFailureNarrationForJob } from "../jobs/activityPolicy";
import {
  boundDisplayLabel,
  deriveAgentId,
  truncateToCodePoints,
} from "../../../services/auditAttribution";
import { AgentExecutionError } from "./agentExecutionError";
import type { ActionRegistry, ActionRuntime } from "./actionRegistry";
import type { AgentExecutionContext, AgentExecutionResult } from "./agentTypes";

type RawParams = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatScalar(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function formatCountLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
}

function buildSuccessNarration(jobName: string, metadata: unknown): string {
  if (!isRecord(metadata)) {
    return `${jobName} completed successfully.`;
  }

  const summaryParts: string[] = [];

  for (const [key, rawValue] of Object.entries(metadata)) {
    if (
      key === "date" ||
      key === "week" ||
      key === "periodKey" ||
      key === "runId"
    ) {
      continue;
    }

    const scalar = formatScalar(rawValue);
    if (!scalar) {
      continue;
    }

    if (key === "errorMessage") {
      continue;
    }

    if (
      /Count$/i.test(key) ||
      /^count[A-Z_]/.test(key) ||
      /^count$/i.test(key)
    ) {
      summaryParts.push(`${formatCountLabel(key)}: ${scalar}`);
      continue;
    }

    if (summaryParts.length < 2) {
      summaryParts.push(`${formatCountLabel(key)}: ${scalar}`);
    }
  }

  if (summaryParts.length === 0) {
    return `${jobName} completed successfully.`;
  }

  return `${jobName} completed successfully. ${summaryParts.join(" · ")}.`;
}

async function recordJobNarration(
  runtime: ActionRuntime,
  context: AgentExecutionContext,
  input: {
    jobName: string;
    periodKey: string;
    narration: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!runtime.persistencePrisma) {
    return;
  }

  await runtime.persistencePrisma.agentActionAudit.create({
    data: {
      surface: "agent",
      action: "record_job_narration",
      readOnly: false,
      outcome: "success",
      status: 200,
      userId: context.userId,
      requestId: context.requestId,
      actor: boundDisplayLabel(context.actor, "unknown-agent"),
      replayed: false,
      jobName: input.jobName,
      jobPeriodKey: input.periodKey,
      triggeredBy: "agent",
      agentId: context.agentId ?? deriveAgentId(context.actor),
      narration: truncateToCodePoints(input.narration, 500),
      metadata:
        input.metadata !== undefined
          ? (input.metadata as unknown as Prisma.InputJsonValue)
          : undefined,
    },
  });
}

/**
 * Post-commit narration for complete/fail_job_run: the job-run state
 * change has already committed, so an audit failure must not turn the
 * response into a misleading failure. The failure stays observable
 * through a structured error log, matching the non-fatal audit policy
 * in AgentAuditService.
 */
async function recordJobNarrationBestEffort(
  runtime: ActionRuntime,
  context: AgentExecutionContext,
  input: {
    jobName: string;
    periodKey: string;
    narration: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await recordJobNarration(runtime, context, input);
  } catch (error) {
    console.error("Non-fatal error recording job narration audit:", {
      jobName: input.jobName,
      periodKey: input.periodKey,
      userId: context.userId,
      requestId: context.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function registerAgentControlActions(registry: ActionRegistry): void {
  registry.registerRaw(
    "claim_job_run",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const { jobName, periodKey } = validateAgentClaimJobRunInput(params);
      const { claimed, run } = await runtime.jobRunService.claimRun(
        context.userId,
        jobName,
        periodKey,
      );
      return runtime.exec.success("claim_job_run", false, context, 200, {
        claimed,
        run,
      });
    },
  );

  registry.registerRaw(
    "complete_job_run",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const { jobName, periodKey, metadata } =
        validateAgentCompleteJobRunInput(params);
      const completed = await runtime.jobRunService.completeRun(
        context.userId,
        jobName,
        periodKey,
        metadata,
      );
      if (!completed) {
        throw new AgentExecutionError(
          404,
          "RESOURCE_NOT_FOUND",
          `No running job run found for jobName=${jobName} periodKey=${periodKey}`,
          false,
          "Ensure claim_job_run was called first for this job/period combination.",
        );
      }
      await recordJobNarrationBestEffort(runtime, context, {
        jobName,
        periodKey,
        narration: buildSuccessNarration(jobName, metadata),
        metadata: isRecord(metadata) ? metadata : undefined,
      });
      return runtime.exec.success("complete_job_run", false, context, 200, {
        completed: true,
        jobName,
        periodKey,
      });
    },
  );

  registry.registerRaw(
    "fail_job_run",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const { jobName, periodKey, errorMessage } =
        validateAgentFailJobRunInput(params);
      const failed = await runtime.jobRunService.failRun(
        context.userId,
        jobName,
        periodKey,
        errorMessage,
      );
      if (!failed) {
        throw new AgentExecutionError(
          404,
          "RESOURCE_NOT_FOUND",
          `No running job run found for jobName=${jobName} periodKey=${periodKey}`,
          false,
          "Ensure claim_job_run was called first for this job/period combination.",
        );
      }
      const failureNarration = getFailureNarrationForJob(jobName, errorMessage);
      if (failureNarration) {
        await recordJobNarrationBestEffort(runtime, context, {
          jobName,
          periodKey,
          narration: failureNarration,
          metadata: { errorMessage },
        });
      }
      return runtime.exec.success("fail_job_run", false, context, 200, {
        failed: true,
        jobName,
        periodKey,
      });
    },
  );

  registry.registerRaw(
    "record_failed_action",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const recordInput = validateAgentRecordFailedActionInput(params);
      const record = await runtime.failedActionService.record({
        ...recordInput,
        userId: context.userId,
      });
      return runtime.exec.success("record_failed_action", false, context, 201, {
        record,
      });
    },
  );

  registry.registerRaw(
    "resolve_failed_action",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const { id, resolution } = validateAgentResolveFailedActionInput(params);
      const resolved = await runtime.failedActionService.resolve(
        context.userId,
        id,
        resolution,
      );
      if (!resolved) {
        throw new AgentExecutionError(
          404,
          "RESOURCE_NOT_FOUND_OR_FORBIDDEN",
          "Failed action not found or already resolved",
          false,
          "Verify the ID belongs to the authenticated user and the action is unresolved.",
        );
      }
      return runtime.exec.success(
        "resolve_failed_action",
        false,
        context,
        200,
        {
          resolved: true,
          id,
          resolution,
        },
      );
    },
  );

  registry.registerRaw(
    "update_agent_config",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const update = validateAgentUpdateAgentConfigInput(params);
      const config = await runtime.agentConfigService.updateConfig(
        context.userId,
        update,
      );
      return runtime.exec.success("update_agent_config", false, context, 200, {
        config,
      });
    },
  );

  registry.registerRaw(
    "replay_job_run",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const { jobName, periodKey } = validateAgentReplayJobRunInput(params);
      const result = await runtime.jobRunService.replayRun(
        context.userId,
        jobName,
        periodKey,
      );
      if (!result.replayed) {
        throw new AgentExecutionError(
          404,
          "RESOURCE_NOT_FOUND",
          `No job run found for jobName=${jobName} periodKey=${periodKey}`,
          false,
          "Verify the job name and period key are correct.",
        );
      }
      return runtime.exec.success("replay_job_run", false, context, 200, {
        replayed: true,
        run: result.run,
      });
    },
  );

  registry.registerRaw(
    "record_metric",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const metricInput = validateAgentRecordMetricInput(params);
      const event = await runtime.metricsService.record(
        context.userId,
        metricInput,
      );
      return runtime.exec.success("record_metric", false, context, 201, {
        event,
      });
    },
  );

  registry.registerRaw(
    "record_recommendation_feedback",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const fbInput = validateAgentRecordFeedbackInput(params);
      const feedback = await runtime.feedbackService.record(
        context.userId,
        fbInput,
      );
      return runtime.exec.success(
        "record_recommendation_feedback",
        false,
        context,
        201,
        {
          feedback,
        },
      );
    },
  );

  registry.registerRaw(
    "set_day_context",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const ctxInput = validateAgentSetDayContextInput(params);
      const dayCtxResult = await runtime.dayContextService.setContext(
        context.userId,
        ctxInput,
      );
      return runtime.exec.success("set_day_context", false, context, 200, {
        context: dayCtxResult,
      });
    },
  );

  registry.registerRaw(
    "record_learning_recommendation",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const recInput = validateAgentRecordLearningRecInput(params);
      const rec = await runtime.learningRecommendationService.record(
        context.userId,
        recInput,
      );
      return runtime.exec.success(
        "record_learning_recommendation",
        false,
        context,
        201,
        {
          recommendation: rec,
        },
      );
    },
  );

  registry.registerRaw(
    "apply_learning_recommendation",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const { id } = validateAgentApplyLearningRecInput(params);
      try {
        const { recommendation, configUpdated } =
          await runtime.learningRecommendationService.apply(context.userId, id);
        return runtime.exec.success(
          "apply_learning_recommendation",
          false,
          context,
          200,
          {
            recommendation,
            configUpdated,
          },
        );
      } catch (err) {
        if (err instanceof Error) {
          throw new AgentExecutionError(
            err.message.includes("not found") ? 404 : 400,
            err.message.includes("not found")
              ? "RESOURCE_NOT_FOUND_OR_FORBIDDEN"
              : "INVALID_OPERATION",
            err.message,
            false,
          );
        }
        throw err;
      }
    },
  );

  registry.registerRaw(
    "update_action_policy",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const { actionName, autoApply, minConfidence } =
        validateAgentUpdateActionPolicyInput(params);
      const policies = await runtime.actionPolicyService.updatePolicy(
        context.userId,
        actionName,
        { autoApply, minConfidence },
      );
      return runtime.exec.success("update_action_policy", false, context, 200, {
        policies,
      });
    },
  );

  registry.registerRaw(
    "record_job_narration",
    async (
      params: RawParams,
      context: AgentExecutionContext,
      runtime: ActionRuntime,
    ): Promise<AgentExecutionResult> => {
      const jobName = params.jobName as string | undefined;
      const periodKey = params.periodKey as string | undefined;
      const narration = params.narration as string | undefined;
      const metadata = params.metadata as Record<string, unknown> | undefined;

      if (!jobName || !periodKey || !narration) {
        throw new AgentExecutionError(
          400,
          "INVALID_INPUT",
          "jobName, periodKey, and narration are required",
          false,
        );
      }
      // Validate against storage limits before writing, so a column
      // error can never surface as a generic persistence failure.
      if (
        jobName.length > 100 ||
        periodKey.length > 20 ||
        [...narration].length > 500
      ) {
        throw new AgentExecutionError(
          400,
          "INVALID_INPUT",
          "jobName cannot exceed 100 characters, periodKey cannot exceed 20 characters, and narration cannot exceed 500 characters",
          false,
        );
      }

      await recordJobNarration(runtime, context, {
        jobName,
        periodKey,
        narration,
        metadata,
      });

      return runtime.exec.success("record_job_narration", false, context, 201, {
        recorded: true,
        jobName,
        periodKey,
      });
    },
  );
}
