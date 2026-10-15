import { createHmac } from "node:crypto";
import type { ThemisConfig } from "./config.js";

export type AlertEvent = "pr_opened" | "run_completed" | "run_failed";

export interface AlertPayload {
  event: AlertEvent;
  repository: string;
  dependency?: string;
  verdict?: string;
  pr_url?: string;
  capsule_url?: string;
  timestamp: string;
}

export function signPayload(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Posts a signed JSON alert to ALERT_WEBHOOK_URL. Summary and links only, never logs or secrets.
 * Retries once; never throws, so an alert can never fail a run.
 */
export async function sendAlert(
  config: Pick<ThemisConfig, "alertWebhookUrl" | "alertWebhookSecret">,
  payload: Omit<AlertPayload, "timestamp">,
): Promise<{ sent: boolean; detail: string }> {
  if (!config.alertWebhookUrl) return { sent: false, detail: "ALERT_WEBHOOK_URL not set" };
  const body = JSON.stringify({ ...payload, timestamp: new Date().toISOString() });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "themis-alerts",
  };
  if (config.alertWebhookSecret)
    headers["x-themis-signature-256"] = signPayload(body, config.alertWebhookSecret);
  let detail = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(config.alertWebhookUrl, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { sent: true, detail: `HTTP ${res.status}` };
      detail = `HTTP ${res.status}`;
    } catch (err) {
      detail = (err as Error).message;
    }
  }
  return { sent: false, detail };
}
