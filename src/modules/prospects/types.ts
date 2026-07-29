/** Un prospect = o firmă potențial client pentru distribuție. */
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
  adresa: string;
  localitate: string;
  judet: string;
  caen: string;
  stare: string; // textul de stare din fișier, dacă există
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
  limit?: number;
  offset?: number;
}
