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
import { queryAnafBatch, ANAF_BATCH_SIZE, type AnafFirmInfo } from "./anaf";

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
 * Aplică răspunsul ANAF pe un batch: negăsit = radiat → inactiv; găsit →
 * starea de la ANAF, DAR fără să reînvie închiderile din teren. Toate
 * primesc anaf_checked_at = NOW(). Întoarce câte au devenit inactive.
 */
export async function aplicaRezultateAnaf(
  db: Sql,
  batch: string[],
  info: Map<string, AnafFirmInfo>,
): Promise<{ inactive: number }> {
  const notFound: string[] = [];
  const updates: Array<{ cui: string; activ: boolean; tva: boolean }> = [];
  let inactive = 0;
  for (const cui of batch) {
    const firm = info.get(cui);
    if (!firm) {
      notFound.push(cui);
      inactive++;
    } else {
      updates.push({ cui, activ: firm.activ, tva: firm.tva });
      if (!firm.activ) inactive++;
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
  return { inactive };
}

/**
 * Un „tic” de măturare: ia până la `maxBatches` × 500 de firme scadente
 * și le verifică la ANAF. Se cheamă periodic din instrumentation (sau
 * manual). Cu lock — un singur proces lucrează.
 */
export async function anafSweepTick(
  db: Sql,
  maxBatches = 10,
): Promise<{ verificate: number; inactive: number; ramase: number } | null> {
  const [{ lock }] = await db<[{ lock: boolean }]>`
    SELECT pg_try_advisory_lock(${LOCK_KEY}) AS lock
  `;
  if (!lock) return null; // altă instanță mătură deja
  try {
    const judete = sweepJudete();
    if (judete.length === 0) return { verificate: 0, inactive: 0, ramase: 0 };
    const cuis = await firmeDeVerificat(db, judete, maxBatches * ANAF_BATCH_SIZE);
    let verificate = 0;
    let inactive = 0;
    for (let i = 0; i < cuis.length; i += ANAF_BATCH_SIZE) {
      const batch = cuis.slice(i, i + ANAF_BATCH_SIZE);
      const info = await queryAnafBatch(batch);
      const r = await aplicaRezultateAnaf(db, batch, info);
      verificate += batch.length;
      inactive += r.inactive;
      if (i + ANAF_BATCH_SIZE < cuis.length) {
        await new Promise((res) => setTimeout(res, 1100));
      }
    }
    const [{ ramase }] = await db<[{ ramase: string }]>`
      SELECT COUNT(*)::text AS ramase FROM prospects
      WHERE judet = ANY(${judete})
        AND (anaf_checked_at IS NULL
             OR anaf_checked_at < NOW() - (${RECHECK_DAYS} || ' days')::interval)
    `;
    return { verificate, inactive, ramase: parseInt(ramase, 10) };
  } finally {
    await db`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  }
}
