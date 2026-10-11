import { Router, Request, Response, NextFunction } from "express";
import { UserAdaptationService } from "../services/userAdaptationService";
import { AdaptationProjectInferenceService } from "../services/adaptationProjectInferenceService";
import {
  AdaptationFlags,
  getDefaultFlags,
  isUserEligible,
  applyKillSwitches,
} from "../services/adaptationFlags";
import { createLogger } from "../infra/logging/logger";

const log = createLogger("adaptationRouter");

// ─── Types ──────────────────────────────────────────────────────────────────

interface AdaptationRouterDeps {
  adaptationService: UserAdaptationService;
  projectInferenceService?: AdaptationProjectInferenceService;
  flags?: AdaptationFlags;
  resolveUserId: (req: Request, res: Response) => string | null;
}

// ─── Router Factory ─────────────────────────────────────────────────────────

export function createAdaptationRouter({
  adaptationService,
  projectInferenceService,
  flags,
  resolveUserId,
}: AdaptationRouterDeps): Router {
  const router = Router();
  const activeFlags = flags ?? getDefaultFlags();

  /**
   * GET /adaptation/profile
   * Returns the current user's adaptation profile.
   * Recomputes lazily if the stored profile is stale (>24h).
   */
  router.get(
    "/profile",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = resolveUserId(req, res);
        if (!userId) return;

        const result = await adaptationService.getOrCreateProfile(userId);

        // Apply kill switches before returning
        const profile = applyKillSwitches(result.profile, activeFlags);

        // Check rollout eligibility
        const flagEligible = isUserEligible(userId, activeFlags);
        if (!flagEligible && activeFlags.enabled) {
          // User is not in rollout — return cold-start profile
          log.info("User not in rollout", { userId });
        }

        res.json(profile);
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * POST /adaptation/profile/compute
   * Forces recomputation of the user's adaptation profile.
   * Admin/debug endpoint — not for production client use.
   */
  router.post(
    "/profile/compute",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = resolveUserId(req, res);
        if (!userId) return;

        const result = await adaptationService.computeProfile(userId);
        const profile = applyKillSwitches(result.profile, activeFlags);

        log.info("Forced profile recomputation", {
          userId,
          confidence: profile.confidence,
          eligibility: profile.eligibility,
        });

        res.json(profile);
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * GET /adaptation/flags
   * Returns current feature flag / kill switch state.
   */
  router.get(
    "/flags",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json({
          ...activeFlags,
          // Don't expose the allowlist in production
          eligibleUserIds: activeFlags.eligibleUserIds
            ? `[${activeFlags.eligibleUserIds.length} users]`
            : undefined,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * GET /adaptation/projects/:projectId/soft-inference
   * Returns LLM-based soft inference for a project.
   * Only used when behavioral confidence is low (< 0.4).
   * Never feeds the UserAdaptationProfile directly — advisory only.
   */
  router.get(
    "/projects/:projectId/soft-inference",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = resolveUserId(req, res);
        if (!userId) return;

        const projectId = req.params.projectId;
        if (Array.isArray(projectId)) {
          return res.status(400).json({ error: "Invalid project ID" });
        }

        if (!projectInferenceService) {
          return res.status(503).json({
            error: "LLM inference not configured",
            inference: null,
          });
        }

        const result = await projectInferenceService.getSoftInference(
          userId,
          projectId,
          activeFlags,
        );
        res.status(result.status).json(result.body);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
