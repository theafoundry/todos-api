import { Router, Request, Response, NextFunction } from "express";
import { CaptureService } from "../services/captureService";
import { validateId, ValidationError } from "../validation/validation";

function requireWebReviewSession(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.user?.tokenType !== undefined) {
    res.status(403).json({
      error: "Review captures using a signed-in web session",
    });
    return;
  }
  next();
}

export function createCaptureRouter(captureService: CaptureService): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const { text, source, capturedAt } = req.body;
      if (!text || typeof text !== "string") {
        res.status(400).json({ error: "text is required" });
        return;
      }
      const item = await captureService.create(
        userId,
        text.trim(),
        source,
        capturedAt ? new Date(capturedAt) : undefined,
      );
      res.status(201).json(item);
    } catch (error) {
      next(error);
    }
  });

  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const lifecycleRaw = req.query.lifecycle;
      const lifecycle =
        typeof lifecycleRaw === "string" ? lifecycleRaw : undefined;
      if (req.query.review !== undefined && req.query.review !== "pending") {
        throw new ValidationError("review must be pending");
      }
      const items =
        req.query.review === "pending"
          ? await captureService.findPendingReview(userId)
          : await captureService.findAll(
              userId,
              lifecycle as "new" | "triaged" | "discarded" | undefined,
            );
      res.json(items);
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/:id/accept",
    requireWebReviewSession,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const id = req.params.id as string;
        validateId(id);
        const body = req.body ?? {};
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => key !== "title")
        ) {
          throw new ValidationError(
            "Only title may be supplied when accepting a capture",
          );
        }
        if (
          body.title !== undefined &&
          (typeof body.title !== "string" ||
            !body.title.trim() ||
            body.title.trim().length > 200)
        ) {
          throw new ValidationError("title must contain 1 to 200 characters");
        }
        const result = await captureService.acceptAsTask(
          userId,
          id,
          body.title,
        );
        return res.status(result.created ? 201 : 200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/:id/discard",
    requireWebReviewSession,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const id = req.params.id as string;
        validateId(id);
        return res.json(await captureService.discard(userId, id));
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/:id",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.userId;
        if (!userId) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        const id = req.params.id as string;
        const item = await captureService.findById(userId, id);
        if (!item) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        res.json(item);
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/:id",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.userId;
        if (!userId) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        const { lifecycle, triageResult } = req.body as {
          lifecycle: unknown;
          triageResult: unknown;
        };
        const validLifecycles = ["new", "triaged", "discarded"] as const;
        if (
          !lifecycle ||
          typeof lifecycle !== "string" ||
          !validLifecycles.includes(
            lifecycle as "new" | "triaged" | "discarded",
          )
        ) {
          res.status(400).json({
            error: "lifecycle must be new, triaged, or discarded",
          });
          return;
        }
        const id = req.params.id as string;
        const item = await captureService.updateLifecycle(
          userId,
          id,
          lifecycle as "new" | "triaged" | "discarded",
          triageResult,
          { allowRestore: lifecycle !== "discarded" },
        );
        if (!item) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        res.json(item);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
