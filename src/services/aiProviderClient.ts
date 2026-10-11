import { createHash } from "node:crypto";
import { config } from "../config";
import { assertLlmProviderConfigured } from "./aiProviderConfiguration";
import { AiProviderAdmissionError } from "./aiProviderAdmissionService";
import {
  getAiProviderAdmission,
  getAiProviderContext,
  nextAiProviderAdmissionKey,
} from "./aiProviderContext";

export interface AiProviderCallOptions {
  operation: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  signal?: AbortSignal;
}

const safePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function unavailable(code: string, message: string): AiProviderAdmissionError {
  return new AiProviderAdmissionError({ code, message, statusCode: 503 });
}

/** Integer microUSD, rounded up. No floats, tokenizer estimate, or unverified price default. */
export function calculateProviderCostMicros(
  inputTokens: number,
  outputTokens: number,
  inputRate: number,
  outputRate: number,
): number {
  for (const value of [inputTokens, outputTokens, inputRate, outputRate]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw unavailable(
        "AI_PROVIDER_INVALID_USAGE",
        "Hosted AI usage requires review",
      );
    }
  }
  const total =
    BigInt(inputTokens) * BigInt(inputRate) +
    BigInt(outputTokens) * BigInt(outputRate);
  const micros = (total + 999_999n) / 1_000_000n;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw unavailable(
      "AI_PROVIDER_INVALID_USAGE",
      "Hosted AI usage exceeds accounting bounds",
    );
  }
  return Number(micros);
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) throw new Error("AI provider returned no response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("AI provider response exceeds its configured bound");
      }
      chunks.push(result.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

/** The only production backend provider HTTP boundary. Exactly one admitted attempt; no retry. */
export async function callAiProvider(
  options: AiProviderCallOptions,
): Promise<string> {
  assertLlmProviderConfigured();
  options.signal?.throwIfAborted();
  const context = getAiProviderContext();
  const admission = getAiProviderAdmission();
  if (!context || !admission) {
    throw unavailable(
      "AI_PROVIDER_AUTH_CONTEXT_REQUIRED",
      "Hosted AI requires authenticated durable admission",
    );
  }
  // Snapshot request and billing identity before admission; mutation during a call cannot reprice it.
  const snapshot = {
    model: config.aiProviderModel,
    baseUrl: config.aiProviderBaseUrl,
    apiKey: config.aiProviderApiKey,
    inputCeiling: config.aiProviderInputTokenCeiling,
    inputRate: config.aiProviderInputPriceMicrosPerMillionTokens,
    outputRate: config.aiProviderOutputPriceMicrosPerMillionTokens,
    maxPromptBytes: config.aiProviderMaxPromptBytes,
    maxResponseBytes: config.aiProviderMaxResponseBytes,
    timeoutMs: config.aiProviderTimeoutMs,
    outputCap: config.aiProviderMaxOutputTokens,
  };
  if (
    config.aiProviderBillingModel !== snapshot.model ||
    config.aiProviderBillingBaseUrl !== snapshot.baseUrl ||
    ![
      snapshot.inputCeiling,
      snapshot.inputRate,
      snapshot.outputRate,
      snapshot.maxPromptBytes,
      snapshot.maxResponseBytes,
      snapshot.timeoutMs,
      snapshot.outputCap,
    ].every(safePositive)
  ) {
    throw unavailable(
      "AI_PROVIDER_PRICING_UNCONFIGURED",
      "Hosted AI needs verified model pricing and bounds",
    );
  }
  if (options.maxTokens !== undefined && !safePositive(options.maxTokens)) {
    throw unavailable(
      "AI_PROVIDER_INVALID_REQUEST",
      "Hosted AI output bound is invalid",
    );
  }
  const maxTokens = Math.min(
    options.maxTokens ?? snapshot.outputCap,
    snapshot.outputCap,
  );
  const temperature = options.temperature ?? 0.3;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw unavailable(
      "AI_PROVIDER_INVALID_REQUEST",
      "Hosted AI request options are invalid",
    );
  }
  const body = JSON.stringify({
    model: snapshot.model,
    max_tokens: maxTokens,
    temperature,
    ...(options.json ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPrompt },
    ],
  });
  if (Buffer.byteLength(body, "utf8") > snapshot.maxPromptBytes) {
    throw unavailable(
      "AI_PROVIDER_INPUT_BOUND",
      "Hosted AI context exceeds its configured bound",
    );
  }
  // Reserve the VERIFIED full model input ceiling, not a characters→tokens guess.
  const maxCostMicros = calculateProviderCostMicros(
    snapshot.inputCeiling!,
    maxTokens,
    snapshot.inputRate!,
    snapshot.outputRate!,
  );
  const requestKey = nextAiProviderAdmissionKey(options.operation);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        body,
        baseUrl: snapshot.baseUrl,
        inputCeiling: snapshot.inputCeiling,
        inputRate: snapshot.inputRate,
        outputRate: snapshot.outputRate,
      }),
    )
    .digest("hex");
  const accepted = await admission.reserve({
    userId: context.userId,
    requestKey,
    fingerprint,
    maxCostMicros,
  });
  if (accepted.kind !== "new") {
    throw new AiProviderAdmissionError({
      code: "AI_PROVIDER_REQUEST_ALREADY_ADMITTED",
      statusCode: 429,
      message:
        "This hosted AI request was already admitted; it will not be repeated",
    });
  }
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("AI provider deadline reached")),
    snapshot.timeoutMs,
  );
  let dispatched = false;
  let ended = false;
  let actualCostMicros: number | undefined;
  let usageBoundBreached = false;
  try {
    assertLlmProviderConfigured();
    options.signal?.throwIfAborted();
    dispatched = true;
    const response = await fetch(`${snapshot.baseUrl}/chat/completions`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${snapshot.apiKey}`,
      },
      body,
    });
    const responseText = await readBoundedResponse(
      response,
      snapshot.maxResponseBytes,
    );
    ended = true;
    if (!response.ok)
      throw new Error(
        `AI provider request failed with status ${response.status}`,
      );
    const data = JSON.parse(responseText) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    if (data.usage !== undefined) {
      const input = data.usage?.prompt_tokens;
      const output = data.usage?.completion_tokens;
      if (
        typeof input !== "number" ||
        typeof output !== "number" ||
        !Number.isSafeInteger(input) ||
        !Number.isSafeInteger(output) ||
        input < 0 ||
        output < 0
      ) {
        usageBoundBreached = true;
      } else {
        usageBoundBreached =
          input > snapshot.inputCeiling! || output > maxTokens;
        try {
          actualCostMicros = calculateProviderCostMicros(
            input,
            output,
            snapshot.inputRate!,
            snapshot.outputRate!,
          );
        } catch {
          usageBoundBreached = true;
        }
      }
    }
    if (usageBoundBreached)
      throw unavailable(
        "AI_PROVIDER_USAGE_BOUND_BREACHED",
        "Hosted AI usage bounds require operator review",
      );
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content)
      throw new Error("AI provider returned empty content");
    return content;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    // A failed settlement leaves its durable reservation held; no retry or optimistic refund.
    const settlement = await admission.settle({
      reservationId: accepted.reservation.id,
      userId: context.userId,
      outcome: !dispatched || ended ? "completed" : "uncertain",
      actualCostMicros: !dispatched ? 0 : actualCostMicros,
      usageBoundBreached,
    });
    if (settlement.exceededReservation) {
      throw unavailable(
        "AI_PROVIDER_COST_BOUND_BREACHED",
        "Hosted AI spending bounds require operator review",
      );
    }
  }
}
