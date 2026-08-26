/**
 * DICTAREA CARE NU SE BÂLBÂIE — probe pe note ADEVĂRATE din teren.
 *
 * Notele lui Robert Volanschi, 26.08.2026, așa cum s-au salvat:
 *   „rău rău platnic"
 *   „nu nu vrea nu vrea țigări"
 *   „lucrează lucrează cu lucrează cu producătorii"
 *   „lucrează lucrează la lucrează la facturare lucrează la facturare cu…"
 *   „Shop Jetta plus Shop Jetta plus Shop Shop Jetta plus Shop todalex…"
 *
 * Aici jucăm exact ce trimite Chrome pe Android și verificăm că iese ce a
 * spus omul, o singură dată. Fiecare probă e o notă care CHIAR a ieșit
 * stricată — dacă vreuna cade, agentul iar scrie păsărește.
 */

import { ceEnou, cuvinte, felCuvant, textulSesiunii } from "../src/lib/dictare";

let treceri = 0;
let caderi = 0;
function ok(nume: string, conditie: boolean, detaliu = "") {
  if (conditie) {
    treceri++;
  } else {
    caderi++;
    console.log(`  ✗ ${nume}${detaliu ? `\n      ${detaliu}` : ""}`);
  }
}
function egal(nume: string, primit: string, asteptat: string) {
  ok(nume, primit === asteptat, `primit:   „${primit}"\n      așteptat: „${asteptat}"`);
}

/**
 * Joacă o sesiune de dictare așa cum o trimite browserul și întoarce nota
 * cum ar arăta pe ecranul agentului.
 *
 * `evenimente` = ce conține `results` la fiecare `onresult`; fiecare
 * bucată e o transcriere marcată FINALĂ.
 */
function nota(evenimente: string[][]): string {
  let trimis: string[] = [];
  let scris = "";
  for (const ev of evenimente) {
    const { nou, trimisAcum } = ceEnou(trimis, textulSesiunii(ev));
    trimis = trimisAcum;
    if (nou) scris = scris ? `${scris} ${nou}` : nou;
  }
  return scris;
}

console.log("\n── NOTELE CARE AU IEȘIT STRICATE ÎN TEREN ──");

// „rău rău platnic" — Chrome a dat „rău", apoi a revizuit în „rău platnic".
egal(
  "rau platnic",
  nota([["rău"], ["rău", "rău platnic"]]),
  "rău platnic",
);

// „nu nu vrea nu vrea țigări" — trei revizuiri ale aceleiași vorbe.
egal(
  "nu vrea tigari",
  nota([["nu"], ["nu", "nu vrea"], ["nu", "nu vrea", "nu vrea țigări"]]),
  "nu vrea țigări",
);

// „lucrează lucrează cu lucrează cu producătorii"
egal(
  "lucreaza cu producatorii",
  nota([
    ["lucrează"],
    ["lucrează", "lucrează cu"],
    ["lucrează", "lucrează cu", "lucrează cu producătorii"],
  ]),
  "lucrează cu producătorii",
);

// „lucrează lucrează la lucrează la facturare lucrează la facturare cu…"
egal(
  "lucreaza la facturare cu producatorii",
  nota([
    ["lucrează"],
    ["lucrează", "lucrează la"],
    ["lucrează", "lucrează la", "lucrează la facturare"],
    [
      "lucrează",
      "lucrează la",
      "lucrează la facturare",
      "lucrează la facturare cu producătorii",
    ],
  ]),
  "lucrează la facturare cu producătorii",
);

// „Shop Jetta plus Shop Jetta plus Shop Shop Jetta plus Shop todalex șopeta"
egal(
  "Shop Jetta plus, apoi alt magazin",
  nota([
    ["Shop"],
    ["Shop", "Shop Jetta"],
    ["Shop", "Shop Jetta", "Shop Jetta plus"],
    ["Shop", "Shop Jetta", "Shop Jetta plus", "todalex șopeta"],
  ]),
  "Shop Jetta plus todalex șopeta",
);

// „shopping shopping interbrands"
egal(
  "shopping interbrands",
  nota([["shopping"], ["shopping", "shopping interbrands"]]),
  "shopping interbrands",
);

console.log("\n── CAZURILE CARE TREBUIE SĂ MEARGĂ MAI DEPARTE ──");

// Omul CHIAR repetă un cuvânt. Nu-i corectăm vorba — o scriem cum a zis-o.
egal(
  "repetitia adevarata a omului ramane",
  nota([["nu nu vrea"]]),
  "nu nu vrea",
);
egal(
  "doua propozitii diferite raman amandoua",
  nota([["nu vrea țigări"], ["nu vrea țigări", "vine marțea viitoare"]]),
  "nu vrea țigări vine marțea viitoare",
);
egal(
  "o singura bucata, o singura data",
  nota([["rău platnic"]]),
  "rău platnic",
);
egal("nimic dictat, nimic scris", nota([[]]), "");
egal("bucata goala se sare", nota([["", "  ", "bună ziua"]]), "bună ziua");

// Chrome trimite ACELAȘI eveniment de două ori (se întâmplă des).
egal(
  "acelasi eveniment de doua ori nu scrie de doua ori",
  nota([["rău platnic"], ["rău platnic"], ["rău platnic"]]),
  "rău platnic",
);

// Repornirea automată: browserul închide sesiunea, o redeschidem, iar
// indexurile o iau de la zero. Ce era scris rămâne, ce vine se adaugă.
{
  let trimis: string[] = [];
  let scris = "";
  const pas = (ev: string[]) => {
    const { nou, trimisAcum } = ceEnou(trimis, textulSesiunii(ev));
    trimis = trimisAcum;
    if (nou) scris = scris ? `${scris} ${nou}` : nou;
  };
  pas(["nu vrea"]);
  pas(["nu vrea", "nu vrea țigări"]);
  trimis = []; // ← repornire: browserul o ia de la capăt
  pas(["dar vrea bere"]);
  egal("dupa repornire, textul continua, nu se repeta", scris, "nu vrea țigări dar vrea bere");
}

console.log("\n── DIACRITICELE ──");
// Telefonul scrie „țigări" într-o clipă și „tigari" în alta. E aceeași
// vorbă, deci NU se scrie de două ori. Ce era deja în notă rămâne cum a
// intrat: nota se completează, nu se rescrie — dacă am rescrie-o, i-am
// șterge agentului de sub deget ce corectase el cu mâna. Rămâne prima
// scriere, dar niciodată amândouă.
egal(
  "aceeasi vorba, cu si fara diacritice, nu se dubleaza",
  nota([["nu vrea tigari"], ["nu vrea tigari", "nu vrea țigări acum"]]),
  "nu vrea tigari acum",
);
egal(
  "semnele de punctuatie nu fac vorba noua",
  nota([["bună ziua"], ["bună ziua", "Bună ziua!"]]),
  "bună ziua",
);
// Iar dacă agentul nu-i place cum a ieșit, scrie peste, cu mâna — de-aia
// căsuța rămâne o căsuță de scris, nu un ecran care se schimbă singur.
ok("felCuvant taie diacriticele", felCuvant("Țigări,") === "tigari", felCuvant("Țigări,"));
ok("felCuvant taie semnele", felCuvant("plus!") === "plus");
ok("cuvinte nu lasa goluri", cuvinte("  a   b  ").length === 2);

console.log("\n── LUCRURI CARE NU TREBUIE SĂ CRAPE ──");
egal("text gol", nota([[""]]), "");
egal("doar spatii", nota([["   "]]), "");
ok("lista goala de evenimente", nota([]) === "");
ok("textulSesiunii pe gol", textulSesiunii([]).length === 0);
ok(
  "ceEnou nu da nimic cand nu e nimic nou",
  ceEnou(["a", "b"], ["a", "b"]).nou === "",
);
ok(
  "ceEnou nu da nimic cand textul s-a scurtat",
  ceEnou(["a", "b", "c"], ["a"]).nou === "",
);

// O notă lungă, dictată în bucăți — cum vorbește agentul de fapt.
{
  const ev: string[][] = [];
  const bucati = [
    "clientul zice că",
    "clientul zice că nu mai are loc",
    "clientul zice că nu mai are loc în raft",
  ];
  for (let i = 0; i < bucati.length; i++) ev.push(bucati.slice(0, i + 1));
  ev.push([...bucati, "revin joi cu marfă"]);
  egal(
    "o nota lunga, dictata pe bucati, iese intreaga si curata",
    nota(ev),
    "clientul zice că nu mai are loc în raft revin joi cu marfă",
  );
}

console.log(`\n${caderi === 0 ? "✅" : "❌"} ${treceri} verificări trecute, ${caderi} căzute\n`);
process.exit(caderi === 0 ? 0 : 1);
