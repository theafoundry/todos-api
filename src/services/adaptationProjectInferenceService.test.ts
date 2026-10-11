import type { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { AdaptationProjectInferenceService } from "./adaptationProjectInferenceService";
import type { AdaptationFlags } from "./adaptationFlags";
import { createAdaptationRouter } from "../routes/adaptationRouter";

const enabledFlags: AdaptationFlags = {
  enabled: true,
  insightsPersonalization: true,
  guidancePersonalization: true,
  rolloutPercentage: 100,
};

const project = {
  id: "project-1",
  name: "Launch plan",
  description: "Coordinate the rollout",
  targetDate: null,
  createdAt: new Date("2026-04-01T00:00:00.000Z"),
};

function createMockPrisma(
  overrides: Record<string, unknown> = {},
): PrismaClient {
  return {
    project: { findFirst: jest.fn() },
    todo: { findMany: jest.fn() },
    heading: { findMany: jest.fn() },
    agentConfig: {
      findUnique: jest.fn().mockResolvedValue({ aiOptOut: false }),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

describe("AdaptationProjectInferenceService", () => {
  it("returns 404 when the project is missing", async () => {
    const service = new AdaptationProjectInferenceService(
      createMockPrisma({
        project: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
      { getOrCreateProfile: jest.fn() } as any,
      { inferProjectIntent: jest.fn() } as any,
    );

    await expect(
      service.getSoftInference("user-1", "project-1", enabledFlags),
    ).resolves.toEqual({
      status: 404,
      body: { error: "Project not found" },
    });
  });

  it("skips todo and heading fetches when behavioral confidence is already high", async () => {
    const projectFindFirst = jest.fn().mockResolvedValue({
      id: "project-1",
      name: "Project",
      description: "Description",
      targetDate: null,
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
    });
    const todoFindMany = jest.fn();
    const headingFindMany = jest.fn();
    const getOrCreateProfile = jest.fn().mockResolvedValue({
      profile: { confidence: 0.82 },
    });
    const inferProjectIntent = jest.fn();
    const service = new AdaptationProjectInferenceService(
      createMockPrisma({
        project: { findFirst: projectFindFirst },
        todo: { findMany: todoFindMany },
        heading: { findMany: headingFindMany },
      }),
      { getOrCreateProfile } as any,
      { inferProjectIntent } as any,
    );

    await expect(
      service.getSoftInference("user-1", "project-1", enabledFlags),
    ).resolves.toEqual({
      status: 200,
      body: {
        inference: null,
        reason: "behavioral confidence sufficient — LLM inference skipped",
        behavioralConfidence: 0.82,
      },
    });
    expect(todoFindMany).not.toHaveBeenCalled();
    expect(headingFindMany).not.toHaveBeenCalled();
    expect(inferProjectIntent).not.toHaveBeenCalled();
  });

  it("loads project context and returns soft inference when behavioral confidence is low", async () => {
    const inferProjectIntent = jest.fn().mockResolvedValue({
      inferredProjectType: "commitment",
      confidence: 0.61,
    });
    const service = new AdaptationProjectInferenceService(
      createMockPrisma({
        project: {
          findFirst: jest.fn().mockResolvedValue({
            id: "project-1",
            name: "Launch plan",
            description: "Coordinate the rollout",
            targetDate: null,
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
          }),
        },
        todo: {
          findMany: jest.fn().mockResolvedValue([
            {
              title: "Write launch checklist",
              headingId: null,
              dueDate: null,
            },
          ]),
        },
        heading: {
          findMany: jest.fn().mockResolvedValue([{ name: "Milestones" }]),
        },
      }),
      {
        getOrCreateProfile: jest
          .fn()
          .mockResolvedValue({ profile: { confidence: 0.18 } }),
      } as any,
      { inferProjectIntent } as any,
    );

    await expect(
      service.getSoftInference("user-1", "project-1", {
        ...enabledFlags,
        rolloutPercentage: 0,
        eligibleUserIds: ["user-1"],
      }),
    ).resolves.toEqual({
      status: 200,
      body: {
        inference: {
          inferredProjectType: "commitment",
          confidence: 0.61,
        },
        reason: "llm soft inference",
        behavioralConfidence: 0.18,
      },
    });
    expect(inferProjectIntent).toHaveBeenCalledWith({
      projectName: "Launch plan",
      projectDescription: "Coordinate the rollout",
      taskTitles: ["Write launch checklist"],
      existingSectionNames: ["Milestones"],
    });
  });

  it.each([
    ["disabled master switch", { ...enabledFlags, enabled: false }],
    ["zero rollout", { ...enabledFlags, rolloutPercentage: 0 }],
    [
      "excluded allowlist user",
      { ...enabledFlags, eligibleUserIds: ["user-2"] },
    ],
    ["disabled guidance", { ...enabledFlags, guidancePersonalization: false }],
  ])(
    "skips inference with %s before loading prompt context",
    async (_, flags) => {
      const prisma = createMockPrisma({
        project: { findFirst: jest.fn().mockResolvedValue(project) },
      });
      const getOrCreateProfile = jest.fn();
      const inferProjectIntent = jest.fn();
      const service = new AdaptationProjectInferenceService(
        prisma,
        { getOrCreateProfile } as any,
        { inferProjectIntent } as any,
      );

      const result = await service.getSoftInference(
        "user-1",
        "project-1",
        flags as AdaptationFlags,
      );

      expect(result).toEqual({
        status: 200,
        body: {
          inference: null,
          reason: "adaptation guidance not enabled for this user",
        },
      });
      expect(prisma.agentConfig.findUnique).not.toHaveBeenCalled();
      expect(getOrCreateProfile).not.toHaveBeenCalled();
      expect(prisma.todo.findMany).not.toHaveBeenCalled();
      expect(prisma.heading.findMany).not.toHaveBeenCalled();
      expect(inferProjectIntent).not.toHaveBeenCalled();
    },
  );

  it("honors AI opt-out for an eligible user before loading prompt context", async () => {
    const prisma = createMockPrisma({
      project: { findFirst: jest.fn().mockResolvedValue(project) },
      agentConfig: {
        findUnique: jest.fn().mockResolvedValue({ aiOptOut: true }),
      },
    });
    const getOrCreateProfile = jest.fn();
    const inferProjectIntent = jest.fn();
    const service = new AdaptationProjectInferenceService(
      prisma,
      { getOrCreateProfile } as any,
      { inferProjectIntent } as any,
    );

    await expect(
      service.getSoftInference("user-1", "project-1", enabledFlags),
    ).resolves.toEqual({
      status: 200,
      body: { inference: null, reason: "AI opt-out enabled" },
    });
    expect(prisma.agentConfig.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(getOrCreateProfile).not.toHaveBeenCalled();
    expect(prisma.todo.findMany).not.toHaveBeenCalled();
    expect(prisma.heading.findMany).not.toHaveBeenCalled();
    expect(inferProjectIntent).not.toHaveBeenCalled();
  });

  it("preserves ownership 404 even when adaptation is disabled", async () => {
    const prisma = createMockPrisma({
      project: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const inferProjectIntent = jest.fn();
    const service = new AdaptationProjectInferenceService(
      prisma,
      { getOrCreateProfile: jest.fn() } as any,
      { inferProjectIntent } as any,
    );

    await expect(
      service.getSoftInference("user-1", "project-1", {
        ...enabledFlags,
        enabled: false,
      }),
    ).resolves.toEqual({ status: 404, body: { error: "Project not found" } });
    expect(prisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "project-1", userId: "user-1" } }),
    );
    expect(inferProjectIntent).not.toHaveBeenCalled();
  });

  it.each([
    { enabled: false, aiOptOut: false, expectedCalls: 0 },
    { enabled: true, aiOptOut: true, expectedCalls: 0 },
    { enabled: true, aiOptOut: false, expectedCalls: 1 },
  ])(
    "uses the direct route's eligibility and opt-out gates (%j)",
    async ({ enabled, aiOptOut, expectedCalls }) => {
      const prisma = createMockPrisma({
        project: { findFirst: jest.fn().mockResolvedValue(project) },
        todo: { findMany: jest.fn().mockResolvedValue([]) },
        heading: { findMany: jest.fn().mockResolvedValue([]) },
        agentConfig: {
          findUnique: jest.fn().mockResolvedValue({ aiOptOut }),
        },
      });
      const getOrCreateProfile = jest
        .fn()
        .mockResolvedValue({ profile: { confidence: 0.1 } });
      const adaptationService = { getOrCreateProfile } as any;
      const inferProjectIntent = jest.fn().mockResolvedValue(null);
      const projectInferenceService = new AdaptationProjectInferenceService(
        prisma,
        adaptationService,
        { inferProjectIntent } as any,
      );
      const app = express();
      app.use(
        "/adaptation",
        createAdaptationRouter({
          adaptationService,
          projectInferenceService,
          flags: { ...enabledFlags, enabled },
          resolveUserId: () => "user-1",
        }),
      );

      const response = await request(app)
        .get("/adaptation/projects/project-1/soft-inference")
        .expect(200);

      expect(response.body.inference).toBeNull();
      expect(inferProjectIntent).toHaveBeenCalledTimes(expectedCalls);
      expect(prisma.project.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "project-1", userId: "user-1" },
        }),
      );
    },
  );
});
