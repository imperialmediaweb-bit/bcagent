/**
 * Teste pentru modulul prospects: parser MF, filtrare CAEN, județe, stări.
 * Run: pnpm dlx tsx scripts/test-prospects.ts
 */
import {
  caenDescription,
  isActiveByState,
  isTargetCaen,
  normalizeCaen,
  normalizeCounty,
  parseFirmsFile,
} from "../src/modules/prospects";

let ok = true;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  if (!cond) ok = false;
}

// === 1. Fixture: format MF cu header și pipe ===
const withHeader = `CUI|DENUMIRE|COD_INMATRICULARE|STARE_FIRMA|COD_CAEN|ADRESA|JUDET|LOCALITATE
123456|MAGAZIN LA COLT SRL|J33/100/2005|INREGISTRAT din data 01.01.2005|4711|STR. PRINCIPALA NR. 5|SV|SUCEAVA
234567|BAR CENTRAL SRL|J07/200/2010|INREGISTRAT din data 05.05.2010|5630|STR. GARII NR. 12|BT|BOTOSANI
345678|TUTUNGERIE EXPRES SRL|J33/300/2015|INREGISTRAT|4726|BD. IPOTESTI NR. 3|SV|FALTICENI
456789|FIRMA RADIATA SRL|J33/400/2000|RADIAT din data 01.01.2020|4711|STR. VECHE 1|SV|SUCEAVA
567890|SERVICE AUTO SRL|J33/500/2018|INREGISTRAT|4520|STR. AUTO NR. 7|SV|SUCEAVA
678901|ALIMENTARA NOUA SRL|J07/600/2019|INREGISTRAT|4711|STR. NOUA NR. 9|BT|DOROHOI`;

console.log("\n=== T1: fișier MF cu header + pipe ===");
const r1 = parseFirmsFile(withHeader);
check("delimitator pipe detectat", r1.delimiter === "|", `"${r1.delimiter}"`);
check("6 firme parsate", r1.rows.length === 6, `(${r1.rows.length})`);
check(
  "CUI primul rând",
  r1.rows[0]?.cui === "123456",
  r1.rows[0]?.cui,
);
check(
  "județ normalizat SV",
  r1.rows[0]?.judet === "SV",
  r1.rows[0]?.judet,
);
check(
  "CAEN extras",
  r1.rows[0]?.caen === "4711",
  r1.rows[0]?.caen,
);
check(
  "stare extrasă",
  (r1.rows[3]?.stare ?? "").includes("RADIAT"),
  r1.rows[3]?.stare,
);

console.log("\n=== T2: filtrare CAEN + stare ===");
const active = r1.rows.filter((r) => isActiveByState(r.stare));
check("firma RADIATA exclusă", active.length === 5, `(${active.length})`);
const target = active.filter((r) => isTargetCaen(r.caen));
check(
  "service auto (4520) exclus, restul păstrate",
  target.length === 4,
  `(${target.length}: ${target.map((t) => t.denumire).join(", ")})`,
);

console.log("\n=== T3: format fără header (pozițional) ===");
const noHeader = `999888|FIRMA FARA HEADER SRL|J33/1/2020|01.01.2020|4711|JUD. SUCEAVA, MUN. SUCEAVA, STR. TEST NR. 1|0230123456
888777|ALT BAR SRL|J07/2/2021|02.02.2021|5630|JUD. BOTOSANI, ORAS SAVENI, STR. BAR 2|0231654321`;
const r3 = parseFirmsFile(noHeader);
check("2 firme parsate pozițional", r3.rows.length === 2, `(${r3.rows.length})`);
check("CUI pozițional", r3.rows[0]?.cui === "999888", r3.rows[0]?.cui);
check(
  "CAEN pozițional",
  r3.rows[0]?.caen === "4711",
  r3.rows[0]?.caen,
);
check(
  "județ extras din adresă",
  r3.rows[0]?.judet === "SV",
  r3.rows[0]?.judet,
);
check(
  "localitate extrasă din adresă",
  (r3.rows[0]?.localitate ?? "").toUpperCase().includes("SUCEAVA"),
  r3.rows[0]?.localitate,
);

console.log("\n=== T4: CSV cu virgulă și diacritice ===");
const csv = `cui,denumire,adresă,județ,localitate,cod caen,stare
111222,MAGAZIN ALIMENTAR ÎNSUȘI SRL,"STR. ȘTEFAN CEL MARE 10",SV,RĂDĂUȚI,4711,INREGISTRAT`;
const r4 = parseFirmsFile(csv);
check("CSV parsat", r4.rows.length === 1, `(${r4.rows.length})`);
check(
  "diacritice în headere mapate",
  r4.rows[0]?.judet === "SV" && r4.rows[0]?.caen === "4711",
  JSON.stringify(r4.rows[0]),
);

console.log("\n=== T5: utilitare ===");
check("normalizeCaen('4711.2') = 4711", normalizeCaen("4711.2") === "4711");
check("normalizeCaen('47') = 47 (nu match)", !isTargetCaen("47"));
check("normalizeCounty('Suceava') = SV", normalizeCounty("Suceava") === "SV");
check("normalizeCounty('BOTOȘANI') = BT", normalizeCounty("BOTOȘANI") === "BT");
check("normalizeCounty('sv') = SV", normalizeCounty("sv") === "SV");
check(
  "caenDescription(5630) conține Baruri",
  caenDescription("5630").includes("Baruri"),
);
check("stare goală = activă (ANAF decide)", isActiveByState(""));
check("Lichidare = inactivă", !isActiveByState("DIZOLVARE CU LICHIDARE"));

console.log("\n=== T6: fișier gol / gunoi ===");
const rEmpty = parseFirmsFile("");
check("fișier gol → 0 rânduri, no crash", rEmpty.rows.length === 0);
const rJunk = parseFirmsFile("abc\ndef\nghi");
check("gunoi → 0 rânduri, no crash", rJunk.rows.length === 0);

console.log("\n" + "=".repeat(60));
console.log(ok ? "✅ TOATE TESTELE PROSPECTS TRECUTE" : "❌ TESTE EȘUATE");
console.log("=".repeat(60));
process.exit(ok ? 0 : 1);
