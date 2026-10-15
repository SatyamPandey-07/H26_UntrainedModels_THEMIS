import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
  groqApiKey: z
    .string({ error: "GROQ_API_KEY is not set (export it or add it to .env)" })
    .min(1, "GROQ_API_KEY is empty"),
  groqModel: z.string().min(1).default("openai/gpt-oss-120b"),
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

export function loadConfig(cwd: string = process.cwd()): ThemisConfig {
  const envFile = findDotenv(cwd);
  if (envFile) loadDotenv(envFile);
  const env = process.env;
  const result = ConfigSchema.safeParse({
    groqApiKey: env.GROQ_API_KEY,
    groqModel: emptyToUndefined(env.GROQ_MODEL),
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
