/**
 * ALEGI O DATĂ, INTRĂ ÎN TOATE ZILELE.
 *
 * Textul real al unui agent (27.08): „Catamarasti" scris gol și luni,
 * și joi. La ei există și Cătămărăști-Deal, și Cătămărăști-Vale, deci
 * aplicația întreabă — corect. Dar omul a ales o dată Deal, iar joi a
 * rămas tot fără sat: alegerea se lipea de o singură zi, și nedumerirea
 * apărea de două ori pe ecran, identică.
 *
 * Acum: aceeași vorbă negăsită se arată O DATĂ, cu zilele ei pe ea, iar
 * răspunsul omului se întinde pe toate zilele unde a scris-o.
 */

import { citesteZone, zileleAlegerii } from "../src/modules/zone/aplica";

let treceri = 0;
const caderi: string[] = [];
function ok(nume: string, conditie: boolean, detaliu = "") {
  if (conditie) {
    treceri++;
    console.log(`  ✓ ${nume}`);
  } else {
    caderi.push(nume);
    console.log(`  ✗ ${nume}${detaliu ? ` — ${detaliu}` : ""}`);
  }
}

// Satele lor, cu ambele Cătămărăști — de-aia „Catamarasti" gol întreabă.
const CUNOSCUTE = [
  "CATAMARASTI-DEAL", "CATAMARASTI-VALE M.EMINESCU",
  "Brehuiesti", "Corni", "Sarafinesti", "Icuseni", "Vorona", "ONEAGA",
  "Cosula", "COPALAU", "Flămânzi", "RAUSENI", "CERNEŞTI", "Iuresti",
  "Zlatunoaia", "LUNCA", "Jijia", "Todireni", "Calarasi", "Santa Mare",
  "Ilişeni", "Stefanesti", "Botoşani", "Stînceşti", "Ionaseni",
  "Tudor Vladimirescu", "Dîngeni", "Hăneşti", "Unţeni",
];

// Textul agentului, cuvânt cu cuvânt.
const TEXT = `Luni
Catamarasti
Brehuiesti
Corni
Sarafinesti
Icuseni
Vorona
Oneaga
Cosula
Copalau
Flamanzi

Marți
Rauseni
Cernesti
Iuresti
Zlatunoaia
Lunca

Miercuri
Jijia
Todireni
Călărași
Santa mare
Iliseni
Stefanesti
Botosani
Stancesti


Joi
Catamarasti
Ionaseni (albesti)
Tudor Vladimirescu
Dangeni
Hanesti
Unteni
Botosani


Vineri
Botosani
Oneaga
Flamanzi`;

function main() {
  console.log("\n══ Textul lui, citit ══");
  const { gasite, negasite } = citesteZone(TEXT, CUNOSCUTE);
  ok(
    "Catamarasti gol întreabă (există și Deal, și Vale — nu ghicim)",
    negasite.some((n) => n.scris.toLowerCase().startsWith("catamarasti")),
    JSON.stringify(negasite.map((n) => n.scris)),
  );
  const cat = negasite.filter((n) =>
    n.scris.toLowerCase().startsWith("catamarasti"),
  );
  ok(
    "dar nedumerirea apare O DATĂ, nu de două ori",
    cat.length === 1,
    `apare de ${cat.length} ori`,
  );
  ok(
    "și își știe zilele: luni și joi",
    cat[0]?.zile.includes("luni") === true && cat[0]?.zile.includes("joi") === true,
    JSON.stringify(cat[0]?.zile),
  );
  ok(
    "restul satelor au intrat: luni 10 rânduri → 9 găsite",
    gasite.filter((g) => g.zi === "luni").length === 9,
    `luni: ${gasite.filter((g) => g.zi === "luni").length}`,
  );
  ok(
    "Ionaseni (albesti) — paranteza nu-l strică",
    gasite.some((g) => g.zi === "joi" && g.localitate === "Ionaseni"),
  );

  console.log("\n══ Omul alege o dată Cătămărăști-Deal ══");
  const zile = zileleAlegerii(negasite, "Catamarasti", "luni");
  ok(
    "alegerea se întinde pe AMBELE zile",
    zile.includes("luni") && zile.includes("joi"),
    JSON.stringify(zile),
  );
  ok("nu și pe alte zile", zile.length === 2, JSON.stringify(zile));

  console.log("\n══ Ce nu trebuie stricat ══");
  {
    // O vorbă negăsită dintr-o singură zi: rămâne pe ziua ei.
    const r = citesteZone("marti - Satul Inexistent", CUNOSCUTE);
    const z = zileleAlegerii(r.negasite, "Satul Inexistent", "marti");
    ok("vorba dintr-o singură zi rămâne pe ziua ei", z.length === 1 && z[0] === "marti", JSON.stringify(z));
    // Alegere pentru ceva ce nu-i în negăsite: cade pe ziua din ecran.
    const z2 = zileleAlegerii(r.negasite, "Altceva", "vineri");
    ok("necunoscutul cade pe ziua din ecran, nu crapă", z2.length === 1 && z2[0] === "vineri");
    // Scris diferit (diacritice) tot se potrivește.
    const z3 = zileleAlegerii(negasite, "cătămărăsti", "luni");
    ok("cu diacritice se potrivește la fel", z3.includes("joi"), JSON.stringify(z3));
  }

  console.log(
    `\n${caderi.length === 0 ? "✅" : "❌"} ${treceri} verificări trecute, ${caderi.length} eșuate\n`,
  );
  process.exit(caderi.length === 0 ? 0 : 1);
}

main();
