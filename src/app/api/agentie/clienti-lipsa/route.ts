import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { aduFirmeLipsa } from "@/modules/prospects/firma-lipsa";
import { audit, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * CLIENȚII PE CARE REGISTRUL NU-I ȘTIE.
 *
 * Importul de clienți doar potrivește firme cu registrul; ce nu găsește
 * rămâne pe dinafară. Până acum lista aia se arăta o dată pe ecran și se
 * pierdea — iar clienți adevărați (AndroCament, Turism Premier Laur,
 * I.I. Plugariu) nu apăreau nicăieri, până le-a spus Costin pe WhatsApp.
 *
 * GET  → lista nerezolvată, ca s-o vadă managerul oricând.
 * POST → îi aduce în registru (cu CUI) și îi alocă agentului din fișier.
 * PATCH → „lasă-i deoparte": îi marchează rezolvați, fără să-i creeze.
 */

interface Rand {
  id: string;
  denumire: string;
  cui: string;
  adresa: string;
  localitate: string;
  agent: string;
}

export async function GET() {
  if (!isDBEnabled()) return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  try {
    await ensureSchema();
    const rows = await db<Array<Rand & { created_at: Date }>>`
      SELECT id::text, denumire, cui, adresa, localitate, agent, created_at
      FROM clienti_nepotriviti
      WHERE org_id = ${auth.session.orgId} AND rezolvat_la IS NULL
      ORDER BY (cui <> '') DESC, denumire ASC
      LIMIT 1000
    `;
    return Response.json({
      clienti: rows.map((r) => ({
        id: r.id,
        denumire: r.denumire,
        cui: r.cui,
        adresa: r.adresa,
        localitate: r.localitate,
        agent: r.agent,
      })),
      // Fără CUI nu putem crea firma: registrul se ține pe CUI.
      cuCui: rows.filter((r) => r.cui !== "").length,
    });
  } catch (e) {
    console.error("[clienti-lipsa GET]", e);
    return Response.json({ error: "Eroare la citirea listei" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  try {
    await ensureSchema();
    const idsCerute = Array.isArray(body.ids)
      ? body.ids.filter((x) => /^\d{1,18}$/.test(String(x))).slice(0, 2000)
      : [];
    const rows = await db<Array<Rand>>`
      SELECT id::text, denumire, cui, adresa, localitate, agent
      FROM clienti_nepotriviti
      WHERE org_id = ${auth.session.orgId} AND rezolvat_la IS NULL
        AND cui <> ''
        AND (${idsCerute.length === 0} OR id::text = ANY(${idsCerute}))
      LIMIT 2000
    `;
    if (rows.length === 0) {
      return Response.json({ create: 0, alocate: 0, sarite: [], mesaj: "Nimic de adus." });
    }

    // Agentul din fișier hotărăște alocarea; grupăm ca să nu amestecăm.
    const peAgent = new Map<string, Rand[]>();
    for (const r of rows) {
      const ale = peAgent.get(r.agent);
      if (ale) ale.push(r);
      else peAgent.set(r.agent, [r]);
    }
    let create = 0;
    let alocate = 0;
    const sarite: Array<{ cui: string; motiv: string }> = [];
    // Doar CUI-urile chiar rezolvate ies din listă. Marcând tot, cele
    // sărite (CUI greșit, firma altei agenții) dispăreau de pe ecran fără
    // să fi fost rezolvate — și nimeni nu mai afla de ele.
    const reusite = new Set<string>();
    for (const [agent, ale] of peAgent) {
      const rez = await aduFirmeLipsa(db, auth.session.orgId, ale, agent);
      create += rez.create;
      alocate += rez.alocate;
      sarite.push(...rez.sarite);
      const bune = new Set(rez.reusite);
      for (const r of ale) if (bune.has(r.cui)) reusite.add(r.id);
    }
    const deInchis = rows.filter((r) => reusite.has(r.id)).map((r) => r.id);
    if (deInchis.length > 0) {
      await db`
        UPDATE clienti_nepotriviti
        SET rezolvat_la = NOW(), rezolvat_cum = 'aduse in registru'
        WHERE org_id = ${auth.session.orgId}
          AND id::text = ANY(${deInchis})
      `;
    }
    await audit(auth.session.email, "clients.missing.create", auth.session.orgId, {
      create,
      alocate,
    });
    return Response.json({ create, alocate, sarite });
  } catch (e) {
    console.error("[clienti-lipsa POST]", e);
    return Response.json({ error: "Eroare la aducerea firmelor" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isDBEnabled()) return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x) => /^\d{1,18}$/.test(String(x))).slice(0, 2000)
    : [];
  if (ids.length === 0) return Response.json({ error: "Nimic de lăsat deoparte" }, { status: 400 });
  try {
    await ensureSchema();
    const r = await db`
      UPDATE clienti_nepotriviti
      SET rezolvat_la = NOW(), rezolvat_cum = 'lasate deoparte'
      WHERE org_id = ${auth.session.orgId} AND rezolvat_la IS NULL
        AND id::text = ANY(${ids})
    `;
    return Response.json({ lasate: r.count });
  } catch (e) {
    console.error("[clienti-lipsa PATCH]", e);
    return Response.json({ error: "Eroare la salvare" }, { status: 500 });
  }
}
