/**
 * MII DE TEXTE, CUM LE SCRIU OAMENII — fuzz pe citirea zonelor.
 *
 * Zonele vin scrise de mână, pe WhatsApp, de cinci oameni diferiți, în
 * mașină, cu tastatura de telefon. Nu există „formatul corect": unii pun
 * virgule, alții nu; unii scriu „marţi" cu ţ de Word, alții „Marti";
 * cineva uită o virgulă și lipește două sate; altcineva scrie „vf.
 * câmpului" sau „com. Lozna". Din textul ăsta iese ruta pe care omul
 * chiar merge — deci nu are voie nici să crape, nici să GHICEASCĂ.
 *
 * Suita generează mii de variante și verifică, pe FIECARE, reguli care
 * trebuie să țină întotdeauna:
 *   1. nu aruncă niciodată (orice mizerie ar primi);
 *   2. nu inventează sate: tot ce întoarce e din registrul real;
 *   3. ziua e mereu una validă (sau goală), niciodată gunoi;
 *   4. nu dublează același sat în aceeași zi;
 *   5. e determinist: același text de două ori → același rezultat;
 *   6. satul scris ca în registru (oricum ar fi scris cu majuscule sau
 *      diacritice) e găsit ÎNTOTDEAUNA;
 *   7. ordinea în care le-a scris omul se păstrează — aia e ordinea
 *      drumului;
 *   8. un sat care nu există în registru nu devine niciodată „găsit".
 *
 * Rulare:
 *   npx tsx scripts/test-zona-fuzz.ts
 *   ROTUNDE=20000 npx tsx scripts/test-zona-fuzz.ts   (și mai adânc)
 */
import { ZILE, neted, parseZone, potriveste } from "../src/modules/zone/parse";
import { citesteZone } from "../src/modules/zone/aplica";

const ROTUNDE = Math.max(200, parseInt(process.env.ROTUNDE ?? "6000", 10) || 6000);

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

/* ───────── generator determinist (fără Math.random: se poate reface) ───────── */

let samanta = 20260826;
/** Număr pseudo-aleator repetabil — dacă pică, rulezi iar și pică la fel. */
function rnd(n: number): number {
  samanta = (samanta * 1103515245 + 12345) & 0x7fffffff;
  return samanta % n;
}
const alege = <T>(a: readonly T[]): T => a[rnd(a.length)];

/** Satele REALE, exact cum arată în registrul MF (cu diacritice, majuscule). */
const REGISTRU = [
  "VIRFUL CAMPULUI", "LOZNA", "DERSCA", "STRATENI", "ȘENDRICENI", "DOROHOI",
  "BROSCĂUȚI", "CĂRĂUȘA", "PĂDURENI", "HUDEȘTI", "ALBA", "NĂRĂNCA",
  "DARABANI", "PĂLTINIȘ", "UNGURENI", "SĂVENI", "PODRIGA", "HORIA",
  "AVRĂMENI", "ROMA", "NICȘENI", "GORBĂNEȘTI", "STĂUCENI", "MIHĂILENI",
  "RĂDĂUȚI", "SUCEAVA", "FĂLTICENI", "GURA HUMORULUI", "VICOVU DE SUS",
  "POIANA STAMPEI", "CÂMPULUNG MOLDOVENESC", "VATRA DORNEI", "SIRET",
];

/** Cum scrie omul un sat: cu/fără diacritice, mic/mare, cu prescurtări. */
function scrieSat(oficial: string): string {
  const v = rnd(6);
  if (v === 0) return oficial; // exact
  if (v === 1) return oficial.toLowerCase();
  if (v === 2) return neted(oficial); // fără diacritice, litere mici
  if (v === 3) {
    // Prima literă mare la fiecare cuvânt („Poiana Stampei").
    return neted(oficial)
      .split(" ")
      .map((c) => c.charAt(0).toUpperCase() + c.slice(1))
      .join(" ");
  }
  if (v === 4 && oficial.startsWith("VIRFUL ")) {
    return "vf. " + neted(oficial.slice(7));
  }
  return alege(["", "com. ", "sat ", "COM."])+ neted(oficial);
}

/** Cum scrie omul ziua: „Marți:", „marti -", „MIERCURI", „joi". */
function scrieZi(zi: string): string {
  const v = rnd(5);
  const baza =
    zi === "marti" && rnd(2) === 0
      ? alege(["marți", "marţi", "Marți"])
      : zi === "sambata"
        ? alege(["sâmbătă", "sambata", "simbata"])
        : zi;
  if (v === 0) return baza.toUpperCase();
  if (v === 1) return baza.charAt(0).toUpperCase() + baza.slice(1);
  return baza;
}

/** Separatorul dintre zi și sate: „-", ":", „ - ", nimic. */
const SEP = [" - ", "- ", ": ", ":", " ", " – ", "-"] as const;
/** Separatorul dintre sate: virgulă cu/fără spațiu, punct-virgulă, slash. */
const SEP_SAT = [", ", ",", " , ", "; ", " / ", ",  "] as const;

interface Caz {
  text: string;
  /** Ce am scris, pe zile, în ordinea scrisă. */
  asteptat: Array<{ zi: string; sate: string[] }>;
}

/** Un mesaj de WhatsApp verosimil, cu 1-6 zile și 1-8 sate pe zi. */
function genereazaCaz(): Caz {
  const cateZile = 1 + rnd(6);
  const zileFolosite = new Set<string>();
  const randuri: string[] = [];
  const asteptat: Array<{ zi: string; sate: string[] }> = [];
  for (let i = 0; i < cateZile; i++) {
    const zi = alege(ZILE);
    if (zileFolosite.has(zi)) continue;
    zileFolosite.add(zi);
    const cate = 1 + rnd(8);
    const sate: string[] = [];
    const scrise: string[] = [];
    const vazute = new Set<string>();
    for (let j = 0; j < cate; j++) {
      const s = alege(REGISTRU);
      if (vazute.has(s)) continue;
      vazute.add(s);
      sate.push(s);
      scrise.push(scrieSat(s));
    }
    randuri.push(scrieZi(zi) + alege(SEP) + scrise.join(alege(SEP_SAT)));
    asteptat.push({ zi, sate });
  }
  // Uneori omul lasă rânduri goale sau spații la coadă.
  const text = randuri
    .map((r) => (rnd(4) === 0 ? r + " " : r))
    .join(rnd(5) === 0 ? "\n\n" : "\n");
  return { text, asteptat };
}

/** Mizerie curată: text care NU trebuie să producă sate, dar nici să crape. */
function genereazaGunoi(): string {
  const bucati = [
    "", "   ", "\n\n\n", "!!!", "?!?", "123456", "😀😀", "null", "undefined",
    "<script>alert(1)</script>", "'; DROP TABLE agent_zone; --",
    "%s%s%s", "\\x00\\x01", "a".repeat(300), "—–-", ",,,,,,", ";;;;",
    "luni", "marti:", "joi - ", "  vineri  ", "\t\t", "0/0/0",
    "Bună dimineața!", "ok", "da", "??", "/////", "http://exemplu.ro",
  ];
  const n = 1 + rnd(4);
  return Array.from({ length: n }, () => alege(bucati)).join(alege(["\n", " ", ","]));
}

/* ────────────────────────── rulare ────────────────────────── */

function main() {
  console.log(`\nFUZZ PE ZONE — ${ROTUNDE} texte generate (sămânță 20260826)`);

  sectiune(`Mesaje verosimile de WhatsApp (${ROTUNDE} bucăți)`);
  let aruncat = 0;
  let inventat = 0;
  let ziGunoi = 0;
  let dublate = 0;
  let nedeterminist = 0;
  let ordineStricata = 0;
  let pierdute = 0;
  let totalSate = 0;
  let totalGasite = 0;
  const exemple: string[] = [];

  for (let i = 0; i < ROTUNDE; i++) {
    const caz = genereazaCaz();
    let r1;
    try {
      r1 = citesteZone(caz.text, REGISTRU);
    } catch (e) {
      aruncat++;
      if (exemple.length < 3) exemple.push(`ARUNCĂ: ${(e as Error).message} pe «${caz.text.slice(0, 60)}»`);
      continue;
    }
    // 5. determinist
    const r2 = citesteZone(caz.text, REGISTRU);
    if (JSON.stringify(r1) !== JSON.stringify(r2)) nedeterminist++;

    const vazute = new Set<string>();
    for (const g of r1.gasite) {
      // 2. nu inventează
      if (!REGISTRU.includes(g.localitate)) {
        inventat++;
        if (exemple.length < 3) exemple.push(`INVENTAT: «${g.localitate}» din «${caz.text.slice(0, 60)}»`);
      }
      // 3. ziua e validă
      if (g.zi !== "" && !(ZILE as readonly string[]).includes(g.zi)) ziGunoi++;
      // 4. fără dubluri pe aceeași zi
      const cheie = `${g.zi}|${g.localitate}`;
      if (vazute.has(cheie)) dublate++;
      vazute.add(cheie);
    }

    // 6 + 7: ce am scris trebuie regăsit, în ordinea scrisă
    for (const a of caz.asteptat) {
      totalSate += a.sate.length;
      const aleZilei = r1.gasite.filter((g) => g.zi === a.zi).map((g) => g.localitate);
      totalGasite += aleZilei.filter((x) => a.sate.includes(x)).length;
      for (const s of a.sate) {
        if (!aleZilei.includes(s)) {
          pierdute++;
          if (exemple.length < 3) {
            exemple.push(`PIERDUT: «${s}» din «${caz.text.slice(0, 70)}» → ${aleZilei.join(",")}`);
          }
          break;
        }
      }
      // Ordinea: satele scrise apar în aceeași ordine relativă.
      const doarAleMele = aleZilei.filter((x) => a.sate.includes(x));
      const asteptata = a.sate.filter((x) => doarAleMele.includes(x));
      if (doarAleMele.join("|") !== asteptata.join("|")) {
        ordineStricata++;
        if (exemple.length < 3) {
          exemple.push(`ORDINE: ${doarAleMele.join(",")} vs ${asteptata.join(",")}`);
        }
      }
    }
  }

  check("nu aruncă niciodată, pe niciun text", aruncat === 0, `${aruncat} din ${ROTUNDE}`);
  check("nu inventează sate din afara registrului", inventat === 0, `${inventat} cazuri`);
  check("ziua e mereu una validă", ziGunoi === 0, `${ziGunoi} cazuri`);
  check("nu dublează același sat în aceeași zi", dublate === 0, `${dublate} cazuri`);
  check("același text dă mereu același rezultat", nedeterminist === 0, `${nedeterminist} cazuri`);
  check("nu pierde sate scrise ca în registru", pierdute === 0, `${pierdute} cazuri`);
  check("păstrează ordinea scrisă (ordinea drumului)", ordineStricata === 0, `${ordineStricata} cazuri`);
  check(
    "recunoaște aproape tot ce scrie omul",
    totalSate > 0 && totalGasite / totalSate > 0.97,
    `${totalGasite}/${totalSate} (${((totalGasite / Math.max(1, totalSate)) * 100).toFixed(1)}%)`,
  );
  if (exemple.length) console.log("\n  Exemple:\n" + exemple.map((e) => "   · " + e).join("\n"));

  sectiune(`Mizerie curată — nu trebuie să crape (${Math.floor(ROTUNDE / 2)} bucăți)`);
  let gunoiCrapat = 0;
  let gunoiInventat = 0;
  for (let i = 0; i < Math.floor(ROTUNDE / 2); i++) {
    const t = genereazaGunoi();
    try {
      const r = citesteZone(t, REGISTRU);
      for (const g of r.gasite) {
        if (!REGISTRU.includes(g.localitate)) gunoiInventat++;
      }
    } catch {
      gunoiCrapat++;
    }
  }
  check("textul-gunoi nu dărâmă citirea", gunoiCrapat === 0, `${gunoiCrapat} crăpături`);
  check("din gunoi nu ies sate inventate", gunoiInventat === 0, `${gunoiInventat} cazuri`);

  sectiune("Sate care NU există: raportate, niciodată ghicite");
  let ghicit = 0;
  let netaportat = 0;
  const INVENTATE = [
    "SATUL LUI PESTE", "ZZZQQQ", "MAGAZINUL MEU", "COMUNA INEXISTENTA",
    "BUCURESTIULNOSTRU", "ALFA BETA GAMA", "1234", "X Y Z",
  ];
  for (let i = 0; i < 400; i++) {
    const fals = alege(INVENTATE) + (rnd(2) ? ` ${i}` : "");
    const zi = alege(ZILE);
    const r = citesteZone(`${zi} - ${fals}`, REGISTRU);
    if (r.gasite.length > 0) {
      ghicit++;
      if (ghicit <= 2) console.log(`   · ghicit: «${fals}» → ${r.gasite.map((g) => g.localitate).join(",")}`);
    }
    if (r.negasite.length === 0 && r.gasite.length === 0) netaportat++;
  }
  check("nu ghicește niciodată un sat inexistent", ghicit === 0, `${ghicit} din 400`);
  check("…și îl raportează, nu-l înghite în tăcere", netaportat === 0, `${netaportat} tăcute`);

  sectiune("Virgula uitată: două sate lipite se desfac");
  let desfacute = 0;
  let ratate = 0;
  for (let i = 0; i < 300; i++) {
    const a = alege(REGISTRU);
    const b = alege(REGISTRU);
    if (a === b) continue;
    // Sărim perechile care ar putea forma un nume real de localitate.
    if (REGISTRU.some((x) => neted(x) === `${neted(a)} ${neted(b)}`)) continue;
    const zi = alege(ZILE);
    const r = citesteZone(`${zi} - ${scrieSat(a)} ${scrieSat(b)}`, REGISTRU);
    const nume = r.gasite.map((g) => g.localitate);
    if (nume.includes(a) && nume.includes(b)) desfacute++;
    else ratate++;
  }
  check(
    "«Sendriceni Dorohoi» devine două sate, nu unul",
    desfacute > 0 && desfacute / Math.max(1, desfacute + ratate) > 0.8,
    `${desfacute} desfăcute, ${ratate} ratate`,
  );

  sectiune("Numele cu două cuvinte NU se rupe degeaba");
  let rupte = 0;
  const DOUA_CUVINTE = REGISTRU.filter((x) => x.includes(" "));
  for (const s of DOUA_CUVINTE) {
    for (const varianta of [s, s.toLowerCase(), neted(s)]) {
      const r = citesteZone(`luni - ${varianta}`, REGISTRU);
      if (r.gasite.length !== 1 || r.gasite[0].localitate !== s) {
        rupte++;
        console.log(`   · rupt: «${varianta}» → ${r.gasite.map((g) => g.localitate).join(",")}`);
      }
    }
  }
  check("«Gura Humorului» rămâne un singur sat", rupte === 0, `${rupte} rupte`);

  sectiune("Fiecare zi scrisă în toate felurile e recunoscută");
  let ziRatata = 0;
  for (const zi of ZILE) {
    for (let i = 0; i < 40; i++) {
      const sat = alege(REGISTRU);
      const r = citesteZone(`${scrieZi(zi)}${alege(SEP)}${scrieSat(sat)}`, REGISTRU);
      if (!r.gasite.some((g) => g.zi === zi)) {
        ziRatata++;
        if (ziRatata <= 3) console.log(`   · zi ratată: «${scrieZi(zi)}» pentru ${zi}`);
      }
    }
  }
  check("orice fel de a scrie ziua e înțeles", ziRatata === 0, `${ziRatata} din ${ZILE.length * 40}`);

  sectiune("Scris stricat de tastatură: sugestii, nu ghicit");
  // Greșeli reale de telefon: litere inversate, una lipsă, una în plus.
  const TYPO: Array<[string, string]> = [
    ["doorhoi", "DOROHOI"],
    ["brocsauti", "BROSCĂUȚI"],
    ["padurni", "PĂDURENI"],
    ["hudesit", "HUDEȘTI"],
    ["daraabni", "DARABANI"],
    ["savenii", "SĂVENI"],
    ["nicsen", "NICȘENI"],
    ["gorbanest", "GORBĂNEȘTI"],
  ];
  let faraSugestie = 0;
  let ghicitDinTypo = 0;
  for (const [gresit, corect] of TYPO) {
    const r = citesteZone(`luni - ${gresit}`, REGISTRU);
    // Nu are voie să-l ACCEPTE tăcut: ori îl găsește pentru că e doar
    // prescurtat, ori îl raportează cu sugestia bună.
    const sugerat = r.negasite[0]?.sugestii ?? [];
    const gasit = r.gasite.map((g) => g.localitate);
    if (gasit.length > 0 && !gasit.includes(corect)) {
      ghicitDinTypo++;
      console.log(`   · ghicit greșit: «${gresit}» → ${gasit.join(",")}`);
    }
    if (gasit.length === 0 && !sugerat.includes(corect)) {
      faraSugestie++;
      console.log(`   · fără sugestie bună: «${gresit}» → ${sugerat.join(",") || "nimic"}`);
    }
  }
  check("greșeala de tastatură primește sugestia bună", faraSugestie === 0, `${faraSugestie} din ${TYPO.length}`);
  check("…și nu e acceptată tăcut ca alt sat", ghicitDinTypo === 0, `${ghicitDinTypo} cazuri`);

  let sugestiiDinGunoi = 0;
  for (const g of ["zzzqqqwww", "1234567890", "aaaaaaaaaa", "xyzxyzxyz"]) {
    const r = citesteZone(`luni - ${g}`, REGISTRU);
    if ((r.negasite[0]?.sugestii ?? []).length > 0) {
      sugestiiDinGunoi++;
      console.log(`   · sugestie din gunoi: «${g}» → ${r.negasite[0].sugestii.join(",")}`);
    }
  }
  check("din gunoi curat NU inventează sugestii", sugestiiDinGunoi === 0, `${sugestiiDinGunoi} cazuri`);

  sectiune("Prefixe administrative: sat / comuna / municipiul");
  let prefixRatat = 0;
  for (const s of REGISTRU) {
    for (const pre of ["sat ", "com. ", "comuna ", "mun. ", "municipiul ", "oras ", "ORS. "]) {
      const r = citesteZone(`luni - ${pre}${neted(s)}`, REGISTRU);
      if (!r.gasite.some((g) => g.localitate === s)) {
        prefixRatat++;
        if (prefixRatat <= 3) console.log(`   · ratat: «${pre}${neted(s)}» → ${r.gasite.map((g) => g.localitate).join(",")}`);
      }
    }
  }
  check("prefixele administrative nu încurcă potrivirea", prefixRatat === 0,
    `${prefixRatat} din ${REGISTRU.length * 7}`);

  sectiune("Sate cu nume care SEMĂNĂ cu o zi nu se pierd");
  let ziFalsa = 0;
  for (const fals of ["MARTINESTI", "LUNCANI", "JOITA", "VINERIA", "SAMBATENI", "DUMINICENI"]) {
    const reg = [...REGISTRU, fals];
    const r = citesteZone(`luni - ${fals}, ${REGISTRU[0]}`, reg);
    if (!r.gasite.some((g) => g.localitate === fals)) {
      ziFalsa++;
      console.log(`   · pierdut ca zi: «${fals}» → ${r.gasite.map((g) => g.localitate).join(",")}`);
    }
  }
  check("«MARTINESTI» rămâne sat, nu devine marți", ziFalsa === 0, `${ziFalsa} pierdute`);

  sectiune("Mesaje URIAȘE (cineva lipește toată luna)");
  const urias = Array.from({ length: 400 }, () => {
    const c = genereazaCaz();
    return c.text;
  }).join("\n");
  const t0 = Date.now();
  let uriasOk = true;
  try {
    const r = citesteZone(urias.slice(0, 20_000), REGISTRU);
    uriasOk = r.gasite.every((g) => REGISTRU.includes(g.localitate));
  } catch {
    uriasOk = false;
  }
  const dt = Date.now() - t0;
  check("un mesaj de 20.000 de caractere nu blochează nimic", uriasOk, "a crăpat");
  check("…și se citește repede (sub 2 secunde)", dt < 2000, `${dt}ms`);

  sectiune("Potrivirea unui sat, luată separat");
  let potrivireGresita = 0;
  for (const s of REGISTRU) {
    for (const varianta of [s, s.toLowerCase(), neted(s), ` ${s} `]) {
      const p = potriveste(varianta, REGISTRU);
      if (p.oficial !== s && !(p.parti ?? []).includes(s)) {
        potrivireGresita++;
        if (potrivireGresita <= 3) console.log(`   · «${varianta}» → ${p.oficial}`);
      }
    }
  }
  check("orice sat din registru se regăsește pe sine", potrivireGresita === 0, `${potrivireGresita} greșite`);

  sectiune("Rânduri fără zi (zonă fără program) — tot valabile");
  const faraZi = citesteZone(REGISTRU.slice(0, 4).join(", "), REGISTRU);
  check("satele fără zi se citesc", faraZi.gasite.length === 4, `${faraZi.gasite.length}`);
  check("…cu ziua goală, nu inventată", faraZi.gasite.every((g) => g.zi === ""));
  const doarZi = parseZone("luni\nmarti\njoi");
  check("zilele singure pe rând nu devin sate", doarZi.length === 0, `${doarZi.length} rânduri`);

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  console.log(
    `   (${ROTUNDE} mesaje verosimile + ${Math.floor(ROTUNDE / 2)} texte-gunoi + ~1.500 cazuri țintite)`,
  );
  if (fail) {
    console.log("\nCe nu merge:");
    rele.forEach((r) => console.log("  · " + r));
  }
  process.exit(fail === 0 ? 0 : 1);
}

main();
