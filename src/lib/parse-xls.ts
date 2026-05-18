import * as XLSX from "xlsx";

export interface NormalizedRow {
  date: Date;
  agent: string;
  producer: string;
  client: string;
  volume: number;
  value: number;
}

export interface ColumnMapping {
  date?: string;
  agent?: string;
  producer?: string;
  client?: string;
  volume?: string;
  value?: string;
}

export interface ParseResult {
  rows: NormalizedRow[];
  mapping: ColumnMapping;
  headers: string[];
  skipped: number;
  /** Debug info pentru când auto-detect eșuează. */
  diagnostic?: {
    sheetNames: string[];
    sheetUsed?: string;
    headerRow?: number;
    sample?: Array<Record<string, unknown>>;
    candidates?: Array<{
      sheet: string;
      headerRow: number;
      headers: string[];
      mapping: ColumnMapping;
      mappedCount: number;
      rowsCount: number;
    }>;
  };
}

const ALIASES: Record<keyof ColumnMapping, string[]> = {
  date: [
    "data",
    "date",
    "ziua",
    "luna",
    "perioada",
    "data vanzare",
    "data vanzarii",
    "data tranzactie",
    "data document",
    "data factura",
    "data emitere",
    "month",
    "day",
    "transaction date",
  ],
  agent: [
    "agent",
    "vanzator",
    "reprezentant",
    "sales agent",
    "salesperson",
    "agent vanzari",
    "rep",
    "user",
    "operator",
  ],
  producer: [
    "producator",
    "producer",
    "furnizor",
    "brand",
    "marca",
    "supplier",
    "manufacturer",
    "vendor",
    "fabricant",
    "grupa",
    "grupa produs",
    "grupa produse",
    "categorie",
    "categorie produs",
    "familie",
    "linie",
    "linie produs",
  ],
  client: [
    "client",
    "customer",
    "cumparator",
    "partener",
    "company",
    "beneficiar",
    "client final",
  ],
  volume: [
    "volum",
    "volume",
    "cantitate",
    "quantity",
    "qty",
    "buc",
    "bucati",
    "litri",
    "kg",
    "units",
    "unitati",
  ],
  value: [
    "valoare",
    "value",
    "suma",
    "amount",
    "pret",
    "price",
    "total",
    "venit",
    "revenue",
    "incasari",
    "net",
    "gross",
    "valoare neta",
    "valoare totala",
  ],
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectColumns(headers: string[]): ColumnMapping {
  const result: ColumnMapping = {};
  const normalized = headers.map((h) => ({ original: h, norm: normalize(h) }));
  const taken = new Set<string>();

  for (const field of Object.keys(ALIASES) as (keyof ColumnMapping)[]) {
    const aliases = ALIASES[field].map(normalize);
    let match = normalized.find(
      (h) => !taken.has(h.original) && aliases.includes(h.norm),
    );
    if (!match) {
      // Substring fuzzy match — dar evită potriviri prea liberale.
      // Cere ca header-ul normalizat să fie >= 4 chars ȘI fie să conțină
      // un alias întreg, fie să fie conținut de un alias dar nu mai scurt
      // decât 60% din lungimea aliasului.
      match = normalized.find(
        (h) =>
          !taken.has(h.original) &&
          h.norm.length >= 4 &&
          aliases.some((a) => {
            if (a.length < 4) return false;
            if (h.norm.includes(a)) return true;
            if (a.includes(h.norm) && h.norm.length >= a.length * 0.6)
              return true;
            return false;
          }),
      );
    }
    if (match) {
      result[field] = match.original;
      taken.add(match.original);
    }
  }
  return result;
}

function parseDateCell(v: unknown): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    // Excel serial date → build LOCAL date so day-level buckets are stable
    // across timezones (otherwise 2024-01-01 in Excel can land in 2023-12-31).
    const utcMs = (v - 25569) * 86400 * 1000;
    const utc = new Date(utcMs);
    if (!isNaN(utc.getTime())) {
      return new Date(
        utc.getUTCFullYear(),
        utc.getUTCMonth(),
        utc.getUTCDate(),
      );
    }
  }
  if (typeof v === "string") {
    const m = v.match(
      /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/,
    );
    if (m) {
      const [, d, mo, y] = m;
      const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
      const dt = new Date(year, parseInt(mo, 10) - 1, parseInt(d, 10));
      if (!isNaN(dt.getTime())) return dt;
    }
    const iso = new Date(v);
    if (!isNaN(iso.getTime())) return iso;
  }
  return null;
}

function parseNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return 0;
    const hasComma = trimmed.includes(",");
    const hasDot = trimmed.includes(".");
    let cleaned = trimmed.replace(/[^\d,.\-]/g, "");
    if (hasComma && hasDot) {
      // Format românesc cu mii și zecimale: "1.234,56" → 1234.56
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else if (hasComma) {
      // Doar virgulă = zecimală românească: "1234,56" → 1234.56
      cleaned = cleaned.replace(",", ".");
    } else if (hasDot) {
      // Doar punct: ambiguu. Euristică — dacă cifrele după punct sunt
      // exact 3 (sau multiple grupuri de 3), e separator de mii românesc;
      // altfel decimal stil EN.
      const m = cleaned.match(/^-?\d{1,3}(\.\d{3})+$/);
      if (m) cleaned = cleaned.replace(/\./g, "");
    }
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * Scanează un sheet ca matrice 2D și încearcă rândurile 0-5 ca posibil
 * header. Pentru fiecare candidat, calculează mapping-ul și numărul de rânduri
 * parsabile. Returnează cel mai bun candidat.
 */
function scanSheet(
  sheet: XLSX.WorkSheet,
  sheetName: string,
): {
  headers: string[];
  mapping: ColumnMapping;
  headerRow: number;
  rows: NormalizedRow[];
  skipped: number;
  candidates: Array<{
    sheet: string;
    headerRow: number;
    headers: string[];
    mapping: ColumnMapping;
    mappedCount: number;
    rowsCount: number;
  }>;
} {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  });

  const candidates: Array<{
    sheet: string;
    headerRow: number;
    headers: string[];
    mapping: ColumnMapping;
    mappedCount: number;
    rowsCount: number;
    rows: NormalizedRow[];
    skipped: number;
  }> = [];

  const maxHeaderRow = Math.min(6, aoa.length);
  for (let h = 0; h < maxHeaderRow; h++) {
    const raw = aoa[h];
    if (!Array.isArray(raw)) continue;
    const headers = raw.map((v) =>
      v == null ? "" : String(v).trim(),
    );
    const nonEmpty = headers.filter((x) => x !== "").length;
    if (nonEmpty < 3) continue;
    const mapping = detectColumns(headers.filter((x) => x !== ""));
    const mappedCount = Object.keys(mapping).length;
    if (!mapping.date) continue; // date e obligatoriu
    if (mappedCount < 2) continue;

    // Parsează rândurile de sub header
    const rows: NormalizedRow[] = [];
    let skipped = 0;
    for (let r = h + 1; r < aoa.length; r++) {
      const rowArr = aoa[r];
      if (!Array.isArray(rowArr)) continue;
      const obj: Record<string, unknown> = {};
      for (let c = 0; c < headers.length; c++) {
        if (headers[c]) obj[headers[c]] = rowArr[c];
      }
      const date = mapping.date ? parseDateCell(obj[mapping.date]) : null;
      if (!date) {
        if (Object.values(obj).some((v) => v != null && String(v).trim() !== "")) {
          skipped++;
        }
        continue;
      }
      rows.push({
        date,
        agent: mapping.agent ? String(obj[mapping.agent] ?? "").trim() : "",
        producer: mapping.producer
          ? String(obj[mapping.producer] ?? "").trim()
          : "",
        client: mapping.client ? String(obj[mapping.client] ?? "").trim() : "",
        volume: mapping.volume ? parseNumber(obj[mapping.volume]) : 0,
        value: mapping.value ? parseNumber(obj[mapping.value]) : 0,
      });
    }

    candidates.push({
      sheet: sheetName,
      headerRow: h + 1,
      headers,
      mapping,
      mappedCount,
      rowsCount: rows.length,
      rows,
      skipped,
    });
  }

  // Cel mai bun candidat = cele mai multe rânduri parsate (prioritar),
  // apoi cele mai multe coloane mapate.
  candidates.sort((a, b) => {
    if (b.rowsCount !== a.rowsCount) return b.rowsCount - a.rowsCount;
    return b.mappedCount - a.mappedCount;
  });

  const best = candidates[0];
  return {
    headers: best?.headers ?? [],
    mapping: best?.mapping ?? {},
    headerRow: best?.headerRow ?? 0,
    rows: best?.rows ?? [],
    skipped: best?.skipped ?? 0,
    candidates: candidates.map((c) => ({
      sheet: c.sheet,
      headerRow: c.headerRow,
      headers: c.headers,
      mapping: c.mapping,
      mappedCount: c.mappedCount,
      rowsCount: c.rowsCount,
    })),
  };
}

export async function parseXLSBuffer(buffer: ArrayBuffer): Promise<ParseResult> {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetNames = wb.SheetNames;

  if (sheetNames.length === 0) {
    return {
      rows: [],
      mapping: {},
      headers: [],
      skipped: 0,
      diagnostic: { sheetNames: [] },
    };
  }

  let best:
    | (ReturnType<typeof scanSheet> & { sheetName: string })
    | null = null;
  const allCandidates: Array<{
    sheet: string;
    headerRow: number;
    headers: string[];
    mapping: ColumnMapping;
    mappedCount: number;
    rowsCount: number;
  }> = [];

  for (const sheetName of sheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const scan = scanSheet(sheet, sheetName);
    allCandidates.push(...scan.candidates);
    if (
      !best ||
      scan.rows.length > best.rows.length ||
      (scan.rows.length === best.rows.length &&
        Object.keys(scan.mapping).length > Object.keys(best.mapping).length)
    ) {
      best = { ...scan, sheetName };
    }
  }

  // Sample pentru debug (primele 5 rânduri din foaia primă, raw)
  const firstSheet = wb.Sheets[sheetNames[0]];
  const sampleAoa = firstSheet
    ? XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
        header: 1,
        defval: null,
        raw: true,
        blankrows: false,
      })
    : [];
  const sample = sampleAoa.slice(0, 5).map((r, i) => {
    const arr = Array.isArray(r) ? r : [];
    const obj: Record<string, unknown> = { _row: i + 1 };
    for (let c = 0; c < arr.length; c++) {
      obj[`col${c + 1}`] = arr[c];
    }
    return obj;
  });

  if (!best || best.rows.length === 0) {
    return {
      rows: [],
      mapping: best?.mapping ?? {},
      headers: best?.headers ?? [],
      skipped: best?.skipped ?? 0,
      diagnostic: {
        sheetNames,
        sheetUsed: best?.sheetName,
        headerRow: best?.headerRow,
        sample,
        candidates: allCandidates
          .sort((a, b) => b.rowsCount - a.rowsCount)
          .slice(0, 10),
      },
    };
  }

  return {
    rows: best.rows,
    mapping: best.mapping,
    headers: best.headers.filter((h) => h !== ""),
    skipped: best.skipped,
    diagnostic: {
      sheetNames,
      sheetUsed: best.sheetName,
      headerRow: best.headerRow,
      sample,
      candidates: allCandidates
        .sort((a, b) => b.rowsCount - a.rowsCount)
        .slice(0, 5),
    },
  };
}
