/**
 * MĂTURAREA ANAF PERIODICĂ — igiena automată a listei de firme.
 *
 * Cererea utilizatorului (25.08): „nu trebuie să vezi în fiecare an dacă
 * sunt active?" — ba da, și fără să apese nimeni nimic. Măturarea trece
 * lunar prin firmele județelor lucrate (SV+BT implicit) și întreabă
 * ANAF: radiate/inactive fiscal → devin inactive și dispar din liste.
 *
 * Reguli precise (ca să nu stricăm ce știe TERENUL):
 *   - firmele cu inchis_teren = TRUE nu sunt reînviate NICIODATĂ de ANAF
 *     (legal pot fi active, dar agentul a văzut că magazinul e mort);
 *   - se verifică întâi ce n-a fost verificat niciodată, apoi ce e mai
 *     vechi de RECHECK_DAYS;
 *   - viteza respectă limita ANAF: 500 CUI/cerere, 1 cerere/secundă;
 *   - un singur proces mătură la un moment dat (advisory lock Postgres) —
 *     mai multe instanțe Railway nu dublează cererile spre ANAF.
 */

import type { Sql } from "postgres";
import { queryAnafBatchDetaliat, ANAF_BATCH_SIZE, type AnafFirmInfo } from "./anaf";

export const RECHECK_DAYS = 30;
const LOCK_KEY = 771_204_001; // cheie fixă pentru pg_advisory_lock

export function sweepJudete(): string[] {
  return (process.env.ANAF_SWEEP_JUDETE ?? "SV,BT")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{1,2}$/.test(s));
}

/** Firmele scadente la verificare (întâi neverificatele, apoi cele vechi). */
export async function firmeDeVerificat(
  db: Sql,
  judete: string[],
  limit: number,
): Promise<string[]> {
  const rows = await db<Array<{ cui: string }>>`
    SELECT cui FROM prospects
    WHERE judet = ANY(${judete})
      AND (anaf_checked_at IS NULL
           OR anaf_checked_at < NOW() - (${RECHECK_DAYS} || ' days')::interval)
    ORDER BY anaf_checked_at ASC NULLS FIRST
    LIMIT ${limit}
  `;
  return rows.map((r) => r.cui);
}

/**
 * Aplică răspunsul ANAF pe un batch. REGULĂ STRICTĂ: inactivă devine DOAR
 * firma pe care ANAF o declară EXPLICIT negăsită (radiată) sau inactivă
 * fiscal — „lipsește din răspuns" nu e dovadă (răspuns parțial/degradat)
 * și se reia data viitoare, fără anaf_checked_at. Închiderile din teren
 * nu sunt reînviate niciodată. Întoarce câte au devenit inactive și câte
 * au fost sărite.
 */
export async function aplicaRezultateAnaf(
  db: Sql,
  batch: string[],
  info: Map<string, AnafFirmInfo>,
  anafNotFound: Set<string>,
): Promise<{ inactive: number; sarite: number }> {
  const notFound: string[] = [];
  const updates: Array<{ cui: string; activ: boolean; tva: boolean }> = [];
  let inactive = 0;
  let sarite = 0;
  for (const cui of batch) {
    const firm = info.get(cui);
    if (firm) {
      updates.push({ cui, activ: firm.activ, tva: firm.tva });
      if (!firm.activ) inactive++;
    } else if (anafNotFound.has(cui)) {
      notFound.push(cui);
      inactive++;
    } else {
      sarite++; // nici găsită, nici declarată negăsită — nu ne atingem
    }
  }
  if (notFound.length > 0) {
    await db`
      UPDATE prospects
      SET activ = FALSE, anaf_checked_at = NOW(), updated_at = NOW()
      WHERE cui = ANY(${notFound})
    `;
  }
  if (updates.length > 0) {
    await db`
      UPDATE prospects p SET
        activ = CASE WHEN p.inchis_teren THEN FALSE ELSE u.activ END,
        tva = u.tva,
        anaf_checked_at = NOW(),
        updated_at = NOW()
      FROM jsonb_to_recordset(${db.json(updates)})
        AS u(cui text, activ boolean, tva boolean)
      WHERE p.cui = u.cui
    `;
  }
  return { inactive, sarite };
}

/**
 * Un „tic” de măturare: ia până la `maxBatches` × 500 de firme scadente
 * și le verifică la ANAF. Se cheamă periodic din instrumentation (sau
 * manual). Cu lock — un singur proces lucrează.
 */
export async function anafSweepTick(
  db: Sql,
  maxBatches = 10,
): Promise<{ verificate: number; inactive: number; sarite: number; ramase: number } | null> {
  // Lock-ul advisory e legat de CONEXIUNE — prin pool, lock-ul s-ar lua pe
  // o conexiune și unlock-ul ar nimeri alta (sau conexiunea idle ar muri
  // și lock-ul ar pica în mijlocul măturării). De-aia REZERVĂM o singură
  // conexiune pentru tot ticul: lock, toate query-urile și unlock-ul stau
  // pe același fir.
  const con = await db.reserve();
  try {
    const [{ lock }] = await con<[{ lock: boolean }]>`
      SELECT pg_try_advisory_lock(${LOCK_KEY}) AS lock
    `;
    if (!lock) return null; // altă instanță mătură deja
    try {
      const judete = sweepJudete();
      if (judete.length === 0) return { verificate: 0, inactive: 0, sarite: 0, ramase: 0 };
      const cuis = await firmeDeVerificat(con as unknown as Sql, judete, maxBatches * ANAF_BATCH_SIZE);
      let verificate = 0;
      let inactive = 0;
      let sarite = 0;
      for (let i = 0; i < cuis.length; i += ANAF_BATCH_SIZE) {
        const batch = cuis.slice(i, i + ANAF_BATCH_SIZE);
        const { found, notFound } = await queryAnafBatchDetaliat(batch);
        const r = await aplicaRezultateAnaf(con as unknown as Sql, batch, found, notFound);
        verificate += batch.length - r.sarite;
        inactive += r.inactive;
        sarite += r.sarite;
        if (i + ANAF_BATCH_SIZE < cuis.length) {
          await new Promise((res) => setTimeout(res, 1100));
        }
      }
      const [{ ramase }] = await con<[{ ramase: string }]>`
        SELECT COUNT(*)::text AS ramase FROM prospects
        WHERE judet = ANY(${judete})
          AND (anaf_checked_at IS NULL
               OR anaf_checked_at < NOW() - (${RECHECK_DAYS} || ' days')::interval)
      `;
      return { verificate, inactive, sarite, ramase: parseInt(ramase, 10) };
    } finally {
      await con`SELECT pg_advisory_unlock(${LOCK_KEY})`;
    }
  } finally {
    con.release();
  }
}
