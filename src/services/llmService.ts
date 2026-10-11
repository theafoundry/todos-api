import { callAiProvider } from "./aiProviderClient";
export {
  LlmProviderNotConfiguredError,
  assertLlmProviderConfigured,
} from "./aiProviderConfiguration";

export interface LlmCallOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** Text inference uses the same authenticated durable boundary as JSON inference. */
export async function callLlm(options: LlmCallOptions): Promise<string> {
  return callAiProvider({ ...options, operation: "text_generation" });
}
