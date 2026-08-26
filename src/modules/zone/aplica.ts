import { getDB } from "@/lib/db";
import { orasulCartierului } from "./cartiere";
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
export async function localitatiCunoscute(
  db: DB,
  numeAgenti: string[],
): Promise<string[]> {
  if (numeAgenti.length === 0) return [];
  const rows = await db<Array<{ localitate: string }>>`
    SELECT DISTINCT localitate FROM prospects
    WHERE localitate <> ''
      AND judet IN (
        SELECT DISTINCT judet FROM prospects
        WHERE assigned_agent = ANY(${numeAgenti}) AND judet <> ''
      )
    LIMIT 5000
  `;
  return rows.map((r) => r.localitate);
}

/** Textul scris de om → ce am înțeles și ce n-am găsit. */
export function citesteZone(text: string, cunoscute: string[]): CititeZone {
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
      // CARTIERELE. Agentul zice „luni fac Burdujeniul", dar la Finanțe
      // firmele de acolo scriu „SUCEAVA" — cartierul nu apare niciodată
      // în listele noastre. Îl traducem în oraș, ca ziua lui să nu rămână
      // goală, și îi scriem pe ecran de ce vede Suceava în loc.
      const oras = orasulCartierului(neted(c.localitate), neted);
      const alOras =
        oras === null
          ? null
          : cunoscute.find((k) => neted(k) === neted(oras)) ?? null;
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
