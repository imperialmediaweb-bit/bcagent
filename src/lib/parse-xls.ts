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
    .replace(/[̀-ͯ]/g, "")
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
      match = normalized.find(
        (h) =>
          !taken.has(h.original) &&
          aliases.some((a) => h.norm.includes(a) || a.includes(h.norm)),
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
    const utcDays = v - 25569;
    const utcValue = utcDays * 86400;
    const d = new Date(utcValue * 1000);
    if (!isNaN(d.getTime())) return d;
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
    // Handle Romanian format "1.234,56" → "1234.56"
    const hasComma = trimmed.includes(",");
    const hasDot = trimmed.includes(".");
    let cleaned = trimmed.replace(/[^\d,.\-]/g, "");
    if (hasComma && hasDot) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else if (hasComma) {
      cleaned = cleaned.replace(",", ".");
    }
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

export async function parseXLSBuffer(buffer: ArrayBuffer): Promise<ParseResult> {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { rows: [], mapping: {}, headers: [], skipped: 0 };
  }
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });
  if (rows.length === 0) {
    return { rows: [], mapping: {}, headers: [], skipped: 0 };
  }
  const headers = Object.keys(rows[0]);
  const mapping = detectColumns(headers);

  const out: NormalizedRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    const date = mapping.date ? parseDateCell(row[mapping.date]) : null;
    if (!date) {
      skipped++;
      continue;
    }
    out.push({
      date,
      agent: mapping.agent ? String(row[mapping.agent] ?? "").trim() : "",
      producer: mapping.producer
        ? String(row[mapping.producer] ?? "").trim()
        : "",
      client: mapping.client ? String(row[mapping.client] ?? "").trim() : "",
      volume: mapping.volume ? parseNumber(row[mapping.volume]) : 0,
      value: mapping.value ? parseNumber(row[mapping.value]) : 0,
    });
  }
  return { rows: out, mapping, headers, skipped };
}
