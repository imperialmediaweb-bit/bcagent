import { getDB } from "@/lib/db";
import { alAgentiei } from "@/lib/org-scope";

/**
 * CE MAI E DE VIZITAT — o singură socoteală, pentru toată platforma.
 *
 * În distribuția de țigări vizita săptămânală e obligatorie. Cine n-a
 * fost văzut de șapte zile apare aici, cel mai vechi primul.
 *
 * DOUĂ LUCRURI care păreau mărunte și nu erau:
 *
 * 1. O OPRIRE E UN MAGAZIN, NU O FIRMĂ.
 *    „Da, așa ar trebui. Magazinele." (Bogdan, 26.08)
 *    Ovi Tacomax e o firmă cu șase magazine. Cât timp se numărau firme, o
 *    vizită la cel din Cernești bifa firma întreagă: celelalte cinci
 *    ieșeau din listă ca și cum ar fi fost făcute. Cifrele arătau frumos
 *    și cinci magazine rămâneau nevizitate.
 *
 * 2. TELEFONUL ȘI PANOUL ȘEFULUI TREBUIE SĂ SPUNĂ ACELAȘI LUCRU.
 *    Socoteala era scrisă de două ori, în două locuri, cu două
 *    interogări diferite. Agentul vedea 23 de opriri, patronul vedea 9,
 *    și amândoi aveau dreptate — ceea ce e cel mai rău fel de a greși.
 *    De-aia stă aici, o dată.
 *
 * Firmele fără magazine cunoscute rămân o singură oprire, ca până acum.
 */

type DB = NonNullable<ReturnType<typeof getDB>>;

export interface Oprire {
  cui: string;
  /** Magazinul, când firma are magazine cunoscute. Gol = firma însăși. */
  magazinId: string;
  denumire: string;
  adresa: string;
  localitate: string;
  judet: string;
  telefon: string;
  /** Locul magazinului, când e știut — ruta merge fix acolo, nu la sediu. */
  lat: number | null;
  lng: number | null;
  lastVisit: Date | null;
}

const SAPTE_ZILE_MS = 7 * 24 * 3600 * 1000;

/**
 * Opririle scadente ale unei firme (sau ale unui singur agent).
 *
 * @param numeAgenti agenții pentru care se socotește. Pentru panoul
 *   șefului: toți agenții firmei PLUS `""`, ca să intre și clienții
 *   nedistribuiți — altfel cifra de pe tabloul lui nu s-ar potrivi cu
 *   lista pe care o deschide.
 */
export async function opririScadente(
  db: DB,
  orgId: string,
  numeAgenti: string[],
  limit = 100,
): Promise<Oprire[]> {
  const clienti = await db<
    Array<{
      cui: string;
      denumire: string;
      adresa: string;
      localitate: string;
      judet: string;
      telefon: string;
      last_visit: Date | null;
    }>
  >`
    SELECT p.cui, p.denumire, COALESCE(p.adresa,'') AS adresa,
           COALESCE(p.localitate,'') AS localitate, COALESCE(p.judet,'') AS judet,
           COALESCE(p.telefon,'') AS telefon,
           MAX(v.visited_at) AS last_visit
    FROM prospects p
    -- Doar vizitele scrise pe FIRMĂ, nu pe un magazin anume: altfel o
    -- vizită la un magazin ar stinge din nou firma întreagă.
    LEFT JOIN visits v ON v.cui = p.cui AND COALESCE(v.magazin_id,'') = ''
    WHERE p.status = 'client'
      AND ${alAgentiei(db, orgId, numeAgenti)}
    GROUP BY p.cui, p.denumire, p.adresa, p.localitate, p.judet, p.telefon
  `;

  const cuiuri = clienti.map((c) => c.cui);
  interface MagazinRand {
    id: string;
    cui: string;
    nume: string;
    adresa: string;
    localitate: string;
    judet: string;
    telefon: string;
    lat: number;
    lng: number;
    last_visit: Date | null;
  }
  const magazine: MagazinRand[] =
    orgId !== "" && cuiuri.length > 0
      ? await db<MagazinRand[]>`
          SELECT m.id, m.cui, m.nume, COALESCE(m.adresa,'') AS adresa,
                 COALESCE(m.localitate,'') AS localitate,
                 COALESCE(m.judet,'') AS judet,
                 COALESCE(m.telefon,'') AS telefon, m.lat, m.lng,
                 MAX(v.visited_at) AS last_visit
          FROM magazin_harta m
          LEFT JOIN visits v ON v.magazin_id = m.id
          WHERE m.org_id = ${orgId}
            AND m.cui = ANY(${cuiuri})
            -- Magazinul tăiat de un coleg pe teren nu mai e o oprire.
            AND m.stare <> 'inchis'
            -- Standurile lui (SIS) nu-s opriri de vânzare.
            AND m.fel <> 'sis'
          GROUP BY m.id, m.cui, m.nume, m.adresa, m.localitate, m.judet,
                   m.telefon, m.lat, m.lng
        `
      : [];

  const peFirma = new Map<string, MagazinRand[]>();
  for (const m of magazine) {
    const l = peFirma.get(m.cui);
    if (l) l.push(m);
    else peFirma.set(m.cui, [m]);
  }

  const opriri: Oprire[] = [];
  for (const c of clienti) {
    const ale = peFirma.get(c.cui);
    if (ale && ale.length > 0) {
      for (const m of ale) {
        opriri.push({
          cui: c.cui,
          magazinId: m.id,
          // Numele magazinului, ca agentul să știe LA CARE se duce:
          // „OVI-TACOMAX · Cernești", nu de șase ori „OVI-TACOMAX".
          denumire:
            m.nume && m.nume !== c.denumire
              ? `${c.denumire} · ${m.nume}`
              : c.denumire,
          adresa: m.adresa || c.adresa,
          localitate: m.localitate || c.localitate,
          judet: m.judet || c.judet,
          telefon: m.telefon || c.telefon,
          lat: m.lat,
          lng: m.lng,
          lastVisit: m.last_visit,
        });
      }
    } else {
      opriri.push({
        cui: c.cui,
        magazinId: "",
        denumire: c.denumire,
        adresa: c.adresa,
        localitate: c.localitate,
        judet: c.judet,
        telefon: c.telefon,
        lat: null,
        lng: null,
        lastVisit: c.last_visit,
      });
    }
  }

  const prag = Date.now() - SAPTE_ZILE_MS;
  return opriri
    .filter((o) => o.lastVisit === null || o.lastVisit.getTime() < prag)
    .sort((a, b) => {
      const ta = a.lastVisit ? a.lastVisit.getTime() : -1;
      const tb = b.lastVisit ? b.lastVisit.getTime() : -1;
      return ta - tb;
    })
    .slice(0, limit);
}
