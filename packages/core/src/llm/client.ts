import { requireGroqKey } from "../config.js";
import type { ThemisConfig } from "../config.js";
import { GroqPool } from "./pool.js";
import type { PoolOptions } from "./pool.js";

export * from "./types.js";
export { LlmExhaustedError, PromptTooLargeError } from "./errors.js";
export { COMPLETION_TOKENS, GroqPool, parseDurationMs, parseRequestLimit } from "./pool.js";

type GroqConfig = Pick<ThemisConfig, "groqApiKey" | "groqApiKeys" | "groqModel" | "groqFallbackModels">;

/** Pool options from the Themis config: every configured key, primary model first, then the fallbacks. */
export function poolOptions(config: GroqConfig): PoolOptions {
  const keys = config.groqApiKeys?.length ? config.groqApiKeys : config.groqApiKey ? [config.groqApiKey] : [];
  if (keys.length === 0) requireGroqKey(config as ThemisConfig); // throws the actionable missing-key error
  const models = [config.groqModel, ...(config.groqFallbackModels ?? [])].filter(
    (m, i, all) => all.indexOf(m) === i,
  );
  const maxWait = Number(process.env.THEMIS_GROQ_MAX_WAIT_SECONDS);
  const tpm = Number(process.env.THEMIS_TPM_LIMIT);
  return {
    keys,
    models,
    maxWaitMs: Number.isFinite(maxWait) && maxWait > 0 ? maxWait * 1000 : undefined,
    tpmLimit: Number.isFinite(tpm) && tpm > 0 ? tpm : undefined,
  };
}

/**
 * The Groq client used by every agent: all configured API keys, each with the primary model and then the
 * fallback models, switching slots the moment one is rate limited.
 */
export class GroqClient extends GroqPool {
  constructor(config: GroqConfig) {
    super(poolOptions(config));
  }
}
