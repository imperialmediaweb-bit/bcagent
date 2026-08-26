import { getDB } from "@/lib/db";
import {
  citesteOverpass,
  intrebareJudet,
  remarcaOverpass,
  SERVERE_OVERPASS,
} from "./overpass";
import { cheieMagazin, neted, potriveștePuncte } from "./potrivire";

/**
 * MAGAZINELE DIN OPENSTREETMAP, ca o COADĂ DE LUCRU.
 *
 * Registrul Finanțelor are sediul social — la un PFA, casa omului. Harta
 * lui Bogdan are magazinele LUI. Ce lipsește sunt magazinele la care n-a
 * ajuns nimeni: alimentara din satul unde firma n-are încă niciun client.
 * OpenStreetMap le are, puse de oameni care au trecut pe-acolo.
 *
 * PRIMA VARIANTĂ A FOST GREȘITĂ și merită scris de ce, ca să nu se mai
 * facă: o cerere lua toate județele pe rând. Suceava (cei mai mulți
 * clienți, deci prima) mânca tot timpul, iar Botoșani și Iași apucau
 * câteva secunde — destul cât Overpass să răspundă „am depășit timpul",
 * adică o listă goală. Pe ecran ieșea „BT: 0 magazine", care e minciună.
 *
 * Acum fiecare județ e o TREABĂ cu starea ei, într-o coadă. O ia:
 *   · omul, când apasă „Adu locațiile" — un județ pe apăsare, pagina
 *     cheamă mai departe singură și-i arată pe unde e;
 *   · cronul, când nu așteaptă nimeni — și atunci se duce mai departe,
 *     peste toată Moldova, nu doar unde au deja clienți.
 * Amândoi iau din același loc. Nimeni nu așteaptă degeaba, nimic nu se
 * face de două ori, iar ce n-a ieșit rămâne scris — cu motivul.
 */

type DB = NonNullable<ReturnType<typeof getDB>>;

/**
 * JUDEȚELE VECINE, CALCULATE DIN DATELE FIRMEI.
 *
 * Un distribuitor nu se oprește la granița județului: vecinii sunt la o
 * oră de mers, iar harta ar rămâne goală fix acolo unde ar avea de
 * crescut.
 *
 * Aveam aici o listă scrisă de mine: „Moldova = SV, BT, IS, NT, BC, VS,
 * VN, GL". Era bună pentru Uvertura și pentru nimeni altcineva —
 * platforma nu e a unei singure firme. Pentru un distribuitor din
 * Timișoara, lista aia nu însemna nimic.
 *
 * Acum se calculează: luăm mijlocul județelor în care firma ARE clienți
 * și adăugăm județele aflate la mai puțin de `KM_VECIN`. Mijlocul îl
 * scoatem din localitățile pe care le avem deja pe hartă — date, nu
 * presupuneri. Merge la fel în Suceava și în Timiș.
 */
const KM_VECIN = 130;

/** Distanța dintre două locuri, în kilometri. */
function kmIntre(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Județele vecine celor în care firma are clienți, după mijlocul lor
 * geografic. Dacă n-avem de unde ști mijlocul, nu inventăm: întoarcem
 * lista goală și rămân doar județele lor.
 */
export async function judeteVecine(
  db: DB,
  aleLor: string[],
): Promise<string[]> {
  if (aleLor.length === 0) return [];
  const mijloc = await db<Array<{ judet: string; lat: number; lng: number }>>`
    SELECT judet, AVG(lat)::float8 AS lat, AVG(lng)::float8 AS lng
    FROM geo_localitati
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND judet <> ''
    GROUP BY judet
    HAVING COUNT(*) >= 5
  `;
  const dupaJudet = new Map(mijloc.map((m) => [m.judet, m]));
  const ale = aleLor.map((j) => dupaJudet.get(j)).filter((x) => x !== undefined);
  if (ale.length === 0) return [];
  const vecini: string[] = [];
  for (const m of mijloc) {
    if (aleLor.includes(m.judet)) continue;
    if (ale.some((a) => kmIntre(a!, m) <= KM_VECIN)) vecini.push(m.judet);
  }
  return vecini;
}

export interface TreabaOSM {
  judet: string;
  stare: string;
  motiv: string;
  magazine: number;
  locuri: number;
  noi: number;
  eroare: string;
}

export interface RezultatJudet {
  judet: string;
  magazine: number;
  /** Firme din listele lor care au primit locul exact. */
  locuriPuse: number;
  /** Magazine noi de prospectat. */
  magazineNoi: number;
  /** Câte le aveam deja pe hartă — nu le punem a doua oară. */
  deja: number;
  eroare?: string;
}

/**
 * O întrebare la Overpass, cu server de rezervă dacă primul e ocupat.
 *
 * `panaLa` e ceasul, nu un timeout pe cerere: trei servere × 25 s ar
 * însemna 75 s, iar cererea noastră are voie 60. Cât a mai rămas, atât
 * primește următorul server încercat.
 *
 * Un `remark` de la Overpass e tot o cădere — aruncăm, ca să se încerce
 * următorul server, nu ca să raportăm „județul n-are magazine".
 */
async function intreabaOverpass(
  judet: string,
  panaLa: number,
): Promise<unknown> {
  let ultimaEroare: unknown = null;
  for (const server of SERVERE_OVERPASS) {
    const ramas = panaLa - Date.now();
    if (ramas < 5_000) break;
    try {
      const r = await fetch(server, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "bcagent-saas/1.0 (CRM distributie; contact via repo)",
        },
        body: `data=${encodeURIComponent(intrebareJudet(judet))}`,
        signal: AbortSignal.timeout(ramas),
      });
      if (!r.ok) throw new Error(`Overpass ${r.status}`);
      const json = await r.json();
      const remarca = remarcaOverpass(json);
      if (remarca !== "") throw new Error(remarca);
      return json;
    } catch (e) {
      ultimaEroare = e;
    }
  }
  throw ultimaEroare ?? new Error("Overpass nu raspunde");
}

/**
 * Două puncte la mai puțin de ~50 m unul de altul sunt același loc.
 * (0,0005 grade ≈ 55 m pe latitudine; pe longitudine, la noi, ≈ 37 m.)
 */
function aproapeDeTot(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): boolean {
  return Math.abs(lat1 - lat2) < 0.0005 && Math.abs(lng1 - lng2) < 0.0007;
}

/** Cheie de „e același magazin": numele + locul rotunjit la ~100 m. */
function cheieApropiat(nume: string, lat: number, lng: number): string {
  return `${neted(nume)}@${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/**
 * PUNE COADA LA PUNCT: județele unde firma are clienți, apoi restul
 * Moldovei. Se poate chema oricând — nu strică ce e deja făcut.
 */
export async function planificaOSM(db: DB, orgId: string): Promise<number> {
  const aleLor = (
    await db<Array<{ judet: string }>>`
      SELECT p.judet FROM prospects p
      JOIN org_agents oa ON oa.name = p.assigned_agent
      WHERE oa.org_id = ${orgId} AND COALESCE(p.judet, '') <> ''
      GROUP BY p.judet ORDER BY COUNT(*) DESC
    `
  ).map((r) => r.judet);

  // Întâi unde au clienți (în ordinea numărului de clienți), apoi vecinii.
  const randuri: Array<{ org_id: string; judet: string; motiv: string; rang: number }> = [];
  const puse = new Set<string>();
  aleLor.forEach((judet, i) => {
    if (puse.has(judet)) return;
    puse.add(judet);
    randuri.push({ org_id: orgId, judet, motiv: "clienti", rang: i });
  });
  // Vecinii, calculați din datele lor: județele de lângă cele în care au
  // clienți. Nu o listă scrisă de noi — merge la fel oriunde în țară.
  (await judeteVecine(db, aleLor)).forEach((judet, i) => {
    if (puse.has(judet)) return;
    puse.add(judet);
    randuri.push({ org_id: orgId, judet, motiv: "vecin", rang: 100 + i });
  });
  if (randuri.length === 0) return 0;

  await db`
    INSERT INTO osm_sweep ${db(randuri, "org_id", "judet", "motiv", "rang")}
    ON CONFLICT (org_id, judet) DO UPDATE
      SET motiv = EXCLUDED.motiv, rang = EXCLUDED.rang
  `;
  return randuri.length;
}

/** Toată coada firmei, pentru afișare. */
export async function starePlanOSM(db: DB, orgId: string): Promise<TreabaOSM[]> {
  return db<TreabaOSM[]>`
    SELECT judet, stare, motiv, magazine, locuri, noi, eroare
    FROM osm_sweep WHERE org_id = ${orgId}
    ORDER BY rang, judet
  `;
}

/**
 * Următoarea treabă de făcut.
 *
 * Un județ picat se mai încearcă de două ori: Overpass e ocupat câteodată,
 * dar dacă pică de trei ori e altceva și n-are rost să tot sunăm degeaba.
 */
async function urmatoareaTreaba(db: DB, orgId: string): Promise<string | null> {
  const [r] = await db<Array<{ judet: string }>>`
    SELECT judet FROM osm_sweep
    WHERE org_id = ${orgId}
      AND (stare = 'de_facut' OR (stare = 'picat' AND incercari < 3))
    ORDER BY rang, judet LIMIT 1
  `;
  return r?.judet ?? null;
}

/** Câte au mai rămas de făcut. */
export async function ramaseOSM(db: DB, orgId: string): Promise<number> {
  const [r] = await db<[{ n: string }]>`
    SELECT COUNT(*)::text AS n FROM osm_sweep
    WHERE org_id = ${orgId}
      AND (stare = 'de_facut' OR (stare = 'picat' AND incercari < 3))
  `;
  return parseInt(r.n, 10);
}

/**
 * FACE O SINGURĂ TREABĂ din coadă: un județ, cu ceasul întreg.
 *
 * Întoarce `null` dacă n-a mai rămas nimic de făcut.
 *
 * @param bugetMs cât are voie să dureze; cererea web are 60 s, cronul mai mult
 */
export async function unJudetOSM(
  db: DB,
  orgId: string,
  numeAgenti: string[],
  bugetMs = 40_000,
): Promise<RezultatJudet | null> {
  const pornit = Date.now();
  const judet = await urmatoareaTreaba(db, orgId);
  if (judet === null) return null;

  const numeAg = numeAgenti.length ? numeAgenti : [""];
  const rez: RezultatJudet = {
    judet,
    magazine: 0,
    locuriPuse: 0,
    magazineNoi: 0,
    deja: 0,
  };

  /** Scrie ce a ieșit, ca să nu se mai facă o dată. */
  const noteaza = async (stare: string, eroare = "") => {
    await db`
      UPDATE osm_sweep
      SET stare = ${stare}, magazine = ${rez.magazine}, locuri = ${rez.locuriPuse},
          noi = ${rez.magazineNoi}, eroare = ${eroare.slice(0, 200)},
          incercari = incercari + 1, facut_la = NOW()
      WHERE org_id = ${orgId} AND judet = ${judet}
    `;
  };

  let magazine: ReturnType<typeof citesteOverpass>;
  try {
    magazine = citesteOverpass(await intreabaOverpass(judet, pornit + bugetMs));
  } catch (e) {
    const eroare = e instanceof Error ? e.message.slice(0, 120) : "nu raspunde";
    await noteaza("picat", eroare);
    return { ...rez, eroare };
  }
  rez.magazine = magazine.length;
  if (magazine.length === 0) {
    // Chiar gol. Nu-i o cădere: sunt județe cu foarte puține magazine puse
    // pe OSM. `remarcaOverpass` a verificat deja că nu e vorba de o
    // plângere a serverului.
    await noteaza("gata");
    return rez;
  }

  // CU CINE POTRIVIM: clienții lor + registrul din județul ăsta. Aceleași
  // reguli ca la harta lui Bogdan — n-are rost al doilea mecanism.
  const deLegat = await db<
    Array<{ cui: string; denumire: string; localitate: string }>
  >`
    SELECT p.cui, p.denumire, COALESCE(p.localitate, '') AS localitate
    FROM prospects p
    LEFT JOIN org_agents oa ON oa.name = p.assigned_agent AND oa.org_id = ${orgId}
    WHERE p.judet = ${judet}
      AND (oa.id IS NOT NULL OR COALESCE(p.assigned_agent, '') = '')
      AND p.activ IS DISTINCT FROM FALSE
    LIMIT 60000
  `;
  const centreRanduri = await db<
    Array<{ localitate: string; lat: number; lng: number }>
  >`
    SELECT localitate, lat, lng FROM geo_localitati
    WHERE judet = ${judet} AND lat IS NOT NULL AND lng IS NOT NULL
    LIMIT 20000
  `;
  const centre = new Map(
    centreRanduri.map((c) => [neted(c.localitate), { lat: c.lat, lng: c.lng }]),
  );

  const potriviri = potriveștePuncte(
    magazine.map((m) => ({
      nume: m.nume,
      descriere: `${m.fel} ${m.adresa} ${m.localitate}`.trim(),
      lat: m.lat,
      lng: m.lng,
    })),
    deLegat,
    0.7,
    centre,
  );

  // 1) FIRMELE RECUNOSCUTE PRIMESC LOCUL.
  //
  // „Primesc" înseamnă chiar primesc: firma n-avea loc, sau îl avea doar
  // ghicit (centrul satului), sau OSM îl știe în alt loc. Dacă are deja
  // exact același punct, n-o atingem și n-o numărăm — altfel a doua
  // apăsare ar raporta din nou aceleași zeci de firme „cu loc nou", iar
  // omul ar crede că se schimbă ceva când nu se schimbă nimic.
  //
  // Și ce a pus agentul pe teren nu se atinge NICIODATĂ: el a fost acolo.
  const candidati = potriviri.filter((p) => p.client && p.scor >= 0.9);
  if (candidati.length > 0) {
    const cuiuri = candidati.map((p) => p.client!.cui);
    const acumAre = new Map(
      (
        await db<
          Array<{ cui: string; lat: number; lng: number; aprox: boolean; sursa: string }>
        >`
          SELECT cui, lat, lng, aprox, sursa FROM geo_firme
          WHERE cui = ANY(${cuiuri})
        `
      ).map((g) => [g.cui, g]),
    );
    for (const p of candidati) {
      const are = acumAre.get(p.client!.cui);
      // Pinul pus de om pe teren bate orice import.
      if (are && (are.sursa === "deget" || are.sursa === "gps")) continue;
      if (are && !are.aprox && aproapeDeTot(are.lat, are.lng, p.punct.lat, p.punct.lng)) {
        continue; // îl avea deja, exact acolo — nimic de făcut
      }
      const r = await db`
        INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
        SELECT pr.cui, ${p.punct.lat}, ${p.punct.lng}, FALSE, FALSE, 'import'
        FROM prospects pr
        WHERE pr.cui = ${p.client!.cui}
          AND (COALESCE(pr.assigned_agent, '') = ''
               OR pr.assigned_agent = ANY(${numeAg}))
          AND NOT EXISTS (
            SELECT 1 FROM geo_firme g
            WHERE g.cui = pr.cui AND g.sursa IN ('deget', 'gps')
          )
        ON CONFLICT (cui) DO UPDATE
          SET lat = EXCLUDED.lat, lng = EXCLUDED.lng,
              aprox = FALSE, failed = FALSE, sursa = 'import', updated_at = NOW()
      `;
      if (r.count > 0) rez.locuriPuse++;
    }
  }

  // 2) Restul devin puncte de prospectare, ca cele din harta veche.
  // Ce e deja pe hartă nu se pune a doua oară: agentul ar vedea două
  // pinuri peste același magazin și n-ar ști la care să intre.
  const acum = await db<Array<{ nume: string; lat: number; lng: number }>>`
    SELECT nume, lat, lng FROM magazin_harta
    WHERE org_id = ${orgId} AND (judet = ${judet} OR judet = '')
    LIMIT 60000
  `;
  const stiute = new Set(acum.map((m) => cheieApropiat(m.nume, m.lat, m.lng)));
  const dupaNume = new Map(magazine.map((m) => [m.nume, m]));
  const randuri: Array<Record<string, string | number>> = [];
  for (const p of potriviri) {
    if (p.client) continue;
    const cheie = cheieApropiat(p.punct.nume, p.punct.lat, p.punct.lng);
    if (stiute.has(cheie)) {
      rez.deja++;
      continue;
    }
    stiute.add(cheie);
    const m = dupaNume.get(p.punct.nume);
    randuri.push({
      id: `${orgId}:osm:${cheieMagazin(p.punct.nume, p.punct.lat, p.punct.lng)}`.slice(0, 200),
      org_id: orgId,
      nume: p.punct.nume.slice(0, 200),
      // Ce știe OSM despre el: felul locului, strada, telefonul.
      adresa: [m?.fel, m?.adresa, m?.telefon].filter(Boolean).join(" · ").slice(0, 300),
      localitate: (m?.localitate ?? "").slice(0, 120),
      judet,
      lat: p.punct.lat,
      lng: p.punct.lng,
      strat: "OpenStreetMap",
    });
  }
  // Aceeași rulare poate scoate două rânduri cu același id (același nume în
  // același punct) — Postgres refuză să atingă rândul de două ori.
  const unice = Array.from(new Map(randuri.map((r) => [r.id, r])).values());
  for (let k = 0; k < unice.length; k += 500) {
    const bucata = unice.slice(k, k + 500);
    const r = await db`
      INSERT INTO magazin_harta ${db(
        bucata,
        "id", "org_id", "nume", "adresa", "localitate", "judet",
        "lat", "lng", "strat",
      )}
      ON CONFLICT (id) DO UPDATE
        SET nume = EXCLUDED.nume, adresa = EXCLUDED.adresa,
            localitate = EXCLUDED.localitate, judet = EXCLUDED.judet,
            lat = EXCLUDED.lat, lng = EXCLUDED.lng
    `;
    rez.magazineNoi += r.count;
  }

  await noteaza("gata");
  return rez;
}
