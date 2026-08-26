import { getDB } from "@/lib/db";

/**
 * IZOLAREA ÎNTRE FIRME în universul comun de prospecți.
 *
 * Tabelul `prospects` e piața întreagă, comună (orice agent vede firmele —
 * asta e prospectarea). Dar STAREA de lucru (status, notă, agent alocat,
 * sold) e a fiecărei agenții: firma A nu are voie să vadă cine sunt
 * clienții firmei B. Până la migrarea pe stare per-firmă, izolăm prin
 * MASCARE: cititorii care aparțin unei firme văd starea doar pe rândurile
 * alocate agenților firmei lor; restul apar ca firme simple din piață.
 *
 * Apelanții FĂRĂ firmă (tokenuri vechi, dinainte de multi-tenant) văd tot,
 * ca până acum — nu le stricăm panourile.
 */

/** Numele tuturor agenților din firma căreia îi aparține agentul dat.
 *  Gol = agentul nu e într-o firmă → fără mascare. */
export async function orgAgentNamesForAgent(agentId: string): Promise<string[]> {
  const db = getDB();
  if (!db) return [];
  try {
    const rows = await db<Array<{ name: string }>>`
      SELECT colegi.name
      FROM org_agents eu
      JOIN org_agents colegi ON colegi.org_id = eu.org_id
      WHERE eu.agent_id = ${agentId} AND eu.active
    `;
    return rows.map((r) => r.name);
  } catch {
    // tabelul platformei poate lipsi pe instalări vechi — fără mascare
    return [];
  }
}

/**
 * Firma (organizația) agentului — pentru lucrurile care privesc DOAR
 * firma lui: închiderile de prospecți, rapoartele de probleme etc.
 * Întoarce "" pentru linkurile vechi, fără organizație.
 */
export async function orgIdForAgent(agentId: string): Promise<string> {
  try {
    const { getDB } = await import("@/lib/db");
    const db = getDB();
    if (!db) return "";
    const [r] = await db<Array<{ org_id: string }>>`
      SELECT org_id FROM org_agents WHERE agent_id = ${agentId} LIMIT 1
    `;
    return r?.org_id ?? "";
  } catch {
    return "";
  }
}

type DB = NonNullable<ReturnType<typeof getDB>>;

/**
 * „E CLIENTUL FIRMEI ĂSTEIA?" — condiția, într-un singur loc.
 *
 * Până acum, întrebarea se punea peste tot la fel: „e alocat cuiva cu
 * numele unuia dintre agenții mei?". Numele nu ajunge. „Popescu Ion" e
 * cel mai obișnuit nume din țară, iar platforma e făcută pentru multe
 * firme de distribuție deodată: în ziua în care două dintre ele au
 * fiecare câte un Popescu Ion, fiecare o vedea pe cealaltă — stare,
 * notă, sold, tot. Nu e o teamă, se arată în două rânduri de test.
 *
 * Coloana `assigned_org` spune CINE a alocat. Goală = alocare veche,
 * dinainte de ea; aia se judecă după nume, ca înainte, ca să nu rămână
 * nimeni fără clienți peste noapte.
 *
 * Se cheamă PROASPĂT la fiecare folosire: postgres.js nu garantează că
 * același fragment poate fi refolosit în două interogări.
 *
 * Coloanele se scriu NEcalificate dinadins — merge și când tabelul e
 * `prospects`, și când e `prospects p`, fiindcă în interogările noastre
 * niciun alt tabel n-are coloanele astea.
 */
export function alAgentiei(db: DB, orgId: string, numeAgenti: string[]) {
  const nume = numeAgenti.length ? numeAgenti : [""];
  return db`(assigned_agent = ANY(${nume})
             AND (assigned_org = '' OR assigned_org = ${orgId || "-"}))`;
}
