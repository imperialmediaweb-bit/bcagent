import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { alAgentiei } from "@/lib/org-scope";
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
        AND ${alAgentiei(db, auth.session.orgId, scoped)}
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

    // ── CE A FOST SCOS DIN LISTE DE PE TEREN ──
    // Un agent a apăsat „Nu mai există". Dacă a greșit — sau firma s-a
    // redeschis — managerul trebuie să AIBĂ UNDE SĂ VADĂ asta, altfel
    // butonul de adus înapoi n-are cum să fie găsit. O listă scurtă,
    // lângă clienți, cu cine a scos-o și când.
    const scoase = await db<
      Array<{
        cui: string;
        denumire: string;
        localitate: string;
        agent: string;
        cand: Date | null;
      }>
    >`
      SELECT p.cui, p.denumire, COALESCE(p.localitate,'') AS localitate,
             COALESCE(
               (SELECT v.agent_name FROM visits v
                WHERE v.cui = p.cui AND v.result = 'nu_mai_exista'
                ORDER BY v.visited_at DESC LIMIT 1), '') AS agent,
             (SELECT MAX(v.visited_at) FROM visits v
              WHERE v.cui = p.cui AND v.result = 'nu_mai_exista') AS cand
      FROM prospects p
      WHERE p.inchis_teren
        AND ${alAgentiei(db, auth.session.orgId, names)}
      ORDER BY p.denumire
      LIMIT 200
    `;

    return Response.json({
      total: parseInt(count, 10),
      scoaseDeTeren: scoase.map((r) => ({
        cui: r.cui,
        denumire: r.denumire,
        localitate: r.localitate,
        agent: r.agent,
        cand: r.cand ? r.cand.toISOString() : null,
      })),
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

  let body: {
    cui?: string;
    agent?: string;
    /**
     * „ADU-L ÎNAPOI." Un agent a apăsat pe teren „Nu mai există" și a
     * greșit — sau firma s-a redeschis. Până acum, apăsatul ăla era pe
     * viață: firma ieșea din liste și din hartă pentru toată agenția, iar
     * verificarea lunară de la ANAF era anume oprită să o mai reînvie.
     * Nicăieri, în toată platforma, nu exista drumul înapoi.
     */
    redeschide?: boolean;
  };
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

    // ── ADU-L ÎNAPOI ──
    // Ridicăm și steagul de pe firmă (dacă e a noastră), și ascunderea
    // pusă doar pentru firma noastră (dacă era un prospect nealocat).
    if (body.redeschide === true) {
      const inviat = await db`
        UPDATE prospects
        SET inchis_teren = FALSE, activ = TRUE, updated_at = NOW()
        WHERE cui = ${cui}
          AND (assigned_agent = '' OR ${alAgentiei(db, auth.session.orgId, names)})
      `;
      const dezascuns = await db`
        DELETE FROM prospect_inchis
        WHERE cui = ${cui} AND org_id = ${auth.session.orgId}
      `;
      if (inviat.count === 0 && dezascuns.count === 0) {
        return Response.json(
          { error: "Firma asta nu e a ta sau n-a fost scoasă din liste." },
          { status: 403 },
        );
      }
      await audit(auth.session.email, "client.redeschide", cui, {});
      return Response.json({
        ok: true,
        // ANAF o va verifica din nou la următoarea tură: steagul care
        // oprea reînvierea a fost ridicat.
        redeschis: true,
      });
    }

    if (agent !== "" && !names.includes(agent)) {
      return Response.json({ error: "Agentul nu e al firmei tale" }, { status: 400 });
    }
    // Doar clienții firmei: alocați unui agent al ei sau nedistribuiți.
    const rows = await db<Array<{ cui: string }>>`
      UPDATE prospects
      SET assigned_agent = ${agent}, assigned_org = ${auth.session.orgId},
          updated_at = NOW()
      WHERE cui = ${cui} AND status = 'client'
        AND (assigned_agent = '' OR ${alAgentiei(db, auth.session.orgId, names)})
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
