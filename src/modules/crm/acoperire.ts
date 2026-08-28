import { getDB } from "@/lib/db";
import { alAgentiei } from "@/lib/org-scope";

/**
 * ACOPERIREA TERENULUI: ce a vizitat fiecare agent din tot ce ARE de
 * vizitat pe hartă.
 *
 * Cerut de Bogdan (28.08): „un raport care să evidențieze vizitele
 * efectuate vs. universul posibil de pe hartă, al agenților". Cifra care
 * îl interesează pe un manager de distribuție nu e „câte vizite a bătut
 * omul" — e CÂT DIN TEREN A ACOPERIT. 40 de vizite pot fi de 40 de ori
 * același magazin.
 *
 * REGULILE, aceleași ca peste tot (nu o a doua socoteală care să se
 * bată cap în cap cu prima):
 *   · o OPRIRE e un MAGAZIN, nu o firmă — Ovi Tacomax cu 6 magazine e
 *     6 opriri, exact ca la „De vizitat săptămâna asta";
 *   · magazinul tăiat pe teren și standurile (SIS) nu-s opriri;
 *   · universul unui agent = clienții LUI (cu paza pe firmă, nu doar pe
 *     nume) + magazinele acelor clienți;
 *   · prospectarea se numără separat: magazinele mov din satele ZONELOR
 *     lui — alea sunt „universul posibil" dincolo de clienți;
 *   · „vizitat" = are o vizită scrisă de EL în perioadă, pe acea oprire.
 */

type DB = NonNullable<ReturnType<typeof getDB>>;

export interface AcoperireAgent {
  agent: string;
  /** Opriri-client în portofoliul lui: firme fără magazine = 1, altfel
   *  câte magazine deschise are firma. */
  universClienti: number;
  /** Câte din ele au vizită scrisă de el în perioadă. */
  vizitate: number;
  /** Procent, rotunjit. 0 când universul e gol. */
  procent: number;
  /** Toate vizitele lui din perioadă (cu tot cu repetări). */
  vizite: number;
  /** Magazine de prospectat (mov) din satele zonelor lui. */
  universProspectare: number;
  /** Câte din ele a atins în perioadă (vizită sau confirmare/tăiere). */
  prospectate: number;
  /** Are zone puse pe zile? Fără ele, prospectarea nu se poate lega de el. */
  areZone: boolean;
}

export interface RaportAcoperire {
  zile: number;
  agenti: AcoperireAgent[];
  total: {
    universClienti: number;
    vizitate: number;
    procent: number;
    vizite: number;
    universProspectare: number;
    prospectate: number;
  };
}

function procent(parte: number, tot: number): number {
  return tot > 0 ? Math.round((parte / tot) * 100) : 0;
}

export async function acoperireTeren(
  db: DB,
  orgId: string,
  /** Agenții firmei: (nume, agentId) — vin din org_agents, verificați. */
  agenti: Array<{ name: string; agentId: string }>,
  zile = 30,
): Promise<RaportAcoperire> {
  const rezultate: AcoperireAgent[] = [];

  for (const a of agenti) {
    // ── UNIVERSUL DE CLIENȚI: opriri, nu firme ──
    const clienti = await db<Array<{ cui: string }>>`
      SELECT p.cui FROM prospects p
      WHERE p.status = 'client'
        AND p.activ IS DISTINCT FROM FALSE
        AND ${alAgentiei(db, orgId, [a.name])}
    `;
    const cuiuri = clienti.map((c) => c.cui);
    const magazine =
      cuiuri.length > 0
        ? await db<Array<{ id: string; cui: string }>>`
            SELECT m.id, m.cui FROM magazin_harta m
            WHERE m.org_id = ${orgId} AND m.cui = ANY(${cuiuri})
              AND m.stare <> 'inchis' AND m.fel <> 'sis'
          `
        : [];
    const magazinePeFirma = new Map<string, string[]>();
    for (const m of magazine) {
      const l = magazinePeFirma.get(m.cui);
      if (l) l.push(m.id);
      else magazinePeFirma.set(m.cui, [m.id]);
    }
    // Cheile opririlor, ca la rută: magazinul când există, firma altfel.
    const chei = new Set<string>();
    for (const c of clienti) {
      const ale = magazinePeFirma.get(c.cui);
      if (ale && ale.length > 0) for (const id of ale) chei.add(`m:${id}`);
      else chei.add(`c:${c.cui}`);
    }

    // ── CE A VIZITAT EL în perioadă ──
    const vizite = await db<
      Array<{ cui: string; magazin_id: string; n: string }>
    >`
      SELECT cui, COALESCE(magazin_id,'') AS magazin_id, COUNT(*)::text AS n
      FROM visits
      WHERE agent_id = ${a.agentId}
        AND visited_at >= NOW() - (${zile} || ' days')::interval
      GROUP BY cui, COALESCE(magazin_id,'')
    `;
    let vizitate = 0;
    let viziteTotale = 0;
    const magazineAtinse = new Set<string>();
    for (const v of vizite) {
      viziteTotale += parseInt(v.n, 10);
      const cheie = v.magazin_id !== "" ? `m:${v.magazin_id}` : `c:${v.cui}`;
      if (chei.has(cheie)) {
        vizitate++;
        chei.delete(cheie); // ca aceeași oprire să nu se numere de două ori
      }
      if (v.magazin_id !== "") magazineAtinse.add(v.magazin_id);
    }
    const universClienti = chei.size + vizitate;

    // ── PROSPECTAREA: movurile din satele zonelor LUI ──
    const zone = await db<Array<{ localitate: string }>>`
      SELECT DISTINCT localitate FROM agent_zone
      WHERE org_id = ${orgId} AND agent_name = ${a.name}
    `;
    const sate = zone.map((z) => z.localitate);
    let universProspectare = 0;
    let prospectate = 0;
    if (sate.length > 0) {
      // Fără diacritice și fără majuscule: satul din zonă („Broscăuți")
      // trebuie să-l prindă pe cel din magazin („BROSCAUTI").
      const [pr] = await db<
        [{ total: string; atinse: string }]
      >`
        SELECT COUNT(*)::text AS total,
               COUNT(*) FILTER (
                 WHERE (m.confirmat_de = ${a.name}
                        AND m.confirmat_la >= NOW() - (${zile} || ' days')::interval)
                    OR EXISTS (
                         SELECT 1 FROM visits v
                         WHERE v.magazin_id = m.id AND v.agent_id = ${a.agentId}
                           AND v.visited_at >= NOW() - (${zile} || ' days')::interval
                       )
               )::text AS atinse
        FROM magazin_harta m
        WHERE m.org_id = ${orgId}
          AND COALESCE(m.cui,'') = ''
          AND m.stare <> 'inchis' AND m.fel <> 'sis'
          AND lower(translate(m.localitate,'ăâîșțĂÂÎȘȚşţŞŢ','aaastAAASTstST'))
              = ANY(${sate.map((s) =>
                s
                  .toLowerCase()
                  .replace(/[ăâ]/g, "a")
                  .replace(/î/g, "i")
                  .replace(/[șş]/g, "s")
                  .replace(/[țţ]/g, "t"),
              )})
      `;
      universProspectare = parseInt(pr.total, 10);
      prospectate = parseInt(pr.atinse, 10);
    }

    rezultate.push({
      agent: a.name,
      universClienti,
      vizitate,
      procent: procent(vizitate, universClienti),
      vizite: viziteTotale,
      universProspectare,
      prospectate,
      areZone: sate.length > 0,
    });
  }

  const total = {
    universClienti: rezultate.reduce((s, r) => s + r.universClienti, 0),
    vizitate: rezultate.reduce((s, r) => s + r.vizitate, 0),
    vizite: rezultate.reduce((s, r) => s + r.vizite, 0),
    universProspectare: rezultate.reduce((s, r) => s + r.universProspectare, 0),
    prospectate: rezultate.reduce((s, r) => s + r.prospectate, 0),
    procent: 0,
  };
  total.procent = procent(total.vizitate, total.universClienti);

  // Cel mai bun sus — clasamentul e și el o unealtă de management.
  rezultate.sort((x, y) => y.procent - x.procent || y.vizitate - x.vizitate);
  return { zile, agenti: rezultate, total };
}
