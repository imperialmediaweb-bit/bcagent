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

function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COLUMN_ALIASES: Record<keyof Omit<RawFirmRow, "stare">, string[]> & {
  stare: string[];
} = {
  cui: ["cui", "cod fiscal", "cod unic", "cif", "codunic", "cod de identificare fiscala"],
  denumire: ["denumire", "denumire platitor", "nume firma", "denumire firma", "nume"],
  adresa: ["adresa", "adresa completa", "adr", "domiciliul fiscal", "sediu", "strada"],
  localitate: ["localitate", "oras", "comuna", "loc"],
  judet: ["judet", "jud", "cod judet"],
  caen: ["caen", "cod caen", "obiect de activitate", "cod activitate", "act"],
  stare: ["stare", "stare firma", "stare inregistrare", "status", "stare fiscala"],
};

function detectDelimiter(lines: string[]): string {
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

function mapColumnsByHeader(
  headerCells: string[],
): Record<string, number> | null {
  const norm = headerCells.map(normalizeHeader);
  const map: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = norm.findIndex(
      (h) =>
        h.length > 0 &&
        aliases.some(
          (a) => h === a || (h.length >= 3 && (h.includes(a) || a.includes(h))),
        ),
    );
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
function positionalMap(cells: string[]): Record<string, number> | null {
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
    const cells = nonEmpty[i].split(delimiter).map((c) => c.trim());
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
      const cells = nonEmpty[i].split(delimiter).map((c) => c.trim());
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
    const cells = nonEmpty[i].split(delimiter);
    const get = (field: string): string => {
      const idx = columnMap![field];
      return idx !== undefined && idx < cells.length
        ? cells[idx].trim()
        : "";
    };
    const cuiRaw = get("cui").replace(/^RO/i, "").replace(/\D/g, "");
    const denumire = get("denumire");
    if (!cuiRaw || !denumire) {
      skipped++;
      continue;
    }
    const adresa = get("adresa");
    const judetRaw = get("judet");
    const judet = judetRaw
      ? normalizeCounty(judetRaw)
      : (options.defaultCounty ?? extractCountyFromAddress(adresa));
    rows.push({
      cui: cuiRaw,
      denumire,
      adresa,
      localitate: get("localitate") || extractLocalitate(adresa),
      judet,
      caen: get("caen"),
      stare: get("stare"),
    });
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
