import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { audit, listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";

/**
 * Predarea portofoliului din panoul agenției (owner sau manager):
 * clienții/prospecții agentului care pleacă trec pe alt agent AL ACELEIAȘI
 * organizații, iar accesul celui vechi se blochează.
 */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;

  let body: { fromAgent?: string; toAgent?: string; deactivate?: boolean };
  try {
    await ensureSchema();
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
    const orgId = auth.session.orgId;
    // Ambii agenți trebuie să fie ai organizației — nu muți portofolii străine.
    const agents = await listOrgAgents(orgId);
    const names = new Set(agents.map((a) => a.name));
    if (!names.has(fromAgent) || !names.has(toAgent)) {
      return Response.json(
        { error: "Ambii agenți trebuie să fie din firma ta" },
        { status: 403 },
      );
    }

    const moved = await db`
      UPDATE prospects SET assigned_agent = ${toAgent}, updated_at = NOW()
      WHERE assigned_agent = ${fromAgent}
    `;
    if (body.deactivate !== false) {
      await db`
        UPDATE org_agents SET active = FALSE
        WHERE org_id = ${orgId} AND name = ${fromAgent}
      `;
    }
    await audit(auth.session.email, "agent.transfer", orgId, {
      fromAgent,
      toAgent,
      moved: moved.count,
    });
    return Response.json({ ok: true, moved: moved.count });
  } catch (e) {
    console.error("[agentie transfer]", e);
    return Response.json({ error: "Eroare la transfer" }, { status: 500 });
  }
}
