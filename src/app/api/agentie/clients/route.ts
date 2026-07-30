import { isDBEnabled, getDB } from "@/lib/db";
import { listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";

/** Clienții firmei: prospecții cu status „client" alocați agenților ei. */
export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  const url = new URL(req.url);
  const agent = url.searchParams.get("agent") ?? "";
  const search = url.searchParams.get("search") ?? "";
  const limit = Math.min(
    500,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100),
  );
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  try {
    const agents = await listOrgAgents(auth.session.orgId);
    const names = agents.map((a) => a.name);
    const scoped = agent && names.includes(agent) ? [agent] : names;

    const where = () => db`
      WHERE p.status = 'client'
        AND p.assigned_agent = ANY(${scoped.length ? scoped : [""]})
        AND (${search} = '' OR p.denumire ILIKE ${"%" + search + "%"}
             OR p.localitate ILIKE ${"%" + search + "%"} OR p.cui LIKE ${search + "%"})
    `;

    const rows = await db<
      Array<{
        cui: string;
        denumire: string;
        adresa: string;
        localitate: string;
        judet: string;
        telefon: string;
        assigned_agent: string;
        updated_at: Date;
        last_visit: Date | null;
      }>
    >`
      SELECT p.cui, p.denumire, COALESCE(p.adresa,'') AS adresa,
             COALESCE(p.localitate,'') AS localitate, COALESCE(p.judet,'') AS judet,
             COALESCE(p.telefon,'') AS telefon, p.assigned_agent, p.updated_at,
             (SELECT MAX(v.visited_at) FROM visits v WHERE v.cui = p.cui) AS last_visit
      FROM prospects p
      ${where()}
      ORDER BY p.denumire ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [{ count }] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM prospects p ${where()}
    `;

    return Response.json({
      total: parseInt(count, 10),
      clients: rows.map((r) => ({
        cui: r.cui,
        denumire: r.denumire,
        adresa: r.adresa,
        localitate: r.localitate,
        judet: r.judet,
        telefon: r.telefon,
        agent: r.assigned_agent,
        lastVisit: r.last_visit ? r.last_visit.toISOString() : null,
      })),
    });
  } catch (e) {
    console.error("[agentie clients]", e);
    return Response.json({ error: "Eroare la citirea clienților" }, { status: 500 });
  }
}
