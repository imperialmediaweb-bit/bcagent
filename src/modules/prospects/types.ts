/** Un prospect = o firmă potențial client. */
export interface Prospect {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  judet: string; // 'SV' | 'BT' | alt cod județ
  caen: string;
  caenDesc: string;
  tva: boolean | null; // plătitor TVA (null = neverificat la ANAF)
  activ: boolean | null; // firmă activă fiscal (null = neverificat)
  /** Telefon din fișierul MF sau de la ANAF. */
  telefon: string;
  /** Email — NU există în datele oficiale; se completează manual de agent. */
  email: string;
  /** Persoană de contact — completată manual de agent. */
  contact: string;
  status: ProspectStatus;
  note: string;
  assignedAgent: string;
  updatedAt: string; // ISO
}

export type ProspectStatus = "nou" | "contactat" | "client" | "respins";

export const PROSPECT_STATUSES: ProspectStatus[] = [
  "nou",
  "contactat",
  "client",
  "respins",
];

/** Rând brut extras din fișierul MF înainte de filtrare. */
export interface RawFirmRow {
  cui: string;
  denumire: string;
  /** Adresa completă (stradă + număr, dacă fișierul are coloane separate). */
  adresa: string;
  localitate: string;
  judet: string;
  caen: string;
  stare: string; // textul de stare din fișier, dacă există
  /** Telefon normalizat (doar cifre/+), gol dacă lipsește sau e invalid. */
  telefon: string;
}

export interface ParseFirmsResult {
  rows: RawFirmRow[];
  totalLines: number;
  skipped: number;
  delimiter: string;
  columnMap: Record<string, number>;
  headers: string[];
}

export interface ProspectFilter {
  judet?: string;
  localitate?: string;
  caen?: string;
  status?: ProspectStatus;
  search?: string;
  assignedAgent?: string;
  /** Doar firmele care au număr de telefon. */
  withPhone?: boolean;
  limit?: number;
  offset?: number;
}
