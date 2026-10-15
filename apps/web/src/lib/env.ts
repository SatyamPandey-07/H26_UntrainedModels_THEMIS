import "server-only";

function read(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function requireEnv(name: string): string {
  const v = read(name);
  if (!v) throw new Error(`${name} is not set; see apps/web/.env.example`);
  return v;
}

export const env = {
  appUrl: () => read("APP_URL") ?? "http://localhost:3000",
  clientId: () => requireEnv("GITHUB_CLIENT_ID"),
  clientSecret: () => requireEnv("GITHUB_CLIENT_SECRET"),
  sessionSecret: () => requireEnv("SESSION_SECRET"),
  appId: () => requireEnv("APP_ID"),
  // Vercel stores multi-line values fine; also accept "\n"-escaped single-line keys.
  privateKey: () => requireEnv("PRIVATE_KEY").replace(/\\n/g, "\n"),
  webhookSecret: () => requireEnv("WEBHOOK_SECRET"),
  runnerRepo: () => read("RUNNER_REPO") ?? "SatyamPandey-07/H26_UntrainedModels_THEMIS",
  appSlug: () => read("APP_SLUG") ?? "themis-migrations",
};
