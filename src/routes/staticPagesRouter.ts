/**
 * Static page routes — serves standalone HTML pages at product URLs.
 *
 * NOTE: The primary product surfaces are served by React builds in app.ts.
 * This router owns small standalone policy, support, verification, and
 * compatibility responses that must remain available without a client build.
 */

import { Router, Request, Response } from "express";
import path from "path";
import {
  buildPrivacyPage,
  buildSupportPage,
  buildTermsPage,
} from "../views/publicReviewPages";

export interface StaticPagesRouterOptions {
  domainVerificationToken?: string | null;
}

function normalizeVerificationToken(value: string | null | undefined) {
  if (!value || value !== value.trim() || /[\r\n]/.test(value)) return null;
  return value;
}

export function createStaticPagesRouter(
  options: StaticPagesRouterOptions = {},
): Router {
  const router = Router();
  const configuredVerificationToken = Object.prototype.hasOwnProperty.call(
    options,
    "domainVerificationToken",
  )
    ? options.domainVerificationToken
    : process.env.DOMAIN_VERIFICATION_TOKEN;
  const domainVerificationToken = normalizeVerificationToken(
    configuredVerificationToken,
  );

  router.get("/review/todos-chatgpt-demo-v1.mp4", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("video/mp4");
    res.sendFile(
      path.join(
        __dirname,
        "../../docs/review/assets/todos-chatgpt-demo-v1.mp4",
      ),
    );
  });

  router.get(
    "/.well-known/openai-apps-challenge",
    (_req: Request, res: Response) => {
      if (!domainVerificationToken) return res.status(404).end();
      return res
        .status(200)
        .type("text/plain")
        .set("Cache-Control", "no-store")
        .send(domainVerificationToken);
    },
  );

  router.get("/privacy", (_req: Request, res: Response) =>
    res.status(200).type("html").send(buildPrivacyPage()),
  );
  router.get("/terms", (_req: Request, res: Response) =>
    res.status(200).type("html").send(buildTermsPage()),
  );
  router.get("/support", (_req: Request, res: Response) =>
    res.status(200).type("html").send(buildSupportPage()),
  );

  // Compatibility redirects — preserve old /app-react links (302 for rollback safety)
  router.get("/app-react", (_req: Request, res: Response) =>
    res.redirect(302, "/app"),
  );
  router.get("/app-react/{*path}", (req: Request, res: Response) => {
    const subPath = (req.params as Record<string, string>)["0"] || "";
    res.redirect(302, `/app/${subPath}`);
  });

  return router;
}
