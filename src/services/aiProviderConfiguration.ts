import { config } from "../config";

export class LlmProviderNotConfiguredError extends Error {
  constructor() {
    super("AI provider is not configured or is disabled.");
    this.name = "LlmProviderNotConfiguredError";
  }
}

export function assertLlmProviderConfigured(): void {
  if (!config.aiProviderEnabled || !config.aiProviderApiKey) {
    throw new LlmProviderNotConfiguredError();
  }
}
