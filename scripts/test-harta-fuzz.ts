/**
 * IMPORTUL HĂRȚII, LA SÂNGE — mii de cazuri generate, nu zece scrise de mână.
 *
 * Funcția asta scrie ÎN DATELE CLIENTULUI: dacă leagă un pin de firma
 * greșită, agentul e trimis la altă adresă și va crede aplicația, nu
 * ochii. Deci n-ajunge că merge pe exemplele mele — trebuie să reziste la
 * ce vine din realitate: fișiere stricate, nume ciudate, coordonate
 * imposibile, magazine în același punct, reimporturi repetate.
 *
 * Ce se verifică aici, pe mii de cazuri:
 *   · CITIREA nu crapă niciodată și nu inventează puncte;
 *   · POTRIVIREA nu leagă niciodată un pin de altă firmă decât a lui;
 *   · CHEILE magazinelor nu se ciocnesc (asta a rupt importul în teren);
 *   · REIMPORTUL dă exact același rezultat (nu dublează, nu mută nimic).
 *
 * Rulare: npx tsx scripts/test-harta-fuzz.ts
 */
import { citesteKML, citesteKMLRaport, midDinLink } from "../src/modules/prospects/kml";
import { cheieMagazin, neted, potriveștePuncte } from "../src/modules/prospects/potrivire";

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

/** Numere „aleatoare" dar REPETABILE: un test care pică o dată la zece
 *  rulări nu ajută pe nimeni. */
let sam = 12345;
function rnd(): number {
  sam = (sam * 1103515245 + 12345) % 2147483648;
  return sam / 2147483648;
}
const alege = <T,>(v: readonly T[]): T => v[Math.floor(rnd() * v.length)];

/* ─────────── 1. CITIREA: mii de fișiere stricate ─────────── */

sectiune("Citirea nu crapă, orice fișier i-ai da (2000 de variante)");

const BUCATI = [
  "<kml>", "</kml>", "<Document>", "</Document>", "<Placemark>", "</Placemark>",
  "<name>", "</name>", "<Point>", "</Point>", "<coordinates>", "</coordinates>",
  "26.5,47.8,0", "abc,def", "", "   ", "<!-- comentariu -->", "&amp;", "&lt;",
  "<![CDATA[", "]]>", "<Folder>", "</Folder>", "<LineString>", "</LineString>",
  "\n", "\t", '"', "'", "<", ">", "/", "999999,999999", "-0,-0", "NaN,NaN",
];
let crapate = 0;
let inventate = 0;
for (let i = 0; i < 2000; i++) {
  const n = 3 + Math.floor(rnd() * 25);
  const text = Array.from({ length: n }, () => alege(BUCATI)).join("");
  try {
    const p = citesteKML(text);
    if (!Array.isArray(p)) crapate++;
    for (const m of p) {
      // Nimic „citit" nu are voie să fie gunoi: nume gol sau coordonate
      // imposibile ar ajunge pe harta agentului.
      if (
        typeof m.nume !== "string" || m.nume.trim() === "" ||
        !Number.isFinite(m.lat) || !Number.isFinite(m.lng) ||
        m.lat < 43.3 || m.lat > 48.4 || m.lng < 20.1 || m.lng > 30.1
      ) {
        inventate++;
      }
    }
  } catch {
    crapate++;
  }
}
check("2000 de fișiere stricate, niciun crash", crapate === 0, `${crapate}`);
check("…și niciun punct inventat sau în afara României", inventate === 0, `${inventate}`);

sectiune("Coordonate imposibile — 1500 de combinații");
let scapate = 0;
for (let i = 0; i < 1500; i++) {
  const lat = (rnd() - 0.5) * 400;
  const lng = (rnd() - 0.5) * 800;
  const kml = `<kml><Placemark><name>X${i}</name><Point><coordinates>${lng},${lat},0</coordinates></Point></Placemark></kml>`;
  const p = citesteKML(kml);
  const inRO = lat >= 43.3 && lat <= 48.4 && lng >= 20.1 && lng <= 30.1;
  if (inRO !== (p.length === 1)) scapate++;
}
check("intră DOAR ce e în România", scapate === 0, `${scapate} greșite`);

sectiune("Raportul spune adevărul — 500 de hărți generate");
let raportGresit = 0;
for (let i = 0; i < 500; i++) {
  const bune = Math.floor(rnd() * 8);
  const faraLoc = Math.floor(rnd() * 5);
  const laZero = Math.floor(rnd() * 4);
  const linii = Math.floor(rnd() * 3);
  const p: string[] = [];
  for (let k = 0; k < bune; k++) {
    p.push(`<Placemark><name>B${k}</name><Point><coordinates>26.${k}0,47.${k}0,0</coordinates></Point></Placemark>`);
  }
  for (let k = 0; k < faraLoc; k++) p.push(`<Placemark><name>F${k}</name></Placemark>`);
  for (let k = 0; k < laZero; k++) {
    p.push(`<Placemark><name>Z${k}</name><Point><coordinates>0,0,0</coordinates></Point></Placemark>`);
  }
  for (let k = 0; k < linii; k++) {
    p.push(`<Placemark><name>L${k}</name><LineString><coordinates>25,47 26,48</coordinates></LineString></Placemark>`);
  }
  const r = citesteKMLRaport(`<kml><Document>${p.join("")}</Document></kml>`);
  if (
    r.puncte.length !== bune ||
    r.faraLocPeHarta !== faraLoc ||
    r.inafara !== laZero ||
    r.liniiSiZone !== linii
  ) {
    raportGresit++;
  }
}
check("500 de hărți: raportul numără exact", raportGresit === 0, `${raportGresit} greșite`);

/* ─────────── 2. POTRIVIREA: nu lega niciodată greșit ─────────── */

sectiune("Potrivirea nu leagă niciodată de altă firmă (3000 de cazuri)");

const PRENUME = ["ANDRONACHE", "POPESCU", "IONESCU", "VASILIU", "MOISE", "CIOBANU",
  "ACIOBANITEI", "GAVRILET", "COJOCARU", "VOLANSCHI", "CALINCIUC", "COSTIN"];
const SUFIX = ["SRL", "II", "PFA", "SNC", "COM SRL", "IMPEX SRL", "ÎNTREPRINDERE INDIVIDUALĂ"];
const GENERIC = ["MAGAZIN", "ALIMENTARA", "BAR", "MINIMARKET", "DEPOZIT"];

let legatGresit = 0;
let ratatUsor = 0;
for (let i = 0; i < 3000; i++) {
  const baza = `${alege(PRENUME)} ${Math.floor(rnd() * 900) + 100}`;
  const oficial = `${rnd() < 0.4 ? alege(GENERIC) + " " : ""}${baza} ${alege(SUFIX)}`;
  // Numele de pe hartă: scris de om, mai scurt, uneori fără diacritice.
  const pePin = rnd() < 0.5 ? baza : `${alege(GENERIC)} ${baza}`;

  // Altă firmă, cu nume ASEMĂNĂTOR dar diferit — capcana clasică.
  const altul = `${alege(PRENUME)} ${Math.floor(rnd() * 900) + 100} ${alege(SUFIX)}`;
  const clienti = [
    { cui: "1", denumire: oficial, localitate: "" },
    { cui: "2", denumire: altul, localitate: "" },
  ];
  if (neted(altul) === neted(oficial)) continue;

  const r = potriveștePuncte(
    [{ nume: pePin, lat: 47.5, lng: 26.5 }],
    clienti,
  )[0];
  if (r.client && r.client.cui !== "1") legatGresit++;
  // Nu cerem să prindă tot, dar când numele de pe pin e chiar baza
  // oficialului, ar trebui să-l lege.
  if (!r.client && neted(oficial).includes(neted(pePin))) ratatUsor++;
}
check("3000 de perechi: NICIUNA legată de firma greșită", legatGresit === 0, `${legatGresit}`);
check(
  "…și prinde majoritatea celor evidente",
  ratatUsor < 300,
  `${ratatUsor} ratate din 3000`,
);

sectiune("Un client nu primește două pinuri (500 de hărți)");
let dublate = 0;
for (let i = 0; i < 500; i++) {
  const nume = `${alege(PRENUME)} ${i} SRL`;
  const cate = 2 + Math.floor(rnd() * 4);
  const puncte = Array.from({ length: cate }, (_, k) => ({
    nume,
    lat: 47.5 + k / 1000,
    lng: 26.5 + k / 1000,
  }));
  const r = potriveștePuncte(puncte, [{ cui: "1", denumire: nume, localitate: "" }]);
  const legate = r.filter((x) => x.client).length;
  if (legate > 1) dublate++;
  // Restul trebuie SPUSE ca puncte de lucru, nu aruncate în tăcere.
  if (r.filter((x) => !x.client && /punct de lucru/i.test(x.motiv)).length !== cate - 1) {
    dublate++;
  }
}
check("500 de hărți cu magazine multiple: niciun client cu două pinuri", dublate === 0, `${dublate}`);

sectiune("Fără candidați buni, NU inventează (1000 de cazuri)");
let inventat = 0;
for (let i = 0; i < 1000; i++) {
  const r = potriveștePuncte(
    [{ nume: `MAGAZIN NECUNOSCUT ${i}`, lat: 47.5, lng: 26.5 }],
    [
      { cui: "1", denumire: `${alege(PRENUME)} ${i + 5000} SRL`, localitate: "" },
      { cui: "2", denumire: `${alege(PRENUME)} ${i + 9000} SRL`, localitate: "" },
    ],
  );
  if (r[0].client) inventat++;
}
check("1000 de nume fără pereche: nicio potrivire inventată", inventat === 0, `${inventat}`);

/* ─────────── 3. CHEILE: ce a rupt importul în teren ─────────── */

sectiune("Cheile magazinelor nu se ciocnesc (5000 de magazine)");
const chei = new Set<string>();
let ciocniri = 0;
for (let i = 0; i < 5000; i++) {
  // Multe magazine EXACT în același punct — cazul real care a rupt totul.
  const lat = 47.5 + Math.floor(rnd() * 5) / 100;
  const lng = 26.5 + Math.floor(rnd() * 5) / 100;
  const nume = `${alege(PRENUME)} ${i} ${alege(SUFIX)}`;
  const k = cheieMagazin(nume, lat, lng);
  if (chei.has(k)) ciocniri++;
  chei.add(k);
}
check("5000 de magazine, doar 25 de puncte: nicio cheie dublă", ciocniri === 0, `${ciocniri}`);
check("…și cheile încap în coloană (max 110 caractere)",
  [...chei].every((k) => k.length <= 110));

sectiune("Aceeași însemnare dă aceeași cheie, oricum ar fi scrisă");
let instabile = 0;
for (let i = 0; i < 500; i++) {
  const nume = `${alege(PRENUME)} ${i} SRL`;
  const lat = 47.5 + i / 10000;
  const lng = 26.5 + i / 10000;
  const a = cheieMagazin(nume, lat, lng);
  const b = cheieMagazin(nume.toLowerCase(), lat, lng);
  const c = cheieMagazin(`  ${nume}  `, lat, lng);
  if (a !== b || a !== c) instabile++;
}
check("majuscule și spații nu schimbă cheia", instabile === 0, `${instabile}`);

/* ─────────── 4. REIMPORTUL: același rezultat, de fiecare dată ─────────── */

sectiune("Reimportul dă EXACT același rezultat (200 de hărți)");
let nedeterminist = 0;
for (let i = 0; i < 200; i++) {
  const cate = 3 + Math.floor(rnd() * 10);
  const puncte = Array.from({ length: cate }, (_, k) => ({
    nume: `${alege(PRENUME)} ${i}-${k} SRL`,
    lat: 47.5 + k / 500,
    lng: 26.5 + k / 500,
  }));
  const clienti = puncte
    .filter(() => rnd() < 0.7)
    .map((p, k) => ({ cui: String(k), denumire: p.nume, localitate: "" }));
  const a = potriveștePuncte(puncte, clienti);
  const b = potriveștePuncte(puncte, clienti);
  const cheie = (r: typeof a) =>
    r.map((x) => `${x.punct.nume}=>${x.client?.cui ?? "-"}`).join("|");
  if (cheie(a) !== cheie(b)) nedeterminist++;
}
check("200 de hărți rulate de două ori: rezultat identic", nedeterminist === 0, `${nedeterminist}`);

sectiune("Ordinea pinurilor din fișier nu schimbă cine cu cine se leagă");
let dependentDeOrdine = 0;
for (let i = 0; i < 200; i++) {
  const cate = 4 + Math.floor(rnd() * 6);
  const puncte = Array.from({ length: cate }, (_, k) => ({
    nume: `${alege(PRENUME)} ${i}-${k} SRL`,
    lat: 47.5 + k / 500,
    lng: 26.5 + k / 500,
  }));
  const clienti = puncte.map((p, k) => ({
    cui: String(k),
    denumire: p.nume,
    localitate: "",
  }));
  const drept = potriveștePuncte(puncte, clienti);
  const invers = potriveștePuncte([...puncte].reverse(), clienti);
  const perechi = (r: typeof drept) =>
    new Map(r.filter((x) => x.client).map((x) => [x.punct.nume, x.client!.cui]));
  const a = perechi(drept);
  const b = perechi(invers);
  if (a.size !== b.size || [...a].some(([k, v]) => b.get(k) !== v)) {
    dependentDeOrdine++;
  }
}
check("200 de hărți citite invers: aceleași perechi", dependentDeOrdine === 0, `${dependentDeOrdine}`);

/* ─────────── 5. LINKURILE ─────────── */

sectiune("Linkuri de tot felul (1000 de variante)");
const MID = "17ICKizbR91vBsEn6v6RxcI3avAwFi8k";
const GAZDE = ["https://www.google.com", "http://google.com", "google.com", "https://google.com"];
const CAI = ["/maps/d/viewer", "/maps/d/u/0/viewer", "/maps/d/edit", "/maps/d/u/1/viewer"];
const COZI = ["", "&usp=sharing", "&ll=47.1%2C26.2&z=10", "&hl=ro", "&ll=1,2&z=4&usp=sharing"];
let ratate = 0;
for (let i = 0; i < 1000; i++) {
  const l = `${alege(GAZDE)}${alege(CAI)}?mid=${MID}${alege(COZI)}`;
  if (midDinLink(l) !== MID) ratate++;
}
check("1000 de forme de link: identificatorul iese de fiecare dată", ratate === 0, `${ratate}`);

let acceptateGresit = 0;
for (const rau of [
  "https://google.com/maps", "https://facebook.com/x?mid=abc", "",
  "   ", "mid=", "https://www.google.com/maps/d/viewer?mid=scurt",
  "javascript:alert(1)", "../../etc/passwd", "<script>",
]) {
  // „mid" dintr-un alt site nu ne interesează: descărcăm doar de la Google.
  const m = midDinLink(rau);
  if (m !== "" && !rau.includes("google.com")) acceptateGresit++;
}
check("linkurile care nu-s de My Maps nu trec", acceptateGresit === 0, `${acceptateGresit}`);

/* ─────────── 6. VOLUM ─────────── */

sectiune("Volum: o hartă cât cea reală");
const mare = Array.from({ length: 2500 }, (_, i) =>
  `<Placemark><name>${alege(PRENUME)} ${i} ${alege(SUFIX)}</name><Point><coordinates>${(26 + (i % 100) / 100).toFixed(4)},${(47.5 + (i % 80) / 100).toFixed(4)},0</coordinates></Point></Placemark>`,
).join("");
const t0 = Date.now();
const citite = citesteKML(`<kml><Document>${mare}</Document></kml>`);
const tCitire = Date.now() - t0;
check("2500 de magazine citite", citite.length === 2500, `${citite.length}`);
check("…rapid (sub 3 secunde)", tCitire < 3000, `${tCitire} ms`);

const cli = Array.from({ length: 2500 }, (_, i) => ({
  cui: String(i),
  denumire: citite[i].nume,
  localitate: "",
}));
const t1 = Date.now();
const potr = potriveștePuncte(citite, cli);
const tPotrivire = Date.now() - t1;
check("…potrivite cu 2500 de clienți", potr.length === 2500);
check("…într-un timp rezonabil (sub 30 secunde)", tPotrivire < 30_000, `${tPotrivire} ms`);
const gresiteVolum = potr.filter(
  (p) => p.client && neted(p.client.denumire) !== neted(p.punct.nume),
).length;
check("…și niciuna legată greșit", gresiteVolum === 0, `${gresiteVolum}`);

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
if (fail) {
  console.log("\nCe nu merge:");
  rele.forEach((r) => console.log("  · " + r));
}
process.exit(fail === 0 ? 0 : 1);
