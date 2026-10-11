import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { AiProviderAdmissionService } from "./aiProviderAdmissionService";

export type AiProviderSource =
  | "application"
  | "admin"
  | "agent"
  | "legacy-mcp"
  | "native-mcp";

export interface AiProviderContext {
  readonly userId: string;
  readonly source: AiProviderSource;
  readonly requestKey: string;
}

interface AiProviderFrame {
  readonly context: AiProviderContext;
  readonly admissionService?: AiProviderAdmissionService;
  callOrdinal: number;
}

const storage = new AsyncLocalStorage<AiProviderFrame | undefined>();
const sources = new Set<AiProviderSource>([
  "application",
  "admin",
  "agent",
  "legacy-mcp",
  "native-mcp",
]);

/** Establish identity only after authentication, using server-owned dependencies. */
export function runWithAiProviderContext<T>(
  input: { userId: string; source: AiProviderSource },
  fn: () => T,
  admissionService?: AiProviderAdmissionService,
): T {
  if (
    typeof input.userId !== "string" ||
    !input.userId.trim() ||
    input.userId !== input.userId.trim() ||
    !sources.has(input.source)
  ) {
    throw new Error("A verified account and provider source are required");
  }
  return storage.run(
    {
      context: Object.freeze({
        userId: input.userId,
        source: input.source,
        requestKey: randomUUID(),
      }),
      admissionService,
      callOrdinal: 0,
    },
    fn,
  );
}

export function getAiProviderContext(): AiProviderContext | undefined {
  return storage.getStore()?.context;
}

export function getAiProviderAdmission():
  | AiProviderAdmissionService
  | undefined {
  return storage.getStore()?.admissionService;
}

/** Each actual dispatch gets a distinct key; caller-owned retry IDs are excluded. */
export function nextAiProviderAdmissionKey(operation: string): string {
  const frame = storage.getStore();
  if (!frame) {
    throw new Error("Authenticated provider context is required");
  }
  if (
    typeof operation !== "string" ||
    !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,99}$/.test(operation)
  ) {
    throw new Error("A bounded server provider operation is required");
  }
  if (frame.callOrdinal >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Provider admission sequence exhausted");
  }
  frame.callOrdinal += 1;
  return createHash("sha256")
    .update(
      JSON.stringify([
        frame.context.requestKey,
        frame.context.source,
        operation,
        frame.callOrdinal,
      ]),
    )
    .digest("hex");
}

/** Preserve the exact frame and allocator, or explicitly clear ambient identity. */
export function bindAiProviderContext<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const frame = storage.getStore();
  return (...args: Args) => storage.run(frame, () => fn(...args));
}
