import { getDB } from "@/lib/db";
import {
  citesteOverpass,
  intrebareJudet,
  remarcaOverpass,
  SERVERE_OVERPASS,
} from "./overpass";
import { cheieMagazin, neted, potriveștePuncte } from "./potrivire";

/**
 * ADUCE MAGAZINELE DIN OPENSTREETMAP pentru o firmă.
 *
 * Se cheamă din ACELAȘI buton ca importul hărții — „Adu locațiile". Nu
 * facem încă un buton și încă un meniu pentru fiecare sursă de date: omul
 * apasă o dată și primește tot ce se poate — harta lui, plus magazinele pe
 * care le-au pus alți oameni pe OpenStreetMap.
 *
 * Ce se întâmplă cu ele:
 *   · dacă se potrivesc cu o firmă din listele firmei → primesc LOCUL
 *     exact (dar nu se atinge ce a pus agentul din teren);
 *   · dacă nu → rămân puncte de prospectare, ca cele din harta veche.
 *
 * Overpass e un serviciu public, gratuit și lent. De-aia mergem JUDEȚ CU
 * JUDEȚ, cu un buget de timp: ce n-a intrat în cererea asta se ia la
 * următoarea, de la `urmator`. Pagina cheamă singură mai departe — omul
 * tot o apăsare face.
 */

type DB = NonNullable<ReturnType<typeof getDB>>;

export interface RezultatOSM {
  /** Județele întrebate în cererea asta și câte magazine au ieșit. */
  peJudet: Array<{ judet: string; magazine: number; eroare?: string }>;
  /** Firme din listele lor care au primit locul exact. */
  locuriPuse: number;
  /** Magazine noi de prospectat. */
  magazineNoi: number;
  /** Câte magazine erau deja pe hartă (din harta veche) — nu le dublăm. */
  deja: number;
  /** Câte județe are firma cu totul. */
  totalJudete: number;
  /** De unde se reia; `null` = am terminat toate județele. */
  urmator: number | null;
}

/**
 * O întrebare la Overpass, cu server de rezervă dacă primul e ocupat.
 *
 * `panaLa` e ceasul, nu un timeout pe cerere: trei servere × 25 s ar
 * însemna 75 s, iar serverul nostru are voie 60. Cât a mai rămas, atât
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

/** Cheie de „e același magazin": numele + locul rotunjit la ~100 m. */
function cheieApropiat(nume: string, lat: number, lng: number): string {
  return `${neted(nume)}@${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/**
 * Aduce magazinele din OSM pentru județele în care lucrează firma.
 *
 * @param deLa    de la al câtelea județ pornim (cursorul din apelul trecut)
 * @param bugetMs cât are voie să dureze cererea; un server web n-are voie
 *                să aștepte la nesfârșit, iar Vercel/Railway taie la 60 s
 */
export async function aduMagazineOSM(
  db: DB,
  orgId: string,
  numeAgenti: string[],
  deLa = 0,
  bugetMs = 40_000,
): Promise<RezultatOSM> {
  const pornit = Date.now();
  const rezultat: RezultatOSM = {
    peJudet: [],
    locuriPuse: 0,
    magazineNoi: 0,
    deja: 0,
    totalJudete: 0,
    urmator: null,
  };
  const numeAg = numeAgenti.length ? numeAgenti : [""];

  // Județele în care firma chiar are clienți — nu întrebăm toată țara.
  // Întâi cele cu mai mulți clienți: dacă timpul se termină, măcar alea
  // care contează au intrat.
  const judete = (
    await db<Array<{ judet: string }>>`
      SELECT p.judet FROM prospects p
      JOIN org_agents oa ON oa.name = p.assigned_agent
      WHERE oa.org_id = ${orgId} AND COALESCE(p.judet, '') <> ''
      GROUP BY p.judet ORDER BY COUNT(*) DESC
    `
  ).map((r) => r.judet);
  rezultat.totalJudete = judete.length;
  const start = Math.max(0, Math.floor(deLa) || 0);
  if (judete.length === 0 || start >= judete.length) return rezultat;

  // Firmele cu care putem potrivi: clienții lor + registrul din județele
  // lor. Aceleași reguli ca la harta lui Bogdan — n-are rost al doilea
  // mecanism pentru același lucru.
  const deLegat = await db<
    Array<{ cui: string; denumire: string; localitate: string }>
  >`
    SELECT p.cui, p.denumire, COALESCE(p.localitate, '') AS localitate
    FROM prospects p
    LEFT JOIN org_agents oa ON oa.name = p.assigned_agent AND oa.org_id = ${orgId}
    WHERE p.judet = ANY(${judete})
      AND (oa.id IS NOT NULL OR COALESCE(p.assigned_agent, '') = '')
      AND p.activ IS DISTINCT FROM FALSE
    LIMIT 60000
  `;
  if (deLegat.length === 0) return rezultat;

  const centreRanduri = await db<
    Array<{ localitate: string; lat: number; lng: number }>
  >`
    SELECT localitate, lat, lng FROM geo_localitati
    WHERE judet = ANY(${judete}) AND lat IS NOT NULL AND lng IS NOT NULL
    LIMIT 20000
  `;
  const centre = new Map(
    centreRanduri.map((c) => [neted(c.localitate), { lat: c.lat, lng: c.lng }]),
  );

  // Ce e deja pe harta firmei (din harta veche sau dintr-o rulare trecută).
  // Fără asta, agentul ar vedea două pinuri violet peste același magazin.
  const acum = await db<Array<{ nume: string; lat: number; lng: number }>>`
    SELECT nume, lat, lng FROM magazin_harta WHERE org_id = ${orgId} LIMIT 60000
  `;
  const stiute = new Set(acum.map((m) => cheieApropiat(m.nume, m.lat, m.lng)));

  // UN SINGUR JUDEȚ PE CERERE. Prima oară le-am făcut pe toate într-o
  // cerere: Suceava a mâncat tot timpul (658 de magazine), iar Botoșani și
  // Iași au apucat câteva secunde — destul cât Overpass să răspundă „am
  // depășit timpul", adică zero. Așa fiecare județ primește ceasul întreg,
  // iar pagina cheamă mai departe singură.
  {
    const i = start;
    const judet = judete[i];
    let magazine: ReturnType<typeof citesteOverpass> = [];
    let aCazut = false;
    try {
      magazine = citesteOverpass(
        await intreabaOverpass(judet, pornit + bugetMs),
      );
    } catch (e) {
      aCazut = true;
      rezultat.peJudet.push({
        judet,
        magazine: 0,
        eroare: e instanceof Error ? e.message.slice(0, 80) : "nu raspunde",
      });
    }
    if (aCazut) {
      // Județul ăsta n-a ieșit — trecem mai departe, dar rămâne scris ce
      // a pățit, ca omul să știe că poate apăsa iar pentru el.
      rezultat.urmator = i + 1 < judete.length ? i + 1 : null;
      return rezultat;
    }
    rezultat.peJudet.push({ judet, magazine: magazine.length });
    if (magazine.length === 0) {
      rezultat.urmator = i + 1 < judete.length ? i + 1 : null;
      return rezultat;
    }

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

    // 1) Firmele recunoscute primesc LOCUL. Ce a pus agentul nu se atinge.
    for (const p of potriviri) {
      if (!p.client || p.scor < 0.9) continue;
      const r = await db`
        INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
        SELECT pr.cui, ${p.punct.lat}, ${p.punct.lng}, FALSE, FALSE, 'import'
        FROM prospects pr
        WHERE pr.cui = ${p.client.cui}
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
      if (r.count > 0) rezultat.locuriPuse++;
    }

    // 2) Restul devin puncte de prospectare, ca cele din harta veche.
    const dupaNume = new Map(magazine.map((m) => [m.nume, m]));
    const randuri: Array<Record<string, string | number>> = [];
    for (const p of potriviri) {
      if (p.client) continue;
      const cheie = cheieApropiat(p.punct.nume, p.punct.lat, p.punct.lng);
      if (stiute.has(cheie)) {
        rezultat.deja++;
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
    // Aceeași rulare poate scoate două rânduri cu același id (același nume
    // în același punct) — Postgres refuză să atingă rândul de două ori.
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
      rezultat.magazineNoi += r.count;
    }

    rezultat.urmator = i + 1 < judete.length ? i + 1 : null;
  }
  return rezultat;
}
