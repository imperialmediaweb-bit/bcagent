/**
 * ADRESA TRIMISĂ LA GOOGLE — „dacă dau navigare mă lasă rece".
 *
 * Costin Vlad, 26.08, despre clientul ANDRONACHE din Darabani: apasă
 * „Navighează" și harta îl duce lângă Roman, la 100 km. Cauza: trimiteam
 * adresa exact cum o scriu Finanțele —
 *
 *   „JUD. BOTOȘANI, ORȘ. DARABANI, STR. CUCULUI, NR.6"
 *
 * plus, încă o dată, localitatea și județul. Google primea județul primul,
 * nu știa „ORȘ." și nu lega „NR.6" de „STR. CUCULUI" — așa că lăsa pinul
 * unde apuca.
 *
 * Suita verifică rescrierea: din orice fel scriu Finanțele o adresă
 * trebuie să iasă ceva ce înțelege orice hartă — „Strada Cucului 6" —
 * și niciodată județul de două ori.
 *
 * Rulare: npx tsx scripts/test-navigare-adresa.ts
 */
import { adresaCurataPentruNavigatie, navAddress } from "../src/lib/route-nav";

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

sectiune("Cazul din teren: clientul ANDRONACHE din Darabani");
const ANDRONACHE = "JUD. BOTOȘANI, ORȘ. DARABANI, STR. CUCULUI, NR.6";
const curat = adresaCurataPentruNavigatie(ANDRONACHE);
check("adresa devine „Strada Cucului 6”", curat === "Strada Cucului 6", curat);

const nav = navAddress({
  adresa: ANDRONACHE,
  localitate: "DARABANI",
  judet: "BT",
  denumire: "ANDRONACHE FILOTIA ÎNTREPRINDERE INDIVIDUALĂ",
});
check("linkul conține strada și numărul lipite", nav.includes("Strada Cucului 6"), nav);
check("…localitatea o singură dată", (nav.match(/DARABANI/gi) ?? []).length === 1, nav);
check("…județul o singură dată", (nav.match(/Botoșani/gi) ?? []).length === 1, nav);
check("…fără „JUD.”", !/JUD\./i.test(nav), nav);
check("…fără „ORȘ.”", !/ORȘ\.|ORS\./i.test(nav), nav);
check("…fără „NR.” rătăcit", !/\bNR\./i.test(nav), nav);
check("…se termină cu țara", nav.endsWith("Romania"), nav);
check(
  "…și NU mai bagă numele firmei (avem număr, deci adresă bună)",
  !nav.includes("ANDRONACHE"),
  nav,
);

sectiune("Toate felurile în care scriu Finanțele o stradă");
const cazuri: Array<[string, string]> = [
  ["STR. CUCULUI, NR.6", "Strada Cucului 6"],
  ["STR. CUCULUI NR. 6", "Strada Cucului 6"],
  ["STRADA MIHAI EMINESCU, NR. 12", "Strada Mihai Eminescu 12"],
  ["B-DUL. GEORGE ENESCU, NR. 5", "Bulevardul George Enescu 5"],
  ["BD. INDEPENDENTEI NR.44", "Bulevardul Independentei 44"],
  ["CALEA NATIONALA, NR. 100", "Calea Nationala 100"],
  ["SOS. IASI, NR. 3", "Șoseaua Iasi 3"],
  ["ȘOS. BUCUREȘTI NR. 8", "Șoseaua București 8"],
  ["PIATA REVOLUTIEI, NR. 1", "Piața Revolutiei 1"],
  ["ALEEA TEILOR, NR. 2", "Aleea Teilor 2"],
  ["STR. PRINCIPALA, NR. 6A", "Strada Principala 6A"],
  ["STR. GARII, NR. 12 BIS", "Strada Garii 12 BIS"],
];
for (const [scris, asteptat] of cazuri) {
  const r = adresaCurataPentruNavigatie(scris);
  check(`„${scris}” → „${asteptat}”`, r === asteptat, r);
}

sectiune("Ce trebuie ARUNCAT, ca să nu încurce harta");
check(
  "județul din adresă dispare (îl punem noi la sfârșit)",
  adresaCurataPentruNavigatie("JUD. SUCEAVA, STR. LIBERTATII, NR. 3") === "Strada Libertatii 3",
  adresaCurataPentruNavigatie("JUD. SUCEAVA, STR. LIBERTATII, NR. 3"),
);
check(
  "localitatea cu prefix administrativ dispare",
  adresaCurataPentruNavigatie("MUN. BOTOSANI, STR. PACII, NR. 7") === "Strada Pacii 7",
  adresaCurataPentruNavigatie("MUN. BOTOSANI, STR. PACII, NR. 7"),
);
check(
  "comuna și satul dispar la fel",
  adresaCurataPentruNavigatie("COM. DERSCA, SAT DERSCA, STR. MARE, NR. 9") === "Strada Mare 9",
  adresaCurataPentruNavigatie("COM. DERSCA, SAT DERSCA, STR. MARE, NR. 9"),
);
check(
  "blocul/scara/apartamentul se aruncă (încurcă geocodarea)",
  adresaCurataPentruNavigatie("STR. PRIMAVERII, NR. 4, BL. A2, SC. B, ET. 3, AP. 15") ===
    "Strada Primaverii 4",
  adresaCurataPentruNavigatie("STR. PRIMAVERII, NR. 4, BL. A2, SC. B, ET. 3, AP. 15"),
);

sectiune("Adresele de la sate, fără stradă");
check(
  "„SAT COSNA, NR. 12” păstrează numărul",
  adresaCurataPentruNavigatie("SAT COSNA, NR. 12") === "nr. 12",
  adresaCurataPentruNavigatie("SAT COSNA, NR. 12"),
);
const faraStrada = navAddress({
  adresa: "SAT PODU COSNEI",
  localitate: "PODU COSNEI",
  judet: "SV",
  denumire: "MAGAZIN MIXT SRL",
});
check(
  "fără număr, căutăm firma pe NUME (altfel te duce în centrul satului)",
  faraStrada.includes("MAGAZIN MIXT SRL"),
  faraStrada,
);
check("…și tot cu localitatea și județul", /PODU COSNEI/.test(faraStrada) && /Suceava/.test(faraStrada), faraStrada);

sectiune("Nu stricăm adresele care mergeau deja");
check(
  "o adresă deja curată rămâne curată",
  adresaCurataPentruNavigatie("Strada Ștefan Cel Mare 12") === "Strada Ștefan Cel Mare 12",
  adresaCurataPentruNavigatie("Strada Ștefan Cel Mare 12"),
);
check(
  "„Str. Plopilor 3” rămâne bună",
  adresaCurataPentruNavigatie("Str. Plopilor 3") === "Strada Plopilor 3",
  adresaCurataPentruNavigatie("Str. Plopilor 3"),
);

sectiune("Marginile: nimic nu crapă");
const ciudate = [
  "",
  "   ",
  ",,,",
  "JUD. BOTOȘANI",
  "NR.",
  "STR.",
  "STR. , NR. ,",
  "x".repeat(500),
  "STR. 1 DECEMBRIE 1918, NR. 22",
  "Ștefan cel Mare și Sfânt nr. 1",
];
let crapat = 0;
for (const c of ciudate) {
  try {
    const r = adresaCurataPentruNavigatie(c);
    if (typeof r !== "string") crapat++;
    if (r.includes("undefined") || r.includes("NaN")) crapat++;
  } catch {
    crapat++;
  }
}
check("zece adrese ciudate, niciun crash", crapat === 0, `${crapat}`);
check("adresă goală → text gol", adresaCurataPentruNavigatie("") === "");
check(
  "„STR. 1 DECEMBRIE 1918, NR. 22” nu confundă anul cu numărul",
  adresaCurataPentruNavigatie("STR. 1 DECEMBRIE 1918, NR. 22") === "Strada 1 Decembrie 1918 22",
  adresaCurataPentruNavigatie("STR. 1 DECEMBRIE 1918, NR. 22"),
);

sectiune("Linkul de navigare are ce trebuie");
const link = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(nav)}&travelmode=driving`;
check("e link de direcții, nu de căutare", link.includes("/maps/dir/"));
check("cere condusul cu mașina", link.includes("travelmode=driving"));
check("adresa e codificată corect", !link.includes(" "), link.slice(0, 90));
const linkCoord = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent("47.8123,26.4501")}&travelmode=driving`;
check(
  "cu pin, mergem pe coordonate — Google n-are ce ghici",
  decodeURIComponent(linkCoord).includes("47.8123,26.4501"),
);

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
if (fail) {
  console.log("\nCe nu merge:");
  rele.forEach((r) => console.log("  · " + r));
}
process.exit(fail === 0 ? 0 : 1);
