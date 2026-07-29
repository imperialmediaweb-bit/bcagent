/**
 * Codurile CAEN țintă pentru prospectare distribuție FMCG/tutun.
 * Acoperă atât CAEN Rev.2 (4 cifre) cât și variantele Rev.3 unde diferă.
 */
export const TARGET_CAEN: Record<string, string> = {
  "4711":
    "Comerț cu amănuntul în magazine nespecializate, cu vânzare predominantă de produse alimentare, băuturi și tutun",
  "4719": "Comerț cu amănuntul în magazine nespecializate (universale)",
  "4721": "Comerț cu amănuntul al fructelor și legumelor proaspete",
  "4722": "Comerț cu amănuntul al cărnii și al produselor din carne",
  "4724": "Comerț cu amănuntul al pâinii, produselor de patiserie și zaharoaselor",
  "4725": "Comerț cu amănuntul al băuturilor",
  "4726": "Comerț cu amănuntul al produselor din tutun",
  "4729": "Comerț cu amănuntul al altor produse alimentare",
  "5630": "Baruri și alte activități de servire a băuturilor",
};

/** Grupele CAEN principale (folosite ca filtru implicit strict). */
export const CORE_CAEN = ["4711", "4719", "4725", "4726", "5630"];

export function isTargetCaen(caen: string): boolean {
  const code = normalizeCaen(caen);
  return code in TARGET_CAEN;
}

export function caenDescription(caen: string): string {
  return TARGET_CAEN[normalizeCaen(caen)] ?? "";
}

/** Normalizează un cod CAEN: păstrează primele 4 cifre. */
export function normalizeCaen(caen: string): string {
  const digits = String(caen ?? "").replace(/\D/g, "");
  return digits.slice(0, 4);
}

/** Codurile de județ acceptate implicit. */
export const TARGET_COUNTIES = ["SV", "BT"];

const COUNTY_NAMES: Record<string, string> = {
  suceava: "SV",
  botosani: "BT",
};

/**
 * Codurile numerice de județ din evidențele oficiale românești
 * (numerotarea Registrului Comerțului: J33 = Suceava, J07 = Botoșani).
 */
const COUNTY_NUMERIC: Record<number, string> = {
  1: "AB", 2: "AR", 3: "AG", 4: "BC", 5: "BH", 6: "BN", 7: "BT",
  8: "BV", 9: "BR", 10: "BZ", 11: "CS", 12: "CJ", 13: "CT", 14: "CV",
  15: "DB", 16: "DJ", 17: "GL", 18: "GJ", 19: "HR", 20: "HD", 21: "IL",
  22: "IS", 23: "IF", 24: "MM", 25: "MH", 26: "MS", 27: "NT", 28: "OT",
  29: "PH", 30: "SM", 31: "SJ", 32: "SB", 33: "SV", 34: "TR", 35: "TM",
  36: "TL", 37: "VS", 38: "VL", 39: "VN", 40: "B", 51: "CL", 52: "GR",
};

/**
 * Normalizează județul la codul auto (SV, BT...).
 * Acceptă: cod auto (SV/sv), nume complet (Suceava/BOTOȘANI),
 * cod numeric oficial (33, 07, "33.0").
 */
export function normalizeCounty(judet: string): string {
  const raw = String(judet ?? "").trim();
  if (!raw) return "";
  // Cod numeric (33 = SV, 7 = BT) — inclusiv variante "07" / "33.0"
  if (/^\d{1,2}(\.0+)?$/.test(raw)) {
    const n = parseInt(raw, 10);
    return COUNTY_NUMERIC[n] ?? raw;
  }
  if (/^[A-Za-z]{1,2}$/.test(raw)) return raw.toUpperCase();
  const lower = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return COUNTY_NAMES[lower] ?? raw.toUpperCase().slice(0, 2);
}
