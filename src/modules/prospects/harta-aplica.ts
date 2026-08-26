import { getDB } from "@/lib/db";
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
                 OR p.assigned_agent = ANY(${agenti}))
        `;

  const clienti = await db<FirmaDePotrivit[]>`
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
    totalClienti: clienti,
    totalDinRegistru: registru,
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
               OR p.assigned_agent = ANY(${agenti}))
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
               OR p.assigned_agent = ANY(${agenti}))
          -- Nu ștergem o adresă mai bună cu una identică: doar ce se schimbă.
          AND (COALESCE(p.adresa_livrare, '') IS DISTINCT FROM u.adresa
               OR COALESCE(p.localitate_livrare, '') IS DISTINCT FROM u.localitate)
      `;
      rez.adreseScrise = r.count;
    }
  }

  // ── MAGAZINELE FĂRĂ PERECHE ──
  // Nu se aruncă: sunt magazine adevărate, cu locul pus de mână de cineva
  // care a fost acolo. Fără CUI n-au ce căuta în registrul comun, unde
  // le-ar vedea toate agențiile — stau ale firmei care le-a adus.
  const orfane = potriviri.filter((p) => !p.client);
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
      };
    });
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
              adresa = EXCLUDED.adresa, localitate = EXCLUDED.localitate,
              judet = EXCLUDED.judet, strat = EXCLUDED.strat
      `;
      rez.magazineSalvate += r.count;
    }
  }

  // CIFRA CARE CONTEAZĂ pentru patron: nu „câte pinuri am citit", ci câți
  // dintre CLIENȚII LUI au acum locul exact.
  const [acoperire] = await db<[{ cu_loc: string }]>`
    SELECT COUNT(*)::text AS cu_loc
    FROM prospects p
    JOIN org_agents oa ON oa.name = p.assigned_agent
    JOIN geo_firme g ON g.cui = p.cui
    WHERE oa.org_id = ${orgId}
  `;
  rez.clientiCuLoc = parseInt(acoperire.cu_loc, 10);
  return rez;
}
