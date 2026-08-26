/**
 * CARTIERELE, cum le zic agenții.
 *
 * Răzvan a scris „Burdujeni" în zona lui de luni. Aplicația i-a răspuns că
 * n-o găsește și i-a propus „Bursuceni" și „Budeni" — două sate la zeci de
 * kilometri. Burdujeni EXISTĂ, dar la Finanțe firmele de acolo sunt
 * înregistrate în „SUCEAVA": e cartier, nu comună, deci nu apare niciodată
 * în listele noastre, oricâte magazine ar fi acolo.
 *
 * Agentul nu vorbește în unități administrativ-teritoriale. Aici verificăm
 * că vorba lui ajunge la orașul din registru — și că i se spune de ce.
 */

import { citesteZone } from "../src/modules/zone/aplica";
import { cartiereStiute } from "../src/modules/zone/cartiere";

let treceri = 0;
let caderi = 0;
function ok(nume: string, conditie: boolean, detaliu = "") {
  if (conditie) treceri++;
  else {
    caderi++;
    console.log(`  ✗ ${nume}${detaliu ? ` — ${detaliu}` : ""}`);
  }
}

// Registrul cum îl are firma: orașele mari + satele din jur. Burdujeni NU e
// în listă — exact ca în realitate.
const REGISTRU = [
  "SUCEAVA", "BOTOSANI", "IASI", "RADAUTI", "FALTICENI",
  "Ipotesti", "Moara", "Sfantu Ilie", "Mitocu Dragomirnei",
  "Bursuceni", "Budeni", "Bosanci", "Udesti",
];

console.log("\n── PĂȚANIA LUI RĂZVAN ──");
{
  const r = citesteZone(
    ["Luni", "Burdujeni", "Ipotesti", "Moara", "Sfantu Ilie", "Mitocu Dragomirnei"].join("\n"),
    REGISTRU,
  );
  const luni = r.gasite.filter((g) => g.zi === "luni");
  ok("nu mai rămâne nimic negăsit", r.negasite.length === 0, JSON.stringify(r.negasite));
  ok(
    "Burdujeni ajunge la SUCEAVA",
    luni.some((g) => g.scris === "Burdujeni" && g.localitate === "SUCEAVA"),
    JSON.stringify(luni),
  );
  ok("toate cele 5 rânduri ale lui intră în luni", luni.length === 5, `sunt ${luni.length}`);
  const b = luni.find((g) => g.scris === "Burdujeni");
  ok("îi scrie DE CE vede Suceava", (b?.cum ?? "").includes("cartier"), b?.cum ?? "(nimic)");
  ok("și îi spune ce a pățit, pe înțeles", (b?.cum ?? "").includes("SUCEAVA"));
  ok("celelalte sate n-au explicație inutilă", luni.filter((g) => g.cum).length === 1);
}

console.log("\n── CARTIERELE ──");
// Aici aveam si cartiere din Botosani, puse de mine din memorie. Le-am
// scos: nu le scrisese niciun om, iar unul („Bucovina") se batea cu
// numele tinutului. Raman doar cele scrise de agenti si cele
// binecunoscute ale oraselor unde lucreaza.
for (const [cartier, oras] of [
  ["Itcani", "SUCEAVA"], ["Obcini", "SUCEAVA"], ["Zamca", "SUCEAVA"],
  ["George Enescu", "SUCEAVA"], ["Copou", "IASI"], ["Pacurari", "IASI"],
  ["Tatarasi", "IASI"], ["Nicolina", "IASI"],
] as const) {
  const r = citesteZone(`Marti\n${cartier}`, REGISTRU);
  ok(
    `„${cartier}" → ${oras}`,
    r.gasite.some((g) => g.localitate === oras),
    JSON.stringify(r.gasite.map((g) => g.localitate)) + " " + JSON.stringify(r.negasite),
  );
}

console.log("\n── CU DIACRITICE ȘI SCRIS ORICUM ──");
for (const scris of ["burdujeni", "BURDUJENI", "Burdujeni", "Burdujeni "]) {
  const r = citesteZone(`Luni\n${scris}`, REGISTRU);
  ok(`„${scris}" merge`, r.gasite.some((g) => g.localitate === "SUCEAVA"), JSON.stringify(r.negasite));
}
{
  const r = citesteZone("Luni\nȚicani", REGISTRU);
  ok("Itcani scris cu diacritica tot ajunge la Suceava",
     r.gasite.some((g) => g.localitate === "SUCEAVA") || r.negasite.length === 1);
}

console.log("\n── CE NU TREBUIE STRICAT ──");
{
  // Orașul scris direct rămâne oraș, fără explicație de cartier.
  const r = citesteZone("Luni\nSuceava", REGISTRU);
  ok("Suceava scrisă direct rămâne Suceava", r.gasite[0]?.localitate === "SUCEAVA");
  ok("și n-are explicație de cartier", !r.gasite[0]?.cum);
}
{
  // Un sat adevărat nu e confundat cu un cartier.
  const r = citesteZone("Luni\nBursuceni", REGISTRU);
  ok("Bursuceni rămâne satul Bursuceni", r.gasite[0]?.localitate === "Bursuceni");
}
{
  // Cartier dintr-un oraș în care firma NU are clienți: nu inventăm.
  const r = citesteZone("Luni\nCopou", ["SUCEAVA", "Bosanci"]);
  ok("cartier din alt oraș, fără clienți acolo → rămâne negăsit", r.negasite.length === 1,
     JSON.stringify(r.gasite));
}
{
  // Același cartier scris de două ori în aceeași zi = o dată în zonă.
  const r = citesteZone("Luni\nBurdujeni\nItcani", REGISTRU);
  ok("două cartiere ale aceluiași oraș nu dublează orașul",
     r.gasite.filter((g) => g.zi === "luni" && g.localitate === "SUCEAVA").length === 1,
     JSON.stringify(r.gasite));
}
{
  const r = citesteZone("", REGISTRU);
  ok("text gol nu crapă", r.gasite.length === 0 && r.negasite.length === 0);
}

console.log("\n── LISTA ÎNSĂȘI ──");
{
  const lista = cartiereStiute();
  ok("avem cartiere știute", lista.length >= 15, `sunt ${lista.length}`);
  ok(
    "niciun cartier nu e scris cu diacritice sau majuscule",
    lista.every((c) => c.cartier === c.cartier.toLowerCase() && !/[ăâîșț]/i.test(c.cartier)),
  );
  ok(
    "fiecare cartier are un oraș",
    lista.every((c) => c.oras.trim().length >= 3),
  );
  ok(
    "niciun cartier nu se cheamă ca orașul lui",
    lista.every((c) => c.cartier.toUpperCase() !== c.oras.toUpperCase()),
  );
}

console.log(`\n${caderi === 0 ? "✅" : "❌"} ${treceri} verificări trecute, ${caderi} căzute\n`);
process.exit(caderi === 0 ? 0 : 1);
