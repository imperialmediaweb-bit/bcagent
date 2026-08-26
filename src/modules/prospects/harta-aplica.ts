import { getDB } from "@/lib/db";
import { alAgentiei } from "@/lib/org-scope";
import { normalizeCounty } from "./caen";
import { cuiValid, curataCui } from "./cui";
import type { PunctKML } from "./kml";
import { cheieMagazin, neted, potriveștePuncte } from "./potrivire";
import type { Potrivire } from "./potrivire";

/**
 * CE FACEM CU O HARTĂ CITITĂ, într-un singur loc.
 *
 * Până acum logica asta stătea copiată în două rute — panoul firmei și
 * panoul adminului de platformă. De fiecare dată când reparam ceva, o
 * reparam într-una și cealaltă rămânea în urmă: de-aia panoul de admin
 * n-a primit niciodată nici potrivirea pe CUI, nici adresa cu număr.
 *
 * Aici e toată treaba, o dată. Rutele doar întreabă cine ești și cheamă
 * funcția. Ce se schimbă, se schimbă pentru amândouă.
 *
 * REGULILE, scrise ca să nu se piardă:
 *   1. CUI-ul din pin bate orice. Nu ghicim după nume când răspunsul e
 *      scris în pin; iar dacă acel CUI nu e al firmei, punctul rămâne de
 *      prospectat — nu-l lipim de altcineva cu nume asemănător.
 *   2. Ce a pus agentul pe teren („deget"/„gps") NU se atinge niciodată.
 *      El a fost acolo; importul doar citește o hartă.
 *   3. Ce e deja exact la locul lui nu se rescrie — altfel a doua apăsare
 *      ar raporta aceeași muncă a doua oară.
 *   4. Nu scriem pe firmele altei agenții. Registrul e comun.
 *   5. Ce n-are pereche nu se aruncă: rămâne punct de prospectare, al
 *      firmei care l-a adus.
 */

type DB = NonNullable<ReturnType<typeof getDB>>;

export interface FirmaDePotrivit {
  cui: string;
  denumire: string;
  localitate: string;
}

export interface RezultatHarta {
  /** Locuri scrise ACUM (nu și cele care erau deja la locul lor). */
  scrise: number;
  /** Firme legate de un pin, sigur — inclusiv cele deja bune. */
  legate: number;
  /** Erau deja acolo, sau puse de agent: nu le-am atins. */
  neatinse: number;
  /** Firme cărora le-am pus adresa cu număr, din pin. */
  adreseScrise: number;
  /** Magazine fără pereche, păstrate pentru prospectare. */
  magazineSalvate: number;
  /** Câte pinuri aveau CUI scris în ele. */
  pinuriCuCui: number;
  /** Câte pinuri aveau adresă cu număr de casă. */
  adreseCuNumar: number;
  /** Câți clienți ai firmei au acum locul exact. */
  clientiCuLoc: number;
  /**
   * Pinuri cu CUI scris, dar al cărui CUI nu e nicăieri în baza noastră.
   * Fără cifra asta, „1634 n-am putut lega" nu spune nimic: omul nu știe
   * dacă e vina potrivirii sau pur și simplu firme pe care nu le avem.
   */
  cuCuiNecunoscut: number;
  /**
   * Firme ADUSE ÎN REGISTRU din hartă: aveau CUI valid, nume, adresă cu
   * număr și loc exact, dar nu existau nicăieri la noi.
   */
  firmeNoi: number;
  /** Aveau CUI, dar cifra de control zice că nu-i CUI: nu le-am băgat. */
  cuiStricat: number;
  totalClienti: number;
  totalDinRegistru: number;
  /** Potrivirile, ca să le poată arăta ruta pe ecran. */
  potriviri: Potrivire[];
}

/** Sub ~50 m e același loc (0,0005° latitudine ≈ 55 m). */
function acelasiLoc(
  a: { lat: number; lng: number },
  lat: number,
  lng: number,
): boolean {
  return Math.abs(a.lat - lat) < 0.0005 && Math.abs(a.lng - lng) < 0.0007;
}

/**
 * CU CINE POTRIVIM.
 *
 * Trei izvoare, în ordinea în care merită încredere:
 *   1. firmele al căror CUI e scris chiar în pinuri — cerute pe nume, nu
 *      căutate prin listă. Așa nu mai contează dacă au primit deja un loc
 *      ieri (înainte le scoteam din listă, și tocmai de-aia a doua apăsare
 *      potrivea mai puțin decât prima) și nu mai poate fi tăiată lista;
 *   2. clienții firmei;
 *   3. restul registrului din județele ei, pentru pinurile fără CUI.
 */
async function firmeDePotrivit(
  db: DB,
  orgId: string,
  numeAgenti: string[],
  puncte: PunctKML[],
): Promise<{ toate: FirmaDePotrivit[]; clienti: number; registru: number }> {
  const agenti = numeAgenti.length ? numeAgenti : [""];

  const cuiuri = [
    ...new Set(
      puncte
        .map((p) => String(p.cui ?? "").replace(/\D/g, ""))
        .filter((c) => c.length >= 2),
    ),
  ].slice(0, 20000);
  const dupaCui =
    cuiuri.length === 0
      ? []
      : await db<FirmaDePotrivit[]>`
          SELECT p.cui, p.denumire, COALESCE(p.localitate, '') AS localitate
          FROM prospects p
          WHERE p.cui = ANY(${cuiuri})
            AND (COALESCE(p.assigned_agent, '') = ''
                 OR ${alAgentiei(db, orgId, agenti)})
        `;

  const clienti = await db<FirmaDePotrivit[]>`
    SELECT p.cui, p.denumire, COALESCE(p.localitate, '') AS localitate
    FROM prospects p
    JOIN org_agents oa ON oa.name = p.assigned_agent AND (p.assigned_org = '' OR p.assigned_org = oa.org_id)
    WHERE oa.org_id = ${orgId}
    LIMIT 20000
  `;

  const judete = (
    await db<Array<{ judet: string }>>`
      SELECT DISTINCT p.judet FROM prospects p
      JOIN org_agents oa ON oa.name = p.assigned_agent AND (p.assigned_org = '' OR p.assigned_org = oa.org_id)
      WHERE oa.org_id = ${orgId} AND COALESCE(p.judet, '') <> ''
    `
  ).map((r) => r.judet);

  const registru =
    judete.length === 0
      ? []
      : await db<FirmaDePotrivit[]>`
          SELECT p.cui, p.denumire, COALESCE(p.localitate, '') AS localitate
          FROM prospects p
          WHERE p.judet = ANY(${judete})
            AND COALESCE(p.assigned_agent, '') = ''
            AND p.activ IS DISTINCT FROM FALSE
            AND NOT EXISTS (SELECT 1 FROM geo_firme g WHERE g.cui = p.cui)
          LIMIT 60000
        `;

  // Fără dubluri: o firmă poate fi și în pinuri, și client.
  const vazut = new Set<string>();
  const toate: FirmaDePotrivit[] = [];
  for (const f of [...dupaCui, ...clienti, ...registru]) {
    if (vazut.has(f.cui)) continue;
    vazut.add(f.cui);
    toate.push(f);
  }
  return { toate, clienti: clienti.length, registru: registru.length };
}

/**
 * Aplică o hartă citită: potrivește, scrie locurile și adresele, păstrează
 * magazinele fără pereche.
 *
 * @param doarVezi nu scrie nimic, doar spune ce ar face
 */
export async function aplicaHarta(
  db: DB,
  orgId: string,
  numeAgenti: string[],
  puncte: PunctKML[],
  doarVezi = false,
): Promise<RezultatHarta> {
  const agenti = numeAgenti.length ? numeAgenti : [""];
  const { toate, clienti, registru } = await firmeDePotrivit(
    db,
    orgId,
    agenti,
    puncte,
  );

  // Centrele satelor: două firme cu același nume din sate diferite se
  // deosebesc după distanța până la pin, nu după noroc.
  const centre = new Map(
    (
      await db<Array<{ localitate: string; lat: number; lng: number }>>`
        SELECT localitate, lat, lng FROM geo_localitati
        WHERE lat IS NOT NULL AND lng IS NOT NULL LIMIT 20000
      `
    ).map((c) => [neted(c.localitate), { lat: c.lat, lng: c.lng }]),
  );

  const potriviri = potriveștePuncte(puncte, toate, 0.7, centre);
  const sigure = potriviri.filter((p) => p.client && p.scor >= 0.9);
  const stiute = new Set(toate.map((f) => f.cui));

  const rez: RezultatHarta = {
    scrise: 0,
    legate: sigure.length,
    neatinse: 0,
    adreseScrise: 0,
    magazineSalvate: 0,
    pinuriCuCui: puncte.filter(
      (p) => String(p.cui ?? "").replace(/\D/g, "") !== "",
    ).length,
    adreseCuNumar: puncte.filter((p) => /\d/.test(String(p.adresa ?? ""))).length,
    clientiCuLoc: 0,
    firmeNoi: 0,
    cuiStricat: 0,
    totalClienti: clienti,
    totalDinRegistru: registru,
    cuCuiNecunoscut: puncte.filter((p) => {
      const c = String(p.cui ?? "").replace(/\D/g, "");
      return c !== "" && !stiute.has(c);
    }).length,
    potriviri,
  };

  if (!doarVezi && sigure.length > 0) {
    // ── LOCURILE ──
    const acumAu = new Map(
      (
        await db<
          Array<{ cui: string; lat: number; lng: number; aprox: boolean; sursa: string }>
        >`
          SELECT cui, lat, lng, aprox, sursa FROM geo_firme
          WHERE cui = ANY(${sigure.map((g) => g.client!.cui)})
        `
      ).map((r) => [r.cui, r]),
    );
    for (const g of sigure) {
      const are = acumAu.get(g.client!.cui);
      // Ce a pus omul pe teren nu se atinge, iar ce e deja exact acolo nu
      // se rescrie degeaba (altfel a doua apăsare raportează aceeași muncă).
      if (are && (are.sursa === "deget" || are.sursa === "gps")) {
        rez.neatinse++;
        continue;
      }
      if (are && !are.aprox && acelasiLoc(are, g.punct.lat, g.punct.lng)) {
        rez.neatinse++;
        continue;
      }
      const r = await db`
        INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
        SELECT p.cui, ${g.punct.lat}, ${g.punct.lng}, FALSE, FALSE, 'import'
        FROM prospects p
        WHERE p.cui = ${g.client!.cui}
          AND (COALESCE(p.assigned_agent, '') = ''
               OR ${alAgentiei(db, orgId, agenti)})
          AND NOT EXISTS (
            SELECT 1 FROM geo_firme gf
            WHERE gf.cui = p.cui AND gf.sursa IN ('deget', 'gps')
          )
        ON CONFLICT (cui) DO UPDATE
          SET lat = EXCLUDED.lat, lng = EXCLUDED.lng,
              aprox = FALSE, failed = FALSE, sursa = 'import', updated_at = NOW()
      `;
      if (r.count > 0) rez.scrise++;
      else rez.neatinse++;
    }

    // ── ADRESA CU NUMĂR, din pin ──
    // Registrul dă sediul social — la un PFA, casa omului. Pinurile lui
    // Bogdan au adresa magazinului, cu număr („STR PRINCIPALA 183A").
    // O punem pe coloana de livrare: sediul social rămâne neatins.
    const cuAdresa = sigure
      .map((g) => ({
        cui: g.client!.cui,
        adresa: String((g.punct as PunctKML).adresa ?? "").trim().slice(0, 300),
        localitate: String((g.punct as PunctKML).localitate ?? "").trim().slice(0, 120),
      }))
      .filter((r) => r.adresa !== "" || r.localitate !== "");
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
               OR ${alAgentiei(db, orgId, agenti)})
          -- Nu ștergem o adresă mai bună cu una identică: doar ce se schimbă.
          AND (COALESCE(p.adresa_livrare, '') IS DISTINCT FROM u.adresa
               OR COALESCE(p.localitate_livrare, '') IS DISTINCT FROM u.localitate)
      `;
      rez.adreseScrise = r.count;
    }
  }

  // ── FIRMELE PE CARE NU LE AVEAM ──
  //
  // Din harta lui Bogdan, 1634 de pinuri au CUI-uri care nu-s nicăieri în
  // registrul nostru. Nu-s greșeli: sunt firme adevărate, cu nume, cod
  // fiscal, adresă cu număr și loc pus de mână de cineva care a fost
  // acolo. Registrul de la Finanțe nu le-a adus (PFA-uri, firme din alte
  // județe) — dar ele există și agenții lor au fost deja la ușa lor.
  //
  // Le aducem în registru ca PROSPECȚI, nealocate: registrul e comun, iar
  // un CUI cu o denumire și o adresă e un FAPT, nu o informație
  // comercială. Ce e al firmei — cine e clientul cui, ce s-a vorbit —
  // rămâne mascat, ca la toate celelalte.
  //
  // Două paze, fiindcă un rând stricat aici îl vede toată platforma:
  //   · CIFRA DE CONTROL a CUI-ului. Un telefon, un an, un cod intern —
  //     niciunul nu trece. Ce nu trece rămâne doar punct pe hartă.
  //   · `DO NOTHING` la conflict: nu atingem NICIODATĂ o firmă existentă.
  const orfaneCuCui: Array<{ p: Potrivire; cui: string }> = [];
  const cuiuriNoi = new Set<string>();
  for (const p of potriviri) {
    if (p.client) continue;
    const k = p.punct as PunctKML;
    const brut = String(k.cui ?? "");
    if (curataCui(brut) === "") continue;
    if (!cuiValid(brut)) {
      rez.cuiStricat++;
      continue;
    }
    const cui = curataCui(brut);
    if (stiute.has(cui) || cuiuriNoi.has(cui)) continue;
    cuiuriNoi.add(cui);
    orfaneCuCui.push({ p, cui });
  }

  if (!doarVezi && orfaneCuCui.length > 0) {
    const randuri = orfaneCuCui.slice(0, 20000).map(({ p, cui }) => {
      const k = p.punct as PunctKML;
      return {
        cui,
        // Denumirea din acte, dacă pinul o are; altfel numele de pe firmă.
        denumire: (k.numeLegal || p.punct.nume).slice(0, 200),
        adresa: String(k.adresa ?? "").slice(0, 300),
        localitate: String(k.localitate ?? "").slice(0, 120),
        judet: normalizeCounty(String(k.judet ?? "")).slice(0, 2),
        status: "nou",
        // Cine a adus-o. Fără asta nu se poate spune nici ce a adus
        // butonul, nici de ce firma n-are CAEN.
        adus_de_org: orgId,
      };
    });
    for (let i = 0; i < randuri.length; i += 500) {
      const bucata = randuri.slice(i, i + 500);
      const r = await db`
        INSERT INTO prospects ${db(
          bucata,
          "cui", "denumire", "adresa", "localitate", "judet", "status",
          "adus_de_org",
        )}
        -- NICIODATĂ peste o firmă care există deja. Dacă a apărut între
        -- timp, a ei e denumirea de la Finanțe, nu cea de pe hartă.
        ON CONFLICT (cui) DO NOTHING
      `;
      rez.firmeNoi += r.count;
    }
    // Și LOCUL lor, care e tot ce le face folositoare: pus de mână, exact.
    for (const { p, cui } of orfaneCuCui) {
      await db`
        INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
        SELECT pr.cui, ${p.punct.lat}, ${p.punct.lng}, FALSE, FALSE, 'import'
        FROM prospects pr
        WHERE pr.cui = ${cui}
          -- NU SCRIEM PE FIRMELE ALTEI AGENȚII. Un CUI din harta noastră
          -- poate fi clientul vecinului: firma lui nu se atinge, nici
          -- măcar cu o coordonată. Testul a prins-o — fără rândul ăsta,
          -- importul lui Bogdan muta locurile clienților altcuiva.
          AND (COALESCE(pr.assigned_agent, '') = ''
               OR ${alAgentiei(db, orgId, agenti)})
          AND NOT EXISTS (
            SELECT 1 FROM geo_firme g
            WHERE g.cui = pr.cui AND g.sursa IN ('deget', 'gps')
          )
        ON CONFLICT (cui) DO UPDATE
          SET lat = EXCLUDED.lat, lng = EXCLUDED.lng,
              aprox = FALSE, failed = FALSE, sursa = 'import', updated_at = NOW()
      `;
    }
  }

  // ── MAGAZINELE FĂRĂ PERECHE ──
  // Nu se aruncă: sunt magazine adevărate, cu locul pus de mână de cineva
  // care a fost acolo. Fără CUI n-au ce căuta în registrul comun, unde
  // le-ar vedea toate agențiile — stau ale firmei care le-a adus.
  // PRIMUL pin al unei firme noi îi devine locul ei pe hartă — n-are rost
  // să-l punem și ca punct mov alături: agentul ar vedea două lucruri
  // pentru același magazin și n-ar ști la care să intre.
  //
  // AL DOILEA pin al ACELEIAȘI firme rămâne însă punct pe hartă, dinadins:
  // e al doilea magazin al ei. Ovi Tacomax are șase, iar unul dintre
  // clienții din harta lui Bogdan are treizeci. Firma ține un singur loc;
  // restul magazinelor ar dispărea dacă nu le-am păstra aici — și agentul
  // ar crede că are o oprire, când are șase.
  const devenitFirma = new Set(orfaneCuCui.map((x) => x.p));
  const orfane = potriviri.filter((p) => !p.client && !devenitFirma.has(p));
  if (!doarVezi && orfane.length > 0) {
    const randuri = orfane.slice(0, 20000).map((p) => {
      const k = p.punct as PunctKML;
      return {
        // Identificator stabil, din NUME + coordonate. Doar din coordonate
        // nu merge: pe harta reală mai multe magazine stau exact în același
        // punct, iar Postgres refuză două rânduri cu același id.
        id: `${orgId}:${cheieMagazin(p.punct.nume, p.punct.lat, p.punct.lng)}`,
        org_id: orgId,
        nume: p.punct.nume.slice(0, 200),
        // Ce știm despre el: felul locului și adresa din pin, dacă le are.
        adresa: [k.fel, k.adresa].filter(Boolean).join(" · ").slice(0, 300) ||
          (p.punct.descriere ?? "").slice(0, 300),
        localitate: String(k.localitate ?? "").slice(0, 120),
        judet: String(k.judet ?? "").slice(0, 60),
        lat: p.punct.lat,
        lng: p.punct.lng,
        strat: String(k.strat ?? "").slice(0, 120),
        // CINE E. 1634 de pinuri au CUI-uri care nu-s în registrul nostru
        // — firme adevărate, doar necunoscute nouă. Fără astea, agentul
        // vedea un punct mov fără nume; cu ele, știe la cine intră și
        // poate cere pe loc firma în listă.
        cui: String(k.cui ?? "").replace(/\D/g, "").slice(0, 12),
        nume_legal: String(k.numeLegal ?? "").slice(0, 200),
      };
    });
    const unice = Array.from(new Map(randuri.map((r) => [r.id, r])).values());
    for (let i = 0; i < unice.length; i += 500) {
      const bucata = unice.slice(i, i + 500);
      const r = await db`
        INSERT INTO magazin_harta ${db(
          bucata,
          "id", "org_id", "nume", "adresa", "localitate", "judet",
          "lat", "lng", "strat", "cui", "nume_legal",
        )}
        ON CONFLICT (id) DO UPDATE
          SET nume = EXCLUDED.nume, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
              adresa = EXCLUDED.adresa, localitate = EXCLUDED.localitate,
              judet = EXCLUDED.judet, strat = EXCLUDED.strat,
              cui = EXCLUDED.cui, nume_legal = EXCLUDED.nume_legal
      `;
      rez.magazineSalvate += r.count;
    }
  }

  // CIFRA CARE CONTEAZĂ pentru patron: nu „câte pinuri am citit", ci câți
  // dintre CLIENȚII LUI au acum locul exact.
  const [acoperire] = await db<[{ cu_loc: string }]>`
    SELECT COUNT(*)::text AS cu_loc
    FROM prospects p
    JOIN org_agents oa ON oa.name = p.assigned_agent AND (p.assigned_org = '' OR p.assigned_org = oa.org_id)
    JOIN geo_firme g ON g.cui = p.cui
    WHERE oa.org_id = ${orgId}
  `;
  rez.clientiCuLoc = parseInt(acoperire.cu_loc, 10);
  return rez;
}

/** Ce a scos anularea, ca butonul să nu promită mai mult decât face. */
export interface RezultatAnulare {
  /** Locuri de pe firme, șterse. */
  locuri: number;
  /** Puncte de magazin aduse de import, șterse. */
  magazine: number;
  /** Magazine păstrate fiindcă un agent le-a atins (confirmat, tăiat,
   *  adăugat de el, sau a fost în vizită acolo). */
  pastrate: number;
  /** Firme noi intrate în registrul comun — nu se pot scoate de aici. */
  firmeRamase: number;
}

/**
 * „ANULEAZĂ CE AM ADUS", spus cinstit.
 *
 * Butonul ștergea doar locurile firmelor. Magazinele aduse din hartă și
 * din OpenStreetMap rămâneau pe hartă, iar omul apăsa a doua oară
 * crezând că n-a mers. Acum scoate și punctele aduse de import.
 *
 * CE NU SE ATINGE, niciodată:
 *   · locul pus de un agent cu degetul sau cu GPS-ul;
 *   · magazinul confirmat, tăiat sau adăugat de un agent pe teren;
 *   · magazinul la care s-a înregistrat o vizită;
 *   · firmele noi intrate în registru. Registrul e COMUN tuturor
 *     agențiilor: un CUI cu denumire și adresă e un fapt, iar un buton
 *     apăsat la o firmă n-are voie să șteargă date de sub picioarele
 *     celorlalte. Le numărăm și i-o spunem, nu le ștergem pe furiș.
 */
export async function anuleazaImportul(
  db: DB,
  orgId: string,
  numeAgenti: string[],
): Promise<RezultatAnulare> {
  const agenti = numeAgenti.length ? numeAgenti : [""];
  const locuri = await db`
    DELETE FROM geo_firme g
    USING prospects p
    WHERE p.cui = g.cui
      AND g.sursa = 'import'
      AND (COALESCE(p.assigned_agent, '') = ''
           OR ${alAgentiei(db, orgId, agenti)})
  `;
  // Câte magazine ale firmei poartă urma unui agent: alea rămân.
  const [p] = await db<[{ n: string }]>`
    SELECT COUNT(*)::text AS n FROM magazin_harta m
    WHERE m.org_id = ${orgId}
      AND (COALESCE(m.adaugat_de,'') <> ''
           OR COALESCE(m.stare,'') <> ''
           OR EXISTS (SELECT 1 FROM visits v WHERE v.magazin_id = m.id))
  `;
  const magazine = await db`
    DELETE FROM magazin_harta m
    WHERE m.org_id = ${orgId}
      -- Pus de import, nu de un om: fără nume de agent pe el...
      AND COALESCE(m.adaugat_de,'') = ''
      -- ...neatins de nimeni pe teren...
      AND COALESCE(m.stare,'') = ''
      -- ...și fără nicio vizită scrisă pe el.
      AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.magazin_id = m.id)
  `;
  // Firmele intrate în registru din harta ACESTEI firme. Le numărăm ca să
  // scrie negru pe alb ce rămâne în urmă — nu le ștergem.
  const [f] = await db<[{ n: string }]>`
    SELECT COUNT(*)::text AS n
    FROM prospects pr WHERE pr.adus_de_org = ${orgId}
  `;
  return {
    locuri: locuri.count,
    magazine: magazine.count,
    pastrate: parseInt(p.n, 10),
    firmeRamase: parseInt(f.n, 10),
  };
}
