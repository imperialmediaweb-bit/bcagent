import { NextResponse } from "next/server";
import { signToken } from "@/lib/signed-token";

export const runtime = "edge";

export async function POST(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  const tokenSecret = process.env.TOKEN_SECRET;
  if (!adminSecret || !tokenSecret) {
    return NextResponse.json(
      { error: "Server not configured (ADMIN_SECRET / TOKEN_SECRET lipsesc)" },
      { status: 500 },
    );
  }
  if (req.headers.get("x-admin-secret") !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { agentId?: string; agentName?: string; ttlDays?: number };
  try {
    body = (await req.json()) as {
      agentId?: string;
      agentName?: string;
      ttlDays?: number;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.agentId || !body.agentName) {
    return NextResponse.json(
      { error: "agentId and agentName required" },
      { status: 400 },
    );
  }
  const ttlDays = body.ttlDays ?? 30;
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const token = await signToken(
    { agentId: body.agentId, agentName: body.agentName, exp },
    tokenSecret,
  );
  const origin = new URL(req.url).origin;
  return NextResponse.json({
    token,
    url: `${origin}/a/${token}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  });
}
