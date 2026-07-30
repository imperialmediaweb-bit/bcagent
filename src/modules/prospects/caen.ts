/**
 * CAEN + județe. Platforma servește agenți din TOATE domeniile:
 * codurile „țintă" rămân doar ca presetări rapide de filtrare în UI,
 * NU ca filtru obligatoriu la import.
 */

/** Preset FMCG/tutun — filtru rapid în UI. */
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
  "5610": "Restaurante",
  "5630": "Baruri și alte activități de servire a băuturilor",
};

/** Grupele CAEN principale pentru presetul FMCG. */
export const CORE_CAEN = ["4711", "4719", "4725", "4726", "5610", "5630"];

/** Presetări rapide de domeniu — refolosite în Prospecți și pe hartă. */
export const DOMAIN_PRESETS: Array<{
  id: string;
  label: string;
  caens: string[];
}> = [
  { id: "fmcg", label: "Alimentare / baruri / tutun", caens: CORE_CAEN },
  { id: "retail", label: "Comerț cu amănuntul (tot)", caens: ["47"] },
  { id: "wholesale", label: "Comerț cu ridicata", caens: ["46"] },
  { id: "horeca", label: "HoReCa (hotel/restaurant)", caens: ["55", "56"] },
  { id: "auto", label: "Auto (comerț/service)", caens: ["45"] },
  { id: "constructii", label: "Construcții", caens: ["41", "42", "43"] },
  { id: "transport", label: "Transport / depozitare", caens: ["49", "52", "53"] },
  { id: "productie", label: "Producție alimentară", caens: ["10", "11"] },
  { id: "farma", label: "Farmacii / sănătate", caens: ["21", "86"] },
  { id: "it", label: "IT / servicii digitale", caens: ["62", "63"] },
  { id: "agro", label: "Agricultură", caens: ["01", "02", "03"] },
];

/**
 * Diviziunile CAEN (primele 2 cifre) — etichete scurte pentru ORICE cod,
 * ca lista să fie lizibilă indiferent de domeniu.
 */
export const CAEN_DIVISIONS: Record<string, string> = {
  "01": "Agricultură", "02": "Silvicultură", "03": "Pescuit/acvacultură",
  "05": "Extracție cărbune", "06": "Extracție petrol/gaze",
  "07": "Extracție minereuri", "08": "Alte activități extractive",
  "09": "Servicii extractive",
  "10": "Industrie alimentară", "11": "Fabricare băuturi", "12": "Tutun",
  "13": "Textile", "14": "Confecții", "15": "Piele/încălțăminte",
  "16": "Prelucrare lemn", "17": "Hârtie/carton", "18": "Tipografie",
  "19": "Produse petroliere", "20": "Substanțe chimice", "21": "Farmaceutice",
  "22": "Cauciuc/mase plastice", "23": "Minerale nemetalice",
  "24": "Metalurgie", "25": "Construcții metalice",
  "26": "Calculatoare/electronice", "27": "Echipamente electrice",
  "28": "Mașini/utilaje", "29": "Autovehicule", "30": "Alte mijloace transport",
  "31": "Mobilă", "32": "Alte industrii prelucrătoare",
  "33": "Reparații mașini/echipamente",
  "35": "Energie electrică/termică", "36": "Captare/tratare apă",
  "37": "Canalizare", "38": "Colectare deșeuri", "39": "Decontaminare",
  "41": "Construcții clădiri", "42": "Lucrări geniu civil",
  "43": "Construcții specializate",
  "45": "Comerț/reparații auto", "46": "Comerț cu ridicata",
  "47": "Comerț cu amănuntul",
  "49": "Transport terestru", "50": "Transport pe apă", "51": "Transport aerian",
  "52": "Depozitare/servicii transport", "53": "Poștă/curierat",
  "55": "Hoteluri/cazare", "56": "Restaurante/baruri",
  "58": "Editare", "59": "Film/TV/muzică", "60": "Radio/televiziune",
  "61": "Telecomunicații", "62": "IT/programare",
  "63": "Servicii informatice",
  "64": "Intermedieri financiare", "65": "Asigurări",
  "66": "Auxiliare financiare", "68": "Tranzacții imobiliare",
  "69": "Juridic/contabilitate", "70": "Consultanță management",
  "71": "Arhitectură/inginerie", "72": "Cercetare-dezvoltare",
  "73": "Publicitate/studii piață", "74": "Alte activități profesionale",
  "75": "Servicii veterinare",
  "77": "Închirieri/leasing", "78": "Resurse umane",
  "79": "Agenții turism", "80": "Securitate/investigații",
  "81": "Servicii clădiri/peisagistică", "82": "Servicii suport business",
  "84": "Administrație publică", "85": "Învățământ",
  "86": "Sănătate", "87": "Asistență socială cu cazare",
  "88": "Asistență socială fără cazare",
  "90": "Activități culturale/artistice", "91": "Biblioteci/muzee",
  "92": "Jocuri de noroc", "93": "Sport/recreere",
  "94": "Organizații/asociații", "95": "Reparații calculatoare/bunuri",
  "96": "Alte servicii personale", "97": "Activități gospodării",
  "98": "Producție gospodării", "99": "Organizații internaționale",
};

export function isTargetCaen(caen: string): boolean {
  const code = normalizeCaen(caen);
  return code in TARGET_CAEN;
}

/** Descriere detaliată doar pentru codurile din presetul FMCG. */
export function caenDescription(caen: string): string {
  return TARGET_CAEN[normalizeCaen(caen)] ?? "";
}

/**
 * Etichetă lizibilă pentru ORICE cod CAEN: descrierea detaliată dacă e din
 * preset, altfel numele diviziunii (primele 2 cifre).
 */
export function caenLabel(caen: string): string {
  const code = normalizeCaen(caen);
  if (!code) return "";
  const exact = TARGET_CAEN[code];
  if (exact) return exact;
  const div = code.length >= 2 ? code.slice(0, 2) : code.padStart(2, "0");
  return CAEN_DIVISIONS[div] ?? "";
}

/** Normalizează un cod CAEN: păstrează primele 4 cifre. */
export function normalizeCaen(caen: string): string {
  const digits = String(caen ?? "").replace(/\D/g, "");
  return digits.slice(0, 4);
}

/** Județele folosite ca preset implicit în UI (piața curentă). */
export const TARGET_COUNTIES = ["SV", "BT"];

/** Toate județele României + București. */
export const COUNTY_LIST: Array<{ code: string; name: string }> = [
  { code: "AB", name: "Alba" },
  { code: "AR", name: "Arad" },
  { code: "AG", name: "Argeș" },
  { code: "BC", name: "Bacău" },
  { code: "BH", name: "Bihor" },
  { code: "BN", name: "Bistrița-Năsăud" },
  { code: "BT", name: "Botoșani" },
  { code: "BR", name: "Brăila" },
  { code: "BV", name: "Brașov" },
  { code: "B", name: "București" },
  { code: "BZ", name: "Buzău" },
  { code: "CL", name: "Călărași" },
  { code: "CS", name: "Caraș-Severin" },
  { code: "CJ", name: "Cluj" },
  { code: "CT", name: "Constanța" },
  { code: "CV", name: "Covasna" },
  { code: "DB", name: "Dâmbovița" },
  { code: "DJ", name: "Dolj" },
  { code: "GL", name: "Galați" },
  { code: "GR", name: "Giurgiu" },
  { code: "GJ", name: "Gorj" },
  { code: "HR", name: "Harghita" },
  { code: "HD", name: "Hunedoara" },
  { code: "IL", name: "Ialomița" },
  { code: "IS", name: "Iași" },
  { code: "IF", name: "Ilfov" },
  { code: "MM", name: "Maramureș" },
  { code: "MH", name: "Mehedinți" },
  { code: "MS", name: "Mureș" },
  { code: "NT", name: "Neamț" },
  { code: "OT", name: "Olt" },
  { code: "PH", name: "Prahova" },
  { code: "SJ", name: "Sălaj" },
  { code: "SM", name: "Satu Mare" },
  { code: "SB", name: "Sibiu" },
  { code: "SV", name: "Suceava" },
  { code: "TR", name: "Teleorman" },
  { code: "TM", name: "Timiș" },
  { code: "TL", name: "Tulcea" },
  { code: "VL", name: "Vâlcea" },
  { code: "VS", name: "Vaslui" },
  { code: "VN", name: "Vrancea" },
];

const VALID_CODES = new Set(COUNTY_LIST.map((c) => c.code));

/** Nume județ normalizat (fără diacritice) → cod auto. */
const COUNTY_NAMES: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const { code, name } of COUNTY_LIST) {
    const key = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    map[key] = code;
  }
  // Variante întâlnite în fișierele oficiale
  map["bucuresti"] = "B";
  map["municipiul bucuresti"] = "B";
  map["satu-mare"] = "SM";
  map["caras severin"] = "CS";
  map["bistrita nasaud"] = "BN";
  map["calarasi"] = "CL";
  return map;
})();

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
 * Acceptă: cod auto, nume complet (cu/fără diacritice, cu prefix JUD./MUN.),
 * cod numeric oficial (33, 07, 33.0), cod Registrul Comerțului (J33/F33/C33).
 */
export function normalizeCounty(judet: string): string {
  const raw = String(judet ?? "").trim();
  if (!raw) return "";
  // Cod numeric (33 = SV, 7 = BT) — inclusiv variante "07" / "33.0"
  if (/^\d{1,2}(\.0+)?$/.test(raw)) {
    const n = parseInt(raw, 10);
    return COUNTY_NUMERIC[n] ?? raw;
  }
  // Cod Registrul Comerțului: "J33" / "F33" / "C33" → 33 → SV
  const jMatch = raw.match(/^[JFC](\d{1,2})$/i);
  if (jMatch) {
    const n = parseInt(jMatch[1], 10);
    return COUNTY_NUMERIC[n] ?? raw.toUpperCase();
  }
  const upper = raw.toUpperCase();
  if (upper.length <= 2 && VALID_CODES.has(upper)) return upper;
  const lower = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(judetul|jud\.?)\s+/, "")
    .replace(/^(municipiul|mun\.?)\s+/, "")
    .trim();
  if (COUNTY_NAMES[lower]) return COUNTY_NAMES[lower];
  const guess = upper.slice(0, 2);
  return VALID_CODES.has(guess) ? guess : guess;
}

/** Numele județului pentru un cod (pentru afișare). */
export function countyName(code: string): string {
  return COUNTY_LIST.find((c) => c.code === code)?.name ?? code;
}
