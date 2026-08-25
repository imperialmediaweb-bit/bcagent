/**
 * Client pentru ANAF WebService v9 (PlatitorTvaRest).
 * Docs: https://static.anaf.ro/static/10/Anaf/Informatii_R/Servicii_web/doc_WS_V9.txt
 * Limite oficiale: max 500 CUI / cerere, max 1 cerere / secundă.
 * Rulează DOAR server-side (Railway are egress liber).
 */

import { normalizePhone } from "./parse";

const ANAF_URL = "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva";
export const ANAF_BATCH_SIZE = 500;

export interface AnafFirmInfo {
  cui: string;
  activ: boolean;
  tva: boolean;
  radiata: boolean;
  denumire?: string;
  adresa?: string;
  /** Codul CAEN principal raportat de ANAF (4 cifre). */
  caen?: string;
  /** Telefon din evidența ANAF (normalizat). */
  telefon?: string;
}

interface AnafResponseEntry {
  date_generale?: {
    cui?: number | string;
    denumire?: string;
    adresa?: string;
    cod_CAEN?: string | number;
    telefon?: string;
    fax?: string;
    codPostal?: string;
    nrRegCom?: string;
    statusRO_e_Factura?: boolean;
  };
  inregistrare_scop_Tva?: { scpTVA?: boolean };
  stare_inactiv?: {
    statusInactivi?: boolean;
    dataRadiere?: string | null;
    dataInactivare?: string | null;
  };
}

interface AnafResponse {
  cod?: number;
  found?: AnafResponseEntry[];
  notFound?: Array<number | string>;
}

/**
 * Interoghează ANAF pentru un batch de CUI-uri (max 500).
 * Returnează o hartă cui → info. CUI-urile negăsite lipsesc din hartă.
 */
export async function queryAnafBatch(
  cuis: string[],
): Promise<Map<string, AnafFirmInfo>> {
  return (await queryAnafBatchDetaliat(cuis)).found;
}

/**
 * Varianta STRICTĂ, pentru măturarea automată: pe lângă firmele găsite,
 * întoarce și lista EXPLICITĂ de CUI-uri pe care ANAF le declară negăsite
 * (data.notFound). Diferența contează enorm: „lipsește din răspuns" NU
 * înseamnă „radiată" — ANAF răspunde uneori 200 cu corp de eroare sau
 * parțial; doar ce declară EL negăsit se marchează inactiv, restul se
 * reia data viitoare. Aruncă dacă răspunsul nu e întreg (cod ≠ 200).
 */
export async function queryAnafBatchDetaliat(
  cuis: string[],
): Promise<{ found: Map<string, AnafFirmInfo>; notFound: Set<string> }> {
  const result = new Map<string, AnafFirmInfo>();
  const notFound = new Set<string>();
  if (cuis.length === 0) return { found: result, notFound };
  if (cuis.length > ANAF_BATCH_SIZE) {
    throw new Error(`Batch ANAF prea mare: ${cuis.length} > ${ANAF_BATCH_SIZE}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const payload = cuis.map((c) => ({ cui: Number(c), data: today }));

  const res = await fetch(ANAF_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`ANAF a răspuns cu ${res.status}`);
  }
  const data = (await res.json()) as AnafResponse;
  if (data.cod !== undefined && data.cod !== 200) {
    // 200 HTTP cu corp de eroare — răspunsul nu e de încredere.
    throw new Error(`ANAF a răspuns cu cod intern ${data.cod}`);
  }
  for (const nf of data.notFound ?? []) {
    const cui = String(nf).replace(/\D/g, "");
    if (cui) notFound.add(cui);
  }
  for (const entry of data.found ?? []) {
    const cui = String(entry.date_generale?.cui ?? "").trim();
    if (!cui) continue;
    const inactiv = entry.stare_inactiv?.statusInactivi === true;
    const radiata = !!entry.stare_inactiv?.dataRadiere;
    const caenRaw = String(entry.date_generale?.cod_CAEN ?? "").replace(/\D/g, "");
    result.set(cui, {
      cui,
      activ: !inactiv && !radiata,
      tva: entry.inregistrare_scop_Tva?.scpTVA === true,
      radiata,
      denumire: entry.date_generale?.denumire,
      adresa: entry.date_generale?.adresa,
      caen: caenRaw ? caenRaw.slice(0, 4) : undefined,
      telefon: normalizePhone(String(entry.date_generale?.telefon ?? "")),
    });
  }
  return { found: result, notFound };
}
