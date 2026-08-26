/**
 * MAGAZINELE DIN OPENSTREETMAP — verificare pe fixturi.
 *
 * Overpass e un serviciu public din afară: nu-l chemăm dintr-un test (ar
 * fi lent, capricios și nepoliticos). Verificăm ce ține de noi — întrebarea
 * pe care o punem și felul în care citim răspunsul — pe răspunsuri reale
 * copiate din ce dă Overpass.
 *
 * Ce contează la sânge:
 *   · județul ajunge la codul corect, oricum ar fi scris în baza noastră;
 *   · un magazin desenat ca CLĂDIRE (fără lat/lon propriu) tot primește loc;
 *   · nimic din afara României nu intră pe harta agentului;
 *   · același magazin, pus și ca punct și ca clădire, apare O SINGURĂ dată;
 *   · potrivirea cu firmele merge la fel ca la harta lui Bogdan.
 */

import { citesteOverpass, intrebareJudet } from "../src/modules/prospects/overpass";
import { potriveștePuncte } from "../src/modules/prospects/potrivire";

let treceri = 0;
let caderi = 0;
function ok(nume: string, conditie: boolean, detaliu = "") {
  if (conditie) {
    treceri++;
  } else {
    caderi++;
    console.log(`  ✗ ${nume}${detaliu ? ` — ${detaliu}` : ""}`);
  }
}
function egal(nume: string, a: unknown, b: unknown) {
  ok(nume, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}

console.log("\n── ÎNTREBAREA PENTRU OVERPASS ──");

{
  const q = intrebareJudet("SV");
  ok("codul județului ajunge în ISO3166-2", q.includes('"ISO3166-2"="RO-SV"'), q.slice(0, 80));
  ok("cere și centrul clădirilor", q.includes("out center"));
  ok("cere JSON", q.startsWith("[out:json]"));
  ok("are timeout", /\[timeout:\d+\]/.test(q));
  ok("caută alimentare", q.includes("convenience"));
  ok("caută baruri", q.includes("bar"));
  ok("caută și noduri, și clădiri", q.includes("node[") && q.includes("way["));
  ok("are cale de rezervă pe ref", q.includes('"ref"="SV"'));
}

// Județul poate fi scris în baza noastră în orice fel — a intrat din
// fișiere de la Finanțe, din SAGA, scris de mână. Toate duc la RO-SV.
for (const scris of ["SV", "sv", "Suceava", "SUCEAVA", "JUD. SUCEAVA", "33", "J33"]) {
  ok(
    `„${scris}" → RO-SV`,
    intrebareJudet(scris).includes('"ISO3166-2"="RO-SV"'),
    intrebareJudet(scris).split("\n")[2],
  );
}
ok("Botoșani → RO-BT", intrebareJudet("Botosani").includes('"ISO3166-2"="RO-BT"'));
ok("Iași → RO-IS", intrebareJudet("Iasi").includes('"ISO3166-2"="RO-IS"'));

// Nimeni nu ne bagă altceva în întrebare prin numele județului.
{
  const rau = intrebareJudet('SV"];out;//');
  ok("nu se poate injecta în întrebare", !rau.includes("//") && !rau.includes(";out;"), rau.split("\n")[2]);
  const gol = intrebareJudet("");
  ok("județ gol nu crapă", typeof gol === "string" && gol.length > 0);
}

console.log("\n── CITIREA RĂSPUNSULUI ──");

{
  const raspuns = {
    elements: [
      // magazin pus ca PUNCT, cu tot ce se poate
      {
        type: "node", id: 1, lat: 47.65, lon: 26.25,
        tags: {
          name: "Magazin Mixt Doina", shop: "convenience",
          "addr:street": "Strada Principală", "addr:housenumber": "12",
          "addr:city": "Șiret", phone: "+40 231 555 111",
        },
      },
      // magazin desenat ca CLĂDIRE — n-are lat/lon, are center
      {
        type: "way", id: 2, center: { lat: 47.7, lon: 26.3 },
        tags: { name: "Profi", shop: "supermarket" },
      },
      // bar
      { type: "node", id: 3, lat: 47.6, lon: 26.2, tags: { name: "Bar La Colț", amenity: "bar" } },
      // FĂRĂ NUME — un punct fără nume n-ajută pe nimeni pe hartă
      { type: "node", id: 4, lat: 47.6, lon: 26.2, tags: { shop: "convenience" } },
      // FĂRĂ POZIȚIE
      { type: "way", id: 5, tags: { name: "Fără loc", shop: "kiosk" } },
      // ÎN AFARA ROMÂNIEI — greșeală de date, nu punem agentul pe drum
      { type: "node", id: 6, lat: 48.9, lon: 2.35, tags: { name: "Paris Shop", shop: "convenience" } },
      // 0,0 — Golful Guineei
      { type: "node", id: 7, lat: 0, lon: 0, tags: { name: "Nicăieri", shop: "convenience" } },
    ],
  };
  const m = citesteOverpass(raspuns);
  egal("citește doar ce e bun", m.length, 3);

  const doina = m.find((x) => x.nume === "Magazin Mixt Doina")!;
  ok("are locul", doina.lat === 47.65 && doina.lng === 26.25);
  egal("traduce felul în românește", doina.fel, "alimentară");
  egal("lipește strada și numărul", doina.adresa, "Strada Principală 12");
  egal("ia localitatea", doina.localitate, "Șiret");
  egal("aduce telefonul la forma din România", doina.telefon, "0231555111");
  egal("ține identificatorul OSM", doina.osmId, "node/1");

  const profi = m.find((x) => x.nume === "Profi")!;
  ok("clădirea primește centrul ei", profi.lat === 47.7 && profi.lng === 26.3, JSON.stringify(profi));
  egal("clădirea are id de way", profi.osmId, "way/2");

  egal("barul e bar", m.find((x) => x.nume === "Bar La Colț")!.fel, "bar");
  ok("Parisul n-a intrat", !m.some((x) => x.nume === "Paris Shop"));
  ok("0,0 n-a intrat", !m.some((x) => x.nume === "Nicăieri"));
}

// ACELAȘI MAGAZIN, pus și ca punct și ca clădire — pe hartă trebuie să
// apară o dată, altfel agentul crede că sunt două magazine.
{
  const m = citesteOverpass({
    elements: [
      { type: "node", id: 10, lat: 47.6412, lon: 26.2503, tags: { name: "Profi", shop: "supermarket" } },
      { type: "way", id: 11, center: { lat: 47.64121, lon: 26.25031 }, tags: { name: "Profi", shop: "supermarket" } },
      // alt Profi, în alt sat — ăsta rămâne
      { type: "node", id: 12, lat: 47.9, lon: 26.5, tags: { name: "Profi", shop: "supermarket" } },
    ],
  });
  egal("dublura din același loc dispare, cea din alt sat rămâne", m.length, 2);
}

// Răspunsuri stricate: serviciul e public, poate răspunde orice.
egal("răspuns gol", citesteOverpass({}).length, 0);
egal("null", citesteOverpass(null).length, 0);
egal("text în loc de JSON", citesteOverpass("<html>error</html>").length, 0);
egal("elements nu e listă", citesteOverpass({ elements: "nu" }).length, 0);
egal("element fără tags", citesteOverpass({ elements: [{ type: "node", id: 1, lat: 47, lon: 26 }] }).length, 0);
egal(
  "lat ca text nu strică",
  citesteOverpass({
    elements: [{ type: "node", id: 1, lat: "47.6", lon: "26.2", tags: { name: "X", shop: "kiosk" } }],
  }).length,
  1,
);
egal(
  "lat aiurea (text) se sare",
  citesteOverpass({
    elements: [{ type: "node", id: 1, lat: "abc", lon: "26.2", tags: { name: "X", shop: "kiosk" } }],
  }).length,
  0,
);

console.log("\n── TELEFONUL ──");
{
  const tel = (t: string) =>
    citesteOverpass({
      elements: [{ type: "node", id: 1, lat: 47.6, lon: 26.2, tags: { name: "X", shop: "kiosk", phone: t } }],
    })[0]?.telefon;
  egal("+40 → 0", tel("+40 741 234 567"), "0741234567");
  egal("0040 → 0", tel("0040741234567"), "0741234567");
  egal("deja 0", tel("0741 234 567"), "0741234567");
  egal("număr din altă țară se aruncă", tel("+33 1 23 45 67 89"), "");
  egal("gol rămâne gol", tel(""), "");
  egal("gunoi rămâne gol", tel("sună la magazin"), "");
}

console.log("\n── POTRIVIREA CU FIRMELE ──");
// Aceeași unealtă ca la harta lui Bogdan. Aici verificăm că datele din OSM
// intră corect în ea: numele curat, felul locului ca descriere.
{
  const magazine = citesteOverpass({
    elements: [
      { type: "node", id: 1, lat: 47.65, lon: 26.25, tags: { name: "ALIMENTARA DOINA", shop: "convenience" } },
      { type: "node", id: 2, lat: 47.7, lon: 26.3, tags: { name: "Chioșcul lui Gigi", shop: "kiosk" } },
    ],
  });
  const firme = [
    { cui: "111", denumire: "ALIMENTARA DOINA SRL", localitate: "Șiret" },
    { cui: "222", denumire: "PANIFICATIE MOLDOVA SA", localitate: "Suceava" },
  ];
  const p = potriveștePuncte(
    magazine.map((m) => ({
      nume: m.nume,
      descriere: `${m.fel} ${m.adresa} ${m.localitate}`.trim(),
      lat: m.lat,
      lng: m.lng,
    })),
    firme,
    0.7,
  );
  const doina = p.find((x) => x.punct.nume === "ALIMENTARA DOINA")!;
  egal("firma cunoscută primește locul", doina.client?.cui, "111");
  ok("și e sigur, nu ghicit", doina.scor >= 0.9, String(doina.scor));

  const gigi = p.find((x) => x.punct.nume === "Chioșcul lui Gigi")!;
  egal("magazinul necunoscut rămâne de prospectat", gigi.client, null);
}

// Felul locului („alimentară", „bar") nu trebuie să lege două magazine
// între ele doar pentru că amândouă sunt alimentare.
{
  const p = potriveștePuncte(
    [
      { nume: "La Vale", descriere: "alimentară", lat: 47.6, lng: 26.2 },
      { nume: "La Deal", descriere: "alimentară", lat: 47.7, lng: 26.3 },
    ],
    [{ cui: "999", denumire: "ALIMENTARA SRL", localitate: "Suceava" }],
    0.7,
  );
  ok(
    "felul locului nu creează potriviri false",
    p.every((x) => x.client === null || x.scor < 0.9),
    JSON.stringify(p.map((x) => [x.punct.nume, x.client?.denumire, x.scor])),
  );
}

console.log(`\n${caderi === 0 ? "✅" : "❌"} ${treceri} verificări trecute, ${caderi} căzute\n`);
process.exit(caderi === 0 ? 0 : 1);
