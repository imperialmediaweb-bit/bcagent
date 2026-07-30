import { verifyToken } from "@/lib/signed-token";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Gamification pentru agent: targetul MEU + clasamentul echipei pe luna
 * curentă. Organizația se găsește prin org_agents (agentul e membru).
 */
export async function GET(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const secret = process.env.TOKEN_SECRET;
  if (!secret) return Response.json({ error: "Server not configured" }, { status: 500 });
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const payload = await verifyToken(token, secret);
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  const month = new Date().toISOString().slice(0, 7);

  try {
    await ensureSchema();
    // Din ce organizație face parte agentul?
    const membership = await db<Array<{ org_id: string }>>`
      SELECT org_id FROM org_agents
      WHERE agent_id = ${payload.agentId} AND active
      LIMIT 1
    `;
    if (membership.length === 0) {
      return Response.json({ month, inOrg: false, leaderboard: [] });
    }
    const orgId = membership[0].org_id;

    const agents = await db<Array<{ name: string }>>`
      SELECT name FROM org_agents WHERE org_id = ${orgId} AND active
    `;
    const names = agents.map((a) => a.name);

    const targets = await db<Array<{ agent_name: string; target_value: number }>>`
      SELECT agent_name, target_value FROM targets
      WHERE org_id = ${orgId} AND month = ${month}
    `;
    const targetByName = new Map(targets.map((t) => [t.agent_name, t.target_value]));

    const sums = await db<Array<{ agent: string; value: string; volume: string }>>`
      SELECT r->>'agent' AS agent,
             COALESCE(SUM((r->>'value')::float), 0)::text AS value,
             COALESCE(SUM((r->>'volume')::float), 0)::text AS volume
      FROM batches b, jsonb_array_elements(b.rows) r
      WHERE (r->>'date') LIKE ${month + "%"}
        AND r->>'agent' = ANY(${names.length ? names : [""]})
      GROUP BY 1
    `;
    const realized = new Map(
      sums.map((r) => [
        r.agent,
        parseFloat(r.value) > 0 ? parseFloat(r.value) : parseFloat(r.volume),
      ]),
    );

    const leaderboard = names
      .map((name) => {
        const r = Math.round(realized.get(name) ?? 0);
        const target = targetByName.get(name) ?? 0;
        return {
          name,
          me: name === payload.agentName,
          realized: r,
          target,
          pct: target > 0 ? Math.round((r / target) * 100) : null,
        };
      })
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.realized - a.realized);

    const daysInMonth = new Date(
      parseInt(month.slice(0, 4)),
      parseInt(month.slice(5, 7)),
      0,
    ).getDate();
    const dayOfMonth = new Date().getDate();

    return Response.json({
      month,
      inOrg: true,
      /** Cât la sută din lună a trecut — reperul pentru „ești în grafic?". */
      monthElapsedPct: Math.round((dayOfMonth / daysInMonth) * 100),
      leaderboard,
    });
  } catch (e) {
    console.error("[targets GET]", e);
    return Response.json({ error: "Eroare la citirea targetului" }, { status: 500 });
  }
}
