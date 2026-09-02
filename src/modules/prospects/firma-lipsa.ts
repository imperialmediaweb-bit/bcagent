import { getDB } from "@/lib/db";
import { alAgentiei } from "@/lib/org-scope";
import { normalizeCounty } from "./caen";
import { cuiValid, curataCui } from "./cui";

/**
 * FIRMA CARE NU E ÎN REGISTRU, ADUSĂ ÎN SISTEM.
 *
 * Copia noastră de registru nu e completă — o știm cu cifre: dintre cele
 * 2450 de pinuri din harta lui Bogdan, 1634 aveau CUI-uri necunoscute
 * nouă. Firme adevărate, doar că lipsă la noi. Costin a dat peste aceeași
 * gaură din teren: „SC AndroCament nu-l am pe hartă", „turism premier
 * laur, în Broscăuți, nu este pe hartă", „i.i. plugariu — nu este pe
 * hartă".
 *
 * Până acum, singurul loc care știa să creeze o firmă lipsă era importul
 * de hartă (harta-aplica). Importul de clienți al managerului doar
 * POTRIVEA — ce nu găsea se arăta o dată pe ecran și se pierdea; iar
 * agentul din teren primea refuz. Aici e aceeași facere, într-un singur
 * loc, ca s-o poată folosi și managerul, și agentul.
 *
 * Reguli care nu se negociază:
 *   · nu inventăm nimic — doar ce a scris omul (nume, sat, adresă);
 *   · `adus_de_org` spune CINE a adus-o, ca să se știe de ce n-are CAEN;
 *   · niciodată peste o firmă care există deja (ON CONFLICT DO NOTHING) —
 *     a ei e denumirea de la Finanțe, nu cea scrisă de noi;
 *   · alocarea la un agent se face doar dacă firma chiar e a agenției
 *     noastre, cu aceeași pază ca peste tot (assigned_org).
 */

type DB = NonNullable<ReturnType<typeof getDB>>;

export interface FirmaDeAdus {
  cui: string;
  denumire: string;
  adresa?: string;
  localitate?: string;
  judet?: string;
}

export interface RezultatAducere {
  /** Câte rânduri noi au intrat în registru. */
  create: number;
  /** Câte existau deja (nu le-am atins). */
  existau: number;
  /** Câte au fost alocate agentului cerut (dacă s-a cerut). */
  alocate: number;
  /** CUI-urile care au rămas pe dinafară, cu motivul. */
  sarite: Array<{ cui: string; motiv: string }>;
  /**
   * CUI-urile chiar rezolvate (create și/sau alocate nouă), exact așa cum
   * au venit la intrare. Cine cheamă nu trebuie să ghicească potrivind
   * șiruri: CUI-ul curățat poate diferi de cel scris (zerouri în față).
   */
  reusite: string[];
}

/**
 * CUI curat ȘI ADEVĂRAT. Nu-i destul să fie cifre: registrul e COMUN
 * tuturor agențiilor, iar un rând stricat îl vede toată lumea și nu-l mai
 * scoate nimeni. Cifra de control taie greșelile de tastare din fața
 * magazinului (un telefon, un an, un cod intern — niciunul nu trece).
 */
export function cuiCurat(brut: string): string {
  const c = curataCui(brut);
  return cuiValid(c) ? c : "";
}

/**
 * Aduce în registru firmele care lipsesc și, opțional, le alocă unui agent
 * al firmei ca CLIENȚI. Firmele care există deja rămân neatinse.
 */
export async function aduFirmeLipsa(
  db: DB,
  orgId: string,
  firme: FirmaDeAdus[],
  /** Numele agentului căruia i se alocă drept clienți. Gol = doar creare. */
  agentName = "",
): Promise<RezultatAducere> {
  const rez: RezultatAducere = { create: 0, existau: 0, alocate: 0, sarite: [], reusite: [] };
  if (!orgId) {
    return { ...rez, sarite: firme.map((f) => ({ cui: f.cui, motiv: "fără firmă" })) };
  }

  // Curățare + eliminarea dublurilor din același fișier.
  const vazute = new Set<string>();
  /** CUI curățat → cum l-a scris omul, ca să raportăm în limba lui. */
  const cumAFostScris = new Map<string, string>();
  const bune: Array<Required<FirmaDeAdus>> = [];
  for (const f of firme) {
    const cui = cuiCurat(f.cui);
    const denumire = String(f.denumire ?? "").trim();
    if (cui === "") {
      const brut = String(f.cui ?? "").trim();
      rez.sarite.push({
        cui: brut,
        motiv: brut === "" ? "fără CUI" : "CUI greșit (nu trece cifra de control)",
      });
      continue;
    }
    if (denumire === "") {
      rez.sarite.push({ cui, motiv: "fără denumire" });
      continue;
    }
    if (vazute.has(cui)) continue;
    vazute.add(cui);
    cumAFostScris.set(cui, String(f.cui ?? "").trim());
    bune.push({
      cui,
      denumire: denumire.slice(0, 200),
      adresa: String(f.adresa ?? "").trim().slice(0, 300),
      localitate: String(f.localitate ?? "").trim().slice(0, 120),
      judet: normalizeCounty(String(f.judet ?? "")).slice(0, 2),
    });
  }
  if (bune.length === 0) return rez;

  // JUDEȚUL, LUAT DIN SATUL DEJA CUNOSCUT (nu ghicit).
  // Fișierul de clienți are satul, rar și județul. Fără județ, firma nou
  // creată nu apare pe harta agentului — care e filtrată pe județ — și
  // omul rămâne exact cu problema de la care am plecat. Dacă satul e în
  // geo_localitati într-un SINGUR județ, ăla e; dacă e în mai multe
  // (sate cu același nume), nu alegem noi — rămâne gol.
  const fataJudet = bune.filter((f) => f.judet === "" && f.localitate !== "");
  if (fataJudet.length > 0) {
    const sate = [...new Set(fataJudet.map((f) => f.localitate))];
    const gasite = await db<Array<{ localitate: string; judet: string; cate: string }>>`
      SELECT localitate, MIN(judet) AS judet, COUNT(DISTINCT judet)::text AS cate
      FROM geo_localitati
      WHERE localitate = ANY(${sate})
      GROUP BY localitate
    `;
    const peSat = new Map<string, string>();
    for (const g of gasite) {
      if (g.cate === "1") peSat.set(g.localitate, g.judet);
    }
    for (const f of fataJudet) {
      const j = peSat.get(f.localitate);
      if (j) f.judet = j;
    }
  }

  const cuiuri = bune.map((f) => f.cui);
  const inainte = await db<Array<{ cui: string }>>`
    SELECT cui FROM prospects WHERE cui = ANY(${cuiuri})
  `;
  const existente = new Set(inainte.map((r) => r.cui));
  rez.existau = existente.size;

  const noi = bune.filter((f) => !existente.has(f.cui));
  for (let i = 0; i < noi.length; i += 500) {
    const bucata = noi.slice(i, i + 500).map((f) => ({ ...f, status: "nou", adus_de_org: orgId }));
    const r = await db`
      INSERT INTO prospects ${db(
        bucata,
        "cui", "denumire", "adresa", "localitate", "judet", "status", "adus_de_org",
      )}
      ON CONFLICT (cui) DO NOTHING
    `;
    rez.create += r.count;
  }

  // ── DATELE OFICIALE, LUATE DE LA ANAF ──
  // Omul ne dă CUI-ul (de pe certificat, din poză). Numele, adresa,
  // domeniul și telefonul le luăm de la sursă, nu de la cine tastează:
  // așa firma nouă intră în registru cu date adevărate, nu cu „magazinul
  // de la Vasile". Dacă ANAF nu răspunde, păstrăm ce-a scris omul și
  // măturătorul de noapte le completează mai târziu.
  if (noi.length > 0) {
    try {
      const { queryAnafBatch } = await import("./anaf");
      const gasite = await queryAnafBatch(noi.slice(0, 100).map((f) => f.cui));
      for (const [cuiAnaf, info] of gasite) {
        await db`
          UPDATE prospects SET
            denumire = CASE WHEN ${info.denumire ?? ""} <> '' THEN ${info.denumire ?? ""} ELSE denumire END,
            adresa = CASE WHEN ${info.adresa ?? ""} <> '' THEN ${info.adresa ?? ""} ELSE adresa END,
            caen = CASE WHEN ${info.caen ?? ""} <> '' THEN ${info.caen ?? ""} ELSE caen END,
            telefon = CASE WHEN ${info.telefon ?? ""} <> '' THEN ${info.telefon ?? ""} ELSE telefon END,
            activ = ${info.activ},
            tva = ${info.tva},
            updated_at = NOW()
          WHERE cui = ${cuiAnaf} AND adus_de_org = ${orgId}
        `;
      }
    } catch {
      // ANAF pică des și nu-i treaba agentului din teren: firma rămâne
      // cu ce s-a scris, verificarea automată o completează ulterior.
    }
  }

  if (agentName !== "") {
    // Alocăm DOAR ce n-are stăpân sau e deja al AGENȚIEI NOASTRE.
    // Varianta „assigned_org gol înseamnă liber" era o gaură: alocările
    // vechi (dinainte de coloana assigned_org) ale unui agent de la altă
    // firmă treceau prin ea și le luam clienții. Aceeași gardă ca peste
    // tot în platformă — pe nume ȘI pe firmă.
    // Numele tuturor agenților firmei: alocările vechi se judecă după
    // nume, ca peste tot, dar numai pentru numele NOASTRE.
    const colegi = await db<Array<{ name: string }>>`
      SELECT name FROM org_agents WHERE org_id = ${orgId} AND active
    `;
    const numeleNoastre = [
      ...new Set([agentName, ...colegi.map((c) => c.name)].filter((n) => n !== "")),
    ];
    const alocate = await db<Array<{ cui: string }>>`
      UPDATE prospects SET
        status = 'client',
        assigned_agent = ${agentName},
        assigned_org = ${orgId},
        updated_at = NOW()
      WHERE cui = ANY(${cuiuri})
        AND (COALESCE(assigned_agent, '') = ''
             OR ${alAgentiei(db, orgId, numeleNoastre)})
      RETURNING cui
    `;
    rez.alocate = alocate.length;
    const alocateSet = new Set(alocate.map((r) => r.cui));
    for (const f of bune) {
      if (alocateSet.has(f.cui)) {
        rez.reusite.push(cumAFostScris.get(f.cui) ?? f.cui);
      } else {
        rez.sarite.push({
          cui: cumAFostScris.get(f.cui) ?? f.cui,
          motiv: "e alocată altei agenții",
        });
      }
    }
  } else {
    // Fără alocare cerută: reușită = firma e în registru după trecerea asta.
    for (const f of bune) rez.reusite.push(cumAFostScris.get(f.cui) ?? f.cui);
  }
  return rez;
}
