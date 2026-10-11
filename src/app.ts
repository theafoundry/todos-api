import express, { Request, Response, RequestHandler } from "express";
import path from "path";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger";
import { ITodoService } from "./interfaces/ITodoService";
import { TodoService } from "./services/todoService";
import { AuthService } from "./services/authService";
import { AiProviderAdmissionService } from "./services/aiProviderAdmissionService";
import { SocialAuthService } from "./services/socialAuthService";
import { GoogleAuthService } from "./services/googleAuthService";
import { AppleAuthService } from "./services/appleAuthService";
import { PhoneAuthService } from "./services/phoneAuthService";
import { authMiddleware } from "./middleware/authMiddleware";
import { adminMiddleware } from "./middleware/adminMiddleware";
import { config } from "./config";
import { errorHandler } from "./errorHandling";
import { createTodosRouter } from "./routes/todosRouter";
import { createAuthRouter } from "./routes/authRouter";
import { createAdminRouter } from "./routes/adminRouter";
import { createUsersRouter } from "./routes/usersRouter";
import { createAiRouter } from "./routes/aiRouter";
import { createPrioritiesBriefRouter } from "./routes/prioritiesBriefRouter";
import { createFocusBriefRouter } from "./routes/focusBriefRouter";
import { createAgentRouter } from "./routes/agentRouter";
import { createMcpRouter } from "./routes/mcpRouter";
import { createMcpAppRouter } from "./routes/mcpAppRouter";
import {
  IAiSuggestionStore,
  InMemoryAiSuggestionStore,
  PrismaAiSuggestionStore,
} from "./services/aiSuggestionStore";
import { AiPlannerService } from "./services/aiService";
import { UserPlan } from "./routes/aiRouter";
import { createProjectsRouter } from "./routes/projectsRouter";
import { IProjectService } from "./interfaces/IProjectService";
import { IHeadingService } from "./interfaces/IHeadingService";
import { AgentExecutor } from "./agent/agentExecutor";
import { McpOAuthService } from "./services/mcpOAuthService";
import { McpClientService } from "./services/mcpClientService";
import { createMcpPublicRouter } from "./routes/mcpPublicRouter";
import { CaptureService } from "./services/captureService";
import { createCaptureRouter } from "./routes/captureRouter";
import { createPreferencesRouter } from "./routes/preferencesRouter";
import { PlanningPreferencesService } from "./services/planningPreferencesService";
import { createAgentEnrollmentRouter } from "./routes/agentEnrollmentRouter";
import {
  createAgentProfileRouter,
  createInternalAgentProfileRouter,
} from "./routes/agentProfileRouter";
import { EmailService } from "./services/emailService";
import { FeedbackService } from "./services/feedbackService";
import { FeedbackDuplicateService } from "./services/feedbackDuplicateService";
import { FeedbackPromotionService } from "./services/feedbackPromotionService";
import { FeedbackTriageService } from "./services/feedbackTriageService";
import { FeedbackAutomationService } from "./services/feedbackAutomationService";
import { FailedAutomationActionService } from "./services/failedAutomationActionService";
import { FeedbackFailureService } from "./services/feedbackFailureService";
import { createFeedbackRouter } from "./routes/feedbackRouter";
import { AgentEnrollmentService } from "./services/agentEnrollmentService";
import { ActivityEventService } from "./services/activityEventService";
import { InsightsService } from "./services/insightsService";
import { InsightsComputeService } from "./services/insightsComputeService";
import { createEventsRouter } from "./routes/eventsRouter";
import { createInsightsRouter } from "./routes/insightsRouter";
import { createCalendarRouter } from "./routes/calendarRouter";
import { createAreasRouter } from "./routes/areasRouter";
import { createGoalsRouter } from "./routes/goalsRouter";
import { createDayPlanRouter } from "./routes/dayPlanRouter";
import { createStaticPagesRouter } from "./routes/staticPagesRouter";
import { createAdaptationRouter } from "./routes/adaptationRouter";
import { createAgentActivityRouter } from "./routes/agentActivityRouter";
import { AgentActivityService } from "./services/agentActivityService";
import { DayPlanService } from "./services/dayPlanService";
import { UserAdaptationService } from "./services/userAdaptationService";
import { AdaptationLlmInferenceService } from "./services/adaptationLlmInference";
import { AdaptationProjectInferenceService } from "./services/adaptationProjectInferenceService";
import { AreaService } from "./services/areaService";
import { GoalService } from "./services/goalService";
import {
  authLimiter,
  emailActionLimiter,
  apiLimiter,
  mcpPublicLimiter,
} from "./middleware/rateLimitMiddleware";
import { requestIdMiddleware } from "./infra/logging/requestId";
import { routeLatencyMiddleware } from "./infra/metrics/routeLatency";

export interface AppDependencies {
  todoService?: ITodoService;
  authService?: AuthService;
  projectService?: IProjectService;
  headingService?: IHeadingService;
  ai?: {
    plannerService?: AiPlannerService;
    suggestionStore?: IAiSuggestionStore;
    dailySuggestionLimit?: number;
    dailySuggestionLimitByPlan?: Partial<Record<UserPlan, number>>;
    decisionAssistEnabled?: boolean;
  };
}

export function createApp(deps: AppDependencies = {}) {
  const {
    todoService = new TodoService(),
    authService,
    projectService,
    headingService,
    ai: {
      plannerService: aiPlannerService,
      suggestionStore: aiSuggestionStore,
      dailySuggestionLimit: aiDailySuggestionLimit,
      dailySuggestionLimitByPlan: aiDailySuggestionLimitByPlan,
      decisionAssistEnabled: aiDecisionAssistEnabled,
    } = {},
  } = deps;
  const app = express();
  const persistencePrisma =
    authService instanceof AuthService
      ? authService.getPrismaClient()
      : undefined;
  const providerAdmissionService = new AiProviderAdmissionService({
    prisma: persistencePrisma,
  });
  const runtimeAiSuggestionStore =
    aiSuggestionStore ||
    (persistencePrisma
      ? new PrismaAiSuggestionStore(persistencePrisma)
      : new InMemoryAiSuggestionStore());
  const runtimeAiPlannerService =
    aiPlannerService ||
    new AiPlannerService({
      todoService,
      projectService,
    });
  const agentExecutor = new AgentExecutor({
    todoService,
    projectService,
    persistencePrisma,
    aiPlannerService: runtimeAiPlannerService,
    suggestionStore: runtimeAiSuggestionStore,
  });
  const mcpOAuthService = new McpOAuthService(persistencePrisma);
  const mcpClientService = new McpClientService();
  const captureService = persistencePrisma
    ? new CaptureService(persistencePrisma)
    : null;
  const emailService = new EmailService();
  const feedbackService = persistencePrisma
    ? new FeedbackService(persistencePrisma, emailService)
    : null;
  const feedbackFailureService = persistencePrisma
    ? new FeedbackFailureService(
        new FailedAutomationActionService(persistencePrisma),
      )
    : null;
  const feedbackTriageService = persistencePrisma
    ? new FeedbackTriageService(persistencePrisma, {
        feedbackFailureService: feedbackFailureService ?? undefined,
      })
    : null;
  const feedbackDuplicateService = persistencePrisma
    ? new FeedbackDuplicateService(persistencePrisma, {
        feedbackFailureService: feedbackFailureService ?? undefined,
      })
    : null;
  const feedbackPromotionService = persistencePrisma
    ? new FeedbackPromotionService(persistencePrisma, {
        feedbackService: feedbackService ?? undefined,
        feedbackDuplicateService: feedbackDuplicateService ?? undefined,
        feedbackFailureService: feedbackFailureService ?? undefined,
      })
    : null;
  const feedbackAutomationService = persistencePrisma
    ? new FeedbackAutomationService(persistencePrisma, {
        feedbackService: feedbackService ?? undefined,
        feedbackDuplicateService: feedbackDuplicateService ?? undefined,
        feedbackPromotionService: feedbackPromotionService ?? undefined,
      })
    : null;

  const resolveUserId = (req: Request, res: Response): string | null => {
    if (authService) {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return null;
      }
      return userId;
    }

    return req.user?.userId || "default-user";
  };

  // Backward-compatible aliases — all three resolve identically.
  const resolveTodoUserId = resolveUserId;
  const resolveAiUserId = resolveUserId;
  const resolveProjectUserId = resolveUserId;

  const resolveAiUserPlan = async (
    userId: string,
  ): Promise<"free" | "pro" | "team"> => {
    if (!authService) {
      return "free";
    }
    const user = await authService.getUserById(userId);
    const plan = user?.plan;
    if (plan === "pro" || plan === "team") {
      return plan;
    }
    return "free";
  };

  const requireAuthIfConfigured: RequestHandler = authService
    ? authMiddleware(authService, providerAdmissionService)
    : (_req: Request, res: Response) => {
        res.status(501).json({ error: "Authentication not configured" });
      };

  app.set("trust proxy", 1);
  app.use(requestIdMiddleware);
  app.use(routeLatencyMiddleware);

  if (config.corsOrigins.length > 0) {
    app.use(
      cors({
        origin: (origin, callback) => {
          if (!origin || config.corsOrigins.includes(origin)) {
            return callback(null, true);
          }
          return callback(null, false);
        },
        credentials: true,
      }),
    );
  }

  app.use(express.json({ limit: config.requestBodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.formBodyLimit }));
  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https:"],
          scriptSrcAttr: ["'none'"],
        },
      },
    }),
  );

  app.use(
    "/vendor/chrono-node",
    express.static(
      path.join(__dirname, "../node_modules/chrono-node/dist/esm"),
    ),
  );

  // ── Static assets ───────────────────────────────────────────────────

  // React app (primary) at /app
  app.use("/app", express.static(path.join(__dirname, "../client-react/dist")));

  // React SPA fallbacks — serve dist/index.html for app routes
  const reactIndex = path.join(__dirname, "../client-react/dist/index.html");
  app.get("/app/{*path}", (_req: Request, res: Response) =>
    res.sendFile(reactIndex),
  );

  // React feedback page at /feedback and /feedback/new
  app.get("/feedback", (_req: Request, res: Response) =>
    res.sendFile(reactIndex),
  );
  app.get("/feedback/{*path}", (_req: Request, res: Response) =>
    res.sendFile(reactIndex),
  );

  // React landing page at / (serves dist-landing/)
  const landingIndex = path.join(
    __dirname,
    "../client-react/dist-landing/landing.html",
  );
  app.get("/", (_req: Request, res: Response) => {
    res.sendFile(landingIndex);
  });
  // Landing static assets (favicon, manifest, JS/CSS bundles)
  app.use(express.static(path.join(__dirname, "../client-react/dist-landing")));

  // React auth page at /auth (serves dist-auth/auth.html)
  const authIndex = path.join(__dirname, "../client-react/dist-auth/auth.html");
  app.get("/auth", (_req: Request, res: Response) => {
    res.sendFile(authIndex);
  });
  // Auth page static assets (only bundles + favicon — NOT API paths)
  app.use(
    "/auth/assets",
    express.static(path.join(__dirname, "../client-react/dist-auth/assets")),
  );

  // ── SPA fallbacks & standalone pages ────────────────────────────────

  app.use(createStaticPagesRouter());

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: ".swagger-ui .topbar { display: none }",
      customSiteTitle: "Todo API Documentation",
    }),
  );

  app.get("/api-docs.json", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });

  app.use("/api", createAgentProfileRouter());

  app.use("/api", apiLimiter);
  app.use("/api/agent-profiles", apiLimiter);
  app.use("/api/internal", apiLimiter);
  app.use("/todos", apiLimiter);
  app.use("/users", apiLimiter);
  app.use("/ai", apiLimiter);
  app.use("/projects", apiLimiter);
  app.use("/agent", apiLimiter);
  app.use("/mcp", apiLimiter);
  app.use("/capture", apiLimiter);
  app.use("/api/feedback", apiLimiter);
  app.use("/preferences", apiLimiter);
  app.use("/events", apiLimiter);
  app.use("/insights", apiLimiter);
  app.use("/calendar", apiLimiter);
  app.use("/areas", apiLimiter);
  app.use("/goals", apiLimiter);
  app.use("/plans", apiLimiter);
  app.use("/oauth", mcpPublicLimiter);
  app.use("/.well-known", mcpPublicLimiter);

  // Social / phone auth services (only instantiated when configured)
  const socialAuthService = persistencePrisma
    ? new SocialAuthService(persistencePrisma)
    : undefined;
  const googleAuthService = config.googleLoginEnabled
    ? new GoogleAuthService()
    : undefined;
  const appleAuthService = config.appleLoginEnabled
    ? new AppleAuthService()
    : undefined;
  const phoneAuthService =
    config.phoneLoginEnabled && persistencePrisma
      ? new PhoneAuthService(persistencePrisma)
      : undefined;

  app.use(
    "/auth",
    createAuthRouter({
      authService,
      mcpOAuthService,
      socialAuthService,
      googleAuthService,
      appleAuthService,
      phoneAuthService,
      authLimiter,
      emailActionLimiter,
      requireAuthIfConfigured,
    }),
  );

  app.use(
    createMcpPublicRouter({
      authService,
      mcpOAuthService,
      mcpClientService,
      googleAuthService,
      socialAuthService,
    }),
  );

  if (authService) {
    const auth = authMiddleware(authService, providerAdmissionService);
    const protectedRoutes = [
      "/todos",
      "/users",
      "/ai",
      "/projects",
      "/capture",
      "/api/feedback",
      "/preferences",
      "/events",
      "/insights",
      "/calendar",
      "/areas",
      "/goals",
      "/plans",
      "/adaptation",
      "/agent-activity",
    ];
    for (const route of protectedRoutes) {
      app.use(route, auth);
    }
    app.use(
      "/admin",
      authMiddleware(authService, providerAdmissionService, "admin"),
      adminMiddleware(authService),
    );
  }

  app.use(
    "/admin",
    createAdminRouter({
      authService,
      feedbackService: feedbackService ?? undefined,
      feedbackTriageService: feedbackTriageService ?? undefined,
      feedbackDuplicateService: feedbackDuplicateService ?? undefined,
      feedbackPromotionService: feedbackPromotionService ?? undefined,
      feedbackAutomationService: feedbackAutomationService ?? undefined,
      feedbackFailureService: feedbackFailureService ?? undefined,
    }),
  );
  app.use("/users", createUsersRouter({ authService, persistencePrisma }));
  app.use(
    "/todos",
    createTodosRouter({
      todoService,
      projectService,
      resolveTodoUserId,
    }),
  );
  app.use(
    "/calendar",
    createCalendarRouter({
      todoService,
      resolveUserId: resolveTodoUserId,
    }),
  );
  app.use(
    "/projects",
    createProjectsRouter({
      projectService,
      headingService,
      resolveProjectUserId,
    }),
  );
  app.use(
    "/ai",
    createAiRouter({
      todoService,
      resolveAiUserId,
      suggestionStore: runtimeAiSuggestionStore,
      aiPlannerService: runtimeAiPlannerService,
      aiDailySuggestionLimit,
      aiDailySuggestionLimitByPlan,
      resolveAiUserPlan,
      projectService,
      decisionAssistEnabled: aiDecisionAssistEnabled,
      persistencePrisma,
    }),
  );
  app.use(
    "/ai",
    createPrioritiesBriefRouter({
      todoService,
      projectService,
      resolveUserId: resolveAiUserId,
    }),
  );
  app.use(
    "/ai",
    createFocusBriefRouter({
      todoService,
      projectService,
      resolveUserId: resolveAiUserId,
    }),
  );
  app.use(
    "/agent",
    createAgentRouter({
      agentExecutor,
      authService,
      providerAdmissionService,
    }),
  );
  app.use("/api", createInternalAgentProfileRouter());
  app.use(
    "/mcp/app",
    createMcpAppRouter({
      agentExecutor,
      authService,
      mcpOAuthService,
      projectService,
      providerAdmissionService,
    }),
  );
  app.use(
    "/mcp",
    createMcpRouter({
      agentExecutor,
      authService,
      mcpOAuthService,
      providerAdmissionService,
    }),
  );

  if (captureService) {
    app.use("/capture", createCaptureRouter(captureService));
  }

  if (feedbackService) {
    app.use("/api/feedback", createFeedbackRouter({ feedbackService }));
  }

  if (persistencePrisma) {
    const planningPreferencesService = new PlanningPreferencesService(
      persistencePrisma,
    );
    app.use(
      "/preferences",
      createPreferencesRouter(planningPreferencesService),
    );

    const areaService = new AreaService(persistencePrisma);
    app.use(
      "/areas",
      createAreasRouter({
        areaService,
        resolveUserId: resolveAiUserId,
      }),
    );

    const goalService = new GoalService(persistencePrisma);
    app.use(
      "/goals",
      createGoalsRouter({
        goalService,
        resolveUserId: resolveAiUserId,
      }),
    );

    const enrollmentService = new AgentEnrollmentService(persistencePrisma);
    app.use(
      "/api/agent-enrollment",
      createAgentEnrollmentRouter({ enrollmentService, authService }),
    );

    const activityEventService = new ActivityEventService(persistencePrisma);
    app.use(
      "/events",
      createEventsRouter({
        activityEventService,
        resolveUserId: resolveAiUserId,
      }),
    );

    const insightsService = new InsightsService(persistencePrisma);
    const insightsComputeService = new InsightsComputeService(
      persistencePrisma,
    );
    app.use(
      "/insights",
      createInsightsRouter({
        insightsService,
        insightsComputeService,
        resolveUserId: resolveAiUserId,
      }),
    );

    // User-Level Adaptation System
    const adaptationService = new UserAdaptationService(
      persistencePrisma,
      activityEventService,
    );
    const llmInferenceService = new AdaptationLlmInferenceService();
    const projectInferenceService = new AdaptationProjectInferenceService(
      persistencePrisma,
      adaptationService,
      llmInferenceService,
    );
    app.use(
      "/adaptation",
      createAdaptationRouter({
        adaptationService,
        projectInferenceService,
        resolveUserId: resolveAiUserId,
      }),
    );

    const dayPlanService = new DayPlanService(persistencePrisma, todoService);
    app.use(
      "/plans",
      createDayPlanRouter({
        dayPlanService,
        resolveUserId,
      }),
    );

    const agentActivityService = new AgentActivityService(persistencePrisma);
    app.use(createAgentActivityRouter(agentActivityService));
  }

  app.use(errorHandler);

  return app;
}
