import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { requireOrgUser } from "@/modules/platform";
import {
  citesteKML,
  citesteKMLRaport,
  linkDinNetworkLink,
  linkKML,
  midDinLink,
} from "@/modules/prospects/kml";
import { potriveștePuncte } from "@/modules/prospects/potrivire";
import type { Potrivire } from "@/modules/prospects/potrivire";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * IMPORTĂ LOCAȚIILE DIN GOOGLE MY MAPS.
 *
 * „Aveam linkul ăsta de la firma veche… cu locații mai actualizate. Poate
 * îl poți integra." (Bogdan, 26.08). Pe harta aia magazinele sunt puse
 * punct cu punct, de mână, de-a lungul anilor — cele mai bune coordonate
 * care există pentru clienții lor.
 *
 * Fluxul are DOUĂ trepte, dinadins:
 *   1. „Vezi ce am înțeles" — descarcă harta, potrivește pinurile cu
 *      clienții firmei și arată tabelul, fără să scrie nimic;
 *   2. „Salvează" — scrie DOAR potrivirile confirmate.
 *
 * Un pin pus greșit trimite agentul la altă adresă, iar el va crede
 * aplicația, nu ochii. De-aia nimic nu intră fără ca omul să vadă întâi.
 */

interface ClientRand {
  cui: string;
  denumire: string;
  localitate: string;
}

/** Ce trimitem înapoi pentru un pin — destul cât să poată verifica omul. */
function pentruEcran(p: Potrivire) {
  return {
    nume: p.punct.nume,
    strat: (p.punct as { strat?: string }).strat ?? "",
    lat: p.punct.lat,
    lng: p.punct.lng,
    cui: p.client?.cui ?? "",
    denumire: p.client?.denumire ?? "",
    localitate: p.client?.localitate ?? "",
    scor: p.scor,
    motiv: p.motiv,
    variante: p.variante.map((v) => ({
      cui: v.cui,
      denumire: v.denumire,
      localitate: v.localitate,
    })),
  };
}

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;

  let body: {
    link?: string;
    /** Fișierul KML lipit de om, când linkul nu merge. */
    kml?: string;
    /** Doar arată ce ai înțeles, nu scrie nimic. */
    verificaDoar?: boolean;
    /** La salvare: perechile confirmate de om (cui ↔ coordonate). */
    confirmate?: Array<{ cui?: string; lat?: number; lng?: number }>;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();

    // ── treapta 2: scriem ce a confirmat omul ──
    if (!body.verificaDoar && Array.isArray(body.confirmate)) {
      const { listOrgAgents } = await import("@/modules/platform");
      const agenti = (await listOrgAgents(auth.session.orgId)).map((a) => a.name);
      let scrise = 0;
      let sarite = 0;
      for (const c of body.confirmate.slice(0, 5000)) {
        const cui = String(c.cui ?? "").replace(/\D/g, "");
        const lat = Number(c.lat);
        const lng = Number(c.lng);
        if (
          cui === "" ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lng) ||
          lat < 43.3 || lat > 48.4 || lng < 20.1 || lng > 30.1
        ) {
          sarite++;
          continue;
        }
        // IZOLARE: scriem doar pe firmele agenției noastre. Registrul e
        // comun — pinul altei agenții nu se atinge.
        const r = await db`
          INSERT INTO geo_firme (cui, lat, lng, aprox, failed)
          SELECT p.cui, ${lat}, ${lng}, FALSE, FALSE
          FROM prospects p
          WHERE p.cui = ${cui}
            AND (COALESCE(p.assigned_agent, '') = ''
                 OR p.assigned_agent = ANY(${agenti.length ? agenti : [""]}))
          ON CONFLICT (cui) DO UPDATE
            SET lat = EXCLUDED.lat, lng = EXCLUDED.lng,
                aprox = FALSE, failed = FALSE, updated_at = NOW()
        `;
        if (r.count > 0) scrise++;
        else sarite++;
      }
      return Response.json({ ok: true, scrise, sarite });
    }

    // ── treapta 1: descarcă harta și arată ce a înțeles ──
    // Omul poate lipi FIȘIERUL direct — util când harta nu e publică sau
    // când Google nu răspunde. Atunci n-avem ce descărca.
    const kmlLipit = String(body.kml ?? "").slice(0, 12_000_000);
    const mid = midDinLink(String(body.link ?? ""));
    if (kmlLipit.trim() === "" && mid === "") {
      return Response.json(
        {
          error:
            "Nu recunosc linkul. Deschide harta în Google My Maps, apasă pe Partajează și lipește aici adresa — trebuie să conțină mid=…",
        },
        { status: 400 },
      );
    }

    let kml = kmlLipit;
    /** Descarcă o adresă de KML de la Google. Aruncă la orice necaz. */
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
      const res = await fetch(linkKML(mid), {
        headers: { "User-Agent": "bcagent-saas/1.0 (import My Maps)" },
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) {
        return Response.json(
          {
            error:
              res.status === 404 || res.status === 403
                ? "Harta nu e publică. În My Maps: Partajează → Oricine are linkul poate vedea, apoi încearcă din nou."
                : `Google a răspuns cu ${res.status}. Încearcă peste un minut.`,
          },
          { status: 502 },
        );
      }
      kml = await res.text();
    } catch {
      return Response.json(
        {
          error:
            "N-am putut descărca harta de la Google. Încearcă din nou — sau exportă harta din My Maps (KML) și lipește fișierul mai jos.",
        },
        { status: 502 },
      );
    }
    }

    // EXPORTUL POATE FI DOAR UN INDICATOR: „Exportă harta întreagă" dă un
    // fișier care conține un link către date, nu datele. Îl urmăm o dată.
    let raport = citesteKMLRaport(kml);
    let puncte = raport.puncte;
    if (puncte.length === 0) {
      const catre = linkDinNetworkLink(kml);
      if (catre !== "") {
        try {
          kml = await descarca(catre);
          raport = citesteKMLRaport(kml);
          puncte = raport.puncte;
        } catch {
          return Response.json(
            {
              error:
                "Fișierul ăsta nu conține magazinele, doar un link către ele — iar linkul nu răspunde. În My Maps, exportă un STRAT (nu harta întreagă) și bifează exportul în KML, nu în KMZ.",
            },
            { status: 422 },
          );
        }
      }
    }
    if (puncte.length === 0) {
      return Response.json(
        {
          error:
            "Harta n-are niciun punct pe care să-l pot citi. Verifică dacă are magazine puse ca pinuri (nu doar linii sau zone).",
        },
        { status: 422 },
      );
    }

    // CU CINE POTRIVIM. Întâi clienții firmei — ei contează cel mai mult.
    // Dar harta veche are magazine din tot județul, iar multe sunt firme
    // din registru la care agenții încă n-au ajuns. Și alea merită locul
    // lor: când agentul dă peste ele în prospectare, îl duce la ușă, nu în
    // centrul satului. Unde stă un magazin e un FAPT, nu o informație
    // comercială — la fel ca pinul pus din teren cu „Sunt aici".
    const clienti = await db<ClientRand[]>`
      SELECT p.cui, p.denumire, COALESCE(p.localitate, '') AS localitate
      FROM prospects p
      JOIN org_agents oa ON oa.name = p.assigned_agent
      WHERE oa.org_id = ${auth.session.orgId}
      LIMIT 20000
    `;
    // Doar în județele în care lucrează firma — nu potrivim cu toată țara.
    const judete = (
      await db<Array<{ judet: string }>>`
        SELECT DISTINCT p.judet FROM prospects p
        JOIN org_agents oa ON oa.name = p.assigned_agent
        WHERE oa.org_id = ${auth.session.orgId} AND COALESCE(p.judet, '') <> ''
      `
    ).map((r) => r.judet);
    // Firmele NEALOCATE care încă n-au loc pe hartă. Cele care au deja un
    // pin nu se ating: acolo a fost cineva pe teren, iar ce a pus omul bate
    // orice import.
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
        {
          error:
            "Firma ta n-are încă niciun client alocat pe agenți — n-am cu ce potrivi pinurile.",
        },
        { status: 422 },
      );
    }

    // Centrele satelor: cu ele, două firme cu același nume din sate
    // diferite nu se mai confundă — decide distanța până la pin.
    const centreRanduri = await db<
      Array<{ localitate: string; lat: number; lng: number }>
    >`
      SELECT localitate, lat, lng FROM geo_localitati
      WHERE lat IS NOT NULL AND lng IS NOT NULL
      LIMIT 20000
    `;
    const { neted } = await import("@/modules/prospects/potrivire");
    const centre = new Map(
      centreRanduri.map((c) => [neted(c.localitate), { lat: c.lat, lng: c.lng }]),
    );

    const potriviri = potriveștePuncte(puncte, deLegat, 0.7, centre);
    const gasite = potriviri.filter((p) => p.client !== null);
    const nepotrivite = potriviri.filter((p) => p.client === null);

    return Response.json({
      ok: true,
      verificare: true,
      totalPuncte: puncte.length,
      totalClienti: clienti.length,
      totalDinRegistru: dinRegistru.length,
      // Ce n-a intrat și DE CE — ca omul să nu creadă că le-a luat pe toate
      // și să caute pe hartă magazine care n-au fost niciodată puse acolo.
      sarite: {
        faraLocPeHarta: raport.faraLocPeHarta,
        inafara: raport.inafara,
        liniiSiZone: raport.liniiSiZone,
      },
      gasite: gasite.map(pentruEcran),
      nepotrivite: nepotrivite.map(pentruEcran),
    });
  } catch (e) {
    console.error("[harta-import]", e);
    return Response.json({ error: "Eroare la importul hărții" }, { status: 500 });
  }
}
