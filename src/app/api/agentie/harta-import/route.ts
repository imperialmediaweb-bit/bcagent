import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { requireOrgUser } from "@/modules/platform";
import {
  citesteKML,
  citesteKMLRaport,
  linkDinNetworkLink,
  linkKML,
  midDinLink,
} from "@/modules/prospects/kml";
import { cheieMagazin, potriveștePuncte } from "@/modules/prospects/potrivire";
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
function pentruEcran(p: Potrivire, clientiiMei?: Set<string>) {
  return {
    // Clienții firmei contează cel mai mult; restul sunt firme din registru,
    // bune de avut, dar nu de verificat rând cu rând.
    eClientDeAlMeu: p.client ? (clientiiMei?.has(p.client.cui) ?? false) : false,
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
    /** „Fă tot singur": scrie potrivirile SIGURE, fără să mai întrebe. */
    automat?: boolean;
    /** Șterge locurile aduse din hartă (nu și pe cele puse de agenți). */
    anuleaza?: boolean;
    /**
     * A doua jumătate a aceluiași buton: magazinele din OpenStreetMap.
     * Vine ca o cerere separată nu ca să mai apese omul o dată, ci pentru
     * că Overpass e lent și fiecare cerere are bugetul ei de timp. Pagina
     * o cheamă singură, după hartă.
     */
    osm?: boolean;
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

    // ── ANULARE: ștergem DOAR ce a adus importul ──
    // Ce au pus agenții pe teren („Pune locul", „Sunt aici", „Am fost")
    // rămâne neatins: aia e muncă făcută la fața locului, nu ghicit.
    if (body.anuleaza === true) {
      const { listOrgAgents } = await import("@/modules/platform");
      const numeAg = (await listOrgAgents(auth.session.orgId)).map((a) => a.name);
      const sters = await db`
        DELETE FROM geo_firme g
        USING prospects p
        WHERE p.cui = g.cui
          AND g.sursa = 'import'
          AND (COALESCE(p.assigned_agent, '') = ''
               OR p.assigned_agent = ANY(${numeAg.length ? numeAg : [""]}))
      `;
      return Response.json({ ok: true, sterse: sters.count });
    }

    // ── MAGAZINELE DIN OPENSTREETMAP ──
    // Harta lui Bogdan are magazinele LUI. Registrul Finanțelor are sediul
    // social — la un PFA, casa omului. Ce lipsește sunt magazinele la care
    // n-a ajuns încă nimeni: alimentara din satul fără niciun client.
    // Alea le-au pus pe OSM oameni care au trecut pe-acolo.
    if (body.osm === true) {
      const { listOrgAgents } = await import("@/modules/platform");
      const { planificaOSM, ramaseOSM, starePlanOSM, unJudetOSM } = await import(
        "@/modules/prospects/osm-import"
      );
      const orgId = auth.session.orgId;
      const numeAg = (await listOrgAgents(orgId)).map((a) => a.name);
      // Coada se pune la punct la fiecare apăsare: dacă firma a primit
      // clienți într-un județ nou, intră și el în listă de la sine.
      await planificaOSM(db, orgId);
      const facut = await unJudetOSM(db, orgId, numeAg);
      return Response.json({
        ok: true,
        osm: {
          facut,
          ramase: await ramaseOSM(db, orgId),
          plan: await starePlanOSM(db, orgId),
        },
      });
    }

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
          INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
          SELECT p.cui, ${lat}, ${lng}, FALSE, FALSE, 'import'
          FROM prospects p
          WHERE p.cui = ${cui}
            AND (COALESCE(p.assigned_agent, '') = ''
                 OR p.assigned_agent = ANY(${agenti.length ? agenti : [""]}))
            -- CE A PUS OMUL PE TEREN NU SE ATINGE. Agentul a fost acolo;
            -- importul doar ghicește după nume.
            AND NOT EXISTS (
              SELECT 1 FROM geo_firme g
              WHERE g.cui = p.cui AND g.sursa IN ('deget', 'gps')
            )
          ON CONFLICT (cui) DO UPDATE
            SET lat = EXCLUDED.lat, lng = EXCLUDED.lng,
                aprox = FALSE, failed = FALSE, sursa = 'import',
                updated_at = NOW()
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

    // CINE ESTE agentia, ca sa nu scriem pe firmele altcuiva.
    const { listOrgAgents: listAg } = await import("@/modules/platform");
    const numeleAgentilor = (await listAg(auth.session.orgId)).map((a) => a.name);
    const { aplicaHarta } = await import("@/modules/prospects/harta-aplica");

    // TOATĂ TREABA STĂ ÎNTR-UN SINGUR LOC (modules/prospects/harta-aplica).
    // Înainte era copiată aici și în panoul adminului de platformă, iar de
    // fiecare dată când reparam ceva reparam doar una din ele — de-aia
    // panoul de admin n-a primit niciodată nici potrivirea pe CUI, nici
    // adresa cu număr. Ruta întreabă cine ești și cheamă funcția, atât.
    //
    // „Vreau să văd întâi lista" cheamă exact aceeași funcție, dar cu
    // `doarVezi`: nu scrie nimic. Așa ce vede omul e chiar ce se va
    // întâmpla, nu o socoteală făcută altfel.
    const r = await aplicaHarta(
      db,
      auth.session.orgId,
      numeleAgentilor,
      puncte,
      body.verificaDoar === true,
    );
    if (r.totalClienti === 0 && r.totalDinRegistru === 0) {
      return Response.json(
        {
          error:
            "Firma ta n-are încă niciun client alocat pe agenți — n-am cu ce potrivi pinurile.",
        },
        { status: 422 },
      );
    }
    const cuiuriClienti = new Set(
      (
        await db<Array<{ cui: string }>>`
          SELECT p.cui FROM prospects p
          JOIN org_agents oa ON oa.name = p.assigned_agent
          WHERE oa.org_id = ${auth.session.orgId} LIMIT 20000
        `
      ).map((c) => c.cui),
    );
    const gasite = r.potriviri.filter((p) => p.client !== null);
    const nepotrivite = r.potriviri.filter((p) => p.client === null);

    if (body.automat === true) {
      const deVazut = r.potriviri.filter((p) => !p.client || p.scor < 0.9);
      return Response.json({
        ok: true,
        automat: true,
        scrise: r.scrise,
        legate: r.legate,
        neatinse: r.neatinse,
        adreseScrise: r.adreseScrise,
        pinuriCuCui: r.pinuriCuCui,
        adreseCuNumar: r.adreseCuNumar,
        cuCuiNecunoscut: r.cuCuiNecunoscut,
        clientiCuLoc: r.clientiCuLoc,
        magazineSalvate: r.magazineSalvate,
        totalPuncte: puncte.length,
        totalClienti: r.totalClienti,
        totalDinRegistru: r.totalDinRegistru,
        sarite: {
          faraLocPeHarta: raport.faraLocPeHarta,
          inafara: raport.inafara,
          liniiSiZone: raport.liniiSiZone,
        },
        // Doar ce a rămas nesigur — atât are omul de verificat.
        nepotrivite: deVazut.map((n) => pentruEcran(n, cuiuriClienti)),
      });
    }

    return Response.json({
      ok: true,
      verificare: true,
      totalPuncte: puncte.length,
      totalClienti: r.totalClienti,
      totalDinRegistru: r.totalDinRegistru,
      // Ce n-a intrat și DE CE — ca omul să nu creadă că le-a luat pe toate
      // și să caute pe hartă magazine care n-au fost niciodată puse acolo.
      sarite: {
        faraLocPeHarta: raport.faraLocPeHarta,
        inafara: raport.inafara,
        liniiSiZone: raport.liniiSiZone,
      },
      gasite: gasite.map((g) => pentruEcran(g, cuiuriClienti)),
      nepotrivite: nepotrivite.map((n) => pentruEcran(n, cuiuriClienti)),
    });
  } catch (e) {
    console.error("[harta-import]", e);
    // Mesajul REAL, nu „eroare". Altfel omul se uită la un dreptunghi roșu
    // și n-are ce să-mi spună, iar eu n-am ce repara.
    const detaliu = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
    return Response.json(
      { error: `Eroare la importul hărții: ${detaliu}` },
      { status: 500 },
    );
  }
}
