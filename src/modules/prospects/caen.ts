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
  botoșani: "BT",
};

/** Normalizează județul la codul auto (SV, BT...). Acceptă și nume complet. */
export function normalizeCounty(judet: string): string {
  const raw = String(judet ?? "").trim();
  if (!raw) return "";
  if (/^[A-Za-z]{1,2}$/.test(raw)) return raw.toUpperCase();
  const lower = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return COUNTY_NAMES[lower] ?? raw.toUpperCase().slice(0, 2);
}
