import { NextResponse } from "next/server";
import { getRun } from "@/lib/data";
import { getSession } from "@/lib/session";

// Polled by the live agent timeline.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.token) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const run = await getRun(session.token, Number(id)).catch(() => undefined);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  return NextResponse.json(run, { headers: { "cache-control": "no-store" } });
}
