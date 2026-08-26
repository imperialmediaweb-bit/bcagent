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

    const cuiuriClienti = new Set(clienti.map((c) => c.cui));
    const potriviri = potriveștePuncte(puncte, deLegat, 0.7, centre);
    const gasite = potriviri.filter((p) => p.client !== null);
    const nepotrivite = potriviri.filter((p) => p.client === null);

    // ── „FĂ TOT SINGUR" ──
    // Nimeni nu se uită la 2450 de rânduri. Scriem singuri potrivirile
    // SIGURE (nume identic sau identic fără forma juridică — pe harta
    // reală, zero greșeli din astea) și-i arătăm doar ce a rămas nesigur.
    // Se poate da înapoi oricând, cu un buton: locurile aduse din hartă
    // sunt marcate, cele puse de agenți nu se ating.
    if (body.automat === true) {
      const { listOrgAgents } = await import("@/modules/platform");
      const numeAg = (await listOrgAgents(auth.session.orgId)).map((a) => a.name);
      const sigure = potriviri.filter((p) => p.client && p.scor >= 0.9);
      let scrise = 0;

      // ADRESA CU NUMĂR, din pin.
      // Pinurile lui Bogdan au un tabel întreg: Cod Fiscal, Adresa („STR
      // PRINCIPALA 183A"), Localitate, Județ. Adresa AIA are număr de
      // casă — registrul Finanțelor n-are, iar fișierul de la BAT scrie
      // „STR. PRINCIPALA" la toate cele 269. Fix asta îi trebuia lui
      // Costin. O punem pe coloana de livrare, fără să atingem sediul.
      const cuAdresa = sigure
        .map((g) => ({
          cui: g.client!.cui,
          adresa: String((g.punct as { adresa?: string }).adresa ?? "").trim().slice(0, 300),
          localitate: String((g.punct as { localitate?: string }).localitate ?? "").trim().slice(0, 120),
        }))
        .filter((r) => r.adresa !== "" || r.localitate !== "");
      let adreseScrise = 0;
      if (cuAdresa.length > 0) {
        const r = await db`
          UPDATE prospects p
          SET adresa_livrare = CASE
                WHEN u.adresa <> '' THEN u.adresa ELSE p.adresa_livrare
              END,
              localitate_livrare = CASE
                WHEN u.localitate <> '' THEN u.localitate ELSE p.localitate_livrare
              END,
              updated_at = NOW()
          FROM jsonb_to_recordset(${db.json(
            cuAdresa as unknown as Parameters<typeof db.json>[0],
          )}) AS u(cui TEXT, adresa TEXT, localitate TEXT)
          WHERE p.cui = u.cui
            AND (COALESCE(p.assigned_agent, '') = ''
                 OR p.assigned_agent = ANY(${numeAg.length ? numeAg : [""]}))
        `;
        adreseScrise = r.count;
      }

      for (const g of sigure) {
        const r = await db`
          INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
          SELECT p.cui, ${g.punct.lat}, ${g.punct.lng}, FALSE, FALSE, 'import'
          FROM prospects p
          WHERE p.cui = ${g.client!.cui}
            AND (COALESCE(p.assigned_agent, '') = ''
                 OR p.assigned_agent = ANY(${numeAg.length ? numeAg : [""]}))
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
      // MAGAZINELE FĂRĂ PERECHE nu se aruncă: sunt magazine ADEVĂRATE, cu
      // locul pus de mână de cineva care a fost acolo — exact ce caută
      // agentul când prospectează. Le ținem deoparte, ale firmei ăsteia,
      // și apar pe harta agenților ei. Fără CUI n-au ce căuta în registrul
      // comun, unde le-ar vedea toate agențiile.
      const orfane = potriviri.filter((p) => !p.client);
      let magazineSalvate = 0;
      if (orfane.length > 0) {
        const randuri = orfane.slice(0, 20000).map((p) => ({
        // Identificator stabil, din NUME + coordonate. Doar din coordonate
        // nu merge: pe harta reală mai multe magazine stau exact în același
        // punct (puse la centrul satului), iar Postgres refuză două rânduri
        // cu același id în aceeași scriere.
        id: `${auth.session.orgId}:${cheieMagazin(p.punct.nume, p.punct.lat, p.punct.lng)}`,
        org_id: auth.session.orgId,
        nume: p.punct.nume.slice(0, 200),
        adresa: (p.punct.descriere ?? "").slice(0, 300),
        localitate: "",
        judet: "",
        lat: p.punct.lat,
        lng: p.punct.lng,
        strat: ((p.punct as { strat?: string }).strat ?? "").slice(0, 120),
      }));
      // Aceeași hartă poate avea două însemnări identice: le păstrăm o dată.
      const unice = Array.from(new Map(randuri.map((r) => [r.id, r])).values());
        for (let i = 0; i < unice.length; i += 500) {
          const bucata = unice.slice(i, i + 500);
          const r = await db`
            INSERT INTO magazin_harta ${db(
              bucata,
              "id", "org_id", "nume", "adresa", "localitate", "judet",
              "lat", "lng", "strat",
            )}
            ON CONFLICT (id) DO UPDATE
              SET nume = EXCLUDED.nume, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
                  adresa = EXCLUDED.adresa, strat = EXCLUDED.strat
          `;
          magazineSalvate += r.count;
        }
      }
      // Câți dintre CLIENȚII firmei au acum locul exact — cifra care
      // contează pentru manager, nu „câte pinuri am citit".
      const [acoperire] = await db<[{ cu_loc: string }]>`
        SELECT COUNT(*)::text AS cu_loc
        FROM prospects p
        JOIN org_agents oa ON oa.name = p.assigned_agent
        JOIN geo_firme g ON g.cui = p.cui
        WHERE oa.org_id = ${auth.session.orgId}
      `;
      const deVazut = potriviri.filter((p) => !p.client || p.scor < 0.9);
      // CÂTE PINURI AVEAU CUI SCRIS ÎN ELE. Cifra asta spune dacă harta e
      // una „cu tabel" (atunci potrivirea e exactă) sau una cu nume goale
      // (atunci ghicim după nume, ca înainte). Omul trebuie s-o vadă.
      const cuCui = puncte.filter(
        (p) => String((p as { cui?: string }).cui ?? "").replace(/\D/g, "") !== "",
      ).length;
      const cuNumar = puncte.filter((p) =>
        /\d/.test(String((p as { adresa?: string }).adresa ?? "")),
      ).length;

      return Response.json({
        ok: true,
        automat: true,
        scrise,
        pinuriCuCui: cuCui,
        adreseCuNumar: cuNumar,
        adreseScrise,
        clientiCuLoc: parseInt(acoperire.cu_loc, 10),
        magazineSalvate,
        totalPuncte: puncte.length,
        totalClienti: clienti.length,
        totalDinRegistru: dinRegistru.length,
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
      totalClienti: clienti.length,
      totalDinRegistru: dinRegistru.length,
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
