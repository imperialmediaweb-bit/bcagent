import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { audit, listOrgAgents, requireOrgUser } from "@/modules/platform";

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
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const names = agents.map((a) => a.name);
    // „__none__" = clienții încă nedistribuiți (fără agent) — managerul
    // îi vede și îi împarte; implicit apar și ei alături de cei alocați.
    const scoped =
      agent === "__none__"
        ? [""]
        : agent && names.includes(agent)
          ? [agent]
          : [...names, ""];

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

/** Realocarea unui client pe alt agent (sau scoaterea de pe agent). */
export async function PATCH(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;

  let body: { cui?: string; agent?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const cui = String(body.cui ?? "").replace(/\D/g, "").slice(0, 12);
  const agent = String(body.agent ?? "").trim().slice(0, 128);
  if (!cui) return Response.json({ error: "CUI lipsește" }, { status: 400 });

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const names = agents.map((a) => a.name);
    if (agent !== "" && !names.includes(agent)) {
      return Response.json({ error: "Agentul nu e al firmei tale" }, { status: 400 });
    }
    // Doar clienții firmei: alocați unui agent al ei sau nedistribuiți.
    const rows = await db<Array<{ cui: string }>>`
      UPDATE prospects
      SET assigned_agent = ${agent}, updated_at = NOW()
      WHERE cui = ${cui} AND status = 'client'
        AND (assigned_agent = '' OR assigned_agent = ANY(${names.length ? names : [""]}))
      RETURNING cui
    `;
    if (rows.length === 0) {
      return Response.json({ error: "Clientul nu e al firmei tale" }, { status: 403 });
    }
    await audit(auth.session.email, "client.reassign", cui, { agent });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[agentie clients PATCH]", e);
    return Response.json({ error: "Eroare la realocare" }, { status: 500 });
  }
}
