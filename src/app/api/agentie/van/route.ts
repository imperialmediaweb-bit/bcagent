import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";

/**
 * VAN SALES în panoul agenției: managerul vede stocul din fiecare dubă
 * și cât numerar are de predat fiecare agent azi (vânzările „pe loc"
 * încasate numerar). Patronul vede exact banii care trebuie să vină seara.
 */
export async function GET() {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const ids = agents.map((a) => a.agentId);
    const names = new Map(agents.map((a) => [a.agentId, a.name]));

    const stock = await db<
      Array<{ agent_id: string; produs: string; um: string; cantitate: number }>
    >`
      SELECT agent_id, produs, um, cantitate FROM van_stock
      WHERE agent_id = ANY(${ids.length ? ids : [""]}) AND cantitate > 0
      ORDER BY agent_id, produs
    `;

    const today = await db<
      Array<{
        agent_id: string;
        sales: string;
        total: string | null;
        numerar: string | null;
      }>
    >`
      SELECT agent_id, COUNT(*)::text AS sales,
             COALESCE(SUM(total_value), 0)::text AS total,
             COALESCE(SUM(total_value) FILTER (WHERE plata = 'numerar'), 0)::text AS numerar
      FROM orders
      WHERE agent_id = ANY(${ids.length ? ids : [""]}) AND tip = 'van'
        AND created_at >= date_trunc('day', NOW())
      GROUP BY agent_id
    `;

    const byAgent = new Map<
      string,
      {
        agentId: string;
        agentName: string;
        stock: Array<{ produs: string; um: string; cantitate: number }>;
        salesToday: number;
        totalToday: number;
        numerarToday: number;
      }
    >();
    const entry = (id: string) => {
      let e = byAgent.get(id);
      if (!e) {
        e = {
          agentId: id,
          agentName: names.get(id) ?? id,
          stock: [],
          salesToday: 0,
          totalToday: 0,
          numerarToday: 0,
        };
        byAgent.set(id, e);
      }
      return e;
    };
    for (const s of stock) {
      entry(s.agent_id).stock.push({
        produs: s.produs,
        um: s.um,
        cantitate: s.cantitate,
      });
    }
    for (const t of today) {
      const e = entry(t.agent_id);
      e.salesToday = parseInt(t.sales, 10);
      e.totalToday = parseFloat(t.total ?? "0");
      e.numerarToday = parseFloat(t.numerar ?? "0");
    }

    return Response.json({ vans: [...byAgent.values()] });
  } catch (e) {
    console.error("[agentie van GET]", e);
    return Response.json({ error: "Eroare la citirea dubelor" }, { status: 500 });
  }
}
