// =============================================================================
// llmService.ts — Provider-agnostic LLM text generation.
// Reads AI_PROVIDER_BASE_URL / AI_PROVIDER_API_KEY / AI_PROVIDER_MODEL
// from config — same env vars used by AiPlannerService / OpenAiCompatibleProvider.
// No additional dependencies. Works with any OpenAI-compatible endpoint.
// =============================================================================

import { config } from "../config";

export interface LlmCallOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

export class LlmProviderNotConfiguredError extends Error {
  constructor() {
    super(
      "AI provider not configured. Set AI_PROVIDER_ENABLED=true, " +
        "AI_PROVIDER_BASE_URL, AI_PROVIDER_API_KEY, and AI_PROVIDER_MODEL.",
    );
    this.name = "LlmProviderNotConfiguredError";
  }
}

/**
 * Call the configured LLM and return the response as a plain string.
 * Uses the same config fields as AiPlannerService / OpenAiCompatibleProvider.
 * Throws LlmProviderNotConfiguredError when env vars are absent.
 * Throws an Error on HTTP failure or empty response.
 */
export function assertLlmProviderConfigured(): void {
  if (!config.aiProviderEnabled || !config.aiProviderApiKey) {
    throw new LlmProviderNotConfiguredError();
  }
}

export async function callLlm(options: LlmCallOptions): Promise<string> {
  assertLlmProviderConfigured();

  const url = `${config.aiProviderBaseUrl}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.aiProviderApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiProviderModel,
      max_tokens: options.maxTokens ?? 1500,
      temperature: options.temperature ?? 0.3,
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `LLM call failed: HTTP ${response.status} from ${config.aiProviderBaseUrl}. ` +
        `Model: ${config.aiProviderModel}. Body: ${text.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) {
    throw new Error(
      `LLM returned empty content. Model: ${config.aiProviderModel}.`,
    );
  }

  return content;
}
