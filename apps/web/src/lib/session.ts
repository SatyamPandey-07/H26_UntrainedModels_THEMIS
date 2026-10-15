import "server-only";
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "./env";

export interface SessionUser {
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface SessionData {
  user?: SessionUser;
  /** GitHub App user-to-server token; acts with the App's permissions limited to what the user can access. */
  token?: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt?: number;
  oauthState?: string;
  returnTo?: string;
}

function options(): SessionOptions {
  return {
    password: env.sessionSecret(),
    cookieName: "themis_session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), options());
}

/** Exchanges the refresh token when the user token is about to expire (GitHub App user tokens last 8 hours). */
async function refreshIfNeeded(session: Awaited<ReturnType<typeof getSession>>): Promise<void> {
  if (!session.expiresAt || !session.refreshToken || session.expiresAt - Date.now() > 5 * 60_000) return;
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.clientId(),
      client_secret: env.clientSecret(),
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    }),
  });
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!body.access_token) {
    session.destroy();
    return;
  }
  session.token = body.access_token;
  session.refreshToken = body.refresh_token ?? session.refreshToken;
  session.expiresAt = body.expires_in ? Date.now() + body.expires_in * 1000 : undefined;
  await session.save();
}

/** The signed-in user and token, or a redirect to sign-in. */
export async function requireUser(returnTo = "/dashboard"): Promise<{ user: SessionUser; token: string }> {
  const session = await getSession();
  await refreshIfNeeded(session).catch(() => undefined);
  if (!session.user || !session.token) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return { user: session.user, token: session.token };
}
