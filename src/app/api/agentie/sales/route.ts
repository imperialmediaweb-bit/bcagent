import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";

/**
 * Vânzările firmei la nivel de agenție, calculate pe server din XLS-urile
 * încărcate (batches): per agent, per brand, evoluție lunară, top clienți.
 * Managerul vede profilul de vânzări al fiecărui agent fără să deschidă
 * panourile lor.
 */
export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  const url = new URL(req.url);
  const months = Math.min(
    24,
    Math.max(1, parseInt(url.searchParams.get("months") ?? "6", 10) || 6),
  );
  const since = new Date();
  since.setMonth(since.getMonth() - (months - 1));
  const sinceKey = since.toISOString().slice(0, 7) + "-01";

  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const names = agents.map((a) => a.name);
    // IZOLARE PE FIRMĂ: numai fișierele urcate de firma asta (org:<id>)
    // sau de agenții ei — altfel două firme cu agenți cu același nume
    // și-ar amesteca vânzările.
    const ownerIds = ["org:" + auth.session.orgId, ...agents.map((a) => a.agentId)];
    if (names.length === 0) {
      return Response.json({ agents: [], monthly: [], topClients: [], brands: [] });
    }

    // agent × lună
    const byMonth = await db<
      Array<{ agent: string; luna: string; value: string; volume: string; clienti: string }>
    >`
      SELECT r->>'agent' AS agent, substr(r->>'date', 1, 7) AS luna,
             COALESCE(SUM((r->>'value')::float), 0)::text AS value,
             COALESCE(SUM((r->>'volume')::float), 0)::text AS volume,
             COUNT(DISTINCT r->>'client')::text AS clienti
      FROM batches b, jsonb_array_elements(b.rows) r
      WHERE b.agent_id = ANY(${ownerIds})
        AND r->>'agent' = ANY(${names}) AND (r->>'date') >= ${sinceKey}
      GROUP BY 1, 2 ORDER BY 2
    `;

    // agent × brand (top)
    const byBrand = await db<
      Array<{ agent: string; brand: string; value: string; volume: string }>
    >`
      SELECT r->>'agent' AS agent, r->>'producer' AS brand,
             COALESCE(SUM((r->>'value')::float), 0)::text AS value,
             COALESCE(SUM((r->>'volume')::float), 0)::text AS volume
      FROM batches b, jsonb_array_elements(b.rows) r
      WHERE b.agent_id = ANY(${ownerIds})
        AND r->>'agent' = ANY(${names}) AND (r->>'date') >= ${sinceKey}
        AND COALESCE(r->>'producer', '') <> ''
      GROUP BY 1, 2
    `;

    const topClients = await db<
      Array<{ client: string; agent: string; value: string; volume: string }>
    >`
      SELECT r->>'client' AS client,
             (array_agg(r->>'agent'))[1] AS agent,
             COALESCE(SUM((r->>'value')::float), 0)::text AS value,
             COALESCE(SUM((r->>'volume')::float), 0)::text AS volume
      FROM batches b, jsonb_array_elements(b.rows) r
      WHERE b.agent_id = ANY(${ownerIds})
        AND r->>'agent' = ANY(${names}) AND (r->>'date') >= ${sinceKey}
        AND COALESCE(r->>'client', '') <> ''
      GROUP BY 1
      ORDER BY SUM(COALESCE((r->>'value')::float, 0)) DESC,
               SUM(COALESCE((r->>'volume')::float, 0)) DESC
      LIMIT 15
    `;

    // VÂNZĂRI PRIN APLICAȚIE: ce au bătut/fotografiat agenții (facturi,
    // van sales, comenzi livrate). Sursă SEPARATĂ de XLS-urile SAGA —
    // se afișează una lângă alta, nu se adună (ar dubla aceleași vânzări).
    const agentIds = agents.map((a) => a.agentId);
    const appByMonth = await db<
      Array<{
        agent_name: string;
        luna: string;
        total: string | null;
        van: string | null;
        vanzari: string;
      }>
    >`
      SELECT agent_name, to_char(created_at, 'YYYY-MM') AS luna,
             COALESCE(SUM(total_value), 0)::text AS total,
             COALESCE(SUM(total_value) FILTER (WHERE tip = 'van'), 0)::text AS van,
             COUNT(*)::text AS vanzari
      FROM orders
      WHERE agent_id = ANY(${agentIds}) AND status = 'livrata'
        AND created_at >= ${sinceKey}::date
      GROUP BY 1, 2 ORDER BY 2
    `;

    // Metrica firmei: valoare dacă există undeva, altfel volum.
    const hasValue = byMonth.some((r) => parseFloat(r.value) > 0);
    const metric = (r: { value: string; volume: string }) =>
      Math.round(parseFloat(hasValue ? r.value : r.volume));

    // Agregate per agent
    const perAgent = new Map<
      string,
      { total: number; clients: Set<string>; brands: Map<string, number>; monthly: Map<string, number> }
    >();
    for (const r of byMonth) {
      let a = perAgent.get(r.agent);
      if (!a) {
        a = { total: 0, clients: new Set(), brands: new Map(), monthly: new Map() };
        perAgent.set(r.agent, a);
      }
      a.total += metric(r);
      a.monthly.set(r.luna, (a.monthly.get(r.luna) ?? 0) + metric(r));
    }
    for (const r of byBrand) {
      const a = perAgent.get(r.agent);
      if (a) a.brands.set(r.brand, (a.brands.get(r.brand) ?? 0) + metric(r));
    }
    const clientCounts = new Map<string, number>();
    for (const r of byMonth) {
      clientCounts.set(
        r.agent,
        Math.max(clientCounts.get(r.agent) ?? 0, parseInt(r.clienti, 10)),
      );
    }

    const monthsList = Array.from(new Set(byMonth.map((r) => r.luna))).sort();
    const allBrands = Array.from(
      byBrand
        .reduce((m, r) => {
          m.set(r.brand, (m.get(r.brand) ?? 0) + metric(r));
          return m;
        }, new Map<string, number>())
        .entries(),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([b]) => b);

    return Response.json({
      metric: hasValue ? "RON" : "buc",
      months: monthsList,
      agents: Array.from(perAgent.entries())
        .map(([name, a]) => ({
          name,
          total: a.total,
          clients: clientCounts.get(name) ?? 0,
          brands: Object.fromEntries(
            allBrands.map((b) => [b, a.brands.get(b) ?? 0]),
          ),
          monthly: monthsList.map((m) => a.monthly.get(m) ?? 0),
        }))
        .sort((x, y) => y.total - x.total),
      brands: allBrands,
      topClients: topClients.map((c) => ({
        client: c.client,
        agent: c.agent,
        total: metric(c),
      })),
      appSales: (() => {
        const per = new Map<
          string,
          { total: number; van: number; sales: number; monthly: Map<string, number> }
        >();
        for (const r of appByMonth) {
          let a = per.get(r.agent_name);
          if (!a) {
            a = { total: 0, van: 0, sales: 0, monthly: new Map() };
            per.set(r.agent_name, a);
          }
          const t = parseFloat(r.total ?? "0");
          a.total += t;
          a.van += parseFloat(r.van ?? "0");
          a.sales += parseInt(r.vanzari, 10);
          a.monthly.set(r.luna, (a.monthly.get(r.luna) ?? 0) + t);
        }
        const appMonths = Array.from(
          new Set(appByMonth.map((r) => r.luna)),
        ).sort();
        return {
          months: appMonths,
          agents: Array.from(per.entries())
            .map(([name, a]) => ({
              name,
              total: Math.round(a.total),
              van: Math.round(a.van),
              sales: a.sales,
              monthly: appMonths.map((m) => Math.round(a.monthly.get(m) ?? 0)),
            }))
            .sort((x, y) => y.total - x.total),
        };
      })(),
    });
  } catch (e) {
    console.error("[agentie sales]", e);
    return Response.json({ error: "Eroare la citirea vânzărilor" }, { status: 500 });
  }
}
