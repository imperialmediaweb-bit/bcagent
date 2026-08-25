/**
 * ZONELE AGENȚILOR, citite din text de om (mesajul lui Bogdan de pe
 * WhatsApp). Verificăm exact ce trimite el, cu toate ciudățeniile:
 * fără diacritice, cu virgule lipsă, cu ziua scrisă în trei feluri,
 * cu sate din două cuvinte, cu spații în plus.
 *
 * Rulare: npx tsx scripts/test-zone-parse.ts   (fără server, fără DB)
 */
import { parseZone, potriveste, ziDinText, neted } from "../src/modules/zone/parse";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}
function sectiune(t: string) {
  console.log(`\n══ ${t} ══`);
}

sectiune("Ziua, scrisă cum îi vine omului");
check("„luni”", ziDinText("luni") === "luni");
check("„Marți” cu diacritice", ziDinText("Marți") === "marti");
check("„MIERCURI” cu majuscule", ziDinText("MIERCURI") === "miercuri");
check("„sambata” fără diacritice", ziDinText("sambata") === "sambata");
check("„sâmbătă”", ziDinText("sâmbătă") === "sambata");
check("un sat NU e zi", ziDinText("Dorohoi") === null);

sectiune("Mesajul REAL al lui Bogdan (zonele lui Costin)");
const mesajBogdan = `luni -vf câmpului,Lozna,dersca,Strateni,Sendriceni Dorohoi
marți- Dorohoi,Broscauti,Carasa ,padureni,
Miercuri -hudesti,alba,naranca,darabani,Păltiniș
joi-ungureni,saveni,Podriga,horia,avrameni,
vineri-roma,nicseni,ungureni ,Gorbănești ,stauceni`;
const z = parseZone(mesajBogdan);
check("s-au citit toate zilele", new Set(z.map((x) => x.zi)).size === 5, JSON.stringify([...new Set(z.map((x) => x.zi))]));
check("luni are 5 intrări", z.filter((x) => x.zi === "luni").length === 5, String(z.filter((x) => x.zi === "luni").length));
check(
  "primul sat de luni e «vf câmpului»",
  neted(z.find((x) => x.zi === "luni")?.localitate ?? "") === "vf campului",
  z.find((x) => x.zi === "luni")?.localitate,
);
check(
  "«Sendriceni Dorohoi» rămâne întreg (nu-l tăiem la spațiu)",
  z.some((x) => neted(x.localitate) === "sendriceni dorohoi"),
  JSON.stringify(z.filter((x) => x.zi === "luni").map((x) => x.localitate)),
);
check("virgulele goale nu produc rânduri goale", z.every((x) => x.localitate.trim().length >= 2));
check("spațiile din jur sunt curățate", z.every((x) => x.localitate === x.localitate.trim()));
check(
  "vineri are Gorbănești cu diacritice păstrate",
  z.some((x) => x.zi === "vineri" && x.localitate.includes("Gorbănești")),
);
check("total 24 de intrări (5+4+5+5+5)", z.length === 24, String(z.length));
check(
  "«ungureni» apare și joi și vineri (același sat, două zile)",
  z.filter((x) => neted(x.localitate) === "ungureni").length === 2,
);

sectiune("Alte feluri de a scrie");
const cuDouaPuncte = parseZone("Marți: Suceava; Rădăuți / Siret");
check("merge și cu «:» și cu «;» și cu «/»", cuDouaPuncte.length === 3, JSON.stringify(cuDouaPuncte));
check("ziua se aplică la toate de pe rând", cuDouaPuncte.every((x) => x.zi === "marti"));
const faraZi = parseZone("Botoșani, Dorohoi\nDarabani");
check("fără zi scrisă, zona rămâne fără zi", faraZi.every((x) => x.zi === ""), JSON.stringify(faraZi));
check("dar localitățile se citesc", faraZi.length === 3);
const ziPeRandulEi = parseZone("luni\nVatra Dornei, Cosna\nmarti\nGura Humorului");
check("ziua singură pe rând se aplică rândurilor următoare", ziPeRandulEi.filter((x) => x.zi === "luni").length === 2, JSON.stringify(ziPeRandulEi));
check("iar a doua zi schimbă ce urmează", ziPeRandulEi.filter((x) => x.zi === "marti").length === 1);
check("cuvântul-zi nu ajunge localitate", !ziPeRandulEi.some((x) => neted(x.localitate) === "luni"));
const dubluri = parseZone("luni: Siret, siret, SIRET");
check("același sat scris de 3 ori intră o dată", dubluri.length === 1, JSON.stringify(dubluri));
check("text gol nu crapă", parseZone("").length === 0);
check("text aiurea nu crapă", parseZone("...,,,;;;").length === 0);

sectiune("Potrivirea cu satele REALE din registru");
const cunoscute = [
  "VIRFUL CAMPULUI",
  "LOZNA",
  "DERSCA",
  "ȘENDRICENI",
  "DOROHOI",
  "VATRA DORNEI",
  "POIANA STAMPEI",
  "GORBĂNEȘTI",
  "SUCEAVA",
];
check("scris fără diacritice, găsește satul cu diacritice", potriveste("gorbanesti", cunoscute).oficial === "GORBĂNEȘTI");
check("prescurtarea «vf» → «virful»", potriveste("vf câmpului", cunoscute).oficial === "VIRFUL CAMPULUI");
check("potrivire exactă", potriveste("Lozna", cunoscute).oficial === "LOZNA");
check("cu prefixul «SAT» în față", potriveste("sat Dersca", cunoscute).oficial === "DERSCA");
check("sat din două cuvinte", potriveste("poiana stampei", cunoscute).oficial === "POIANA STAMPEI");
const negasit = potriveste("Cluj Napoca", cunoscute);
check("un sat inexistent NU se potrivește din greșeală", negasit.oficial === null, String(negasit.oficial));
check("…dar nu inventează sugestii aiurea", negasit.sugestii.length === 0, JSON.stringify(negasit.sugestii));
const ambiguu = potriveste("do", ["DOROHOI", "DORNA CANDRENILOR"]);
check("când sunt mai multe potriviri, cere lămurire (nu ghicește)", ambiguu.oficial === null && ambiguu.sugestii.length === 2, JSON.stringify(ambiguu));

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
process.exit(fail === 0 ? 0 : 1);
