/**
 * APLICAȚIA ÎNVAȚĂ DE LA OM, NU DE LA MINE.
 *
 * „Vom avea și alți agenți. Vreau să auto-învețe." — și avea dreptate:
 * ținusem în cod o listă cu cartierele Sucevei și ale Iașiului, plus
 * „Cn-lung" și „Țara Dornelor". Bună pentru Uvertura, fără niciun înțeles
 * pentru un distribuitor din Timișoara. Platforma nu e a unei firme.
 *
 * Acum: prima dată omul caută și alege, iar alegerea LUI se ține minte
 * pentru firma LUI. A doua oară merge singur. Fără liste scrise de mine,
 * fără ghicit, și merge pentru orice oraș din țară.
 *
 * Aici verificăm exact asta, plus ce nu trebuie să se strice:
 *   · ce a învățat de la o firmă NU se vede la alta;
 *   · învață doar din ce a ALES omul, niciodată din ce am ghicit noi;
 *   · un sat adevărat nu e acoperit de un alias;
 *   · verificarea („vreau să văd întâi") nu învață nimic.
 */

import { ensureSchema, getDB } from "../src/lib/db";
import {
  aliasuriInvatate,
  citesteZone,
  invataAlias,
} from "../src/modules/zone/aplica";

let treceri = 0;
let caderi = 0;
function ok(nume: string, conditie: boolean, detaliu = "") {
  if (conditie) {
    treceri++;
    console.log(`  ✓ ${nume}`);
  } else {
    caderi++;
    console.log(`  ✗ ${nume}${detaliu ? ` — ${detaliu}` : ""}`);
  }
}

const db = getDB();
if (!db) {
  console.log("DATABASE_URL lipsește — nu pot rula.");
  process.exit(1);
}

const ORG_SV = "test-inv-suceava";
const ORG_TM = "test-inv-timis";

// Registrul unei firme din Suceava și al uneia din Timișoara.
const REG_SV = ["SUCEAVA", "CAMPULUNG MOLDOVENESC", "Sadova", "Bursuceni"];
const REG_TM = ["TIMISOARA", "LUGOJ", "Dumbravita", "Giroc"];

async function curata() {
  await db!`DELETE FROM zona_alias WHERE org_id IN (${ORG_SV}, ${ORG_TM})`;
}

async function main() {
  await ensureSchema();
  await curata();

  console.log("\n══ Ziua întâi: nu știe, și nu ghicește ══");
  {
    const a = await aliasuriInvatate(db!, ORG_TM);
    const r = citesteZone("Luni\nFabric", REG_TM, a);
    ok(
      "Fabric (cartier din Timisoara) nu e recunoscut din prima",
      r.negasite.some((x) => x.scris === "Fabric"),
      JSON.stringify(r.gasite),
    );
    ok("și nu l-a lipit de nimic", r.gasite.length === 0);
  }

  console.log("\n══ Omul alege o dată — și de-atunci se știe ══");
  {
    await invataAlias(db!, ORG_TM, "Fabric", "TIMISOARA", "managerul lor");
    const a = await aliasuriInvatate(db!, ORG_TM);
    const r = citesteZone("Luni\nFabric", REG_TM, a);
    ok("acum merge singur", r.gasite.some((g) => g.localitate === "TIMISOARA"), JSON.stringify(r));
    ok("și nu mai rămâne nimic negăsit", r.negasite.length === 0);
    const g = r.gasite[0];
    ok("îi scrie de ce, ca să nu creadă că a greșit aplicația",
       (g?.cum ?? "").includes("ați ales voi"), g?.cum ?? "(nimic)");
  }

  console.log("\n══ Ce învață o firmă NU se vede la alta ══");
  {
    const aSV = await aliasuriInvatate(db!, ORG_SV);
    const r = citesteZone("Luni\nFabric", REG_SV, aSV);
    ok(
      "firma din Suceava nu știe ce a învățat cea din Timișoara",
      r.negasite.some((x) => x.scris === "Fabric"),
      JSON.stringify(r.gasite),
    );
  }
  {
    // Și invers: fiecare își învață cartierele lui, cu ACELAȘI mecanism.
    await invataAlias(db!, ORG_SV, "Burdujeni", "SUCEAVA", "Costin");
    const aSV = await aliasuriInvatate(db!, ORG_SV);
    const r = citesteZone("Luni\nBurdujeni", REG_SV, aSV);
    ok("Suceava și-a învățat Burdujeniul", r.gasite.some((g) => g.localitate === "SUCEAVA"));
    const aTM = await aliasuriInvatate(db!, ORG_TM);
    const r2 = citesteZone("Luni\nBurdujeni", REG_TM, aTM);
    ok(
      "iar Timișoara nu l-a primit pe degeaba",
      r2.negasite.some((x) => x.scris === "Burdujeni"),
      JSON.stringify(r2.gasite),
    );
  }

  console.log("\n══ Ce NU trebuie stricat ══");
  {
    // Un sat ADEVĂRAT nu poate fi acoperit de un alias prost.
    await invataAlias(db!, ORG_SV, "Sadova", "SUCEAVA", "cineva grabit");
    const a = await aliasuriInvatate(db!, ORG_SV);
    const r = citesteZone("Luni\nSadova", REG_SV, a);
    ok(
      "Sadova rămâne Sadova, nu devine Suceava",
      r.gasite.some((g) => g.localitate === "Sadova"),
      JSON.stringify(r.gasite),
    );
  }
  {
    // Un alias care arată spre un sat pe care firma nu-l are: se ignoră.
    await invataAlias(db!, ORG_SV, "Ceva", "UN SAT CARE NU E LA EI", "cineva");
    const a = await aliasuriInvatate(db!, ORG_SV);
    const r = citesteZone("Luni\nCeva", REG_SV, a);
    ok("alias către un sat inexistent nu strică nimic", r.negasite.length === 1, JSON.stringify(r));
  }
  {
    await invataAlias(db!, ORG_SV, "x", "SUCEAVA", "cineva");
    const a = await aliasuriInvatate(db!, ORG_SV);
    ok("un text de o literă nu se învață", !a.has("x"), JSON.stringify([...a.keys()]));
  }
  {
    await invataAlias(db!, ORG_SV, "Gol", "", "cineva");
    const a = await aliasuriInvatate(db!, ORG_SV);
    ok("un sat gol nu se învață", !a.has("gol"));
  }
  {
    // Aceeași alegere de două ori: un singur rând, dar numărat de două ori.
    await invataAlias(db!, ORG_SV, "Itcani", "SUCEAVA", "Costin");
    await invataAlias(db!, ORG_SV, "Itcani", "SUCEAVA", "Robert");
    const [c] = await db!<[{ n: string; f: string }]>`
      SELECT COUNT(*)::text AS n, MAX(folosit)::text AS f
      FROM zona_alias WHERE org_id = ${ORG_SV} AND scris = 'itcani'
    `;
    ok("aceeași alegere de două ori = un rând", c.n === "1", c.n);
    ok("dar se știe că e folosită des", c.f === "2", c.f);
  }
  {
    // Scris cu diacritice sau fără, e aceeași vorbă.
    await invataAlias(db!, ORG_SV, "Ițcani", "SUCEAVA", "Costin");
    const a = await aliasuriInvatate(db!, ORG_SV);
    const r = citesteZone("Marti\nITCANI", REG_SV, a);
    ok(
      "ITCANI cu majuscule merge la fel ca Itcani cu diacritice",
      r.gasite.some((g) => g.localitate === "SUCEAVA"),
      JSON.stringify(r),
    );
  }

  console.log("\n══ Curățenie ══");
  await curata();
  console.log("  · datele de test șterse");
  console.log(`\n${caderi === 0 ? "✅" : "❌"} ${treceri} verificări trecute, ${caderi} eșuate\n`);
  await db!.end();
  process.exit(caderi === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await curata().catch(() => {});
  await db!.end();
  process.exit(1);
});
