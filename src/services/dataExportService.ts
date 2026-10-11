import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Exports stored account and planning data from a consistent snapshot.
 * Excludes authentication secrets, internal operational payloads, and support
 * triage fields that can refer to other accounts.
 */
export class DataExportService {
  constructor(private readonly prisma: PrismaClient) {}

  async exportAllUserData(userId: string): Promise<Record<string, unknown>> {
    if (typeof userId !== "string" || !userId.trim()) {
      throw new Error("User ID is required for data export");
    }
    return this.prisma.$transaction(
      async (tx) => {
        const [
          user,
          todos,
          projects,
          areas,
          goals,
          captures,
          events,
          insights,
          preferences,
          config,
          dayContexts,
          feedback,
          dayPlans,
          adaptationProfile,
          learningRecommendations,
          aiSuggestions,
          socialAccounts,
          feedbackRequests,
          assistantConnections,
          agentEnrollment,
          agentJobRuns,
          agentMetricEvents,
          failedAutomationActions,
          actionHistory,
          actionReceipts,
          providerReservations,
          providerUserDays,
          suggestionReservations,
        ] = await Promise.all([
          tx.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              email: true,
              name: true,
              phoneE164: true,
              role: true,
              plan: true,
              isVerified: true,
              onboardingStep: true,
              onboardingCompletedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
          tx.todo.findMany({ where: { userId }, include: { subtasks: true } }),
          tx.project.findMany({
            where: { userId },
            include: { headings: true },
          }),
          tx.area.findMany({ where: { userId } }),
          tx.goal.findMany({ where: { userId } }),
          tx.captureItem.findMany({ where: { userId } }),
          tx.activityEvent.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
          }),
          tx.userInsight.findMany({ where: { userId } }),
          tx.userPlanningPreferences.findUnique({ where: { userId } }),
          tx.agentConfig.findUnique({ where: { userId } }),
          tx.userDayContext.findMany({ where: { userId } }),
          tx.taskRecommendationFeedback.findMany({ where: { userId } }),
          tx.dayPlan.findMany({
            where: { userId },
            include: { tasks: { where: { todo: { userId } } } },
          }),
          tx.userAdaptationProfile.findUnique({ where: { userId } }),
          tx.learningRecommendation.findMany({ where: { userId } }),
          tx.aiSuggestion.findMany({
            where: { userId },
            include: { appliedTodos: { where: { todo: { userId } } } },
          }),
          tx.socialAccount.findMany({ where: { userId } }),
          tx.feedbackRequest.findMany({
            where: { userId },
            select: {
              id: true,
              type: true,
              title: true,
              body: true,
              screenshotUrl: true,
              attachmentMetadata: true,
              pageUrl: true,
              userAgent: true,
              appVersion: true,
              status: true,
              classification: true,
              githubIssueNumber: true,
              githubIssueUrl: true,
              promotedAt: true,
              reviewedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
          tx.mcpAssistantSession.findMany({
            where: { userId },
            select: {
              assistantName: true,
              clientId: true,
              resource: true,
              timezone: true,
              scopes: true,
              source: true,
              revokedAt: true,
              lastUsedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
          tx.agentEnrollment.findUnique({
            where: { userId },
            select: {
              dailyEnabled: true,
              weeklyEnabled: true,
              timezone: true,
              active: true,
              enrolledAt: true,
              lastRunAt: true,
              lastRunStatus: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
          tx.agentJobRun.findMany({
            where: { userId },
            select: {
              jobName: true,
              periodKey: true,
              status: true,
              retryCount: true,
              claimedAt: true,
              completedAt: true,
              failedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
          tx.agentMetricEvent.findMany({
            where: { userId },
            select: {
              jobName: true,
              periodKey: true,
              metricType: true,
              entityType: true,
              entityId: true,
              value: true,
              recordedAt: true,
            },
          }),
          tx.failedAutomationAction.findMany({
            where: { userId },
            select: {
              jobName: true,
              periodKey: true,
              actionType: true,
              entityType: true,
              entityId: true,
              errorCode: true,
              retryable: true,
              retryCount: true,
              resolvedAt: true,
              resolution: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
          tx.agentActionAudit.findMany({
            where: { userId },
            select: {
              surface: true,
              action: true,
              readOnly: true,
              outcome: true,
              status: true,
              replayed: true,
              errorCode: true,
              jobName: true,
              jobPeriodKey: true,
              triggeredBy: true,
              createdAt: true,
            },
          }),
          tx.agentIdempotencyRecord.findMany({
            where: { userId },
            select: {
              action: true,
              status: true,
              expiresAt: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
          tx.aiProviderReservation.findMany({
            where: { userId },
            select: {
              dayStart: true,
              status: true,
              reservedCostMicros: true,
              chargedCostMicros: true,
              settledAt: true,
              reconciledAt: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
          tx.aiProviderUserDay.findMany({
            where: { userId },
            select: { dayStart: true, requestCount: true },
          }),
          tx.aiSuggestionReservation.findMany({
            where: { userId },
            select: { dayStart: true, dailyLimit: true, createdAt: true },
          }),
        ]);

        const [runnerTables] = await tx.$queryRaw<
          { jobsPresent: boolean; auditPresent: boolean }[]
        >`
      SELECT to_regclass('agent_runner_job_runs') IS NOT NULL AS "jobsPresent",
             to_regclass('agent_runner_audit_log') IS NOT NULL AS "auditPresent"
    `;
        const runnerJobRuns = runnerTables.jobsPresent
          ? await tx.$queryRaw`
          SELECT job_name AS "jobName", period_key AS "periodKey", status,
                 started_at AS "startedAt", completed_at AS "completedAt"
          FROM agent_runner_job_runs WHERE user_id = ${userId}
          ORDER BY started_at DESC
        `
          : [];
        const runnerActionHistory = runnerTables.auditPresent
          ? await tx.$queryRaw`
          SELECT job_name AS "jobName", period_key AS "periodKey",
                 action_type AS "actionType", outcome, entity_type AS "entityType",
                 entity_id AS "entityId", created_at AS "createdAt"
          FROM agent_runner_audit_log WHERE user_id = ${userId}
          ORDER BY created_at DESC
        `
          : [];

        return {
          exportedAt: new Date().toISOString(),
          exportNotes: {
            excludedAuthenticationSecrets:
              "Passwords, verification/reset tokens, access/refresh credentials, OAuth codes and PKCE values are excluded.",
            excludedInternalPayloads:
              "Internal support triage and cross-account references, automation payloads/results/errors, receipt payloads/hashes/keys and internal request/session identifiers are excluded; safe lifecycle metadata is included.",
            externalCopies:
              "Linked screenshots and promoted GitHub issues are references only; their externally hosted contents are not included.",
            excludedProviderIdentifiers:
              "Provider admission request identifiers and content fingerprints, and global budget aggregates, are excluded; your quota and accounting metadata are included.",
          },
          user,
          todos,
          projects,
          areas,
          goals,
          captureItems: captures,
          activityEvents: events,
          insights,
          planningPreferences: preferences,
          agentConfig: config,
          dayContexts,
          recommendationFeedback: feedback,
          dayPlans,
          adaptationProfile,
          learningRecommendations,
          aiSuggestions,
          socialAccounts,
          feedbackRequests,
          assistantConnections,
          agentEnrollment,
          agentJobRuns,
          agentMetricEvents,
          failedAutomationActions,
          actionHistory,
          actionReceipts,
          runnerJobRuns,
          runnerActionHistory,
          aiProviderReservations: providerReservations.map((reservation) => ({
            ...reservation,
            reservedCostMicros: reservation.reservedCostMicros.toString(),
            chargedCostMicros:
              reservation.chargedCostMicros?.toString() ?? null,
          })),
          aiProviderUserDays: providerUserDays,
          aiSuggestionReservations: suggestionReservations,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
