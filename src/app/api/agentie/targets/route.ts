import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { audit, listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";

/**
 * Targeturi lunare per agent. Realizatul se calculează din vânzările
 * încărcate în platformă (batches → rândurile JSONB), pe numele agentului.
 */

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function validMonth(m: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

/** Vânzările lunii, agregate per agent (valoare + volum). */
async function realizedByAgent(
  month: string,
  agentNames: string[],
): Promise<Map<string, { value: number; volume: number }>> {
  const db = getDB()!;
  const rows = await db<Array<{ agent: string; value: string; volume: string }>>`
    SELECT r->>'agent' AS agent,
           COALESCE(SUM((r->>'value')::float), 0)::text AS value,
           COALESCE(SUM((r->>'volume')::float), 0)::text AS volume
    FROM batches b, jsonb_array_elements(b.rows) r
    WHERE (r->>'date') LIKE ${month + "%"}
      AND r->>'agent' = ANY(${agentNames.length ? agentNames : [""]})
    GROUP BY 1
  `;
  return new Map(
    rows.map((r) => [
      r.agent,
      { value: parseFloat(r.value), volume: parseFloat(r.volume) },
    ]),
  );
}

export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  const url = new URL(req.url);
  const month = validMonth(url.searchParams.get("month") ?? "")
    ? url.searchParams.get("month")!
    : currentMonth();

  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const names = agents.filter((a) => a.active).map((a) => a.name);
    const targets = await db<Array<{ agent_name: string; target_value: number }>>`
      SELECT agent_name, target_value FROM targets
      WHERE org_id = ${auth.session.orgId} AND month = ${month}
    `;
    const targetByName = new Map(targets.map((t) => [t.agent_name, t.target_value]));
    const realized = await realizedByAgent(month, names);

    return Response.json({
      month,
      agents: names.map((name) => {
        const r = realized.get(name) ?? { value: 0, volume: 0 };
        const target = targetByName.get(name) ?? 0;
        // Metrica: valoarea dacă există, altfel volumul (țigări = bucăți).
        const metricRealized = r.value > 0 ? r.value : r.volume;
        return {
          name,
          target,
          realizedValue: Math.round(r.value),
          realizedVolume: Math.round(r.volume),
          realized: Math.round(metricRealized),
          pct: target > 0 ? Math.round((metricRealized / target) * 100) : null,
        };
      }),
    });
  } catch (e) {
    console.error("[agentie targets GET]", e);
    return Response.json({ error: "Eroare la citirea targeturilor" }, { status: 500 });
  }
}

/** Setează targeturile unei luni (toate odată, upsert). */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;

  let body: { month?: string; targets?: Array<{ name?: string; target?: number }> };
  try {
    await ensureSchema();
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const month = String(body.month ?? "");
  if (!validMonth(month)) {
    return Response.json({ error: "Lună invalidă (YYYY-MM)" }, { status: 400 });
  }
  if (!Array.isArray(body.targets)) {
    return Response.json({ error: "targets trebuie să fie listă" }, { status: 400 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const validNames = new Set(agents.map((a) => a.name));
    let saved = 0;
    for (const t of body.targets.slice(0, 200)) {
      const name = String(t.name ?? "");
      if (!validNames.has(name)) continue;
      const target = Math.max(0, Number(t.target) || 0);
      await db`
        INSERT INTO targets (org_id, agent_name, month, target_value)
        VALUES (${auth.session.orgId}, ${name}, ${month}, ${target})
        ON CONFLICT (org_id, agent_name, month)
        DO UPDATE SET target_value = EXCLUDED.target_value, updated_at = NOW()
      `;
      saved++;
    }
    await audit(auth.session.email, "targets.set", auth.session.orgId, {
      month,
      saved,
    });
    return Response.json({ ok: true, saved });
  } catch (e) {
    console.error("[agentie targets POST]", e);
    return Response.json({ error: "Eroare la salvare" }, { status: 500 });
  }
}
