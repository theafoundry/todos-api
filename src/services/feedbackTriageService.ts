import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { config } from "../config";
import {
  FeedbackRequestType,
  FeedbackTriageClassification,
  FeedbackTriageResultDto,
} from "../types";
import { validateFeedbackTriageOutput } from "../validation/feedbackTriageContracts";
import { FailedAutomationActionService } from "./failedAutomationActionService";
import { FeedbackFailureService } from "./feedbackFailureService";
import { callAiProvider } from "./aiProviderClient";

interface AiProvider {
  generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T>;
}

export interface FeedbackTriageServiceDeps {
  provider?: AiProvider;
  feedbackFailureService?: FeedbackFailureService;
}

type FeedbackRecord = {
  id: string;
  type: FeedbackRequestType;
  title: string;
  body: string;
  screenshotUrl: string | null;
  pageUrl: string | null;
  userAgent: string | null;
  appVersion: string | null;
  triageSummary: string | null;
  dedupeKey: string | null;
};

class OpenAiCompatibleProvider implements AiProvider {
  async generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const content = await callAiProvider({
      operation: "feedback_triage_json",
      systemPrompt,
      userPrompt,
      json: true,
      temperature: 0,
    });
    return JSON.parse(content) as T;
  }
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function titleCaseLabel(value: string): string {
  return value
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildDedupeKey(
  record: FeedbackRecord,
  classification: string,
): string {
  const normalized = `${classification}|${record.type}|${record.title}|${record.body
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()}`;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

function extractSection(body: string, prompts: string[]): string | null {
  const lines = body.split(/\n+/).map((line) => line.trim());
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lower = line.toLowerCase();
    const match = prompts.find((prompt) =>
      lower.startsWith(prompt.toLowerCase()),
    );
    if (!match) {
      continue;
    }
    const inlineValue = line
      .slice(match.length)
      .replace(/^[:\-\s]+/, "")
      .trim();
    if (inlineValue) {
      return inlineValue;
    }
    const nextLine = lines[index + 1]?.trim();
    if (nextLine) {
      return nextLine;
    }
  }
  return null;
}

function buildSummary(record: FeedbackRecord, classification: string): string {
  const pageContext = record.pageUrl ? ` on ${record.pageUrl}` : "";
  return `${titleCaseLabel(classification)} feedback from "${record.title}"${pageContext}.`;
}

export function triageFeedbackDeterministic(
  record: FeedbackRecord,
): FeedbackTriageResultDto & { triageSummary: string; dedupeKey: string } {
  const normalizedTitle = normalizeWhitespace(record.title).slice(0, 200);
  const normalizedBody = normalizeWhitespace(record.body);
  const titleLower = normalizedTitle.toLowerCase();
  const bodyLower = normalizedBody.toLowerCase();

  let classification: FeedbackTriageClassification =
    record.type === "feature"
      ? "feature"
      : record.type === "bug"
        ? "bug"
        : "support";
  let triageConfidence = 0.72;

  if (
    bodyLower.includes("duplicate") ||
    bodyLower.includes("same issue") ||
    titleLower.includes("again")
  ) {
    classification = "duplicate_candidate";
    triageConfidence = 0.79;
  } else if (
    bodyLower.includes("help") ||
    bodyLower.includes("how do i") ||
    bodyLower.includes("how can i")
  ) {
    classification = "support";
    triageConfidence = 0.76;
  } else if (
    normalizedBody.length < 20 ||
    ["test", "hello", "asdf"].includes(titleLower)
  ) {
    classification = "noise";
    triageConfidence = 0.84;
  } else if (record.type === "feature") {
    classification = "feature";
    triageConfidence = 0.84;
  } else if (record.type === "bug") {
    classification = "bug";
    triageConfidence = 0.86;
  }

  const reproSteps = [
    extractSection(record.body, [
      "what were you doing right before it happened?",
      "steps to reproduce",
      "repro steps",
    ]),
    extractSection(record.body, ["what happened?", "actual behavior"]),
  ].filter((value): value is string => Boolean(value));

  const expectedBehavior = extractSection(record.body, [
    "what did you expect?",
    "expected behavior",
  ]);
  const actualBehavior = extractSection(record.body, [
    "what happened?",
    "actual behavior",
  ]);
  const problemToday = extractSection(record.body, ["what is hard today?"]);
  const desiredOutcome = extractSection(record.body, [
    "what would make this better?",
    "what are you trying to do?",
    "proposed outcome",
  ]);

  const labels = Array.from(
    new Set(
      [
        `feedback:${classification}`,
        `source:${record.type}`,
        record.screenshotUrl ? "has:screenshot" : "",
        record.pageUrl ? "has:page-context" : "",
      ].filter(Boolean),
    ),
  );

  const missingInfo = [
    classification === "bug" && reproSteps.length === 0
      ? "missing_repro_steps"
      : "",
    classification === "bug" && !expectedBehavior
      ? "missing_expected_behavior"
      : "",
    classification === "feature" && !desiredOutcome
      ? "missing_desired_outcome"
      : "",
    !record.pageUrl ? "missing_page_context" : "",
  ].filter(Boolean);

  const triageSummary = buildSummary(record, classification);
  const impactSummary =
    classification === "feature"
      ? problemToday || desiredOutcome || null
      : actualBehavior || normalizedBody.slice(0, 280);
  const proposedOutcome =
    classification === "feature"
      ? desiredOutcome
      : classification === "bug"
        ? expectedBehavior
        : desiredOutcome || expectedBehavior;
  const dedupeKey = buildDedupeKey(record, classification);

  return {
    classification,
    triageConfidence,
    normalizedTitle,
    normalizedBody,
    impactSummary,
    reproSteps,
    expectedBehavior,
    actualBehavior,
    proposedOutcome,
    labels,
    missingInfo,
    triageSummary,
    dedupeKey,
  };
}

function buildSystemPrompt(): string {
  return [
    "You classify product feedback into engineering-ready JSON.",
    "Return only valid JSON matching the requested schema.",
    "Never include markdown or commentary.",
    "Use one classification from bug, feature, support, duplicate_candidate, noise.",
    "Keep titles concise, factual, and implementation-oriented.",
    "Use empty arrays when information is missing.",
  ].join(" ");
}

function buildUserPrompt(record: FeedbackRecord): string {
  return JSON.stringify({
    instruction:
      "Produce deterministic structured triage output with fields classification, triageConfidence, normalizedTitle, normalizedBody, impactSummary, reproSteps, expectedBehavior, actualBehavior, proposedOutcome, labels, missingInfo.",
    feedback: {
      id: record.id,
      type: record.type,
      title: record.title,
      body: record.body,
      screenshotUrl: record.screenshotUrl,
      pageUrl: record.pageUrl,
      userAgent: record.userAgent,
      appVersion: record.appVersion,
    },
  });
}

export class FeedbackTriageService {
  private readonly provider?: AiProvider;
  private readonly feedbackFailureService: FeedbackFailureService;

  constructor(
    private readonly prisma: PrismaClient,
    deps: FeedbackTriageServiceDeps = {},
  ) {
    this.provider =
      deps.provider ??
      (config.aiProviderEnabled ? new OpenAiCompatibleProvider() : undefined);
    this.feedbackFailureService =
      deps.feedbackFailureService ??
      new FeedbackFailureService(new FailedAutomationActionService(prisma));
  }

  async triageFeedback(feedbackId: string): Promise<FeedbackTriageResultDto> {
    const record = await this.prisma.feedbackRequest.findUnique({
      where: { id: feedbackId },
      select: {
        id: true,
        userId: true,
        type: true,
        title: true,
        body: true,
        screenshotUrl: true,
        pageUrl: true,
        userAgent: true,
        appVersion: true,
        triageSummary: true,
        dedupeKey: true,
      },
    });

    if (!record) {
      throw new Error("Feedback request not found");
    }

    const fallback = triageFeedbackDeterministic(record);
    let normalized = fallback;
    let providerFailed = false;

    if (this.provider) {
      try {
        const aiOutput = await this.provider.generateJson<unknown>(
          buildSystemPrompt(),
          buildUserPrompt(record),
        );
        const validated = validateFeedbackTriageOutput(aiOutput);
        normalized = {
          ...validated,
          triageSummary: buildSummary(record, validated.classification),
          dedupeKey: buildDedupeKey(record, validated.classification),
        };
      } catch (error) {
        providerFailed = true;
        await this.feedbackFailureService.record({
          userId: record.userId,
          feedbackId,
          actionType: "feedback.triage",
          errorCode: "TRIAGE_PROVIDER_FAILED",
          errorMessage:
            error instanceof Error ? error.message : "Triage provider failed",
          payload: {
            feedbackId,
            providerEnabled: true,
          },
          retryable: true,
        });
        normalized = fallback;
      }
    }

    await this.prisma.feedbackRequest.update({
      where: { id: feedbackId },
      data: {
        classification: normalized.classification,
        triageConfidence: normalized.triageConfidence,
        normalizedTitle: normalized.normalizedTitle,
        normalizedBody: normalized.normalizedBody,
        impactSummary: normalized.impactSummary ?? null,
        reproStepsJson:
          (normalized.reproSteps ?? []).length > 0
            ? ((normalized.reproSteps ?? []) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        expectedBehavior: normalized.expectedBehavior ?? null,
        actualBehavior: normalized.actualBehavior ?? null,
        proposedOutcome: normalized.proposedOutcome ?? null,
        agentLabelsJson:
          normalized.labels.length > 0
            ? (normalized.labels as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        missingInfoJson:
          normalized.missingInfo.length > 0
            ? (normalized.missingInfo as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        triageSummary: normalized.triageSummary,
        dedupeKey: normalized.dedupeKey,
      },
    });
    if (!providerFailed) {
      await this.feedbackFailureService.resolveOpenForFeedback(
        feedbackId,
        "feedback.triage",
      );
    }

    return normalized;
  }
}
