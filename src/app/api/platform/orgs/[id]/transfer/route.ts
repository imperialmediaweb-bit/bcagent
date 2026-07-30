import { isDBEnabled, getDB, ensureSchema } from "@/lib/db";
import { audit, getOrg, requireAdmin } from "@/modules/platform";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Predarea portofoliului când pleacă un agent:
 *   - toți prospecții/clienții alocați lui trec pe alt agent
 *   - agentul vechi e dezactivat (linkul magic moare instant)
 * Istoricul vizitelor și vânzărilor rămâne pe numele vechi — nu rescriem
 * trecutul, doar viitorul.
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;

  let body: { fromAgent?: string; toAgent?: string; deactivate?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const fromAgent = String(body.fromAgent ?? "").trim().slice(0, 128);
  const toAgent = String(body.toAgent ?? "").trim().slice(0, 128);
  if (!fromAgent || !toAgent || fromAgent === toAgent) {
    return Response.json(
      { error: "Alege agentul care predă și pe cel care preia" },
      { status: 400 },
    );
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const org = await getOrg(id);
    if (!org) return Response.json({ error: "Organizația nu există" }, { status: 404 });

    const moved = await db`
      UPDATE prospects SET assigned_agent = ${toAgent}, updated_at = NOW()
      WHERE assigned_agent = ${fromAgent}
    `;

    if (body.deactivate !== false) {
      // Blocare instantă: linkul magic al agentului plecat nu mai deschide nimic.
      await db`
        UPDATE org_agents SET active = FALSE
        WHERE org_id = ${id}
          AND (name = ${fromAgent} OR agent_id = ${fromAgent})
      `;
    }

    await audit(auth.session.email, "agent.transfer", id, {
      fromAgent,
      toAgent,
      moved: moved.count,
    });
    return Response.json({ ok: true, moved: moved.count });
  } catch (e) {
    console.error("[transfer]", e);
    return Response.json({ error: "Eroare la transfer" }, { status: 500 });
  }
}
