/**
 * HARTA LUI BOGDAN → LOCAȚIILE DIN APLICAȚIE.
 *
 * „Aveam linkul ăsta de la firma veche… cu locații mai actualizate. Poate
 * îl poți integra." (Bogdan, 26.08). Pe harta aia magazinele sunt puse
 * de mână, punct cu punct — cele mai bune coordonate care există.
 *
 * Aici verificăm cele două piese care fac importul, amândouă pure (fără
 * rețea, fără bază de date):
 *   1. CITIREA fișierului KML de la Google My Maps;
 *   2. POTRIVIREA pinurilor cu clienții firmei.
 *
 * A doua e cea periculoasă: un pin legat de firma greșită trimite agentul
 * la altă adresă, iar el va crede aplicația, nu ochii. De-aia regula e
 * „potrivim doar când suntem siguri, restul îl arătăm omului" — și exact
 * asta se verifică aici, inclusiv cazurile în care NU trebuie să ghicim.
 *
 * Rulare: npx tsx scripts/test-harta-mymaps.ts
 */
import {
  citesteKML,
  citesteKMLRaport,
  linkDinNetworkLink,
  linkKML,
  midDinLink,
} from "../src/modules/prospects/kml";
import { cuvinteTari, potriveștePuncte } from "../src/modules/prospects/potrivire";

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

/* ── un KML ca cele scoase de Google My Maps ── */
const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <name>Botosani_Iasi_Suceava</name>
  <Folder>
    <name>Costin Vlad</name>
    <Placemark>
      <name>Andronache</name>
      <description><![CDATA[<b>Str. Cucului 6</b><br>tel 0740111222]]></description>
      <Point><coordinates>26.590100,48.190200,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Arminia Casy</name>
      <description></description>
      <Point><coordinates>26.591500,48.191000,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Bar la Vale &amp; Fii</name>
      <Point><coordinates>26.300000,47.900000,0</coordinates></Point>
    </Placemark>
  </Folder>
  <Folder>
    <name>Razvan Cojocaru</name>
    <Placemark>
      <name>Magazin Podu Cosnei</name>
      <Point><coordinates>25.400000,47.500000,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Traseu luni</name>
      <LineString><coordinates>25.4,47.5,0 25.5,47.6,0</coordinates></LineString>
    </Placemark>
    <Placemark>
      <name>Zona mea</name>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>25.4,47.5,0 25.5,47.6,0 25.4,47.5,0</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
    <Placemark>
      <name>Depozit Africa</name>
      <Point><coordinates>3.000000,6.500000,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name></name>
      <Point><coordinates>26.0,47.7,0</coordinates></Point>
    </Placemark>
  </Folder>
</Document></kml>`;

sectiune("Citirea hărții de la Google");
const puncte = citesteKML(KML);
check("citește pinurile, nu și liniile sau zonele", puncte.length === 4, `${puncte.length}`);
check("ia numele pus de om", puncte[0]?.nume === "Andronache", puncte[0]?.nume);
check(
  "descrierea vine curățată de HTML",
  puncte[0]?.descriere === "Str. Cucului 6 tel 0740111222",
  puncte[0]?.descriere,
);
check(
  "coordonatele NU se inversează (KML scrie lng,lat)",
  Math.abs(puncte[0].lat - 48.1902) < 0.0001 && Math.abs(puncte[0].lng - 26.5901) < 0.0001,
  `${puncte[0]?.lat},${puncte[0]?.lng}`,
);
check("reține stratul (agentul/zona)", puncte[0]?.strat === "Costin Vlad", puncte[0]?.strat);
check("…și pentru al doilea dosar", puncte[3]?.strat === "Razvan Cojocaru", puncte[3]?.strat);
check("dezescapează „&amp;”", puncte[2]?.nume === "Bar la Vale & Fii", puncte[2]?.nume);
check(
  "aruncă punctele din afara României (coordonate greșite)",
  !puncte.some((p) => p.nume.includes("Africa")),
);
check("aruncă pinurile fără nume", !puncte.some((p) => p.nume === ""));

sectiune("Exportul care NU conține datele (cazul real, 26.08)");
// Asta iese din My Maps când exporți „Harta întreagă": un fișier care
// arată ca un KML dar are zero magazine în el, doar un indicator.
const DOAR_INDICATOR = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Botosani_Iasi_Suceava</name>
    <description/>
    <NetworkLink>
      <name>Botosani_Iasi_Suceava</name>
      <Link>
        <href><![CDATA[https://www.google.com/maps/d/u/0/kml?forcekml=1&mid=17ICKizbR91vBsEn6v6RxcI3avAwFi8k]]></href>
      </Link>
    </NetworkLink>
  </Document>
</kml>`;
check("fișierul-indicator n-are niciun magazin", citesteKML(DOAR_INDICATOR).length === 0);
check(
  "…dar îi găsim linkul dinăuntru, ca să-l urmăm",
  linkDinNetworkLink(DOAR_INDICATOR).includes("mid=17ICKizbR91vBsEn6v6RxcI3avAwFi8k"),
  linkDinNetworkLink(DOAR_INDICATOR),
);
check(
  "un KML normal n-are indicator de urmat",
  linkDinNetworkLink(KML) === "",
);
check(
  "nu urmăm linkuri către alte site-uri (fișier primit de la cineva)",
  linkDinNetworkLink(
    '<kml><NetworkLink><Link><href>https://site-rau.example/x.kml</href></Link></NetworkLink></kml>',
  ) === "",
);

sectiune("Linkul dat de om");
check(
  "scoate identificatorul din linkul de partajare",
  midDinLink(
    "https://www.google.com/maps/d/viewer?mid=17ICKizbR91vBsEn6v6RxcI3avAwFi8k&usp=sharing",
  ) === "17ICKizbR91vBsEn6v6RxcI3avAwFi8k",
);
check(
  "merge și linkul de editare",
  midDinLink("https://www.google.com/maps/d/edit?mid=ABCdef123456&ll=47.1%2C26.2&z=10") ===
    "ABCdef123456",
);
check(
  "merge și dacă lipește doar identificatorul",
  midDinLink("17ICKizbR91vBsEn6v6RxcI3avAwFi8k") === "17ICKizbR91vBsEn6v6RxcI3avAwFi8k",
);
check("un link fără mid nu trece", midDinLink("https://google.com/maps") === "");
check("text gol nu trece", midDinLink("") === "");
check("adresa de descărcare e cea de KML", linkKML("X1").includes("/maps/d/kml?mid=X1"));
check("…și cere KML curat", linkKML("X1").includes("forcekml=1"));

sectiune("Potrivirea pinurilor cu clienții firmei");
const clienti = [
  { cui: "1", denumire: "ANDRONACHE FILOTIA ÎNTREPRINDERE INDIVIDUALĂ", localitate: "DARABANI" },
  { cui: "2", denumire: "ARMINIA-CASY SRL", localitate: "DARABANI" },
  { cui: "3", denumire: "PODU COSNEI COMERT SRL", localitate: "PODU COSNEI" },
  { cui: "4", denumire: "MAGAZIN MIXT SRL", localitate: "LOZNA" },
  { cui: "5", denumire: "ANDRONACHE VASILE SRL", localitate: "SAVENI" },
];
// Centrele satelor — cu ele, pinul „Andronache" de la Darabani nu mai
// poate fi confundat cu „Andronache" din Săveni.
const CENTRE = new Map([
  ["darabani", { lat: 48.1900, lng: 26.5900 }],
  ["saveni", { lat: 47.9500, lng: 26.8600 }],
  ["podu cosnei", { lat: 47.5000, lng: 25.4000 }],
  ["lozna", { lat: 47.9800, lng: 26.2000 }],
]);
const potriviri = potriveștePuncte(puncte, clienti, 0.7, CENTRE);
const dupaNume = (n: string) => potriviri.find((p) => p.punct.nume === n);

check(
  "două „Andronache”: îl alege pe cel de lângă pin (Darabani, nu Săveni)",
  dupaNume("Andronache")?.client?.cui === "1",
  `${dupaNume("Andronache")?.client?.denumire} (${dupaNume("Andronache")?.motiv})`,
);
check(
  "…și spune pe ce s-a bazat, ca să poată verifica omul",
  /km de/i.test(dupaNume("Andronache")?.motiv ?? ""),
  dupaNume("Andronache")?.motiv,
);
check(
  "fără centrele satelor, NU ghicește — îl întreabă pe om",
  potriveștePuncte(puncte, clienti).find((x) => x.punct.nume === "Andronache")?.client === null,
);
check(
  "„Arminia Casy” se leagă de ARMINIA-CASY SRL",
  dupaNume("Arminia Casy")?.client?.cui === "2",
  dupaNume("Arminia Casy")?.client?.denumire,
);
check(
  "„Magazin Podu Cosnei” se leagă de firma din Podu Cosnei",
  dupaNume("Magazin Podu Cosnei")?.client?.cui === "3",
  dupaNume("Magazin Podu Cosnei")?.client?.denumire,
);
check(
  "„Bar la Vale & Fii” NU se leagă de nimic (n-are pereche)",
  dupaNume("Bar la Vale & Fii")?.client === null,
  dupaNume("Bar la Vale & Fii")?.client?.denumire,
);
check(
  "…dar primește variante, ca să aleagă omul",
  Array.isArray(dupaNume("Bar la Vale & Fii")?.variante),
);
check(
  "fiecare potrivire spune DE CE a fost aleasă",
  potriviri.every((p) => p.motiv !== ""),
);
check(
  "un client nu poate primi două pinuri",
  (() => {
    const luati = potriviri.filter((p) => p.client).map((p) => p.client!.cui);
    return new Set(luati).size === luati.length;
  })(),
);

sectiune("Când NU are voie să ghicească");
const ambigue = potriveștePuncte(
  [{ nume: "Andronache", lat: 47.9, lng: 26.5 }],
  [
    { cui: "10", denumire: "ANDRONACHE SRL", localitate: "DARABANI" },
    { cui: "11", denumire: "ANDRONACHE SRL", localitate: "SAVENI" },
  ],
);
check(
  "două firme la fel de asemănătoare → nu alege singur",
  ambigue[0].client === null,
  ambigue[0].client?.denumire,
);
check("…și spune de ce", /alege tu/i.test(ambigue[0].motiv), ambigue[0].motiv);
check("…dar le pune pe amândouă ca variante", ambigue[0].variante.length === 2);

const numeGeneric = potriveștePuncte(
  [{ nume: "Magazin", lat: 47.9, lng: 26.5 }],
  [
    { cui: "20", denumire: "MAGAZIN ALIMENTAR SRL", localitate: "X" },
    { cui: "21", denumire: "MAGAZIN MIXT SRL", localitate: "Y" },
  ],
);
check(
  "un nume generic („Magazin”) nu se leagă de nimeni la nimereală",
  numeGeneric[0].client === null,
  numeGeneric[0].client?.denumire,
);
check(
  "cuvintele goale (SRL, magazin, bar) nu contează la potrivire",
  cuvinteTari("MAGAZIN ANDRONACHE SRL").join(",") === "andronache",
  cuvinteTari("MAGAZIN ANDRONACHE SRL").join(","),
);
check(
  "diacriticele nu împiedică potrivirea",
  potriveștePuncte(
    [{ nume: "Cărăușu", lat: 47.9, lng: 26.5 }],
    [{ cui: "30", denumire: "CARAUSU COM SRL", localitate: "X" }],
  )[0].client?.cui === "30",
);

sectiune("Ce ne-a învățat harta REALĂ a lui Bogdan (2450 de magazine)");

// 1. O firmă cu MAI MULTE magazine. Pe hartă apar de două ori cu același
//    nume; în aplicație firma ține un singur loc. Al doilea trebuie spus
//    ca „al doilea punct de lucru", NU legat de altă firmă.
const douaPuncte = potriveștePuncte(
  [
    { nume: "ADEMAT COMERT SRL", descriere: "Nume Legal: ADEMAT COMERT CUCUTENI", lat: 47.7782, lng: 27.138 },
    { nume: "ADEMAT COMERT SRL", descriere: "Nume Legal: ADEMAT COMERT DURNESTI", lat: 47.7724, lng: 27.12 },
  ],
  [{ cui: "40", denumire: "ADEMAT COMERT SRL", localitate: "" }],
);
check("primul magazin al firmei se leagă", douaPuncte[0].client?.cui === "40");
check("al doilea NU se leagă de altă firmă", douaPuncte[1].client === null);
check(
  "…și i se spune omului că e al doilea punct de lucru",
  /punct de lucru/i.test(douaPuncte[1].motiv),
  douaPuncte[1].motiv,
);

// 2. BUG-UL PRINS PE DATE REALE: când firma potrivită e deja luată, NU
//    avem voie să cădem pe următoarea firmă asemănătoare. Așa ajungea
//    „ANA MARIA SRL" legat de „PRISTAVU ANA-MARIA II" — alt om, altă adresă.
const capcana = potriveștePuncte(
  [
    { nume: "ANA MARIA SRL", lat: 47.6, lng: 26.6 },
    { nume: "ANA MARIA SRL", lat: 47.7, lng: 26.7 },
  ],
  [
    { cui: "50", denumire: "ANA MARIA SRL", localitate: "" },
    { cui: "51", denumire: "PRISTAVU ANA-MARIA II", localitate: "" },
  ],
);
check("primul merge la firma lui", capcana[0].client?.cui === "50");
check(
  "al doilea NU e împins la o firmă cu nume asemănător",
  capcana[1].client === null,
  capcana[1].client?.denumire,
);

// 3. Un nume scurt nu mai înghite o firmă mai lungă doar fiindcă e conținut.
const scurt = potriveștePuncte(
  [{ nume: "ANA MARIA SRL", lat: 47.6, lng: 26.6 }],
  [{ cui: "60", denumire: "PRISTAVU ANA-MARIA II", localitate: "" }],
);
check(
  "ANA MARIA nu se leaga singur de PRISTAVU ANA-MARIA",
  scurt[0].client === null,
  scurt[0].client?.denumire,
);

// 4. Descrierea-șablon nu mai creează potriviri din senin. În harta reală
//    fiecare pin are „Tip Outlet: …", identic la toate.
const sablon = potriveștePuncte(
  [{ nume: "IPM SRL", descriere: "Nume Legal: IPM Tip Outlet: Convenience Store", lat: 47.6, lng: 26.6 }],
  [
    { cui: "70", denumire: "RIAROM-IBANESTI SRL", localitate: "" },
    { cui: "71", denumire: "NIKOANDRE SUCEAVA SRL", localitate: "" },
  ],
);
check(
  "text-șablon identic la toate pinurile nu leagă firme fără legătură",
  sablon[0].client === null,
  sablon[0].client?.denumire,
);

// 5. Raportul despre ce n-a intrat: 213 firme fără coordonate, 4 la 0,0.
const RAPORT = `<kml><Document>
  <Placemark><name>FARA LOC SRL</name></Placemark>
  <Placemark><name>LA ZERO SRL</name><Point><coordinates>0,0,0</coordinates></Point></Placemark>
  <Placemark><name>TRASEU</name><LineString><coordinates>25.4,47.5,0 25.5,47.6,0</coordinates></LineString></Placemark>
  <Placemark><name>BUN SRL</name><Point><coordinates>26.5,47.8,0</coordinates></Point></Placemark>
</Document></kml>`;
const rap = citesteKMLRaport(RAPORT);
check("raportul numără magazinele bune", rap.puncte.length === 1, `${rap.puncte.length}`);
check("…firmele niciodată puse pe hartă", rap.faraLocPeHarta === 1, `${rap.faraLocPeHarta}`);
check("…cele cu locul greșit (0,0)", rap.inafara === 1, `${rap.inafara}`);
check("…și liniile desenate", rap.liniiSiZone === 1, `${rap.liniiSiZone}`);

sectiune("Marginile");
check("KML gol → nicio eroare, listă goală", citesteKML("").length === 0);
check("text care nu e KML → listă goală", citesteKML("buna ziua").length === 0);
check(
  "KML rupt la jumătate → listă goală, nu crash",
  citesteKML("<kml><Document><Placemark><name>X</name>").length === 0,
);
check("fără clienți → toate rămân nepotrivite", (() => {
  const r = potriveștePuncte(puncte, []);
  return r.length === puncte.length && r.every((x) => x.client === null);
})());
check("fără puncte → listă goală", potriveștePuncte([], clienti).length === 0);
let crapat = 0;
for (const rau of ["<kml>", "<<>>", "&amp;", " ", "x".repeat(50_000)]) {
  try {
    citesteKML(rau);
  } catch {
    crapat++;
  }
}
check("fișiere stricate, niciun crash", crapat === 0, `${crapat}`);

sectiune("O hartă mare nu îngenunchează serverul");
const multe = Array.from({ length: 400 }, (_, i) => ({
  nume: `Magazin Test ${i}`,
  lat: 47.5 + i / 10000,
  lng: 26.5 + i / 10000,
}));
const multiClienti = Array.from({ length: 800 }, (_, i) => ({
  cui: String(1000 + i),
  denumire: `MAGAZIN TEST ${i} SRL`,
  localitate: "X",
}));
const t0 = process.hrtime.bigint();
const rezultat = potriveștePuncte(multe, multiClienti);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
check("400 de pinuri × 800 de clienți se potrivesc", rezultat.length === 400);
check("…în timp rezonabil (sub 5 secunde)", ms < 5000, `${Math.round(ms)} ms`);
check(
  "…și fiecare pin merge la firma LUI, nu la vecin",
  rezultat.filter((r, i) => r.client?.cui === String(1000 + i)).length >= 395,
  `${rezultat.filter((r, i) => r.client?.cui === String(1000 + i)).length}/400`,
);

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
if (fail) {
  console.log("\nCe nu merge:");
  rele.forEach((r) => console.log("  · " + r));
}
process.exit(fail === 0 ? 0 : 1);
