/**
 * NUMELE SATELOR, AȘA CUM LE SCRIE REGISTRUL vs. AȘA CUM LE ȘTIE HARTA.
 *
 * „în Păltiniș Centru am 3 locații, nu găsesc nici măcar unu pe hartă"
 * (Costin Vlad, 26.08). Cauza: întrebam harta O SINGURĂ DATĂ, cu numele
 * exact din registru. OpenStreetMap nu știe „Păltiniș Centru", știe
 * „Păltiniș" — deci satul rămânea fără poziție și dispărea de pe ecran,
 * cu tot cu clienții agentului din el.
 *
 * Suita verifică generatorul de variante: pentru fiecare fel în care
 * Finanțele scriu o localitate, trebuie să apară printre variante și
 * numele pe care harta îl cunoaște — și de preferat cât mai devreme, ca
 * să nu irosim cereri (Nominatim permite una pe secundă).
 *
 * Rulare: npx tsx scripts/test-localitati.ts
 */
import { curataLocalitate, variantePentruGeocodare } from "../src/modules/prospects/localitati";

let pass = 0;
let fail = 0;
const rele: string[] = [];
function check(n: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${n}`);
  } else {
    fail++;
    rele.push(`${n}${extra ? ` — ${extra}` : ""}`);
    console.log(`  ✗ ${n}${extra ? ` — ${extra}` : ""}`);
  }
}
function sectiune(t: string) {
  console.log(`\n══ ${t} ══`);
}

/** Varianta căutată apare printre cele generate? */
function contine(scris: string, cautat: string): boolean {
  return variantePentruGeocodare(scris).some(
    (v) => v.toLowerCase() === cautat.toLowerCase(),
  );
}

sectiune("Cazul din teren: „Păltiniș Centru”");
check("„PĂLTINIȘ CENTRU” duce la „Păltiniș”", contine("PĂLTINIȘ CENTRU", "PĂLTINIȘ"));
check("…dar întâi încearcă numele întreg", variantePentruGeocodare("PĂLTINIȘ CENTRU")[0] === "PĂLTINIȘ CENTRU");
check("fără diacritice merge la fel", contine("PALTINIS CENTRU", "PALTINIS"));
check("„Cătămărești Deal” duce la „Cătămărești”", contine("Cătămărești Deal", "Cătămărești"));
check("„PODU COȘNEI GARĂ” duce la „PODU COȘNEI”", contine("PODU COȘNEI GARĂ", "PODU COȘNEI"));

sectiune("Prefixele administrative din registru");
check("„SAT PALTINIS” → „PALTINIS”", curataLocalitate("SAT PALTINIS") === "PALTINIS");
check("„COM. DERSCA” → „DERSCA”", curataLocalitate("COM. DERSCA") === "DERSCA");
check("„MUN. BOTOSANI” → „BOTOSANI”", curataLocalitate("MUN. BOTOSANI") === "BOTOSANI");
check("„MUNICIPIUL SUCEAVA” → „SUCEAVA”", curataLocalitate("MUNICIPIUL SUCEAVA") === "SUCEAVA");
check("„ORS. DARABANI” → „DARABANI”", curataLocalitate("ORS. DARABANI") === "DARABANI");
check("„ORAS SAVENI” → „SAVENI”", curataLocalitate("ORAS SAVENI") === "SAVENI");
check("„LOC. HORIA” → „HORIA”", curataLocalitate("LOC. HORIA") === "HORIA");
check(
  "„SAT PALTINIS COM. PALTINIS” → „PALTINIS”",
  curataLocalitate("SAT PALTINIS COM. PALTINIS") === "PALTINIS",
  curataLocalitate("SAT PALTINIS COM. PALTINIS"),
);
check(
  "„PALTINIS (COM. PALTINIS)” → „PALTINIS”",
  curataLocalitate("PALTINIS (COM. PALTINIS)") === "PALTINIS",
  curataLocalitate("PALTINIS (COM. PALTINIS)"),
);
check("spațiile duble se strâng", curataLocalitate("  DERSCA   ") === "DERSCA");

sectiune("Prescurtările de pe hartă");
check("„VF. CAMPULUI” duce la „Vârful Campului”", contine("VF. CAMPULUI", "Vârful Campului"));
check("„DL. MARE” duce la „Dealul MARE”", contine("DL. MARE", "Dealul MARE"));
check("„POD. ILOAIEI” duce la „Podul ILOAIEI”", contine("POD. ILOAIEI", "Podul ILOAIEI"));

sectiune("Nu stricăm ce mergea deja");
for (const nume of ["DOROHOI", "LOZNA", "STRATENI", "ȘENDRICENI", "SUCEAVA"]) {
  const v = variantePentruGeocodare(nume);
  check(`„${nume}” rămâne prima variantă`, v[0] === nume, v.join(" | "));
}
check(
  "un sat cu nume din două cuvinte nu se ciuntește degeaba",
  variantePentruGeocodare("POIANA STAMPEI")[0] === "POIANA STAMPEI",
);
check(
  "…dar are și varianta scurtă, ca ultimă încercare",
  contine("POIANA STAMPEI", "POIANA"),
);

sectiune("Marginile");
check("text gol → nicio variantă", variantePentruGeocodare("").length === 0);
check("doar spații → nicio variantă", variantePentruGeocodare("   ").length === 0);
check("doar prefix → nicio variantă", variantePentruGeocodare("SAT ").length === 0);
check("o silabă nu devine variantă separată", !contine("NOU MIC", "NOU"));
check(
  "nu iese același nume de două ori",
  (() => {
    const v = variantePentruGeocodare("PĂLTINIȘ CENTRU");
    return new Set(v.map((x) => x.toLowerCase())).size === v.length;
  })(),
  variantePentruGeocodare("PĂLTINIȘ CENTRU").join(" | "),
);
check(
  "nu cerem hărții zeci de variante (una pe secundă, pe teren)",
  variantePentruGeocodare("SAT VF. CAMPULUI CENTRU COM. VF CAMPULUI").length <= 6,
  `${variantePentruGeocodare("SAT VF. CAMPULUI CENTRU COM. VF CAMPULUI").length}`,
);

sectiune("Nimic nu crapă, orice i-ai da");
const ciudate = [
  "ȘTEFAN CEL MARE ȘI SFÂNT",
  "1 DECEMBRIE",
  "23 AUGUST",
  "()",
  "COM.",
  "A",
  "x".repeat(300),
  "SAT (COM. (X))",
  "---",
  "ȚĂNDĂREI-NOU",
];
let crapat = 0;
for (const c of ciudate) {
  try {
    const v = variantePentruGeocodare(c);
    if (!Array.isArray(v)) crapat++;
    if (v.some((x) => typeof x !== "string" || x.trim() === "")) crapat++;
  } catch {
    crapat++;
  }
}
check("zece nume ciudate, niciun crash și nicio variantă goală", crapat === 0, `${crapat}`);
check("„1 DECEMBRIE” rămâne întreg", variantePentruGeocodare("1 DECEMBRIE")[0] === "1 DECEMBRIE");

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
if (fail) {
  console.log("\nCe nu merge:");
  rele.forEach((r) => console.log("  · " + r));
}
process.exit(fail === 0 ? 0 : 1);
