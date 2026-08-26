import { getDB } from "@/lib/db";
import {
  NUME_GENERALE,
  PRESCURTARI,
  pareZona,
  orasulCartierului,
} from "./cartiere";
import { neted, parseZone, potriveste } from "./parse";

/**
 * CREIERUL ZONELOR, într-un singur loc.
 *
 * Textul de pe WhatsApp îl scrie ori managerul (din panoul firmei), ori
 * agentul însuși (de pe telefon — „ei știu exact ce zone au, pe zile").
 * Amândoi trebuie să primească ACELAȘI răspuns pe același text: aceleași
 * sate recunoscute, aceleași sugestii la ce n-a găsit, aceeași desfacere
 * a virgulei uitate. De-aia logica stă aici, nu copiată în două rute.
 */

export interface ZonaGasita {
  zi: string;
  localitate: string;
  /** Cum a scris omul — ca să-și recunoască rândul în confirmare. */
  scris: string;
  /**
   * Explicație, când n-am pus fix ce a scris: „Burdujeni e cartier în
   * Suceava". Fără ea, omul vede în zi un oraș pe care nu l-a scris și
   * crede că aplicația a greșit.
   */
  cum?: string;
}
export interface ZonaNegasita {
  scris: string;
  sugestii: string[];
  /**
   * E o zonă (un ținut), nu un sat scris greșit. Atunci nu are rost să-i
   * propunem sate asemănătoare — trebuie să scrie el care sunt.
   */
  zona?: boolean;
}
export interface CititeZone {
  gasite: ZonaGasita[];
  negasite: ZonaNegasita[];
}

type DB = NonNullable<ReturnType<typeof getDB>>;

/**
 * Localitățile REALE pe care le poate avea o zonă: satele din județele
 * în care firma chiar are clienți. Nu tot registrul țării — altfel
 * „Roma" ar nimeri în Italia, nu în Botoșani.
 */
/**
 * LISTA E ACEEAȘI PENTRU CÂTEVA MINUTE.
 *
 * Căutarea de sate cheamă lista la FIECARE literă tastată, iar lista
 * înseamnă două interogări care aduc până la 40.000 de rânduri. Pe
 * telefon, în mașină, cu semnal prost, asta e piatră de moară — și
 * degeaba: satele din județ nu se schimbă cât scrie omul trei litere.
 *
 * O ținem minte cinci minute. Dacă apare un client într-un sat nou, intră
 * la următoarea reîmprospătare — nimeni nu pierde nimic.
 */
const CACHE = new Map<string, { la: number; lista: string[] }>();
const TINE_MINTE_MS = 5 * 60_000;

export async function localitatiCunoscute(
  db: DB,
  numeAgenti: string[],
): Promise<string[]> {
  if (numeAgenti.length === 0) return [];
  const cheieCache = [...numeAgenti].sort().join("|");
  const tinut = CACHE.get(cheieCache);
  if (tinut && Date.now() - tinut.la < TINE_MINTE_MS) return tinut.lista;
  // DOUĂ IZVOARE, nu unul.
  // Înainte luam doar satele unde avem deja o firmă în registru. Dar
  // Tarnița, Palma, Poieni-Solca sunt sate ADEVĂRATE în care pur și
  // simplu n-avem încă nicio firmă — și cădeau ca „negăsite", deși
  // agentul trece prin ele în fiecare săptămână. Tabelul de localități le
  // are pe toate, cu tot cu coordonate.
  const rows = await db<Array<{ localitate: string }>>`
    SELECT DISTINCT localitate FROM prospects
    WHERE localitate <> ''
      AND judet IN (
        SELECT DISTINCT judet FROM prospects
        WHERE assigned_agent = ANY(${numeAgenti}) AND judet <> ''
      )
    LIMIT 20000
  `;
  const sate = await db<Array<{ localitate: string }>>`
    SELECT DISTINCT localitate FROM geo_localitati
    WHERE localitate <> ''
      AND judet IN (
        SELECT DISTINCT judet FROM prospects
        WHERE assigned_agent = ANY(${numeAgenti}) AND judet <> ''
      )
    LIMIT 20000
  `;
  const vazut = new Set<string>();
  const toate: string[] = [];
  for (const r of [...rows, ...sate]) {
    const k = r.localitate.trim().toLowerCase();
    if (k === "" || vazut.has(k)) continue;
    vazut.add(k);
    toate.push(r.localitate);
  }
  CACHE.set(cheieCache, { la: Date.now(), lista: toate });
  // Nu ținem minte pentru toată platforma: câteva firme, atât.
  if (CACHE.size > 50) {
    const celMaiVechi = [...CACHE.entries()].sort((a, b) => a[1].la - b[1].la)[0];
    if (celMaiVechi) CACHE.delete(celMaiVechi[0]);
  }
  return toate;
}

/** Distanța dintre două locuri, în kilometri (formula haversine). */
function km(
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
 * CAUTĂ UN SAT ÎN LISTA LOR.
 *
 * Când omul scrie ceva ce nu recunoaștem („Țara Dornelor"), nu ghicim și
 * nu-l punem să scrie patruzeci de nume: tastează două-trei litere și
 * alege din satele LUI. Alegerea e a lui, datele sunt ale lui, noi nu
 * inventăm nimic — iar el aproape că nu scrie.
 *
 * Căutăm oriunde în nume, nu doar la început: „dorn" scoate și „Vatra
 * Dornei", și „Dorna Candrenilor".
 */
export async function cautaLocalitati(
  db: DB,
  numeAgenti: string[],
  q: string,
  cate = 25,
): Promise<string[]> {
  const cautat = neted(q);
  if (cautat.length < 2 || numeAgenti.length === 0) return [];
  const toate = await localitatiCunoscute(db, numeAgenti);
  const incep: string[] = [];
  const contin: string[] = [];
  for (const l of toate) {
    const n = neted(l);
    if (n === cautat) incep.unshift(l);
    else if (n.startsWith(cautat)) incep.push(l);
    else if (n.includes(cautat)) contin.push(l);
  }
  // Fără dubluri de scriere: „SUCEAVA" și „Suceava" sunt același sat.
  const vazut = new Set<string>();
  const iesire: string[] = [];
  for (const l of [...incep, ...contin]) {
    const k = neted(l);
    if (vazut.has(k)) continue;
    vazut.add(k);
    iesire.push(l);
    if (iesire.length >= cate) break;
  }
  return iesire;
}


/**
 * CE A ÎNVĂȚAT APLICAȚIA DE LA FIRMA ASTA.
 *
 * „Burdujeni" nu e sat în registru. Am ținut o vreme în cod o listă cu
 * cartierele Sucevei și ale Iașiului — greșit din două motive: era
 * scrisă de mine, și era bună doar pentru ei. Platforma nu e a unei
 * singure firme; pentru un distribuitor din Timișoara nu însemna nimic.
 *
 * Acum se învață: prima dată omul caută și alege, iar alegerea LUI se
 * ține minte pentru firma lui. A doua oară merge singur. Fără liste
 * scrise de noi, fără ghicit, și merge pentru orice oraș din țară.
 */
export async function aliasuriInvatate(
  db: DB,
  orgId: string,
): Promise<Map<string, string>> {
  const r = await db<Array<{ scris: string; localitate: string }>>`
    SELECT scris, localitate FROM zona_alias
    WHERE org_id = ${orgId}
    ORDER BY folosit DESC, created_at DESC
    LIMIT 5000
  `;
  const m = new Map<string, string>();
  // Primul găsit rămâne: cel mai folosit, apoi cel mai nou.
  for (const x of r) if (!m.has(x.scris)) m.set(x.scris, x.localitate);
  return m;
}

/**
 * ÎNVAȚĂ. Omul a căutat și a ales — ținem minte, ca să nu mai caute.
 * Se cheamă DOAR cu ce a ales el, niciodată cu ce am ghicit noi.
 */
export async function invataAlias(
  db: DB,
  orgId: string,
  scris: string,
  localitate: string,
  pusDe: string,
): Promise<void> {
  const k = neted(scris);
  if (k.length < 2 || localitate.trim() === "") return;
  await db`
    INSERT INTO zona_alias (org_id, scris, localitate, pus_de, folosit)
    VALUES (${orgId}, ${k.slice(0, 120)}, ${localitate.slice(0, 120)},
            ${pusDe.slice(0, 120)}, 1)
    ON CONFLICT (org_id, scris, localitate)
      DO UPDATE SET folosit = zona_alias.folosit + 1
  `;
}

/**
 * Textul scris de om → ce am înțeles și ce n-am găsit.
 *
 * `centre` sunt locurile satelor pe hartă. Fără ele merge tot, doar că
 * ținuturile („Țara Dornelor") nu se pot desface în sate.
 */
export function citesteZone(
  text: string,
  cunoscute: string[],
  /**
   * Ce a învățat aplicația de la firma asta: „burdujeni" → „SUCEAVA".
   * Învățat din alegerile LOR, nu scris de noi în cod.
   */
  aliasuri?: Map<string, string>,
): CititeZone {
  const gasite: ZonaGasita[] = [];
  const negasite: ZonaNegasita[] = [];
  const vazute = new Set<string>();
  const adauga = (zi: string, oficial: string, scris: string, cum?: string) => {
    const cheie = `${zi}|${neted(oficial)}`;
    if (vazute.has(cheie)) return;
    vazute.add(cheie);
    gasite.push({ zi, localitate: oficial, scris, ...(cum ? { cum } : {}) });
  };
  for (const c of parseZone(text)) {
    const p = potriveste(c.localitate, cunoscute);
    if (p.oficial) {
      adauga(c.zi, p.oficial, c.localitate);
    } else if (p.parti && p.parti.length >= 2) {
      // Virgula uitată: „Sendriceni Dorohoi" = două sate. Le punem pe
      // amândouă, ca al doilea să nu se piardă din zona agentului.
      for (const parte of p.parti) adauga(c.zi, parte, c.localitate);
    } else {
      const n = neted(c.localitate);
      /** Numele oficial din registru pentru un nume știut de noi. */
      const inRegistru = (nume: string) =>
        cunoscute.find((k) => neted(k) === neted(nume)) ?? null;

      // 0. CE A ÎNVĂȚAT DE LA EI. Bate orice altceva: e alegerea lor, pe
      // firma lor. Dacă un om de-al lor a spus o dată că „Burdujeni"
      // înseamnă Suceava, așa e — nu mai întrebăm și nu mai ghicim. Iar
      // un distribuitor din Timișoara își învață cartierele lui, fără ca
      // noi să scriem vreo listă.
      const invatat = aliasuri?.get(n);
      const alInvatat = invatat ? inRegistru(invatat) : null;
      if (alInvatat) {
        adauga(
          c.zi,
          alInvatat,
          c.localitate,
          `${c.localitate} = ${alInvatat} (ați ales voi, mai demult)`,
        );
        continue;
      }

      // 1. PRESCURTĂRILE. „Cn-lung" e Câmpulung Moldovenesc. Nimeni nu
      // scrie 22 de litere într-o listă de 40 de sate, pe telefon.
      const intreg = PRESCURTARI[n];
      const alPrescurtat = intreg ? inRegistru(intreg) : null;
      if (alPrescurtat) {
        adauga(c.zi, alPrescurtat, c.localitate, `${c.localitate} = ${alPrescurtat}`);
        continue;
      }

      // 2. ZONELE NU LE GHICIM.
      // „Țara Dornelor (toate locațiile)" e un ținut, nu un sat. Aș putea
      // pune satele din jurul Vetrei Dornei pe o rază oarecare — dar raza
      // aia ar fi scoasă din burtă, iar un sat băgat greșit în ziua unui
      // agent înseamnă un drum degeaba și o cifră falsă în raport. Îi
      // spunem ce e și-l rugăm să scrie satele: el le știe, noi nu.
      if (pareZona(n)) {
        negasite.push({
          scris: c.localitate,
          sugestii: [],
          zona: true,
        });
        continue;
      }

      // 3. CARTIERELE. Agentul zice „luni fac Burdujeniul", dar la
      // Finanțe firmele de acolo scriu „SUCEAVA" — cartierul nu apare
      // niciodată în listele noastre. Îl traducem în oraș, ca ziua lui să
      // nu rămână goală, și îi scriem pe ecran de ce vede Suceava în loc.
      //
      // „Centru" e prea general ca să însemne ceva singur: îl legăm DOAR
      // dacă în aceeași zi omul a scris și alte cartiere ale aceluiași
      // oraș („Obcini, George Enescu, Centru, Ițcani" — se știe care).
      // Altfel îl lăsăm nelămurit: mai bine întrebăm decât să ghicim.
      const oras = orasulCartierului(n, neted);
      if (oras !== null && NUME_GENERALE.has(n)) {
        const dinAceeasiZi = gasite.some(
          (g) => g.zi === c.zi && neted(g.localitate) === neted(oras) && g.cum,
        );
        if (!dinAceeasiZi) {
          negasite.push({ scris: c.localitate, sugestii: p.sugestii });
          continue;
        }
      }
      const alOras = oras === null ? null : inRegistru(oras);
      if (alOras) {
        adauga(
          c.zi,
          alOras,
          c.localitate,
          `${c.localitate} e cartier în ${alOras} — am pus tot orașul, ca să nu-ți lipsească niciun client de acolo`,
        );
      } else {
        negasite.push({ scris: c.localitate, sugestii: p.sugestii });
      }
    }
  }
  return { gasite, negasite };
}

/**
 * Scrie zona unui agent. ÎNLOCUIEȘTE tot ce avea (nu adună) — omul
 * retrimite lista întreagă când și-o schimbă, nu diferențe.
 */
export async function salveazaZone(
  db: DB,
  orgId: string,
  agentName: string,
  gasite: ZonaGasita[],
  /** Cine a scris-o: agentul însuși sau managerul. Se vede în panou. */
  pusDe: string,
): Promise<void> {
  await db.begin(async (tx) => {
    await tx`
      DELETE FROM agent_zone
      WHERE org_id = ${orgId} AND agent_name = ${agentName}
    `;
    if (gasite.length === 0) return;
    // `pozitie` = rândul în care le-a scris omul. Aia e ordinea drumului
    // („mai întâi Vf. Câmpului, apoi Lozna…"), nu alfabetul.
    const payload = gasite.map((g, i) => ({
      org_id: orgId,
      agent_name: agentName,
      localitate: g.localitate,
      zi: g.zi,
      pozitie: i,
      pus_de: pusDe.slice(0, 120),
    }));
    await tx`
      INSERT INTO agent_zone ${tx(payload, "org_id", "agent_name", "localitate", "zi", "pozitie", "pus_de")}
      ON CONFLICT (org_id, agent_name, localitate, zi)
        DO UPDATE SET pozitie = EXCLUDED.pozitie, pus_de = EXCLUDED.pus_de
    `;
  });
}
