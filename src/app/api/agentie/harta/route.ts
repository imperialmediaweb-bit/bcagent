import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * HARTA FIRMEI — situația centralizată, dintr-o privire (cererea lui
 * Bogdan, 25.08: „mă interesează să creez harta cu situația centralizată").
 *
 * Agentul își vede harta LUI. Managerul are nevoie de a TUTUROR: unde
 * sunt clienții firmei, ai cui sunt, pe unde s-a trecut săptămâna asta și
 * unde nu calcă nimeni de mult. Fiecare client vine cu agentul lui,
 * ultima vizită și coordonatele deja găsite (geo_firme / centrul
 * localității) — nu geocodăm nimic aici, ca pagina să se deschidă instant.
 */

interface Rand {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  judet: string;
  agent: string;
  telefon: string;
  sold_cents: string | null;
  lat: number | null;
  lng: number | null;
  aprox: boolean | null;
  ultima_vizita: Date | null;
  rezultat: string | null;
}

export async function GET(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  const url = new URL(req.url);
  const agentCerut = (url.searchParams.get("agent") ?? "").trim();
  // „De cât timp nu s-a mai trecut pe la el" — pragul de restanță.
  const zile = Math.min(
    90,
    Math.max(1, parseInt(url.searchParams.get("zile") ?? "7", 10) || 7),
  );

  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const nume = agents.map((a) => a.name).filter(Boolean);
    if (nume.length === 0) {
      return Response.json({
        clienti: [],
        agenti: [],
        rezumat: { total: 0, cuPozitie: 0, vizitatiRecent: 0, restanti: 0, localitati: 0 },
      });
    }
    const cautati = agentCerut && nume.includes(agentCerut) ? [agentCerut] : nume;

    const rows = await db<Rand[]>`
      SELECT p.cui, p.denumire, COALESCE(p.adresa, '') AS adresa,
             COALESCE(p.localitate, '') AS localitate,
             COALESCE(p.judet, '') AS judet,
             p.assigned_agent AS agent,
             COALESCE(p.telefon, '') AS telefon,
             p.sold_cents::text AS sold_cents,
             COALESCE(g.lat, gl.lat) AS lat,
             COALESCE(g.lng, gl.lng) AS lng,
             (g.lat IS NULL) AS aprox,
             v.ultima_vizita, v.rezultat
      FROM prospects p
      LEFT JOIN geo_firme g ON g.cui = p.cui AND g.lat IS NOT NULL
      LEFT JOIN geo_localitati gl
        ON gl.judet = p.judet AND gl.localitate = p.localitate AND gl.lat IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT visited_at AS ultima_vizita, result AS rezultat
        FROM visits vv
        WHERE vv.cui = p.cui AND vv.agent_name = ANY(${cautati})
        ORDER BY visited_at DESC
        LIMIT 1
      ) v ON TRUE
      WHERE p.status = 'client'
        AND p.assigned_agent = ANY(${cautati})
        AND p.activ IS DISTINCT FROM FALSE
      ORDER BY p.denumire ASC
      LIMIT 2000
    `;

    const acum = Date.now();
    const pragMs = zile * 86_400_000;
    const clienti = rows.map((r) => {
      const ultima = r.ultima_vizita ? r.ultima_vizita.getTime() : null;
      return {
        cui: r.cui,
        denumire: r.denumire,
        adresa: r.adresa,
        localitate: r.localitate,
        judet: r.judet,
        agent: r.agent,
        telefon: r.telefon,
        soldCents: r.sold_cents ? parseInt(r.sold_cents, 10) : null,
        lat: r.lat,
        lng: r.lng,
        aprox: r.aprox === true,
        ultimaVizita: r.ultima_vizita ? r.ultima_vizita.toISOString() : null,
        rezultat: r.rezultat,
        // „Restant" = n-a fost nimeni de la noi pe la el de mai mult de
        // pragul ales (sau niciodată). Ăștia sunt banii care se răcesc.
        restant: ultima === null || acum - ultima > pragMs,
      };
    });

    const localitati = new Set(
      clienti.map((c) => `${c.judet}|${c.localitate}`).filter((k) => k !== "|"),
    );
    // Câți clienți are fiecare agent și câți dintre ei sunt restanți —
    // clasamentul pe care managerul îl citește în 3 secunde.
    const peAgent = new Map<string, { clienti: number; restanti: number; vizitatiRecent: number }>();
    for (const n of cautati) peAgent.set(n, { clienti: 0, restanti: 0, vizitatiRecent: 0 });
    for (const c of clienti) {
      const a = peAgent.get(c.agent) ?? { clienti: 0, restanti: 0, vizitatiRecent: 0 };
      a.clienti++;
      if (c.restant) a.restanti++;
      else a.vizitatiRecent++;
      peAgent.set(c.agent, a);
    }

    return Response.json({
      clienti,
      agenti: [...peAgent.entries()].map(([nume, d]) => ({ nume, ...d })),
      rezumat: {
        total: clienti.length,
        cuPozitie: clienti.filter((c) => c.lat !== null).length,
        vizitatiRecent: clienti.filter((c) => !c.restant).length,
        restanti: clienti.filter((c) => c.restant).length,
        localitati: localitati.size,
        zile,
      },
    });
  } catch (e) {
    console.error("[agentie harta]", e);
    return Response.json({ error: "Eroare la harta firmei" }, { status: 500 });
  }
}
