import { createHmac, timingSafeEqual } from "node:crypto";
import app from "@themis/github-app/app";
import { createProbot } from "probot";
import { env } from "@/lib/env";

// The GitHub App's webhook, served by the web app so one deployment handles sign-in, the UI and events.
let ready: Promise<ReturnType<typeof createProbot>> | undefined;
function probot() {
  ready ??= (async () => {
    const instance = createProbot({
      overrides: { appId: env.appId(), privateKey: env.privateKey(), secret: env.webhookSecret() },
    });
    await instance.load(app);
    return instance;
  })();
  return ready;
}

/** Constant-time check of GitHub's X-Hub-Signature-256 before any handler or App credential is touched. */
function signatureMatches(payload: string, signature: string): boolean {
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", env.webhookSecret()).update(payload).digest("hex")}`,
  );
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  const id = req.headers.get("x-github-delivery");
  const name = req.headers.get("x-github-event");
  const signature = req.headers.get("x-hub-signature-256");
  if (!id || !name || !signature) return new Response("Missing GitHub webhook headers", { status: 400 });
  const payload = await req.text();
  if (!signatureMatches(payload, signature)) return new Response("Signature does not match", { status: 401 });
  try {
    const instance = await probot();
    await instance.webhooks.receive({ id, name, payload: JSON.parse(payload) } as Parameters<
      typeof instance.webhooks.receive
    >[0]);
    return new Response("ok");
  } catch (err) {
    ready = undefined;
    console.error(`webhook ${name} ${id}: ${(err as Error).message}`);
    return new Response("Handler error", { status: 500 });
  }
}

export async function GET() {
  return new Response("Themis webhook endpoint. GitHub sends POST requests here.", { status: 200 });
}
