import { PrismaClient } from "@prisma/client";
import { createLogger } from "../infra/logging/logger";
import { AdaptationLlmInferenceService } from "./adaptationLlmInference";
import { UserAdaptationService } from "./userAdaptationService";
import { AgentConfigService } from "./agentConfigService";
import {
  type AdaptationFlags,
  getDefaultFlags,
  isUserEligible,
} from "./adaptationFlags";

const log = createLogger("adaptationProjectInferenceService");

export interface AdaptationProjectInferenceResult {
  status: number;
  body: Record<string, unknown>;
}

export class AdaptationProjectInferenceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly adaptationService: UserAdaptationService,
    private readonly llmInferenceService: AdaptationLlmInferenceService,
    private readonly agentConfigService = new AgentConfigService(prisma),
  ) {}

  async getSoftInference(
    userId: string,
    projectId: string,
    flags: AdaptationFlags = getDefaultFlags(),
  ): Promise<AdaptationProjectInferenceResult> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: {
        id: true,
        name: true,
        description: true,
        targetDate: true,
        createdAt: true,
      },
    });

    if (!project) {
      return {
        status: 404,
        body: { error: "Project not found" },
      };
    }

    if (!isUserEligible(userId, flags) || !flags.guidancePersonalization) {
      return {
        status: 200,
        body: {
          inference: null,
          reason: "adaptation guidance not enabled for this user",
        },
      };
    }

    const agentConfig = await this.agentConfigService.getConfig(userId);
    if (agentConfig.aiOptOut) {
      return {
        status: 200,
        body: { inference: null, reason: "AI opt-out enabled" },
      };
    }

    const profileResult =
      await this.adaptationService.getOrCreateProfile(userId);
    if (profileResult.profile.confidence >= 0.4) {
      return {
        status: 200,
        body: {
          inference: null,
          reason: "behavioral confidence sufficient — LLM inference skipped",
          behavioralConfidence: profileResult.profile.confidence,
        },
      };
    }

    const [todos, headings] = await Promise.all([
      this.prisma.todo.findMany({
        where: { userId, projectId, archived: false },
        select: { title: true, headingId: true, dueDate: true },
        take: 50,
      }),
      this.prisma.heading.findMany({
        where: { projectId },
        select: { name: true },
      }),
    ]);

    const inference = await this.llmInferenceService.inferProjectIntent({
      projectName: project.name,
      projectDescription: project.description,
      taskTitles: todos.map((todo) => todo.title),
      existingSectionNames: headings.map((heading) => heading.name),
    });

    log.info("Soft inference result", {
      userId,
      projectId,
      projectName: project.name,
      behavioralConfidence: profileResult.profile.confidence,
      llmConfidence: inference?.confidence ?? 0,
      inferredType: inference?.inferredProjectType,
    });

    return {
      status: 200,
      body: {
        inference,
        reason: inference ? "llm soft inference" : "llm provider not available",
        behavioralConfidence: profileResult.profile.confidence,
      },
    };
  }
}
