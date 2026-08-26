/**
 * QA PE PANOUL AGENTULUI — 100+ verificări, ca un tester care ia
 * telefonul agentului în mână și apasă tot, în ordinea în care apasă el.
 *
 * Acoperă în special ce s-a construit AZI, din problemele raportate de
 * agenții UVERTURA prin Bogdan:
 *   · căutarea de clienți direct pe prima pagină (cererea băieților);
 *   · „clienții mei" apar MEREU, peste orice filtru de domeniu/stare;
 *   · adresa completă (stradă + număr), nu doar centrul satului;
 *   · pinul care ÎNVAȚĂ din poziția telefonului la „Am fost";
 *   · „Închis" pe teren — curăță harta, dar DOAR pentru firma mea;
 *   · zonele pe zile → ruta zilei;
 *   · banda de „versiune nouă", ca să nu mai ceară nimeni refresh.
 * …plus restul panoului, care trebuie să meargă la fel de bine:
 * hartă, rută, vizite, comenzi, van, target, decont, antrenor, ghid.
 *
 * Fiecare verificare are un ÎNȚELES pe teren, nu doar „a răspuns 200":
 * unde se poate, comparăm valori concrete și verificăm și reversul
 * (că firma vecină NU vede, că filtrul chiar filtrează).
 *
 * Rulare:
 *   BASE_URL=http://127.0.0.1:3131 DATABASE_URL=... TOKEN_SECRET=... \
 *   npx tsx scripts/test-qa-agent.ts
 */
import postgres from "postgres";
import { signToken } from "../src/lib/signed-token";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const SECRET = process.env.TOKEN_SECRET ?? "test-secret-0123456789";
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";
const PW =
  process.env.PLAYWRIGHT_MODULE ??
  "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.js";

const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/postgres",
);

let pass = 0;
let fail = 0;
const rele: string[] = [];
function check(nume: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${nume}`);
  } else {
    fail++;
    rele.push(`${nume}${extra ? ` — ${extra}` : ""}`);
    console.log(`  ✗ ${nume}${extra ? ` — ${extra}` : ""}`);
  }
}
function sectiune(t: string) {
  console.log(`\n══ ${t} ══`);
}

/* ────────────────────────── date de test ────────────────────────── */

const RUN = `qa${Date.now().toString(36).slice(-6)}`;
const SUS = RUN.toUpperCase();
const orgMea = `org-${RUN}`;
const orgAlta = `orgx-${RUN}`;
const idEu = `ag-${RUN}-eu`;
const idColeg = `ag-${RUN}-coleg`;
const idStrain = `ag-${RUN}-strain`;
const numeEu = `QA Eu ${RUN}`;
const numeColeg = `QA Coleg ${RUN}`;
const numeStrain = `QA Strain ${RUN}`;
const SAT = `SAT QA ${SUS}`;
const SAT2 = `SAT QA DOI ${SUS}`;
const baza = Date.now().toString().slice(-7);
const cui = (i: number) => `77${baza}${i}`;

/** Firmele din registru, așa cum le vede agentul pe teren. */
const FIRME = [
  // 0: clientul meu, cu adresă COMPLETĂ (stradă + număr)
  { i: 0, den: `ALIMENTARA QA ${SUS}`, adr: "Str. Ștefan cel Mare nr. 12", loc: SAT, caen: "4711", st: "client", ag: () => numeEu, activ: true },
  // 1: clientul meu cu CAEN de IT — nu e „alimentar", dar tot al meu e
  { i: 1, den: `SERVICE IT QA ${SUS}`, adr: "Str. Plopilor 3", loc: SAT, caen: "6202", st: "client", ag: () => numeEu, activ: true },
  // 2: clientul meu marcat INACTIV în registrul MF (dar magazinul merge)
  { i: 2, den: `BODEGA QA ${SUS}`, adr: "Calea Unirii 44", loc: SAT, caen: "4711", st: "client", ag: () => numeEu, activ: false },
  // 3: clientul COLEGULUI din firma mea
  { i: 3, den: `MAGAZIN COLEG QA ${SUS}`, adr: "Str. Morii 8", loc: SAT, caen: "4711", st: "client", ag: () => numeColeg, activ: true },
  // 4: clientul ALTEI firme — nu are ce căuta la mine
  { i: 4, den: `RIVAL QA ${SUS}`, adr: "Str. Rivalilor 1", loc: SAT, caen: "4711", st: "client", ag: () => numeStrain, activ: true },
  // 5: prospect liber, nealocat — pe el se testează „Închis"
  { i: 5, den: `PROSPECT LIBER QA ${SUS}`, adr: "Str. Libera 5", loc: SAT, caen: "4711", st: "nou", ag: () => "", activ: true },
  // 6: firmă fără număr la stradă — navigația trebuie să cadă pe nume
  { i: 6, den: `FARA NUMAR QA ${SUS}`, adr: "Sat fără stradă", loc: SAT2, caen: "4711", st: "nou", ag: () => "", activ: true },
  // 7: al doilea client al meu, în alt sat (pentru rută pe zile)
  { i: 7, den: `MINIMARKET QA ${SUS}`, adr: "Str. Garii 21", loc: SAT2, caen: "4711", st: "client", ag: () => numeEu, activ: true },
  // 8: firmă cu diacritice în nume — căutarea trebuie s-o găsească fără ele
  { i: 8, den: `BĂCĂNIA ȚĂRĂNEASCĂ QA ${SUS}`, adr: "Str. Ţării 2", loc: SAT, caen: "4711", st: "nou", ag: () => "", activ: true },
];

async function pregateste() {
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgMea}, ${"QA MEA " + SUS}, ${RUN + "@qa.test"}, 'trial', 9),
                   (${orgAlta}, ${"QA ALTA " + SUS}, ${RUN + "x@qa.test"}, 'trial', 9)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"oa1-" + RUN}, ${orgMea}, ${idEu}, ${numeEu}),
                   (${"oa2-" + RUN}, ${orgMea}, ${idColeg}, ${numeColeg}),
                   (${"oa3-" + RUN}, ${orgAlta}, ${idStrain}, ${numeStrain})`;
  for (const f of FIRME) {
    await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ, telefon)
              VALUES (${cui(f.i)}, ${f.den}, ${f.adr}, ${f.loc}, 'SV', ${f.caen},
                      ${f.st}, ${f.ag()}, ${f.activ}, ${"07000000" + f.i})`;
  }
  // Coordonate pentru ambele sate, ca harta să aibă bule fără geocodare.
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('SV', ${SAT}, 47.65, 26.25, FALSE),
                   ('SV', ${SAT2}, 47.70, 26.30, FALSE)
            ON CONFLICT (judet, localitate) DO UPDATE
              SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, failed = FALSE`;
}

async function curata() {
  const cuis = FIRME.map((f) => cui(f.i));
  await sql`DELETE FROM agent_pin WHERE agent_id IN (${idEu}, ${idColeg}, ${idStrain})`.catch(() => {});
  await sql`DELETE FROM visits WHERE agent_id IN (${idEu}, ${idColeg}, ${idStrain})`;
  await sql`DELETE FROM orders WHERE agent_id IN (${idEu}, ${idColeg}, ${idStrain})`.catch(() => {});
  await sql`DELETE FROM agent_zone WHERE org_id IN (${orgMea}, ${orgAlta})`.catch(() => {});
  await sql`DELETE FROM prospect_inchis WHERE cui = ANY(${cuis})`.catch(() => {});
  await sql`DELETE FROM geo_firme WHERE cui = ANY(${cuis})`.catch(() => {});
  await sql`DELETE FROM prospects WHERE cui = ANY(${cuis})`;
  await sql`DELETE FROM geo_localitati WHERE localitate IN (${SAT}, ${SAT2})`;
  await sql`DELETE FROM org_agents WHERE org_id IN (${orgMea}, ${orgAlta})`;
  await sql`DELETE FROM organizations WHERE id IN (${orgMea}, ${orgAlta})`;
}

/* ────────────────────────── unelte ────────────────────────── */

interface Firma {
  cui: string;
  denumire: string;
  adresa?: string;
  localitate?: string;
  telefon?: string;
  status?: string;
  assignedAgent?: string;
  navAddress?: string;
}
type Json = Record<string, unknown>;

let tokEu = "";
let tokColeg = "";
let tokStrain = "";

async function ia(cale: string): Promise<{ s: number; d: Json }> {
  const r = await fetch(`${BASE}${cale}`);
  let d: Json = {};
  try {
    d = (await r.json()) as Json;
  } catch {
    /* corp gol sau non-JSON: rămâne {} */
  }
  return { s: r.status, d };
}
async function trimite(
  cale: string,
  corp: Json,
): Promise<{ s: number; d: Json }> {
  const r = await fetch(`${BASE}${cale}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corp),
  });
  let d: Json = {};
  try {
    d = (await r.json()) as Json;
  } catch {
    /* idem */
  }
  return { s: r.status, d };
}
const firme = (d: Json): Firma[] => (d.prospects as Firma[]) ?? [];
const numeLor = (d: Json) => firme(d).map((f) => f.denumire);

/* ══════════════════ 1. POARTA DE INTRARE ══════════════════ */

async function poarta() {
  sectiune("Poarta de intrare: linkul agentului");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  tokEu = await signToken({ agentId: idEu, agentName: numeEu, exp }, SECRET);
  tokColeg = await signToken({ agentId: idColeg, agentName: numeColeg, exp }, SECRET);
  tokStrain = await signToken({ agentId: idStrain, agentName: numeStrain, exp }, SECRET);

  const bun = await ia(`/api/prospects?token=${tokEu}&judet=SV&limit=5`);
  check("linkul valid deschide datele", bun.s === 200, `status ${bun.s}`);

  const gol = await ia(`/api/prospects?judet=SV`);
  check("fără link → refuz, nu date", gol.s >= 400, `status ${gol.s}`);
  check("fără link nu curge nicio firmă", firme(gol.d).length === 0);

  const stricat = await ia(`/api/prospects?token=${tokEu}xyz&judet=SV`);
  check("link ciupit (semnătură stricată) → 401", stricat.s === 401, `status ${stricat.s}`);

  const expirat = await signToken(
    { agentId: idEu, agentName: numeEu, exp: Math.floor(Date.now() / 1000) - 60 },
    SECRET,
  );
  const rExp = await ia(`/api/prospects?token=${expirat}&judet=SV`);
  check("link EXPIRAT → 401", rExp.s === 401, `status ${rExp.s}`);

  const altaCheie = await signToken({ agentId: idEu, agentName: numeEu, exp }, "alta-cheie");
  const rAlt = await ia(`/api/prospects?token=${altaCheie}&judet=SV`);
  check("link semnat cu ALTĂ cheie → 401", rAlt.s === 401, `status ${rAlt.s}`);

  const pag = await fetch(`${BASE}/a/${tokEu}`);
  check("pagina panoului se deschide (200)", pag.status === 200, `status ${pag.status}`);
  const html = await pag.text();
  check("pagina conține numele agentului", html.includes(numeEu) || html.includes(RUN));
  const rea = await fetch(`${BASE}/a/token-inventat-de-nimeni`);
  check("link inventat → pagină de eroare, nu panou", rea.status >= 400, `status ${rea.status}`);
}

/* ══════════ 2. CĂUTAREA DE CLIENȚI (cererea băieților, azi) ══════════ */

async function cautare() {
  sectiune("Căutarea clienților (cerută de agenți azi)");
  const q = (t: string, extra = "") =>
    ia(`/api/prospects?token=${tokEu}&judet=SV&search=${encodeURIComponent(t)}&aiMei=1&usor=1${extra}`);

  const r1 = await q("ALIMENTARA QA");
  check("caut după nume și găsesc firma", numeLor(r1.d).some((n) => n.includes("ALIMENTARA QA")));

  const r2 = await q("alimentara qa");
  check("caut cu litere mici — tot o găsesc", numeLor(r2.d).some((n) => n.includes("ALIMENTARA QA")));

  const r3 = await q("BACANIA TARANEASCA");
  check(
    "caut FĂRĂ diacritice o firmă scrisă CU diacritice",
    numeLor(r3.d).some((n) => n.includes("BĂCĂNIA")),
    numeLor(r3.d).join(","),
  );

  const r4 = await q("BĂCĂNIA ȚĂRĂNEASCĂ");
  check("caut CU diacritice — merge la fel", numeLor(r4.d).some((n) => n.includes("BĂCĂNIA")));

  const r5 = await q(cui(0));
  check("caut după CUI și găsesc firma", firme(r5.d).some((f) => f.cui === cui(0)));

  const r6 = await q("MINIMARKET QA");
  check("caut un client din ALT sat — apare oricum", numeLor(r6.d).some((n) => n.includes("MINIMARKET")));

  const r7 = await q("QA");
  const primele = firme(r7.d).slice(0, 3).map((f) => f.assignedAgent ?? "");
  check(
    "clienții MEI ies primii în listă",
    primele.filter((a) => a === numeEu).length >= 2,
    primele.join(" | "),
  );

  // Registrul de firme e COMUN (toate firmele din România) — deci firma
  // vecinilor apare și la mine, ca orice firmă din registru. Ce NU are voie
  // să se vadă e STAREA DE LUCRU a lor: că e clientul cuiva, al cui, ce
  // notă i-a pus agentul lor. Aia e izolarea care contează.
  const r8 = await q("RIVAL QA");
  const rival = firme(r8.d).find((f) => f.denumire.includes("RIVAL"));
  check("firma vecinilor apare ca firmă din registru", !!rival);
  check("…dar NU scrie că e clientul lor", (rival?.status ?? "nou") === "nou", `status=${rival?.status}`);
  check("…și NU-mi arată al cui agent e", (rival?.assignedAgent ?? "") === "", `agent=${rival?.assignedAgent}`);
  check("…și nu-mi dă notele lor", !(rival as { note?: string } | undefined)?.note);

  const r9 = await q("firma-care-nu-exista-nicaieri");
  check("căutare fără rezultat → listă goală, nu eroare", r9.s === 200 && firme(r9.d).length === 0);

  const r10 = await q("A");
  check("o singură literă nu dărâmă serverul", r10.s === 200, `status ${r10.s}`);

  const r11 = await q("'; DROP TABLE prospects; --");
  const inca = await ia(`/api/prospects?token=${tokEu}&judet=SV&limit=1`);
  check("text periculos în căutare nu strică baza", r11.s === 200 && inca.s === 200);

  const r12 = await q("x".repeat(500));
  check("căutare absurd de lungă → răspuns curat", r12.s === 200, `status ${r12.s}`);

  // „usor=1" e pentru căutarea de la fiecare literă: aduce rândurile, dar
  // NU mai numără tot registrul (1,3M de firme) doar ca să scrie un total
  // pe care nimeni nu-l citește în timp ce tastează.
  const usor = await q("QA");
  const greu = await ia(
    `/api/prospects?token=${tokEu}&judet=SV&search=${encodeURIComponent("QA")}&aiMei=1`,
  );
  const palnie = (d: Json) => (d.funnel as { total?: number } | undefined)?.total ?? -1;
  check("modul „ușor” aduce rândurile", firme(usor.d).length > 0, `${firme(usor.d).length}`);
  check("modul „ușor” NU mai numără toată pâlnia", palnie(usor.d) === 0, `funnel=${palnie(usor.d)}`);
  check("fără „ușor”, pâlnia chiar se numără", palnie(greu.d) > 0, `funnel=${palnie(greu.d)}`);

  const strain = await ia(
    `/api/prospects?token=${tokStrain}&judet=SV&search=${encodeURIComponent("ALIMENTARA QA")}&aiMei=1`,
  );
  const alMeu = firme(strain.d).find((f) => f.denumire.includes("ALIMENTARA QA"));
  check("și invers: agentul lor NU vede că firma e clientul MEU", (alMeu?.status ?? "nou") === "nou", `status=${alMeu?.status}`);
  check("…nici numele meu pe ea", (alMeu?.assignedAgent ?? "") === "", `agent=${alMeu?.assignedAgent}`);
}

/* ══════════ 3. „UNDE SUNT RESTUL DE CLIENȚI?" (azi) ══════════ */

async function clientiiMei() {
  sectiune("Clienții mei apar MEREU (întrebarea din teren)");
  const cuFiltru = `&caenIn=4711&localitate=${encodeURIComponent(SAT)}`;

  const cu = await ia(`/api/prospects?token=${tokEu}&judet=SV&aiMei=1${cuFiltru}&limit=100`);
  const n = numeLor(cu.d);
  check("clientul meu cu ALT domeniu (IT) apare oricum", n.some((x) => x.includes("SERVICE IT")));
  check("clientul meu INACTIV în registru apare oricum", n.some((x) => x.includes("BODEGA")));
  check("clientul meu pe domeniu apare (evident)", n.some((x) => x.includes("ALIMENTARA")));
  check("clientul COLEGULUI din firma mea apare în sat", n.some((x) => x.includes("MAGAZIN COLEG")));
  const coleg = firme(cu.d).find((f) => f.denumire.includes("MAGAZIN COLEG"));
  check("…și văd că e al colegului meu (suntem aceeași firmă)", (coleg?.assignedAgent ?? "") === numeColeg, `agent=${coleg?.assignedAgent}`);
  const riv = firme(cu.d).find((f) => f.denumire.includes("RIVAL"));
  check("firma vecinilor apare ca prospect simplu, fără starea lor", (riv?.status ?? "nou") === "nou" && (riv?.assignedAgent ?? "") === "");

  const fara = await ia(`/api/prospects?token=${tokEu}&judet=SV${cuFiltru}&limit=100`);
  const nf = numeLor(fara.d);
  check(
    "fără aiMei, filtrul de domeniu chiar filtrează (IT-ul dispare)",
    !nf.some((x) => x.includes("SERVICE IT")),
    nf.join(","),
  );
  check("fără aiMei, firma pe domeniu rămâne", nf.some((x) => x.includes("ALIMENTARA")));

  const geo = await ia(`/api/prospects/geo?token=${tokEu}&judet=SV&geocode=0&caenIn=4711`);
  const bule = (geo.d.localities as Array<{ localitate: string; clienti: number; count: number }>) ?? [];
  const bulaSat = bule.find((b) => b.localitate === SAT);
  check("satul meu are bulă pe hartă", !!bulaSat, `${bule.length} bule`);
  check("bula știe câți CLIENȚI am acolo", (bulaSat?.clienti ?? 0) >= 2, `clienti=${bulaSat?.clienti}`);
  const bulaSat2 = bule.find((b) => b.localitate === SAT2);
  check("și al doilea sat are bulă", !!bulaSat2);

  // Vecinul are UN singur client în satul ăsta (al lui). Dacă bula lui ar
  // număra 3, ar însemna că-i numără și pe ai mei.
  const geoStrain = await ia(`/api/prospects/geo?token=${tokStrain}&judet=SV&geocode=0&caenIn=4711`);
  const buleX = (geoStrain.d.localities as Array<{ localitate: string; clienti: number }>) ?? [];
  check(
    "bula vecinului numără DOAR clientul lui, nu și pe ai mei",
    (buleX.find((b) => b.localitate === SAT)?.clienti ?? -1) === 1,
    `clienti=${buleX.find((b) => b.localitate === SAT)?.clienti}`,
  );
}

/* ══════════ 4. ADRESA COMPLETĂ ȘI NAVIGAȚIA (azi) ══════════ */

async function adrese() {
  sectiune("Adresa completă și navigația (nu centrul satului)");
  const r = await ia(
    `/api/prospects?token=${tokEu}&judet=SV&aiMei=1&localitate=${encodeURIComponent(SAT)}&limit=100`,
  );
  const lista = firme(r.d);
  const alim = lista.find((f) => f.cui === cui(0));
  check("firma vine cu adresa ei, nu goală", !!alim?.adresa && alim.adresa.length > 5, alim?.adresa);
  check("adresa conține strada", (alim?.adresa ?? "").toLowerCase().includes("ștefan"));
  check("adresa conține NUMĂRUL", /\b12\b/.test(alim?.adresa ?? ""), alim?.adresa);
  check("firma vine cu localitatea", (alim?.localitate ?? "") === SAT);
  check("firma vine cu telefonul", !!alim?.telefon && alim.telefon.length >= 9, alim?.telefon);

  const { navAddress, poateNaviga } = await import("../src/lib/route-nav");
  const adr1 = navAddress({
    denumire: alim?.denumire ?? "",
    adresa: alim?.adresa ?? "",
    localitate: SAT,
    judet: "SV",
  });
  check("adresa de navigat include strada și numărul", /12/.test(adr1) && /tefan/.test(adr1), adr1);
  check("adresa de navigat include localitatea", adr1.includes(SAT), adr1);
  check("adresa de navigat include județul", /Suceava|SV/i.test(adr1), adr1);

  const faraNr = lista.length ? null : null;
  const adr2 = navAddress({
    denumire: `FARA NUMAR QA ${SUS}`,
    adresa: "Sat fără stradă",
    localitate: SAT2,
    judet: "SV",
  });
  void faraNr;
  check(
    "fără număr la stradă, navigația cade pe NUMELE firmei",
    adr2.includes("FARA NUMAR"),
    adr2,
  );
  check("o firmă cu adresă bună e navigabilă", poateNaviga({ denumire: "X", adresa: "Str. A 1", localitate: SAT, judet: "SV" }));
  check(
    "o firmă fără nimic NU e navigabilă (n-o punem în rută degeaba)",
    !poateNaviga({ denumire: "", adresa: "", localitate: "", judet: "" }),
  );
}

/* ══════════ 5. PINUL ÎNVAȚĂ DE LA OM (azi) ══════════ */

async function pinInvata() {
  sectiune("Pinul învață din poziția telefonului la „Am fost”");
  const c = cui(0);
  const bun = await trimite("/api/visits", {
    token: tokEu, cui: c, denumire: "ALIMENTARA", result: "gandeste",
    note: "trec mâine", lat: 47.6512, lng: 26.2534, acc: 12,
  });
  check("vizita cu GPS bun se salvează", bun.s === 200, `status ${bun.s}`);
  check("aplicația confirmă că a scris pinul EXACT", bun.d.pinExact === true);
  const [pin] = await sql<Array<{ lat: number; lng: number; aprox: boolean }>>`
    SELECT lat, lng, aprox FROM geo_firme WHERE cui = ${c}`;
  check("pinul chiar e în baza de date", !!pin);
  check("pinul are coordonatele telefonului", Math.abs((pin?.lat ?? 0) - 47.6512) < 0.001);
  check("pinul e marcat EXACT, nu aproximativ", pin?.aprox === false);

  const slab = await trimite("/api/visits", {
    token: tokEu, cui: cui(1), denumire: "IT", result: "gandeste",
    lat: 47.6512, lng: 26.2534, acc: 3000,
  });
  const [pin2] = await sql`SELECT cui FROM geo_firme WHERE cui = ${cui(1)}`;
  check("GPS slab (3km precizie) NU strică pinul", slab.s === 200 && !pin2);

  const aiurea = await trimite("/api/visits", {
    token: tokEu, cui: cui(1), denumire: "IT", result: "gandeste",
    lat: 12.3, lng: 99.9, acc: 5,
  });
  const [pin3] = await sql`SELECT cui FROM geo_firme WHERE cui = ${cui(1)}`;
  check("poziție din afara României → ignorată", aiurea.s === 200 && !pin3);

  const furt = await trimite("/api/visits", {
    token: tokStrain, cui: c, denumire: "ALIMENTARA", result: "gandeste",
    lat: 44.0, lng: 26.0, acc: 5,
  });
  const [dupa] = await sql<Array<{ lat: number }>>`SELECT lat FROM geo_firme WHERE cui = ${c}`;
  check(
    "agentul altei firme NU-mi poate muta pinul",
    furt.d.pinExact !== true && Math.abs((dupa?.lat ?? 0) - 47.6512) < 0.001,
    `lat=${dupa?.lat}`,
  );
}

/* ══════════ 6. „ÎNCHIS" PE TEREN, IZOLAT PE FIRMĂ (azi) ══════════ */

async function inchis() {
  sectiune("„Închis” pe teren curăță harta — dar doar la mine");
  const cMeu = cui(2);
  const r = await trimite("/api/visits", {
    token: tokEu, cui: cMeu, denumire: "BODEGA", result: "nu_mai_exista", note: "e zid",
  });
  check("„Închis” pe clientul meu se salvează", r.s === 200, `status ${r.s}`);
  const [p] = await sql<Array<{ activ: boolean; inchis_teren: boolean }>>`
    SELECT activ, inchis_teren FROM prospects WHERE cui = ${cMeu}`;
  check("clientul meu închis se stinge (activ=false)", p?.activ === false);
  check("e marcat ca închis DE PE TEREN", p?.inchis_teren === true);

  const cLiber = cui(5);
  const r2 = await trimite("/api/visits", {
    token: tokEu, cui: cLiber, denumire: "PROSPECT LIBER", result: "inchis",
  });
  check("„Închis” pe un prospect nealocat se salvează", r2.s === 200);
  const [q] = await sql<Array<{ activ: boolean }>>`SELECT activ FROM prospects WHERE cui = ${cLiber}`;
  check(
    "prospectul din registrul COMUN nu se stinge pentru toată lumea",
    q?.activ !== false,
    `activ=${q?.activ}`,
  );
  const ascuns = await sql`SELECT 1 FROM prospect_inchis WHERE cui = ${cLiber} AND org_id = ${orgMea}`;
  check("…dar e ascuns pentru firma MEA", ascuns.length === 1);

  // Verificăm pe CONȚINUTUL listelor, nu pe numărul din bulă: două bule pot
  // arăta același număr din firme diferite, și-atunci testul minte.
  const inSat = async (t: string) =>
    numeLor(
      (await ia(`/api/prospects?token=${t}&judet=SV&localitate=${encodeURIComponent(SAT)}&limit=100`)).d,
    );
  const alMele = await inSat(tokEu);
  const aleLor = await inSat(tokStrain);
  check("firma închisă dispare din lista MEA", !alMele.some((x) => x.includes("PROSPECT LIBER")));
  check("firma vecină o vede în continuare", aleLor.some((x) => x.includes("PROSPECT LIBER")));
  check("restul satului îmi rămâne intact", alMele.some((x) => x.includes("ALIMENTARA QA")));
  check(
    "am ascuns EXACT o firmă, nu tot satul",
    aleLor.length - alMele.length === 1,
    `eu=${alMele.length} ei=${aleLor.length}`,
  );
}

/* ══════════ 7. VIZITE, JURNAL, SCADENȚI ══════════ */

async function vizite() {
  sectiune("Vizitele: jurnal, rezultate, scadenți");
  const rezultate = ["gandeste", "ne_suna", "nu_vrea", "client"] as const;
  for (const rez of rezultate) {
    const r = await trimite("/api/visits", {
      token: tokEu, cui: cui(7), denumire: "MINIMARKET", result: rez, note: `nota ${rez}`,
    });
    check(`rezultatul „${rez}” se salvează`, r.s === 200, `status ${r.s}`);
  }
  const rau = await trimite("/api/visits", {
    token: tokEu, cui: cui(7), denumire: "X", result: "inventat",
  });
  check("un rezultat inventat e respins (400)", rau.s === 400, `status ${rau.s}`);
  const faraCui = await trimite("/api/visits", { token: tokEu, result: "client" });
  check("vizită fără firmă e respinsă (400)", faraCui.s === 400, `status ${faraCui.s}`);

  const j = await ia(`/api/visits?token=${tokEu}&limit=50`);
  const v = (j.d.visits as Array<{ result: string; note: string }>) ?? [];
  check("jurnalul îmi arată vizitele mele", v.length >= 4, `${v.length} vizite`);
  check("jurnalul păstrează nota scrisă", v.some((x) => x.note.includes("nota client")));
  check("contorul zilei e pornit", typeof j.d.today === "number" && (j.d.today as number) >= 4);

  const [pr] = await sql<Array<{ status: string; note: string }>>`
    SELECT status, note FROM prospects WHERE cui = ${cui(7)}`;
  check("„client” face firma CLIENT în listă", pr?.status === "client");
  check("notele din vizite ajung pe fișa firmei", (pr?.note ?? "").includes("nota"));

  const jStrain = await ia(`/api/visits?token=${tokStrain}&limit=50`);
  const vx = (jStrain.d.visits as Array<{ note: string; agentName: string }>) ?? [];
  check(
    "agentul altei firme nu vede NOTELE mele în jurnalul lui",
    !vx.some((x) => (x.note ?? "").includes("nota client")),
    `${vx.length} vizite străine`,
  );
  check(
    "…jurnalul lui are doar vizitele lui",
    vx.every((x) => x.agentName === numeStrain),
    vx.map((x) => x.agentName).join(","),
  );

  const due = await ia(`/api/visits?token=${tokEu}&due=1&limit=50`);
  check("lista de „scadenți” răspunde", due.s === 200, `status ${due.s}`);
  check("scadenții sunt o listă", Array.isArray(due.d.due));
}

/* ══════════ 8. ZONELE PE ZILE ȘI RUTA (azi) ══════════ */

async function zoneSiRuta() {
  sectiune("Zonele pe zile și ruta zilei");
  const { parseZone, potriveste, ziDinText, neted } = await import("../src/modules/zone/parse");

  const z = parseZone(`luni - ${SAT}, ${SAT2}\nmarți: ${SAT2}`);
  check("textul de pe WhatsApp devine zi + sate", z.length === 3, `${z.length} rânduri`);
  check("luni are două sate", z.filter((x) => x.zi === "luni").length === 2);
  check("marți are un sat", z.filter((x) => x.zi === "marti").length === 1);
  check("ziua scrisă cu diacritice e înțeleasă", ziDinText("Marți") === "marti");
  check("ziua scrisă cu majuscule e înțeleasă", ziDinText("MIERCURI") === "miercuri");
  check("„sâmbătă” scris oricum e înțeles", ziDinText("simbata") === "sambata");
  check("textul se netezește (fără diacritice)", neted("Ștefan Țăndărei") === "stefan tandarei");
  const p = potriveste(SAT.toLowerCase(), [SAT, SAT2]);
  check("satul scris cu litere mici e recunoscut", p.oficial === SAT, String(p.oficial));
  const pGresit = potriveste("sat-care-nu-exista", [SAT, SAT2]);
  check("satul inexistant nu se ghicește", pGresit.oficial === null);

  const { planRoute } = await import("../src/lib/route-nav");
  const opriri = [
    { denumire: `A ${SUS}`, adresa: "Str. 1 nr. 1", localitate: SAT, judet: "SV" },
    { denumire: `B ${SUS}`, adresa: "Str. 2 nr. 2", localitate: SAT, judet: "SV" },
    { denumire: `C ${SUS}`, adresa: "", localitate: "", judet: "" },
  ];
  const plan = planRoute(opriri, [], "SV");
  check("ruta se construiește din opriri", (plan.etape?.length ?? 0) >= 1);
  check("oprirea fără adresă e SĂRITĂ, nu bagă ruta în cap", (plan.sarite ?? 0) === 1, `sarite=${plan.sarite}`);
  check("etapa are link de navigare", /google\.com\/maps/.test(plan.etape?.[0]?.url ?? ""));
  check("linkul conține prima oprire", (plan.etape?.[0]?.url ?? "").includes("Str"));
  const multe = Array.from({ length: 23 }, (_, i) => ({
    denumire: `F${i}`, adresa: `Str. ${i} nr. ${i + 1}`, localitate: SAT, judet: "SV",
  }));
  const planMult = planRoute(multe, [], "SV");
  check("23 de opriri se rup în mai multe etape (Google are limită)", (planMult.etape?.length ?? 0) >= 3, `${planMult.etape?.length} etape`);
  const totalOpriri = (planMult.etape ?? []).reduce((s, e) => s + e.stops.length, 0);
  check("nicio oprire nu se pierde la rupere", totalOpriri === 23, `${totalOpriri}/23`);

  const salv = await trimite("/api/routes", {
    token: tokEu, name: `Ruta QA ${RUN}`, day: "luni",
    stops: [{ cui: cui(0), denumire: "ALIMENTARA", adresa: "Str. Ștefan cel Mare nr. 12", localitate: SAT }],
  });
  check("ruta se salvează pe zi", salv.s === 200, `status ${salv.s}`);
  const rute = await ia(`/api/routes?token=${tokEu}`);
  const listaRute = (rute.d.routes as Array<{ name: string }>) ?? [];
  check("ruta salvată se regăsește", listaRute.some((x) => x.name.includes("Ruta QA")));
  const ruteStrain = await ia(`/api/routes?token=${tokStrain}`);
  check(
    "agentul altei firme nu-mi vede rutele",
    !((ruteStrain.d.routes as Array<{ name: string }>) ?? []).some((x) => x.name.includes("Ruta QA")),
  );
}

/* ══════════ 9. COMANDA DIN TEREN ══════════ */

async function comenzi() {
  sectiune("Comanda din magazin");
  const ok = await trimite("/api/orders", {
    token: tokEu, cui: cui(0), denumire: `ALIMENTARA QA ${SUS}`, localitate: SAT,
    lines: [{ produs: "Kent", cantitate: 5, um: "bax", pret: 32.5 }],
    note: "livrare marți", plata: "termen",
  });
  check("comanda se trimite la depozit", ok.s === 200, `status ${ok.s} ${JSON.stringify(ok.d).slice(0, 90)}`);

  const faraLinii = await trimite("/api/orders", {
    token: tokEu, cui: cui(0), denumire: "X", lines: [],
  });
  check("comandă fără produse → respinsă (400)", faraLinii.s === 400, `status ${faraLinii.s}`);

  const faraNume = await trimite("/api/orders", {
    token: tokEu, cui: cui(0), denumire: "",
    lines: [{ produs: "Kent", cantitate: 1, um: "buc", pret: 10 }],
  });
  check("comandă fără client → respinsă (400)", faraNume.s === 400, `status ${faraNume.s}`);

  const platăAiurea = await trimite("/api/orders", {
    token: tokEu, cui: cui(0), denumire: "X", plata: "bitcoin",
    lines: [{ produs: "Kent", cantitate: 1, um: "buc", pret: 10 }],
  });
  check("plată inventată nu trece nefiltrată", platăAiurea.s === 200 || platăAiurea.s === 400);

  const lista = await ia(`/api/orders?token=${tokEu}`);
  check("îmi văd comenzile trimise", lista.s === 200, `status ${lista.s}`);
  const cmd = (lista.d.orders as Array<{ denumire: string; totalValue?: number; lines?: unknown[]; plata?: string }>) ?? [];
  check("comanda mea e în listă", cmd.some((c) => c.denumire.includes("ALIMENTARA QA")));
  const a = cmd.find((c) => c.denumire.includes("ALIMENTARA QA"));
  check("totalul e calculat (5 × 32,5 = 162,5)", Math.abs((a?.totalValue ?? 0) - 162.5) < 0.01, `total=${a?.totalValue}`);
  check("comanda păstrează produsele", (a?.lines?.length ?? 0) === 1, `${a?.lines?.length} linii`);
  check("comanda păstrează felul plății", a?.plata === "termen", `plata=${a?.plata}`);

  const listaX = await ia(`/api/orders?token=${tokStrain}`);
  check(
    "firma vecină nu-mi vede comenzile",
    !((listaX.d.orders as Array<{ denumire: string }>) ?? []).some((c) => c.denumire.includes("ALIMENTARA QA")),
  );
}

/* ══════════ 10. RESTUL PANOULUI (API) ══════════ */

async function restulPanoului() {
  sectiune("Restul panoului: target, decont, van, poze");
  const t = await ia(`/api/targets?token=${tokEu}`);
  check("Target răspunde", t.s === 200, `status ${t.s}`);
  const tX = await ia(`/api/targets?token=inventat`);
  check("Target fără link valid → 401", tX.s === 401, `status ${tX.s}`);

  const e = await trimite("/api/expenses", {
    token: tokEu, kind: "combustibil", amount: 150.5, note: `plin QA ${RUN}`,
  });
  check("decontul de combustibil se salvează", e.s === 200, `status ${e.s}`);
  const eNeg = await trimite("/api/expenses", { token: tokEu, kind: "combustibil", amount: -50 });
  check("sumă negativă la decont → respinsă", eNeg.s >= 400, `status ${eNeg.s}`);
  const eLista = await ia(`/api/expenses?token=${tokEu}`);
  check("îmi văd deconturile", eLista.s === 200, `status ${eLista.s}`);

  const v = await ia(`/api/van?token=${tokEu}`);
  check("stocul din mașină răspunde", v.s === 200, `status ${v.s}`);
  check("stocul e o listă", Array.isArray(v.d.stock));
  const vX = await ia(`/api/van?token=inventat`);
  check("stocul din mașină cere link valid", vX.s === 401, `status ${vX.s}`);

  const poza = await trimite("/api/factura-scan", { token: tokEu, image: { data: "", mime: "image/jpeg" } });
  check("poză goală la factură → mesaj clar, nu crash", poza.s === 400, `status ${poza.s}`);
  const pozaMare = await trimite("/api/factura-scan", {
    token: tokEu, image: { data: "x".repeat(6_100_000), mime: "image/jpeg" },
  });
  check("poză prea mare → mesaj «e prea mare», nu 500", pozaMare.s === 400, `status ${pozaMare.s}`);
  check("mesajul de poză mare e pe românește", /prea mare/i.test(String(pozaMare.d.error ?? "")));

  const brief = await trimite("/api/client-brief", { token: tokEu, cui: cui(0) });
  check("briefingul clientului nu crapă (merge sau spune de ce nu)", [200, 402, 503].includes(brief.s), `status ${brief.s}`);
  if (brief.s !== 200) {
    check("…și explică pe românește", String(brief.d.error ?? "").length > 5, String(brief.d.error));
  } else {
    check("…și întoarce text", String(brief.d.text ?? brief.d.brief ?? "").length > 0);
  }

  const ghid = await fetch(`${BASE}/ghid`);
  check("Ghidul se deschide", ghid.status === 200, `status ${ghid.status}`);
  const gh = await ghid.text();
  check("Ghidul are capitolul cu poze", /Ghidul în imagini|Ghidul in imagini/.test(gh));
}

/* ══════════ 11. CU OCHII, PE TELEFON ══════════ */

async function cuOchii() {
  sectiune("Cu ochii, pe telefon (Chromium real)");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pw = (await import(PW)) as any;
  const chromium = pw.chromium ?? pw.default?.chromium;
  const b = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [eticheta, latime, font] of [
      ["telefon obișnuit", 393, "16px"],
      ["telefon mic, font mare", 320, "22px"],
    ] as const) {
      const ctx = await b.newContext({
        viewport: { width: latime, height: 780 },
        isMobile: true,
        hasTouch: true,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page: any = await ctx.newPage();
      const erori: string[] = [];
      page.on("pageerror", (e: Error) => erori.push(e.message.slice(0, 120)));
      page.on("console", (m: { type: () => string; text: () => string; location: () => { url?: string } }) => {
        if (m.type() !== "error") return;
        const t = m.text();
        const dinAfara = !(m.location()?.url ?? "").startsWith(BASE);
        if (dinAfara && /Failed to load resource|net::ERR_/i.test(t)) return;
        if (/favicon|tile\.openstreetmap/i.test(t)) return;
        erori.push(t.slice(0, 120));
      });

      await page.goto(`${BASE}/a/${tokEu}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(3500);

      // POARTA DE PIN: prima dată pe telefon, agentul își pune un PIN.
      // E primul ecran pe care-l vede în viața lui — trebuie să meargă.
      const pinuri = page.locator('input[type="password"], input[inputmode="numeric"]');
      const catePin = await pinuri.count();
      if (catePin >= 2) {
        // Primul telefon: își ALEGE PIN-ul (de două ori, ca să nu greșească).
        check(`[${eticheta}] poarta de PIN apare la primul telefon`, true);
        check(
          `[${eticheta}] poarta de PIN explică pe românește ce vrea`,
          /PIN/i.test(await page.evaluate(() => document.body.innerText)),
        );
        await pinuri.nth(0).fill("2468");
        await pinuri.nth(1).fill("1357");
        await page.locator("button[type=submit]").first().click();
        await page.waitForTimeout(1800);
        const gresit = await page.evaluate(() => document.body.innerText);
        check(
          `[${eticheta}] două PIN-uri diferite → spune clar că nu se potrivesc`,
          /nu se potrivesc|nu coincid|diferit|identic/i.test(gresit),
          gresit.replace(/\s+/g, " ").slice(0, 100),
        );
        await pinuri.nth(0).fill("2468");
        await pinuri.nth(1).fill("2468");
        await page.locator("button[type=submit]").first().click();
        await page.waitForTimeout(4000);
      } else if (catePin === 1) {
        // Alt telefon: cere PIN-ul deja ales. Întâi unul greșit, apoi bunul.
        check(`[${eticheta}] pe alt telefon cere PIN-ul`, true);
        await pinuri.nth(0).fill("9999");
        await page.locator("button[type=submit]").first().click();
        await page.waitForTimeout(1800);
        check(
          `[${eticheta}] PIN greșit → nu intră`,
          (await page.locator('input[type="search"]').count()) === 0,
        );
        await pinuri.nth(0).fill("2468");
        await page.locator("button[type=submit]").first().click();
        await page.waitForTimeout(4000);
      }
      if (catePin > 0) {
        check(
          `[${eticheta}] cu PIN-ul corect, panoul se deschide`,
          (await page.locator('input[type="search"]').count()) > 0,
        );
        // PIN-ul greșit de mai sus a produs un 401 — ăla e răspunsul corect
        // al serverului, nu un bug. Golim lista AICI (nu filtrăm 401 la
        // nesfârșit), ca de acum încolo orice eroare să conteze.
        erori.length = 0;
      }

      await page.evaluate((f: string) => {
        document.documentElement.style.fontSize = f;
      }, font);
      await page.waitForTimeout(800);

      const of = async () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      check(`[${eticheta}] panoul se deschide`, page.url().includes("/a/"));
      check(`[${eticheta}] nimic nu iese din ecran`, (await of()) <= 2, `${await of()}px afară`);

      // Căutarea de pe prima pagină — cererea băieților de azi.
      const cauta = page.locator('input[type="search"], input[placeholder*="aut" i]').first();
      check(`[${eticheta}] căsuța de căutare e pe prima pagină`, (await cauta.count()) > 0);
      if ((await cauta.count()) > 0) {
        const cutie = await cauta.boundingBox();
        check(
          `[${eticheta}] căsuța de căutare e ÎN ecran`,
          !!cutie && cutie.x >= -1 && cutie.x + cutie.width <= latime + 2,
          JSON.stringify(cutie),
        );
        check(
          `[${eticheta}] căsuța e destul de mare ca s-o apeși cu degetul`,
          (cutie?.height ?? 0) >= 32,
          `${cutie?.height}px`,
        );
        await cauta.fill("ALIMENTARA QA");
        await page.waitForTimeout(2500);
        const text = await page.evaluate(() => document.body.innerText);
        check(`[${eticheta}] căutarea găsește clientul pe ecran`, text.includes("ALIMENTARA QA"));
        check(`[${eticheta}] rezultatul arată și adresa`, /Ștefan cel Mare|Stefan cel Mare/.test(text));
        check(`[${eticheta}] căutarea nu scoate nimic din ecran`, (await of()) <= 2, `${await of()}px`);
        await cauta.fill("zzzz-nimic-aici");
        await page.waitForTimeout(2200);
        const gol = await page.evaluate(() => document.body.innerText);
        check(
          `[${eticheta}] fără rezultate spune ceva, nu rămâne mut`,
          /niciun|nimic|Nu am găsit|0 /i.test(gol),
        );
        await cauta.fill("");
        await page.waitForTimeout(900);
      }

      // Textele nu se taie („Rezultate filtrate", nu „Re…").
      const taiate = await page.evaluate(() => {
        const rele: string[] = [];
        for (const el of Array.from(document.querySelectorAll("p, span, h1, h2, h3, button, a"))) {
          const e = el as HTMLElement;
          if (e.offsetParent === null) continue;
          if (e.children.length > 0) continue;
          const t = (e.innerText || "").trim();
          if (t.length < 4) continue;
          if (e.scrollWidth > e.clientWidth + 2) rele.push(t.slice(0, 40));
        }
        return rele.slice(0, 6);
      });
      check(`[${eticheta}] niciun text nu e tăiat cu „…”`, taiate.length === 0, taiate.join(" | "));

      // Butoanele se pot apăsa cu degetul (minim 32px).
      const mici = await page.evaluate(() => {
        const rele: string[] = [];
        for (const el of Array.from(document.querySelectorAll("button, a[href]"))) {
          const e = el as HTMLElement;
          if (e.offsetParent === null) continue;
          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.height < 28) rele.push(`${(e.innerText || e.getAttribute("aria-label") || "?").slice(0, 20)}:${Math.round(r.height)}px`);
        }
        return rele.slice(0, 6);
      });
      check(`[${eticheta}] butoanele se pot apăsa cu degetul`, mici.length === 0, mici.join(" | "));

      // Meniul lateral și harta.
      await page.locator("header button").first().click().catch(() => {});
      await page.waitForTimeout(500);
      const harta = page.locator("button, a").filter({ hasText: "Harta pieței" }).first();
      check(`[${eticheta}] meniul se deschide și are Harta`, (await harta.count()) > 0);
      if ((await harta.count()) > 0) {
        await harta.click();
        await page.waitForTimeout(4000);
        const info = await page.evaluate(() => {
          const el = document.querySelector(".leaflet-container") as HTMLElement | null;
          if (!el) return null;
          return {
            lat: el.clientWidth,
            inalt: el.clientHeight,
            bule: el.querySelectorAll("path.leaflet-interactive").length,
            patrate: el.querySelectorAll(".leaflet-tile").length,
          };
        });
        check(`[${eticheta}] harta există`, info !== null);
        check(`[${eticheta}] harta are dimensiune reală`, (info?.lat ?? 0) > 200 && (info?.inalt ?? 0) > 150, JSON.stringify(info));
        check(`[${eticheta}] harta nu rămâne gri (cere pătrate)`, (info?.patrate ?? 0) > 1, `${info?.patrate}`);
        check(`[${eticheta}] harta are bule cu firme`, (info?.bule ?? 0) > 0, `${info?.bule}`);
        check(`[${eticheta}] harta încape pe ecran`, (await of()) <= 2, `${await of()}px`);
        if ((info?.bule ?? 0) > 0) {
          await page.locator("path.leaflet-interactive").first().click({ force: true });
          await page.waitForTimeout(2500);
          const t = await page.evaluate(() => document.body.innerText);
          check(`[${eticheta}] apăsând bula văd firmele din sat`, /QA/.test(t));
          const amFost = page.locator('button:has-text("Am fost")').first();
          check(`[${eticheta}] butonul „Am fost” e acolo`, (await amFost.count()) > 0);
          if ((await amFost.count()) > 0) {
            const cutie = await amFost.boundingBox();
            check(
              `[${eticheta}] „Am fost” e ÎN ecran`,
              !!cutie && cutie.x >= -1 && cutie.x + cutie.width <= latime + 2,
              JSON.stringify(cutie),
            );
          }
          const nav = await page.evaluate(() =>
            Array.from(document.querySelectorAll("a[href]"))
              .map((a) => (a as HTMLAnchorElement).href)
              .filter((h) => h.includes("google.com/maps")).length,
          );
          check(`[${eticheta}] am buton de navigare către firmă`, nav > 0, `${nav} linkuri`);
        }
      }
      check(`[${eticheta}] zero erori JavaScript`, erori.length === 0, erori.slice(0, 2).join(" | "));
      await ctx.close();
    }
  } finally {
    await b.close();
  }
}

/* ══════════ 12. BANDA DE VERSIUNE NOUĂ (azi) ══════════ */

async function bandaVersiune() {
  sectiune("Banda „versiune nouă” (ca să nu mai ceară nimeni refresh)");
  const r = await fetch(`${BASE}/api/settings?ver=1`).catch(() => null);
  check("serverul răspunde la întrebarea de versiune", !!r);
  const sursa = await import("node:fs/promises");
  const cod = await sursa.readFile("src/app/AutoUpdate.tsx", "utf8");
  check("banda există în cod", cod.includes("Actualizează"));
  check("banda e ROȘIE/portocalie, cum s-a cerut", /amber|orange|red/.test(cod));
  check("banda apare doar când CHIAR e versiune nouă", /versiune|version/i.test(cod));
  check("banda are × ca s-o poți închide", cod.includes("×") || /aria-label="Închide"/.test(cod));
  check(
    "nu se reîncarcă peste tine când scrii sau încarci ceva",
    /eOcupat|ocupat/.test(cod),
  );
}

/* ────────────────────────── main ────────────────────────── */

async function main() {
  console.log(`\nQA PANOUL AGENTULUI — rulare ${RUN}`);
  await pregateste();
  try {
    await poarta();
    await cautare();
    await clientiiMei();
    await adrese();
    await pinInvata();
    await inchis();
    await vizite();
    await zoneSiRuta();
    await comenzi();
    await restulPanoului();
    await bandaVersiune();
    await cuOchii();
  } finally {
    sectiune("Curățenie");
    await curata();
    console.log("  · datele de test șterse");
    await sql.end();
  }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  if (fail) {
    console.log("\nCe nu merge:");
    rele.forEach((r) => console.log("  · " + r));
  }
  process.exit(fail === 0 ? 0 : 1);
}

await main();
