import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { getOrg, listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";

/**
 * Dashboard-ul agenției: KPI-uri + activitatea agenților, totul scoped
 * pe agenții organizației (prin org_agents).
 */
export async function GET() {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const { orgId } = auth.session;

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();
    const [org, agents] = await Promise.all([getOrg(orgId), listOrgAgents(orgId)]);
    if (!org) return Response.json({ error: "Organizația nu există" }, { status: 404 });
    const agentIds = agents.map((a) => a.agentId);
    const agentNames = agents.map((a) => a.name);

    const [visitStats] = await db<
      [{ azi: string; saptamana: string; luna: string }]
    >`
      SELECT
        COUNT(*) FILTER (WHERE visited_at >= date_trunc('day', NOW()))::text AS azi,
        COUNT(*) FILTER (WHERE visited_at >= date_trunc('week', NOW()))::text AS saptamana,
        COUNT(*) FILTER (WHERE visited_at >= date_trunc('month', NOW()))::text AS luna
      FROM visits
      WHERE agent_id = ANY(${agentIds.length ? agentIds : [""]})
    `;

    const [clientStats] = await db<
      [{ clienti: string; contactati: string; noi30: string }]
    >`
      SELECT
        COUNT(*) FILTER (WHERE status = 'client')::text AS clienti,
        COUNT(*) FILTER (WHERE status = 'contactat')::text AS contactati,
        COUNT(*) FILTER (WHERE status = 'client'
          AND updated_at >= NOW() - INTERVAL '30 days')::text AS noi30
      FROM prospects
      WHERE assigned_agent = ANY(${agentNames.length ? agentNames : [""]})
    `;

    const [dueCount] = await db<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM (
        SELECT p.cui FROM prospects p
        LEFT JOIN visits v ON v.cui = p.cui
        WHERE p.status = 'client'
          AND p.assigned_agent = ANY(${agentNames.length ? agentNames : [""]})
        GROUP BY p.cui
        HAVING MAX(v.visited_at) IS NULL
            OR MAX(v.visited_at) < NOW() - INTERVAL '7 days'
      ) t
    `;

    // Rezultatele vizitelor pe ultimele 30 de zile (funnel de teren).
    const resultRows = await db<Array<{ result: string; n: string }>>`
      SELECT result, COUNT(*)::text AS n FROM visits
      WHERE agent_id = ANY(${agentIds.length ? agentIds : [""]})
        AND visited_at >= NOW() - INTERVAL '30 days'
      GROUP BY result
    `;

    const recent = await db<
      Array<{
        agent_name: string;
        denumire: string;
        result: string;
        note: string;
        visited_at: Date;
      }>
    >`
      SELECT agent_name, denumire, result, note, visited_at FROM visits
      WHERE agent_id = ANY(${agentIds.length ? agentIds : [""]})
      ORDER BY visited_at DESC LIMIT 12
    `;

    // Vizite per agent săptămâna asta (cine muncește, cine nu).
    const perAgent = await db<Array<{ agent_id: string; n: string }>>`
      SELECT agent_id, COUNT(*)::text AS n FROM visits
      WHERE agent_id = ANY(${agentIds.length ? agentIds : [""]})
        AND visited_at >= date_trunc('week', NOW())
      GROUP BY agent_id
    `;
    const visitsByAgent = Object.fromEntries(
      perAgent.map((r) => [r.agent_id, parseInt(r.n, 10)]),
    );

    return Response.json({
      org: {
        name: org.name,
        status: org.status,
        planName: org.planName,
        agentLimit: org.agentLimit,
        trialEndsAt: org.trialEndsAt,
      },
      agents: agents.map((a) => ({
        ...a,
        visitsWeek: visitsByAgent[a.agentId] ?? 0,
      })),
      visits: {
        azi: parseInt(visitStats.azi, 10),
        saptamana: parseInt(visitStats.saptamana, 10),
        luna: parseInt(visitStats.luna, 10),
      },
      clients: {
        total: parseInt(clientStats.clienti, 10),
        contactati: parseInt(clientStats.contactati, 10),
        noi30: parseInt(clientStats.noi30, 10),
      },
      due: parseInt(dueCount.n, 10),
      results30: Object.fromEntries(
        resultRows.map((r) => [r.result, parseInt(r.n, 10)]),
      ),
      recentVisits: recent.map((r) => ({
        agentName: r.agent_name,
        denumire: r.denumire,
        result: r.result,
        note: r.note,
        visitedAt: r.visited_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error("[agentie overview]", e);
    return Response.json({ error: "Eroare la citirea datelor" }, { status: 500 });
  }
}
