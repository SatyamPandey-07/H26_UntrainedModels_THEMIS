import type { IncomingMessage, ServerResponse } from "node:http";
import { createNodeMiddleware, createProbot } from "probot";
import app from "../../dist/app.js";

// Vercel serverless entry. Probot reads APP_ID, PRIVATE_KEY and WEBHOOK_SECRET from the environment and
// verifies every delivery's signature before a handler runs.
const middleware = createNodeMiddleware(app, {
  probot: createProbot(),
  webhooksPath: "/api/github/webhooks",
});

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const handle = await middleware;
  const handled = await handle(req, res);
  if (!handled && !res.writableEnded) {
    res.statusCode = 404;
    res.end("Not found");
  }
}
