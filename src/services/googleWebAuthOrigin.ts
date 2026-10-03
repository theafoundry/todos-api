import type { Request } from "express";
import { config } from "../config";

const PRODUCTION_WEB_ORIGINS = [
  "https://todos.theafoundry.com",
  "https://www.planwren.com",
];
const CALLBACK_PATH = "/auth/google/callback";

/** Select an explicit permitted callback on the host that owns the state cookie. */
export function resolveGoogleWebRedirectUri(req: Request): string | null {
  const host = req.get("host")?.toLowerCase();
  if (!host) {
    return null;
  }

  if (config.nodeEnv === "production") {
    if (!req.secure) {
      return null;
    }
    const origin = PRODUCTION_WEB_ORIGINS.find((candidate) => {
      const allowedHost = new URL(candidate).host;
      return host === allowedHost || host === `${allowedHost}:443`;
    });
    return origin ? `${origin}${CALLBACK_PATH}` : null;
  }

  // Local development retains its explicitly configured callback. Headers can
  // match that origin, but cannot introduce an unconfigured origin or path.
  try {
    const callback = new URL(config.googleRedirectUri);
    if (
      !["http:", "https:"].includes(callback.protocol) ||
      callback.username ||
      callback.password ||
      callback.pathname !== CALLBACK_PATH ||
      callback.search ||
      callback.hash ||
      host !== callback.host.toLowerCase() ||
      `${req.protocol}:` !== callback.protocol
    ) {
      return null;
    }
    return callback.href;
  } catch {
    return null;
  }
}
