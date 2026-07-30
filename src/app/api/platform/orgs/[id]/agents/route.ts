import { isDBEnabled } from "@/lib/db";
import { signToken } from "@/lib/signed-token";
import {
  addOrgAgent,
  audit,
  getOrg,
  listOrgAgents,
  requireAdmin,
} from "@/modules/platform";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  return Response.json({ agents: await listOrgAgents(id) });
}

/** Activează / dezactivează un agent — dezactivarea blochează linkul instant. */
export async function PATCH(req: Request, ctx: Ctx) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;

  let body: { agentRowId?: string; active?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rowId = String(body.agentRowId ?? "");
  if (!rowId || typeof body.active !== "boolean") {
    return Response.json({ error: "agentRowId/active lipsesc" }, { status: 400 });
  }
  try {
    const { getDB } = await import("@/lib/db");
    const db = getDB();
    if (!db) return Response.json({ enabled: false }, { status: 503 });
    await db`
      UPDATE org_agents SET active = ${body.active}
      WHERE id = ${rowId} AND org_id = ${id}
    `;
    await audit(
      auth.session.email,
      body.active ? "agent.activate" : "agent.deactivate",
      rowId,
      { orgId: id },
    );
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[org agents PATCH]", e);
    return Response.json({ error: "Eroare la actualizare" }, { status: 500 });
  }
}

/**
 * Adaugă un agent organizației și emite linkul magic.
 * Respectă limita de agenți din planul organizației.
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    return Response.json({ error: "TOKEN_SECRET lipsește" }, { status: 500 });
  }
  const { id } = await ctx.params;

  let body: { agentId?: string; agentName?: string; ttlDays?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const agentId = String(body.agentId ?? "").trim().slice(0, 64);
  const agentName = String(body.agentName ?? "").trim().slice(0, 120);
  if (!agentId || !agentName) {
    return Response.json({ error: "ID și nume agent obligatorii" }, { status: 400 });
  }
  const ttlDays = Math.min(365, Math.max(1, Number(body.ttlDays) || 30));

  try {
    const org = await getOrg(id);
    if (!org) return Response.json({ error: "Organizația nu există" }, { status: 404 });

    const existing = await listOrgAgents(id);
    const isNew = !existing.some((a) => a.agentId === agentId);
    if (isNew && existing.filter((a) => a.active).length >= org.agentLimit) {
      return Response.json(
        {
          error: `Limita planului: ${org.agentLimit} agenți. Treci organizația pe un plan superior.`,
        },
        { status: 409 },
      );
    }

    await addOrgAgent(id, agentId, agentName);
    const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
    const token = await signToken({ agentId, agentName, exp }, secret);
    const origin = new URL(req.url).origin;
    await audit(auth.session.email, "agent.token", agentId, { orgId: id, ttlDays });

    return Response.json({
      token,
      url: `${origin}/a/${token}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    });
  } catch (e) {
    console.error("[org agents POST]", e);
    return Response.json({ error: "Eroare la emiterea linkului" }, { status: 500 });
  }
}
