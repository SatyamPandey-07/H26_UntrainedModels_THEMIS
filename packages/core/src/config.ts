import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
  /** Optional: without it, scans run without model rationales and the plugin uses Claude Code as the model. */
  groqApiKey: z.string().min(1).optional(),
  /**
   * Every configured key, in order: GROQ_API_KEY_1..N, then GROQ_API_KEYS (comma separated), then GROQ_API_KEY.
   * `groqApiKey` is the first of these.
   */
  groqApiKeys: z.array(z.string().min(1)).default([]),
  groqModel: z.string().min(1).default("openai/gpt-oss-120b"),
  /** Models tried, in order, after the primary on each key. `GROQ_FALLBACK_MODEL=none` disables them. */
  groqFallbackModels: z.array(z.string().min(1)).default(["qwen/qwen3.8-27b"]),
  retryCap: z.coerce.number().int().min(0).max(10).default(2),
  maxOpenPrs: z.coerce.number().int().min(1).max(50).default(3),
  alertWebhookUrl: z.url().optional(),
  alertWebhookSecret: z.string().optional(),
});

export type ThemisConfig = z.infer<typeof ConfigSchema>;

/** Parses a dotenv file without overriding variables already set in the environment. */
function loadDotenv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match as unknown as [string, string, string];
    const value = raw.replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Walks up from `start` to find the nearest `.env`. */
function findDotenv(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const emptyToUndefined = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v);

/** GROQ_API_KEY_1..N in numeric order, then the comma separated GROQ_API_KEYS, then GROQ_API_KEY; de-duplicated. */
export function collectGroqKeys(env: NodeJS.ProcessEnv): string[] {
  const numbered = Object.keys(env)
    .map((k) => ({ k, m: /^GROQ_API_KEY_(\d+)$/.exec(k) }))
    .filter((x): x is { k: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map((x) => env[x.k]);
  const list = (env.GROQ_API_KEYS ?? "").split(/[\s,]+/);
  const all = [...numbered, ...list, env.GROQ_API_KEY]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v));
  return [...new Set(all)];
}

function fallbackModels(value: string | undefined): string[] | undefined {
  const v = emptyToUndefined(value);
  if (v === undefined) return undefined;
  if (/^(none|off|false)$/i.test(v.trim())) return [];
  return v
    .split(/[\s,]+/)
    .map((m) => m.trim())
    .filter(Boolean);
}

export function loadConfig(cwd: string = process.cwd()): ThemisConfig {
  const envFile = findDotenv(cwd);
  if (envFile) loadDotenv(envFile);
  const env = process.env;
  const groqApiKeys = collectGroqKeys(env);
  const result = ConfigSchema.safeParse({
    groqApiKey: groqApiKeys[0],
    groqApiKeys,
    groqModel: emptyToUndefined(env.GROQ_MODEL),
    groqFallbackModels: fallbackModels(env.GROQ_FALLBACK_MODEL),
    retryCap: emptyToUndefined(env.THEMIS_RETRY_CAP),
    maxOpenPrs: emptyToUndefined(env.THEMIS_MAX_OPEN_PRS),
    alertWebhookUrl: emptyToUndefined(env.ALERT_WEBHOOK_URL),
    alertWebhookSecret: emptyToUndefined(env.ALERT_WEBHOOK_SECRET),
  });
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid Themis configuration: ${issues}`);
  }
  return result.data;
}

/** Environment passed to child processes: never carries Themis or GitHub secrets. */
export function scrubbedEnv(extra: Record<string, string> = {}): Record<string, string> {
  const blocked = /^(GROQ_|ALERT_WEBHOOK|WEBHOOK_SECRET|PRIVATE_KEY|APP_ID|GITHUB_TOKEN|GH_TOKEN)/;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !blocked.test(k)) out[k] = v;
  }
  return { ...out, ...extra };
}

/** The Groq key, or a clear error for commands that need a model. */
export function requireGroqKey(config: ThemisConfig): string {
  if (!config.groqApiKey)
    throw new Error(
      "No Groq API key is set (GROQ_API_KEY, or GROQ_API_KEY_1..N). Export one or add it to .env, or use the step commands (map, plan --from, branch, commit, tests, verify) with Claude Code as the model.",
    );
  return config.groqApiKey;
}
