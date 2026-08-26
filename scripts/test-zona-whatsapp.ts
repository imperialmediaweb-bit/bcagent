/**
 * TEXTUL AGENTULUI, EXACT CUM VINE DE PE WHATSAPP.
 *
 * 26.08.2026, ora 18:04. Un agent și-a trimis zonele. Aplicația i-a
 * răspuns că nu găsește 11 localități — dar 8 dintre ele erau locuri
 * adevărate, iar 3 erau gunoi copiat odată cu conversația. Nu omul a
 * scris prost: eu n-am știut să citesc.
 *
 * Ce nu mergea, punct cu punct:
 *   · „[18:04" și „26.08.2026] +40 749 714 955: LUNI" — antetul de
 *     WhatsApp. Ora are virgulă în ea, iar virgula desparte localitățile,
 *     deci rândul se rupea în bucăți fără înțeles;
 *   · „Pârteștii de Sus" — registrul îl are „Pîrteştii de Sus". Reforma
 *     ortografică din 1993: î și â sunt aceeași literă, dar noi le
 *     făceam diferite, și satul se pierdea;
 *   · „Cn-lung" — Câmpulung Moldovenesc, prescurtat;
 *   · „Țara Dornelor (toate locațiile)" — un ținut, nu un sat;
 *   · „Completare vineri" — titlu, nu localitate;
 *   · „Centru" — cartier, lămurit de celelalte cartiere din aceeași zi;
 *   · „Tarnița", „Palma", „Poieni Solca" — sate adevărate în care doar
 *     că n-avem încă nicio firmă.
 *
 * Aici rulăm textul lui întreg, cuvânt cu cuvânt, cum l-a scris.
 */

import { citesteZone } from "../src/modules/zone/aplica";
import { faraAntetWhatsApp, faraParanteze, neted, parseZone } from "../src/modules/zone/parse";

let treceri = 0;
let caderi = 0;
function ok(nume: string, conditie: boolean, detaliu = "") {
  if (conditie) treceri++;
  else {
    caderi++;
    console.log(`  ✗ ${nume}${detaliu ? ` — ${detaliu}` : ""}`);
  }
}

/** Mesajul, copiat din conversație — cu tot cu ora și numărul lui. */
const TEXT = [
  "[18:04, 26.08.2026] +40 749 714 955: LUNI",
  "",
  "Sadova",
  "Pojorâta ",
  "Fundu Moldovei ",
  "Breaza",
  "Izvoarele Sucevei ",
  "",
  "MARȚI ",
  "",
  "Mestecăniș ",
  "Ciocănești ",
  "Botuș ",
  "Cârlibaba",
  "Țara Dornelor (toate locațiile)",
  "",
  "MIERCURI",
  "",
  "Păltinoasa ",
  "Gura Humorului ",
  "Mănăstirea Humorului",
  "Voroneț ",
  "Frasin",
  "Stulpicani",
  "Ostra",
  "Tarnița",
  "",
  "Joi",
  "",
  "Vama",
  "Cn-lung ",
  "Frumosu",
  "Moldovița ",
  "Palma",
  "Sucevița ",
  "",
  "Vineri",
  "",
  "Zaharesti",
  "Stroiești ",
  "Humoreni",
  "Pârteștii de Sus",
  "Pârteștii de Jos",
  "Solca",
  "Poieni Solca ",
  "Ilișești",
  "[18:05, 26.08.2026] +40 749 714 955: Completare vineri",
  "",
  "Obcini",
  "George Enescu ",
  "Centru",
  "Ițcani",
].join("\n");

/** Registrul, aproape ca al lor: cu î unde-l are Finanțele. */
const REGISTRU = [
  "SUCEAVA", "CAMPULUNG MOLDOVENESC", "GURA HUMORULUI", "SOLCA",
  "VATRA DORNEI", "DORNA CANDRENILOR", "DORNA ARINI", "POIANA STAMPEI",
  "SARU DORNEI", "PANACI", "COSNA", "IACOBENI",
  "Sadova", "Pojorata", "Fundu Moldovei", "Breaza", "Izvoarele Sucevei",
  "Mestecanis", "Ciocanesti", "Botus", "Carlibaba",
  "Paltinoasa", "Manastirea Humorului", "Voronet", "Frasin", "Stulpicani",
  "Ostra", "Tarnita",
  "Vama", "Frumosu", "Moldovita", "Palma", "Sucevita",
  "Zaharesti", "Stroiesti", "Humoreni",
  // Fix cum îl are registrul: cu Î, nu cu Â.
  "Pîrteştii de Sus", "Pîrteştii de Jos",
  "Poieni-Solca", "Ilisesti",
];

console.log("\n── ANTETUL DE WHATSAPP ──");
ok(
  "ora, data si numarul se taie",
  faraAntetWhatsApp("[18:04, 26.08.2026] +40 749 714 955: LUNI") === "LUNI",
  faraAntetWhatsApp("[18:04, 26.08.2026] +40 749 714 955: LUNI"),
);
ok(
  "si forma scurta",
  faraAntetWhatsApp("[18:05] Bogdan: Sadova") === "Sadova",
  faraAntetWhatsApp("[18:05] Bogdan: Sadova"),
);
ok(
  "si cea cu liniuta",
  faraAntetWhatsApp("18:04 - B carausu: Vama") === "Vama",
  faraAntetWhatsApp("18:04 - B carausu: Vama"),
);
ok(
  "un rand normal nu se atinge",
  faraAntetWhatsApp("Fundu Moldovei") === "Fundu Moldovei",
  faraAntetWhatsApp("Fundu Moldovei"),
);
ok(
  "un sat cu doua puncte in nume nu se taie",
  faraAntetWhatsApp("Vf. Campului") === "Vf. Campului",
  faraAntetWhatsApp("Vf. Campului"),
);

console.log("\n── Î ȘI Â SUNT ACEEAȘI LITERĂ ──");
ok("Parteştii = Pîrteştii", neted("Pârteștii de Sus") === neted("Pîrteştii de Sus"));
ok("Campulung = Cimpulung", neted("Câmpulung") === neted("Cîmpulung"));
ok("Carlibaba = Cîrlibaba", neted("Cârlibaba") === neted("Cîrlibaba"));

console.log("\n── PARANTEZELE ──");
{
  const r = faraParanteze("Țara Dornelor (toate locațiile)");
  ok("satul ramane curat", r.curat === "Țara Dornelor", r.curat);
  ok("dar stim ce a scris in paranteza", r.nota === "toate locațiile", r.nota);
  // Aceeasi lamurire, scrisa cu linie — cum a scris-o a doua oara.
  const r2 = faraParanteze("Țara Dornelor – toate locațiile");
  ok("merge si cu linie, nu doar cu paranteza", r2.curat === "Țara Dornelor", r2.curat);
  const r3 = faraParanteze("Solca - toate");
  ok("si forma scurta", r3.curat === "Solca", r3.curat);
  // Dar un sat cu linie in nume NU se taie.
  const r4 = faraParanteze("Poieni-Solca");
  ok("un sat cu liniuta in nume ramane intreg", r4.curat === "Poieni-Solca", r4.curat);
}

console.log("\n── TEXTUL ÎNTREG AL AGENTULUI ──");
const linii = parseZone(TEXT);
ok(
  "antetul NU mai intra ca localitate",
  !linii.some((l) => /^\[?\d{1,2}[:.]\d{2}/.test(l.localitate) || l.localitate.includes("749")),
  JSON.stringify(linii.filter((l) => l.localitate.includes("749") || /\d{2}[:.]\d{2}/.test(l.localitate))),
);
ok(
  "Completare vineri nu e localitate",
  !linii.some((l) => /completare/i.test(l.localitate)),
  JSON.stringify(linii.filter((l) => /completare/i.test(l.localitate))),
);
ok(
  "prima zi e luni, si Sadova e in ea",
  linii.some((l) => l.zi === "luni" && l.localitate === "Sadova"),
  JSON.stringify(linii.slice(0, 4)),
);
for (const [loc, zi] of [
  ["Cârlibaba", "marti"],
  ["Ostra", "miercuri"],
  ["Vama", "joi"],
  ["Solca", "vineri"],
] as const) {
  ok(`${loc} e in ziua lui (${zi})`, linii.some((l) => l.zi === zi && l.localitate === loc));
}
for (const c of ["Obcini", "George Enescu", "Centru", "Ițcani"]) {
  ok(
    `„${c}" din completare ajunge tot la VINERI`,
    linii.some((l) => l.zi === "vineri" && l.localitate === c),
    JSON.stringify(linii.filter((l) => l.localitate === c)),
  );
}

console.log("\n── CE SE POTRIVEȘTE, DE FAPT ──");
const r = citesteZone(TEXT, REGISTRU);
const negasite = r.negasite.map((n) => n.scris);
console.log(`  (ramase negasite: ${negasite.length ? negasite.join(" · ") : "niciuna"})`);

const areZi = (zi: string, loc: string) =>
  r.gasite.some((g) => g.zi === zi && neted(g.localitate) === neted(loc));

ok("Pârteștii de Sus se leaga de Pîrteştii din registru", areZi("vineri", "Pîrteştii de Sus"));
ok("Cn-lung devine Campulung Moldovenesc", areZi("joi", "CAMPULUNG MOLDOVENESC"));
ok("Tarnita se gaseste (sat fara nicio firma la noi)", areZi("miercuri", "Tarnita"));
ok("Palma se gaseste", areZi("joi", "Palma"));
ok("Poieni Solca se gaseste", areZi("vineri", "Poieni-Solca"));
ok("Obcini duce la Suceava", areZi("vineri", "SUCEAVA"));
ok(
  "Centru NU mai ramane pe dinafara (e lamurit de celelalte cartiere)",
  !negasite.includes("Centru"),
  JSON.stringify(negasite),
);
{
  // ȚINUTURILE NU LE GHICIM. As putea pune satele din jurul Vetrei
  // Dornei pe o raza oarecare — dar raza aia ar fi scoasa din burta, iar
  // un sat bagat gresit in ziua unui agent inseamna un drum degeaba si o
  // cifra falsa in raport. Ii spunem ce e si-l rugam sa scrie satele.
  const z = r.negasite.find((x) => x.scris.startsWith("Țara Dornelor"));
  ok("Tara Dornelor e semnalata ca ZONA, nu ca sat scris gresit", z?.zona === true, JSON.stringify(z));
  ok("si nu-i propunem sate asemanatoare, ca n-ar avea sens", (z?.sugestii ?? []).length === 0);
  ok(
    "nu am inventat niciun sat pentru ea",
    !r.gasite.some((g) => g.scris.startsWith("Țara Dornelor")),
    JSON.stringify(r.gasite.filter((g) => g.scris.startsWith("Țara Dornelor"))),
  );
}
ok(
  "in afara de zona, nu mai ramane nimic negasit",
  negasite.filter((x) => !x.startsWith("Țara Dornelor")).length === 0,
  negasite.join(" · "),
);

console.log("\n── CE NU TREBUIE STRICAT ──");
{
  // Un sat care se cheamă chiar ca o zi nu se pierde.
  const z = citesteZone("Luni\nLunca\nJoita", ["Lunca", "Joita"]);
  ok("Lunca si Joita raman sate", z.gasite.length === 2, JSON.stringify(z.gasite.map((g) => g.localitate)));
}
{
  // „Centru" singur, fără alte cartiere în zi: NU ghicim.
  const z = citesteZone("Luni\nCentru", ["SUCEAVA", "Sadova"]);
  ok("Centru singur ramane nelamurit, nu-l ghicim", z.negasite.some((n) => n.scris === "Centru"),
     JSON.stringify(z.gasite));
}
{
  const z = citesteZone("", REGISTRU);
  ok("text gol nu crapa", z.gasite.length === 0 && z.negasite.length === 0);
}
{
  const z = citesteZone("[18:04, 26.08.2026] +40 749 714 955: ", REGISTRU);
  ok("doar antet, fara nimic altceva", z.gasite.length === 0 && z.negasite.length === 0,
     JSON.stringify(z));
}

console.log(`\n${caderi === 0 ? "✅" : "❌"} ${treceri} verificări trecute, ${caderi} căzute\n`);
process.exit(caderi === 0 ? 0 : 1);
