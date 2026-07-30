import { isDBEnabled, getDB } from "@/lib/db";
import { listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";

/** Jurnalul de vizite al întregii agenții, cu filtre pe agent și perioadă. */
export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agent") ?? "";
  const days = Math.min(
    365,
    Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10) || 30),
  );
  const limit = Math.min(
    500,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100),
  );
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  try {
    const agents = await listOrgAgents(auth.session.orgId);
    const ids = agents.map((a) => a.agentId);
    // Filtrul de agent trebuie să fie DIN organizație — altfel ignorat.
    const scoped = agentId && ids.includes(agentId) ? [agentId] : ids;

    const rows = await db<
      Array<{
        id: string;
        agent_id: string;
        agent_name: string;
        cui: string;
        denumire: string;
        result: string;
        note: string;
        visited_at: Date;
      }>
    >`
      SELECT id::text, agent_id, agent_name, cui, denumire, result, note, visited_at
      FROM visits
      WHERE agent_id = ANY(${scoped.length ? scoped : [""]})
        AND visited_at >= NOW() - (${days} || ' days')::interval
      ORDER BY visited_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [{ count }] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM visits
      WHERE agent_id = ANY(${scoped.length ? scoped : [""]})
        AND visited_at >= NOW() - (${days} || ' days')::interval
    `;

    return Response.json({
      total: parseInt(count, 10),
      visits: rows.map((r) => ({
        id: r.id,
        agentId: r.agent_id,
        agentName: r.agent_name,
        cui: r.cui,
        denumire: r.denumire,
        result: r.result,
        note: r.note,
        visitedAt: r.visited_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error("[agentie visits]", e);
    return Response.json({ error: "Eroare la citirea vizitelor" }, { status: 500 });
  }
}
