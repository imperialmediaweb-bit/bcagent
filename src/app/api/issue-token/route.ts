import { NextResponse } from "next/server";
import { signToken } from "@/lib/signed-token";
import { clientIP, rateLimit, timingSafeEqual } from "@/lib/rate-limit";

// Nodejs runtime ca să avem acces la rate-limit module-level state.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  const tokenSecret = process.env.TOKEN_SECRET;
  if (!adminSecret || !tokenSecret) {
    return NextResponse.json(
      { error: "Server not configured (ADMIN_SECRET / TOKEN_SECRET lipsesc)" },
      { status: 500 },
    );
  }

  // Rate limit pe IP — anti brute-force pe ADMIN_SECRET
  const ip = clientIP(req);
  const rl = rateLimit(`issue-token:${ip}`, { max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Prea multe încercări. Reîncearcă mai târziu." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      },
    );
  }

  const provided = req.headers.get("x-admin-secret") ?? "";
  if (!timingSafeEqual(provided, adminSecret)) {
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

  // Validare strictă input
  const agentId = String(body.agentId ?? "").trim();
  const agentName = String(body.agentName ?? "").trim();
  if (!agentId || !agentName) {
    return NextResponse.json(
      { error: "agentId și agentName sunt obligatorii" },
      { status: 400 },
    );
  }
  if (agentId.length > 64 || agentName.length > 128) {
    return NextResponse.json(
      { error: "agentId/agentName prea lung" },
      { status: 400 },
    );
  }
  // Limitez caracterele admise (anti-injection în UI / log)
  if (!/^[\w\-.@: ]+$/u.test(agentId)) {
    return NextResponse.json(
      { error: "agentId conține caractere nepermise" },
      { status: 400 },
    );
  }

  const ttlDays = Math.max(
    1,
    Math.min(365, Math.floor(Number(body.ttlDays ?? 30))),
  );
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const token = await signToken({ agentId, agentName, exp }, tokenSecret);
  const origin = new URL(req.url).origin;
  return NextResponse.json({
    token,
    url: `${origin}/a/${token}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  });
}
