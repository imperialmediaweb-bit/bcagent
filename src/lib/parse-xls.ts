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

  // Antetul poate fi adânc: rapoartele SAGA („Ieșiri mărfuri pe documente")
  // au deasupra un preambul de ~10 rânduri (perioadă, tip marfă, agenți).
  const maxHeaderRow = Math.min(20, aoa.length);
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

  // FALLBACK „fără coloană de dată": exportul SAGA plat („Ieșiri mărfuri
  // pe documente", rând per client×produs) nu are data pe rând — o are
  // doar în preambul, ca „Perioada: dd.mm.yyyy..". Dacă niciun antet cu
  // dată n-a produs rânduri, folosim data de start a perioadei pentru
  // toate rândurile (același compromis ca la pivotul grupat pe agent).
  if (!candidates.some((c) => c.rowsCount > 0)) {
    let defaultDate: Date | null = null;
    for (let i = 0; i < Math.min(25, aoa.length); i++) {
      const row = aoa[i];
      if (!Array.isArray(row)) continue;
      const text = row.map((c) => (c == null ? "" : String(c))).join(" ");
      const m = text.match(
        /[Pp]erioada[:\s]+(\d{1,2})[./-](\d{1,2})[./-](\d{4})/,
      );
      if (m) {
        defaultDate = new Date(
          parseInt(m[3], 10),
          parseInt(m[2], 10) - 1,
          parseInt(m[1], 10),
        );
        break;
      }
    }
    if (defaultDate) {
      for (let h = 0; h < maxHeaderRow; h++) {
        const raw = aoa[h];
        if (!Array.isArray(raw)) continue;
        const headers = raw.map((v) => (v == null ? "" : String(v).trim()));
        if (headers.filter((x) => x !== "").length < 3) continue;
        const mapping = detectColumns(headers.filter((x) => x !== ""));
        // Fără dată e acceptabil doar dacă restul e clar: cine (client +
        // agent) și cât (cantitate sau valoare).
        if (!mapping.client || !mapping.agent) continue;
        if (!mapping.volume && !mapping.value) continue;
        const rows: NormalizedRow[] = [];
        let skipped = 0;
        for (let r = h + 1; r < aoa.length; r++) {
          const rowArr = aoa[r];
          if (!Array.isArray(rowArr)) continue;
          const obj: Record<string, unknown> = {};
          for (let c = 0; c < headers.length; c++) {
            if (headers[c]) obj[headers[c]] = rowArr[c];
          }
          const client = String(obj[mapping.client] ?? "").trim();
          if (!client) {
            if (Object.values(obj).some((v) => v != null && String(v).trim() !== "")) {
              skipped++;
            }
            continue;
          }
          rows.push({
            date: defaultDate,
            agent: mapping.agent ? String(obj[mapping.agent] ?? "").trim() : "",
            producer: mapping.producer
              ? String(obj[mapping.producer] ?? "").trim()
              : "",
            client,
            volume: mapping.volume ? parseNumber(obj[mapping.volume]) : 0,
            value: mapping.value ? parseNumber(obj[mapping.value]) : 0,
          });
        }
        if (rows.length > 0) {
          candidates.push({
            sheet: sheetName,
            headerRow: h + 1,
            headers,
            mapping,
            mappedCount: Object.keys(mapping).length,
            rowsCount: rows.length,
            rows,
            skipped,
          });
          break;
        }
      }
    }
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

/**
 * Parser dedicat pentru rapoarte tip "pivot grupat pe agent" (SAGA et al.):
 *
 *   Iesiri marfuri pe documente
 *   ...
 *   Perioada: 01.04.2026..30.04.2026
 *   ...
 *   Agent | Nume grupa | Cantitate
 *         | BRITISH    | 1.529,00
 *         | CARPATI    | 20
 *   ...
 *   T:Calinciuc Gabriel |   | 4.054,00
 *         | BRITISH    | 2.320,00
 *   ...
 *   T:Cojocaru Razvan   |   | 5.809,00
 *   ...
 *   Total general:      |   | 25.998,00
 *
 * Coloana Agent e goală pe rândurile de detaliu — agentul apare doar la
 * subtotaluri sub forma "T:Nume". Data nu apare pe rând, doar în header
 * ca "Perioada: dd.mm.yyyy..dd.mm.yyyy". Aplic data de start tuturor.
 */
function parseGroupedPivot(
  sheet: XLSX.WorkSheet,
  sheetName: string,
): {
  rows: NormalizedRow[];
  defaultDate: Date | null;
  headerRow: number;
  sheetName: string;
} | null {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: false,
  });
  if (aoa.length < 3) return null;

  // 1. Extrage data din header (Perioada: dd.mm.yyyy..dd.mm.yyyy)
  let defaultDate: Date | null = null;
  for (let i = 0; i < Math.min(25, aoa.length); i++) {
    const row = aoa[i];
    if (!Array.isArray(row)) continue;
    const text = row
      .map((c) => (c == null ? "" : String(c)))
      .join(" ");
    const m = text.match(
      /[Pp]erioada[:\s]+(\d{1,2})[./-](\d{1,2})[./-](\d{4})/,
    );
    if (m) {
      defaultDate = new Date(
        parseInt(m[3], 10),
        parseInt(m[2], 10) - 1,
        parseInt(m[1], 10),
      );
      break;
    }
  }

  // 2. Găsește rândul de header cu Agent + grupa/brand/producator + Cantitate
  let headerIdx = -1;
  let agentCol = -1;
  let groupCol = -1;
  let qtyCol = -1;
  let valueCol = -1;
  for (let i = 0; i < Math.min(30, aoa.length); i++) {
    const row = aoa[i];
    if (!Array.isArray(row)) continue;
    const norm = row.map((c) => normalize(String(c ?? "")));
    const aIdx = norm.findIndex((s) => s === "agent" || s === "vanzator");
    const gIdx = norm.findIndex(
      (s) =>
        s === "nume grupa" ||
        s === "grupa" ||
        s === "brand" ||
        s === "producator" ||
        s === "marca" ||
        s === "denumire grupa",
    );
    const qIdx = norm.findIndex(
      (s) => s === "cantitate" || s === "cant" || s === "qty",
    );
    if (aIdx >= 0 && gIdx >= 0 && qIdx >= 0) {
      headerIdx = i;
      agentCol = aIdx;
      groupCol = gIdx;
      qtyCol = qIdx;
      // Optional: caută și coloană de valoare
      const vIdx = norm.findIndex(
        (s) => s === "valoare" || s === "value" || s === "suma",
      );
      if (vIdx >= 0) valueCol = vIdx;
      break;
    }
  }
  if (headerIdx < 0) return null;

  // 3. Parsează rândurile sub header
  const rows: NormalizedRow[] = [];
  let pending: Array<{ producer: string; volume: number; value: number }> = [];

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!Array.isArray(row)) continue;

    const firstAgentCell = String(row[agentCol] ?? "").trim();
    const groupCell = String(row[groupCol] ?? "").trim();
    const qtyRaw = row[qtyCol];
    const valueRaw = valueCol >= 0 ? row[valueCol] : null;

    // Total general → stop
    const joined = `${firstAgentCell} ${groupCell}`.toLowerCase();
    if (/total\s+general/.test(joined)) break;

    // T:Nume agent → flush buffer
    const subtotalMatch = firstAgentCell.match(/^T\s*:\s*(.+?)\s*$/);
    if (subtotalMatch) {
      const agentName = subtotalMatch[1].trim();
      if (agentName) {
        for (const item of pending) {
          rows.push({
            date: defaultDate ?? new Date(),
            agent: agentName,
            producer: item.producer,
            client: "",
            volume: item.volume,
            value: item.value,
          });
        }
      }
      pending = [];
      continue;
    }

    // Rând de detaliu (brand + cantitate)
    if (groupCell && (qtyRaw != null || valueRaw != null)) {
      pending.push({
        producer: groupCell,
        volume: qtyRaw != null ? parseNumber(qtyRaw) : 0,
        value: valueRaw != null ? parseNumber(valueRaw) : 0,
      });
    }
  }

  if (rows.length === 0) return null;
  return { rows, defaultDate, headerRow: headerIdx + 1, sheetName };
}

export async function parseXLSBuffer(buffer: ArrayBuffer): Promise<ParseResult> {
  const smartText = decodeTextSmart(buffer);
  const wb =
    smartText !== null
      ? XLSX.read(smartText, { type: "string", cellDates: true })
      : XLSX.read(buffer, { type: "array", cellDates: true });
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
    // Fallback: încearcă parser-ul de pivot grupat (SAGA & co.)
    for (const sn of sheetNames) {
      const sheet = wb.Sheets[sn];
      if (!sheet) continue;
      const pivot = parseGroupedPivot(sheet, sn);
      if (pivot && pivot.rows.length > 0) {
        return {
          rows: pivot.rows,
          mapping: {
            date: "(perioada — extras din header)",
            agent: "Agent",
            producer: "Nume grupa",
            volume: "Cantitate",
          },
          headers: ["Agent", "Nume grupa", "Cantitate"],
          skipped: 0,
          diagnostic: {
            sheetNames,
            sheetUsed: pivot.sheetName,
            headerRow: pivot.headerRow,
            sample,
            candidates: allCandidates
              .sort((a, b) => b.rowsCount - a.rowsCount)
              .slice(0, 5),
          },
        };
      }
    }

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

/* ───────────────── Fișier de CLIENȚI (universul de clienți) ───────────────
   Lista de clienți a firmei: o coloană cu denumirea, opțional CUI și agentul
   care îi ține. Coloanele se detectează după antet; dacă nu există antet,
   prima coloană cu texte e denumirea. */

export interface ClientFileRow {
  name: string;
  cui: string;
  agent: string;
}

export interface ClientsParseResult {
  clients: ClientFileRow[];
  sheetName: string;
  columns: { name: string; cui: string; agent: string };
}

const CLIENT_NAME_HEADERS =
  /denumire|client|firma|firmă|nume|societate|magazin|partener/i;
const CLIENT_CUI_HEADERS = /\bcui\b|cod\s*fiscal|\bcif\b|cod\s*unic/i;
const CLIENT_AGENT_HEADERS = /agent|vanzator|vânzător|reprezentant|gestionar/i;

/**
 * Fișierele text românești (CSV/TXT din SAGA sau Excel vechi) vin adesea
 * în Windows-1250, nu UTF-8 — citite greșit, diacriticele ies gunoi (�).
 * Detectăm: dacă e binar (xlsx/xls/ods) întoarcem null; dacă e text,
 * încercăm UTF-8 și, când apar caractere sparte, redecodăm ca CP1250.
 */
export function decodeTextSmart(buffer: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 4) {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return null; // ZIP (xlsx/ods)
    if (
      bytes[0] === 0xd0 && bytes[1] === 0xcf &&
      bytes[2] === 0x11 && bytes[3] === 0xe0
    )
      return null; // OLE2 (xls binar)
  }
  let ctrl = 0;
  const n = Math.min(bytes.length, 4096);
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b < 9 || (b > 13 && b < 32)) ctrl++;
  }
  if (n === 0 || ctrl / n > 0.02) return null; // prea multe bytes de control → binar
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("windows-1250").decode(buffer);
  } catch {
    return utf8; // mediu fără CP1250 — rămânem pe ce avem
  }
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

export async function parseClientsFile(
  buffer: ArrayBuffer,
): Promise<ClientsParseResult> {
  const text = decodeTextSmart(buffer);
  const wb =
    text !== null
      ? XLSX.read(text, { type: "string" })
      : XLSX.read(buffer, { type: "array" });
  let best: ClientsParseResult = {
    clients: [],
    sheetName: "",
    columns: { name: "", cui: "", agent: "" },
  };

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: false,
      blankrows: false,
    });
    if (aoa.length === 0) continue;

    // Căutăm rândul de antet în primele 10 rânduri.
    let headerRow = -1;
    let nameCol = -1;
    let cuiCol = -1;
    let agentCol = -1;
    for (let r = 0; r < Math.min(10, aoa.length); r++) {
      const row = aoa[r] ?? [];
      let n = -1;
      let c = -1;
      let a = -1;
      for (let i = 0; i < row.length; i++) {
        const h = cellText(row[i]);
        if (!h) continue;
        // Un antet e scurt și nu arată ca o denumire de firmă reală
        // (ex: „MAGAZIN CENTRAL SRL" conține „magazin" dar NU e antet).
        const looksLikeFirm =
          h.length > 30 || /\b(SRL|S\.?R\.?L\.?|PFA|SA|SNC|II)\b\.?$/i.test(h);
        if (looksLikeFirm) continue;
        if (n === -1 && CLIENT_NAME_HEADERS.test(h)) n = i;
        if (c === -1 && CLIENT_CUI_HEADERS.test(h)) c = i;
        if (a === -1 && CLIENT_AGENT_HEADERS.test(h)) a = i;
      }
      if (n !== -1) {
        headerRow = r;
        nameCol = n;
        cuiCol = c;
        agentCol = a;
        break;
      }
    }

    // Fără antet: prima coloană cu majoritatea celulelor text lungi.
    if (headerRow === -1) {
      const sampleRows = aoa.slice(0, 50);
      const width = Math.max(...sampleRows.map((r) => (r ?? []).length), 0);
      for (let i = 0; i < width; i++) {
        const texts = sampleRows.filter((r) => {
          const v = cellText((r ?? [])[i]);
          return v.length >= 4 && !/^\d+([.,]\d+)?$/.test(v);
        }).length;
        if (texts >= Math.min(5, sampleRows.length)) {
          nameCol = i;
          headerRow = -1;
          break;
        }
      }
      if (nameCol === -1) continue;
    }

    const clients: ClientFileRow[] = [];
    for (let r = headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r] ?? [];
      const name = cellText(row[nameCol]);
      if (name.length < 4) continue;
      // Rânduri de total/subtotal — nu sunt clienți.
      if (/^total|^subtotal/i.test(name)) continue;
      clients.push({
        name: name.slice(0, 200),
        cui:
          cuiCol !== -1
            ? cellText(row[cuiCol]).replace(/\D/g, "").slice(0, 12)
            : "",
        agent: agentCol !== -1 ? cellText(row[agentCol]).slice(0, 128) : "",
      });
    }

    if (clients.length > best.clients.length) {
      const headers = headerRow >= 0 ? (aoa[headerRow] ?? []) : [];
      best = {
        clients,
        sheetName,
        columns: {
          name: headerRow >= 0 ? cellText(headers[nameCol]) : `coloana ${nameCol + 1}`,
          cui: cuiCol !== -1 ? cellText(headers[cuiCol]) : "",
          agent: agentCol !== -1 ? cellText(headers[agentCol]) : "",
        },
      };
    }
  }
  // Dedup pe nume+cui (listele centralizate au adesea dubluri).
  const seen = new Set<string>();
  best.clients = best.clients.filter((c) => {
    const k = `${c.cui}|${c.name.toUpperCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5000);
  return best;
}
