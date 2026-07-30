import type { ParseFirmsResult, RawFirmRow } from "./types";
import { normalizeCounty } from "./caen";

/**
 * Parser tolerant pentru fișierele MF „Date de identificare plătitori".
 * Formatul variază între ediții (delimitator, ordinea și numele coloanelor),
 * așa că: (1) detectăm delimitatorul, (2) mapăm coloanele fuzzy după nume,
 * (3) dacă nu există header recognoscibil, încercăm maparea pozițională
 * clasică MF (CUI | DENUMIRE | ... | ADRESA | JUDET ...).
 */

const DELIMITERS = ["|", "^", "\t", ";", ","] as const;

/**
 * Împarte o linie pe delimitator respectând câmpurile între ghilimele
 * (CSV standard: `"FIRMA X, SRL",123` → ["FIRMA X, SRL", "123"]).
 * Fast-path fără ghilimele = split simplu.
 */
export function splitDelimited(line: string, delimiter: string): string[] {
  if (!line.includes('"')) return line.split(delimiter);
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'; // ghilimele escapate ""
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COLUMN_ALIASES: Record<string, string[]> = {
  cui: ["cui", "cod fiscal", "cod unic", "cif", "codunic", "cod de identificare fiscala"],
  denumire: ["denumire", "denumire platitor", "nume firma", "denumire firma", "nume"],
  adresa: ["adresa", "adresa completa", "adr", "domiciliul fiscal", "sediu", "strada"],
  /** Numărul de la adresă — coloană separată în fișierele MF (STRADA^NR). */
  nr: ["nr", "numar", "nr strada", "numar strada"],
  localitate: ["localitate", "oras", "comuna", "loc"],
  judet: ["judet", "jud", "cod judet"],
  caen: ["caen", "cod caen", "obiect de activitate", "cod activitate"],
  stare: ["stare", "stare firma", "stare inregistrare", "status", "stare fiscala"],
  telefon: ["telefon", "tel", "nr telefon", "numar telefon", "telefoane", "mobil"],
};

export function detectDelimiter(lines: string[]): string {
  let best: string = DELIMITERS[0];
  let bestScore = -1;
  for (const d of DELIMITERS) {
    // Scor = numărul minim de coloane pe primele linii (consistență)
    const counts = lines
      .slice(0, 10)
      .filter((l) => l.trim() !== "")
      .map((l) => l.split(d).length);
    if (counts.length === 0) continue;
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    // vrem multe coloane și consistență între linii
    const score = min >= 3 && max - min <= 2 ? min : 0;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export function mapColumnsByHeader(
  headerCells: string[],
): Record<string, number> | null {
  const norm = headerCells.map(normalizeHeader);
  const map: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    // Pasul 1: potrivire EXACTĂ — "judet" preferă coloana "JUDET",
    // nu "JUDET_COMERT" aflată mai în stânga.
    let idx = norm.findIndex((h) => h.length > 0 && aliases.includes(h));
    // Pasul 2: fuzzy (substring) doar dacă nu există potrivire exactă
    if (idx < 0) {
      idx = norm.findIndex(
        (h) =>
          h.length >= 3 &&
          aliases.some(
            (a) => a.length >= 3 && (h.includes(a) || a.includes(h)),
          ),
      );
    }
    if (idx >= 0) map[field] = idx;
  }
  // Minim necesar: cui + denumire
  if (map.cui === undefined || map.denumire === undefined) return null;
  return map;
}

/**
 * Fallback pozițional pentru fișiere MF fără header. Formatul istoric:
 * CUI|DENUMIRE|COD_INMATRICULARE|DATA_INREG|COD_CAEN|ADRESA|NR_TEL|FAX|
 * CODPOSTAL|ACT_AUTORIZARE|STARE_FIRMA|...
 * (poziții aproximative — validăm prin heuristici pe primul rând de date)
 */
export function positionalMap(cells: string[]): Record<string, number> | null {
  if (cells.length < 5) return null;
  // CUI = primul câmp numeric de 2-10 cifre
  const cuiIdx = cells.findIndex((c) => /^\d{2,10}$/.test(c.trim()));
  if (cuiIdx < 0) return null;
  const map: Record<string, number> = { cui: cuiIdx };
  // Denumirea = primul câmp text lung după CUI
  for (let i = cuiIdx + 1; i < cells.length; i++) {
    const v = cells[i].trim();
    if (v.length >= 4 && /[a-zA-Z]{3}/.test(v)) {
      map.denumire = i;
      break;
    }
  }
  if (map.denumire === undefined) return null;
  // CAEN = câmp de exact 4 cifre după denumire
  for (let i = map.denumire + 1; i < cells.length; i++) {
    if (/^\d{4}$/.test(cells[i].trim())) {
      map.caen = i;
      break;
    }
  }
  // Adresa = cel mai lung câmp text rămas
  let bestLen = 0;
  for (let i = map.denumire + 1; i < cells.length; i++) {
    const v = cells[i].trim();
    if (i !== map.caen && v.length > bestLen && /[a-zA-Z]/.test(v)) {
      bestLen = v.length;
      map.adresa = i;
    }
  }
  return map;
}

function extractLocalitate(adresa: string): string {
  // Adresele MF au frecvent formatul "JUD. SUCEAVA, MUN. SUCEAVA, STR. ..." sau
  // "MUNICIPIUL SUCEAVA, STR X" — extragem localitatea euristic.
  const m = adresa.match(
    /(?:MUN(?:ICIPIUL)?\.?|ORA[SȘ](?:UL)?\.?|COM(?:UNA)?\.?|SAT(?:UL)?\.?)\s+([A-ZĂÂÎȘȚ][A-ZĂÂÎȘȚ\- ]{2,30}?)(?:\s*,|\s+STR|\s+NR|\s+BLD|\s+B-DUL|$)/iu,
  );
  if (m) return m[1].trim();
  return "";
}

export function parseFirmsFile(
  content: string,
  options: { defaultCounty?: string } = {},
): ParseFirmsResult {
  const lines = content.split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) {
    return {
      rows: [],
      totalLines: 0,
      skipped: 0,
      delimiter: "|",
      columnMap: {},
      headers: [],
    };
  }

  const delimiter = detectDelimiter(nonEmpty);

  // Încearcă header pe primele 3 linii
  let columnMap: Record<string, number> | null = null;
  let headerLineIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(3, nonEmpty.length); i++) {
    const cells = splitDelimited(nonEmpty[i], delimiter).map((c) => c.trim());
    const m = mapColumnsByHeader(cells);
    if (m) {
      columnMap = m;
      headerLineIdx = i;
      headers = cells;
      break;
    }
  }

  // Fallback pozițional pe primul rând care arată a date
  if (!columnMap) {
    for (let i = 0; i < Math.min(5, nonEmpty.length); i++) {
      const cells = splitDelimited(nonEmpty[i], delimiter).map((c) => c.trim());
      const m = positionalMap(cells);
      if (m) {
        columnMap = m;
        headerLineIdx = -1; // nu există header — toate liniile sunt date
        break;
      }
    }
  }

  if (!columnMap) {
    return {
      rows: [],
      totalLines: nonEmpty.length,
      skipped: nonEmpty.length,
      delimiter,
      columnMap: {},
      headers,
    };
  }

  const rows: RawFirmRow[] = [];
  let skipped = 0;
  const startIdx = headerLineIdx >= 0 ? headerLineIdx + 1 : 0;
  for (let i = startIdx; i < nonEmpty.length; i++) {
    const row = parseFirmLine(nonEmpty[i], delimiter, columnMap, options);
    if (!row) {
      skipped++;
      continue;
    }
    rows.push(row);
  }

  return {
    rows,
    totalLines: nonEmpty.length,
    skipped,
    delimiter,
    columnMap,
    headers,
  };
}

/**
 * Parsează O linie de date cu delimitator + mapare de coloane cunoscute.
 * Returnează null pentru linii invalide (fără CUI sau denumire).
 * Folosită atât de parseFirmsFile cât și de procesarea incrementală R2.
 */
export function parseFirmLine(
  line: string,
  delimiter: string,
  columnMap: Record<string, number>,
  options: { defaultCounty?: string } = {},
): RawFirmRow | null {
  const cells = splitDelimited(line, delimiter);
  const get = (field: string): string => {
    const idx = columnMap[field];
    return idx !== undefined && idx < cells.length ? cells[idx].trim() : "";
  };
  const cuiRaw = get("cui").replace(/^RO/i, "").replace(/\D/g, "");
  const denumire = get("denumire");
  if (!cuiRaw || !denumire) return null;
  const strada = get("adresa");
  const nr = get("nr");
  // Fișierele MF au strada și numărul în coloane separate → le unim.
  const adresa =
    strada && nr && !/nr\.?\s*\d/i.test(strada)
      ? `${strada} nr. ${nr}`
      : strada;
  const judetRaw = get("judet");
  const judet = judetRaw
    ? normalizeCounty(judetRaw)
    : (options.defaultCounty ?? extractCountyFromAddress(adresa));
  return {
    cui: cuiRaw,
    denumire,
    adresa,
    localitate: get("localitate") || extractLocalitate(adresa),
    judet,
    caen: get("caen"),
    stare: get("stare"),
    telefon: normalizePhone(get("telefon")),
  };
}

/**
 * Normalizează un număr de telefon românesc: păstrează cifrele (și prefixul
 * internațional), respinge valorile evident invalide (prea scurte/lungi, zerouri).
 * Fișierele oficiale conțin des câmpuri de telefon golite sau cu gunoi.
 */
export function normalizePhone(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // Multe numere într-un câmp → luăm primul
  const first = s.split(/[,;/]| sau /i)[0];
  const plus = first.trim().startsWith("+");
  const digits = first.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return "";
  if (/^(0+|1+|9+)$/.test(digits)) return ""; // 000000, 111111 etc.
  // Format local RO: 0xxxxxxxxx (10 cifre). Acceptăm și fără 0 inițial.
  if (!plus && digits.length === 9 && !digits.startsWith("0")) {
    return `0${digits}`;
  }
  return plus ? `+${digits}` : digits;
}

/**
 * Detectează configurația de parsare (delimitator + mapare coloane + dacă
 * prima linie e header) din primele linii ale fișierului.
 * Folosită la începutul procesării incrementale — configurația se
 * serializează în sync_state și se refolosește la fiecare chunk.
 */
export function detectParserConfig(firstLines: string[]): {
  delimiter: string;
  columnMap: Record<string, number>;
  headerLines: number;
} | null {
  const nonEmpty = firstLines.filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) return null;
  const delimiter = detectDelimiter(nonEmpty);
  for (let i = 0; i < Math.min(3, nonEmpty.length); i++) {
    const cells = splitDelimited(nonEmpty[i], delimiter).map((c) => c.trim());
    const m = mapColumnsByHeader(cells);
    if (m) return { delimiter, columnMap: m, headerLines: i + 1 };
  }
  for (let i = 0; i < Math.min(5, nonEmpty.length); i++) {
    const cells = splitDelimited(nonEmpty[i], delimiter).map((c) => c.trim());
    const m = positionalMap(cells);
    if (m) return { delimiter, columnMap: m, headerLines: 0 };
  }
  return null;
}

function extractCountyFromAddress(adresa: string): string {
  const m = adresa.match(/JUD(?:E[TȚ](?:UL)?)?\.?\s+([A-ZĂÂÎȘȚa-zăâîșț\-]{3,20})/iu);
  if (m) return normalizeCounty(m[1]);
  return "";
}

/** Stările MF care indică firmă radiată/inactivă (excluse din prospecți). */
const INACTIVE_MARKERS = [
  "radiat",
  "dizolvare",
  "lichidare",
  "faliment",
  "inactiv",
  "intrerupere",
  "suspend",
];

export function isActiveByState(stare: string): boolean {
  if (!stare || !stare.trim()) return true; // fără informație → presupunem activă, ANAF decide
  const norm = normalizeHeader(stare);
  return !INACTIVE_MARKERS.some((m) => norm.includes(m));
}
