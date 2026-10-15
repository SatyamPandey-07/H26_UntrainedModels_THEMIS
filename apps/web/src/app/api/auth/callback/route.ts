import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getInstallations } from "@/lib/data";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const session = await getSession();
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason)}`, env.appUrl()));

  if (!code) return fail("GitHub did not return an authorization code.");
  // Installing the App from GitHub also lands here without our state; accept it only when no flow is pending.
  if (session.oauthState && state !== session.oauthState)
    return fail("The sign-in request expired. Please try again.");

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: env.clientId(), client_secret: env.clientSecret(), code }),
  });
  const token = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!token.access_token) return fail(token.error_description ?? "GitHub refused the sign-in.");

  const me = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/vnd.github+json" },
  });
  if (!me.ok) return fail("Could not read your GitHub profile.");
  const user = (await me.json()) as { login: string; name: string | null; avatar_url: string };

  session.user = { login: user.login, name: user.name, avatarUrl: user.avatar_url };
  session.token = token.access_token;
  session.refreshToken = token.refresh_token;
  session.expiresAt = token.expires_in ? Date.now() + token.expires_in * 1000 : undefined;
  const returnTo = session.returnTo;
  session.oauthState = undefined;
  session.returnTo = undefined;
  await session.save();

  let target = returnTo;
  if (!target) {
    const installs = await getInstallations(token.access_token).catch(() => []);
    target = installs.some((i) => i.repos.length > 0) ? "/dashboard" : "/onboarding";
  }
  return NextResponse.redirect(new URL(target, env.appUrl()));
}
