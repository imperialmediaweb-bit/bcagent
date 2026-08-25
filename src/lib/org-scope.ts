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
