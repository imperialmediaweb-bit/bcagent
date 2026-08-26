import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { audit, listOrgAgents, requireAdmin } from "@/modules/platform";
import {
  citesteKMLRaport,
  linkDinNetworkLink,
  linkKML,
  midDinLink,
} from "@/modules/prospects/kml";
import { neted, potriveștePuncte } from "@/modules/prospects/potrivire";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * ADMINUL PLATFORMEI ADUCE LOCAȚIILE PENTRU O FIRMĂ.
 *
 * Același import ca în panoul firmei, dar făcut de la locul potrivit.
 * Alternativa era să intri în contul personal al clientului — ceea ce
 * i-ar declanșa alerta de „dispozitiv nou", i-ar apărea în jurnal ca
 * făcut de EL, iar dacă iese ceva strâmb nu se mai știe cine a apăsat.
 * Aici rămâne scris negru pe alb: adminul platformei, pentru firma X.
 */

interface ClientRand {
  cui: string;
  denumire: string;
  localitate: string;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id: orgId } = await ctx.params;

  let body: { link?: string; kml?: string; anuleaza?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDB();
  if (!db) return Response.json({ error: "DB indisponibil" }, { status: 503 });

  try {
    await ensureSchema();
    const agenti = (await listOrgAgents(orgId)).map((a) => a.name);
    const numeAg = agenti.length ? agenti : [""];

    // ── anulare: ștergem doar ce a adus importul ──
    if (body.anuleaza === true) {
      const sters = await db`
        DELETE FROM geo_firme g
        USING prospects p
        WHERE p.cui = g.cui
          AND g.sursa = 'import'
          AND (COALESCE(p.assigned_agent, '') = ''
               OR p.assigned_agent = ANY(${numeAg}))
      `;
      await audit(auth.session.email, "harta.anuleaza", orgId, {
        sterse: sters.count,
      });
      return Response.json({ ok: true, sterse: sters.count });
    }

    // ── aducem harta ──
    let kml = String(body.kml ?? "").slice(0, 12_000_000);
    const mid = midDinLink(String(body.link ?? ""));
    if (kml.trim() === "" && mid === "") {
      return Response.json(
        { error: "Dă linkul hărții (cu mid=…) sau conținutul fișierului KML." },
        { status: 400 },
      );
    }
    const descarca = async (adresa: string): Promise<string> => {
      const r = await fetch(adresa, {
        headers: { "User-Agent": "bcagent-saas/1.0 (import My Maps)" },
        signal: AbortSignal.timeout(25_000),
      });
      if (!r.ok) throw new Error(String(r.status));
      return r.text();
    };
    if (kml === "") {
      try {
        kml = await descarca(linkKML(mid));
      } catch {
        return Response.json(
          { error: "N-am putut descărca harta de la Google. Verifică dacă e publică." },
          { status: 502 },
        );
      }
    }
    let raport = citesteKMLRaport(kml);
    if (raport.puncte.length === 0) {
      const catre = linkDinNetworkLink(kml);
      if (catre !== "") {
        try {
          kml = await descarca(catre);
          raport = citesteKMLRaport(kml);
        } catch {
          /* rămâne gol — se raportează mai jos */
        }
      }
    }
    if (raport.puncte.length === 0) {
      return Response.json(
        { error: "Harta n-are niciun magazin pe care să-l pot citi." },
        { status: 422 },
      );
    }

    // ── cu cine potrivim: clienții firmei + registrul din județele ei ──
    const clienti = await db<ClientRand[]>`
      SELECT p.cui, p.denumire, COALESCE(p.localitate, '') AS localitate
      FROM prospects p
      JOIN org_agents oa ON oa.name = p.assigned_agent
      WHERE oa.org_id = ${orgId}
      LIMIT 20000
    `;
    const judete = (
      await db<Array<{ judet: string }>>`
        SELECT DISTINCT p.judet FROM prospects p
        JOIN org_agents oa ON oa.name = p.assigned_agent
        WHERE oa.org_id = ${orgId} AND COALESCE(p.judet, '') <> ''
      `
    ).map((r) => r.judet);
    const dinRegistru =
      judete.length === 0
        ? []
        : await db<ClientRand[]>`
            SELECT p.cui, p.denumire, COALESCE(p.localitate, '') AS localitate
            FROM prospects p
            WHERE p.judet = ANY(${judete})
              AND COALESCE(p.assigned_agent, '') = ''
              AND p.activ IS DISTINCT FROM FALSE
              AND NOT EXISTS (SELECT 1 FROM geo_firme g WHERE g.cui = p.cui)
            LIMIT 60000
          `;
    const deLegat = [...clienti, ...dinRegistru];
    if (deLegat.length === 0) {
      return Response.json(
        { error: "Firma n-are clienți alocați pe agenți — n-am cu ce potrivi." },
        { status: 422 },
      );
    }

    const centreRanduri = await db<
      Array<{ localitate: string; lat: number; lng: number }>
    >`
      SELECT localitate, lat, lng FROM geo_localitati
      WHERE lat IS NOT NULL AND lng IS NOT NULL
      LIMIT 20000
    `;
    const centre = new Map(
      centreRanduri.map((c) => [neted(c.localitate), { lat: c.lat, lng: c.lng }]),
    );

    const potriviri = potriveștePuncte(raport.puncte, deLegat, 0.7, centre);
    const sigure = potriviri.filter((p) => p.client && p.scor >= 0.9);
    let scrise = 0;
    for (const g of sigure) {
      const r = await db`
        INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
        SELECT p.cui, ${g.punct.lat}, ${g.punct.lng}, FALSE, FALSE, 'import'
        FROM prospects p
        WHERE p.cui = ${g.client!.cui}
          AND (COALESCE(p.assigned_agent, '') = ''
               OR p.assigned_agent = ANY(${numeAg}))
          -- Ce a pus agentul pe teren nu se atinge: el a fost acolo.
          AND NOT EXISTS (
            SELECT 1 FROM geo_firme gf
            WHERE gf.cui = p.cui AND gf.sursa IN ('deget', 'gps')
          )
        ON CONFLICT (cui) DO UPDATE
          SET lat = EXCLUDED.lat, lng = EXCLUDED.lng,
              aprox = FALSE, failed = FALSE, sursa = 'import',
              updated_at = NOW()
      `;
      if (r.count > 0) scrise++;
    }
    const nesigure = potriviri.filter((p) => !p.client || p.scor < 0.9).length;
    // CIFRA CARE CONTEAZĂ pentru manager: nu „câte pinuri am citit", ci
    // câți dintre CLIENȚII LUI au acum locul exact. Restul hărții sunt
    // firme din registru — bune de avut, dar nu despre ele întreabă el.
    const [acoperire] = await db<[{ cu_loc: string }]>`
      SELECT COUNT(*)::text AS cu_loc
      FROM prospects p
      JOIN org_agents oa ON oa.name = p.assigned_agent
      JOIN geo_firme g ON g.cui = p.cui
      WHERE oa.org_id = ${orgId}
    `;
    const clientiCuLoc = parseInt(acoperire.cu_loc, 10);
    await audit(auth.session.email, "harta.import", orgId, {
      scrise,
      magazine: raport.puncte.length,
      nesigure,
    });
    return Response.json({
      ok: true,
      scrise,
      totalPuncte: raport.puncte.length,
      totalClienti: clienti.length,
      totalDinRegistru: dinRegistru.length,
      nesigure,
      clientiCuLoc,
      faraLocPeHarta: raport.faraLocPeHarta,
      inafara: raport.inafara,
    });
  } catch (e) {
    console.error("[platform harta import]", e);
    return Response.json({ error: "Eroare la importul hărții" }, { status: 500 });
  }
}
