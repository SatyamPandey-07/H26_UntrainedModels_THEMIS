import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";

// Starts "Sign in with GitHub" using the Themis App's OAuth client, so one App covers sign-in and repo access.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const state = randomBytes(16).toString("hex");
  session.oauthState = state;
  const next = req.nextUrl.searchParams.get("next");
  session.returnTo = next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
  await session.save();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.clientId());
  url.searchParams.set("redirect_uri", `${env.appUrl()}/api/auth/callback`);
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
