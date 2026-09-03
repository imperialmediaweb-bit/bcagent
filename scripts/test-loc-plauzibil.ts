/**
 * BULA DIN MOLDOVA — nu se mai întâmplă, și ce era stricat se repară.
 *
 * Gavrileț (03.09): pe harta lui, o bulă de sat stătea în Republica
 * Moldova. Oamenii conduc după hărțile astea. Cauza: toate „verificările
 * România" din cod erau un dreptunghi care cuprinde toată Moldova, iar
 * centrul satului se lua din MEDIA pinurilor — un singur pin pus greșit
 * muta tot satul. Suita verifică garda geometrică pe datele noastre:
 *
 *   · un centru de sat la peste 120 km de restul județului nu se scrie;
 *   · un pin pus cu degetul la 300 km de județul firmei e refuzat, cu
 *     motiv pe înțeles — dar unul la 60 km (județ mare, la margine) trece;
 *   · GPS-ul aiurea nu scrie pin (vizita se salvează oricum);
 *   · ce era deja stricat se repară la deschiderea hărții, fără să se
 *     șteargă vreo poziție bună;
 *   · fără destule sate cunoscute, garda tace (nu inventează refuzuri).
 *
 * Rulare:
 *   BASE_URL=... DATABASE_URL=... TOKEN_SECRET=... npx tsx scripts/test-loc-plauzibil.ts
 */
import postgres from "postgres";
import { signToken } from "../src/lib/signed-token";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const SECRET = process.env.TOKEN_SECRET ?? "test-secret-0123456789";
const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/postgres",
);

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
const sectiune = (t: string) => console.log(`\n══ ${t} ══`);

const RUN = `lp${Date.now().toString(36).slice(-6)}`;
const SUS = RUN.toUpperCase();
const org = `org-${RUN}`;
const agentId = `ag-${RUN}`;
const nume = `Loc Om ${RUN}`;

/** Județ MARE cu destule sate: Tulcea, în jurul mijlocului ei real. */
const J = "TL";
const CENTRU = { lat: 45.1, lng: 28.8 };
/** Chișinău — în dreptunghiul «România» al codului vechi, dar peste Prut. */
const MOLDOVA = { lat: 46.99, lng: 28.85 };
/** La ~60 km de mijloc, tot în județ: trebuie acceptat. */
const LA_MARGINE = { lat: 45.6, lng: 28.95 };
/** Județ MIC în date: doar 2 sate cunoscute → garda tace. */
const J_MIC = "MH";
/**
 * Al doilea județ cu destule sate: Cluj, la ~400 km de Tulcea ȘI de
 * Chișinău. (Constanța nu merge aici: e la ~100 km de mijlocul Tulcei,
 * sub pragul de 120 km — un magazin de acolo E plauzibil pentru TL.)
 */
const J2 = "CJ";
const CENTRU2 = { lat: 46.77, lng: 23.6 };
const sateSeed2 = Array.from({ length: 10 }, (_, i) => `LPSEED2 ${i} ${SUS}`);
const MAG_MOLDOVA = `${RUN}:mag:moldova`;
const MAG_J2 = `${RUN}:mag:ct`;
const MAG_TL = `${RUN}:mag:tl`;

const CHEIE = [7, 5, 3, 2, 1, 7, 5, 3, 2];
function faCuiValid(baza: string): string {
  const cifre = baza.split("").map(Number);
  const cheie = CHEIE.slice(CHEIE.length - cifre.length);
  let suma = 0;
  for (let i = 0; i < cifre.length; i++) suma += cifre[i] * cheie[i];
  const rest = (suma * 10) % 11;
  return baza + String(rest === 10 ? 0 : rest);
}
const baza = Date.now().toString().slice(-6);
const cui = (i: number) => faCuiValid(`7${baza}${i}`.slice(0, 9));
const CUI_BUN = cui(0); // firmă în satul bun
const CUI_RAU = cui(1); // firmă cu pin în Moldova
const CUI_MIC = cui(2); // firmă în județul mic
const CUIURI = [CUI_BUN, CUI_RAU, CUI_MIC];

const SAT_BUN = `LPSAT BUN ${SUS}`;
const SAT_RAU = `LPSAT RAU ${SUS}`;
const SAT_STRICAT = `LPSAT STRICAT ${SUS}`;
const SAT_MIC = `LPSAT MIC ${SUS}`;
const sateSeed = Array.from({ length: 12 }, (_, i) => `LPSEED ${i} ${SUS}`);

async function curata() {
  await sql`DELETE FROM visits WHERE agent_id = ${agentId}`.catch(() => {});
  await sql`DELETE FROM geo_firme WHERE cui = ANY(${CUIURI})`.catch(() => {});
  await sql`DELETE FROM prospects WHERE cui = ANY(${CUIURI})`;
  await sql`DELETE FROM geo_localitati WHERE localitate = ANY(${[
    ...sateSeed, ...sateSeed2, SAT_BUN, SAT_RAU, SAT_STRICAT, SAT_MIC, `LPMIC A ${SUS}`, `LPMIC B ${SUS}`,
  ]})`;
  await sql`DELETE FROM magazin_harta WHERE org_id = ${org}`.catch(() => {});
  await sql`DELETE FROM org_agents WHERE org_id = ${org}`;
  await sql`DELETE FROM organizations WHERE id = ${org}`;
}

async function main() {
  console.log(`\nLOC PLAUZIBIL — bula din Moldova — rulare ${RUN}`);
  await curata();
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${org}, ${"LP " + SUS}, ${RUN + "@lp.test"}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"lpa-" + RUN}, ${org}, ${agentId}, ${nume})`;
  // 12 sate cunoscute în jurul mijlocului județului — mediana are sens.
  for (const [i, s] of sateSeed.entries()) {
    await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
              VALUES (${J}, ${s}, ${CENTRU.lat + (i % 4) * 0.08 - 0.12}, ${CENTRU.lng + Math.floor(i / 4) * 0.1 - 0.1}, FALSE)`;
  }
  for (const [i, s2] of sateSeed2.entries()) {
    await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
              VALUES (${J2}, ${s2}, ${CENTRU2.lat + (i % 5) * 0.06 - 0.12}, ${CENTRU2.lng + Math.floor(i / 5) * 0.1 - 0.05}, FALSE)`;
  }
  // Magazinele de pe hartă: unul în Moldova scris la TL (rătăcit), unul
  // la CT scris la TL (măturare vecină, județ greșit), unul bun în TL.
  await sql`INSERT INTO magazin_harta (id, org_id, nume, judet, lat, lng, strat)
            VALUES (${MAG_MOLDOVA}, ${org}, 'MAG MOLDOVA', ${J}, ${MOLDOVA.lat}, ${MOLDOVA.lng}, 'osm'),
                   (${MAG_J2}, ${org}, 'MAG J2', ${J}, ${CENTRU2.lat}, ${CENTRU2.lng}, 'osm'),
                   (${MAG_TL}, ${org}, 'MAG TL', ${J}, ${CENTRU.lat + 0.02}, ${CENTRU.lng + 0.02}, 'osm')`;
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES (${J}, ${SAT_BUN}, ${CENTRU.lat + 0.05}, ${CENTRU.lng + 0.05}, FALSE),
                   (${J}, ${SAT_STRICAT}, ${MOLDOVA.lat}, ${MOLDOVA.lng}, FALSE),
                   (${J_MIC}, ${"LPMIC A " + SUS}, 44.6, 22.7, FALSE),
                   (${J_MIC}, ${"LPMIC B " + SUS}, 44.7, 22.8, FALSE)`;
  await sql`
    INSERT INTO prospects (cui, denumire, adresa, localitate, judet, status, assigned_agent, assigned_org, activ)
    VALUES (${CUI_BUN}, ${"BUN " + SUS}, 'Str. 1', ${SAT_BUN}, ${J}, 'client', ${nume}, ${org}, TRUE),
           (${CUI_RAU}, ${"RAU " + SUS}, 'Str. 2', ${SAT_RAU}, ${J}, 'client', ${nume}, ${org}, TRUE),
           (${CUI_MIC}, ${"MIC " + SUS}, 'Str. 3', ${SAT_MIC}, ${J_MIC}, 'client', ${nume}, ${org}, TRUE)
  `;
  // Pinul stricat, «exact», pus cu degetul în Moldova — cauza bulei.
  await sql`INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
            VALUES (${CUI_RAU}, ${MOLDOVA.lat}, ${MOLDOVA.lng}, FALSE, FALSE, 'deget')`;

  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tok = await signToken({ agentId, agentName: nume, exp }, SECRET);
  const geo = async (judet: string) => {
    const r = await fetch(`${BASE}/api/prospects/geo?token=${tok}&judet=${judet}&geocode=0`);
    return {
      s: r.status,
      d: (await r.json()) as {
        localities?: Array<{ localitate: string; lat: number | null; lng: number | null }>;
        reparate?: { localitati: number; pini: number };
      },
    };
  };
  const pin = (c: string, p: { lat: number; lng: number }, sursa = "deget", acc?: number) =>
    fetch(`${BASE}/api/prospects/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tok, cui: c, lat: p.lat, lng: p.lng, sursa, acc }),
    });

  try {
    sectiune("Deschiderea hărții repară ce era stricat");
    const h = await geo(J);
    check("harta răspunde", h.s === 200, `status ${h.s}`);
    check("satul cu centrul în Moldova a fost resetat",
      (h.d.reparate?.localitati ?? 0) >= 1, JSON.stringify(h.d.reparate));
    check("pinul din Moldova a fost resetat", (h.d.reparate?.pini ?? 0) >= 1, JSON.stringify(h.d.reparate));
    // Satul stricat n-are firme, deci nu apare în lista de bule (lista
    // vine din firme). Ce contează: în bază nu mai are coordonata din
    // Moldova, și dacă apare în listă, apare fără poziție.
    const stricat = (h.d.localities ?? []).find((l) => l.localitate === SAT_STRICAT);
    const [stricatDb] = await sql<Array<{ lat: number | null; failed: boolean }>>`
      SELECT lat, failed FROM geo_localitati WHERE judet = ${J} AND localitate = ${SAT_STRICAT}`;
    check("…și satul NU mai are coordonata din Moldova (se geocodează din nou)",
      stricatDb?.lat === null && stricatDb?.failed === false && (!stricat || stricat.lat === null),
      JSON.stringify({ db: stricatDb, lista: stricat }));
    const rau = (h.d.localities ?? []).find((l) => l.localitate === SAT_RAU);
    check("satul cu pinul stricat NU primește centru din pinul ăla",
      !!rau && rau.lat === null, JSON.stringify(rau));
    const bun = (h.d.localities ?? []).find((l) => l.localitate === SAT_BUN);
    check("satul bun a rămas neatins", bun?.lat === CENTRU.lat + 0.05, `${bun?.lat}`);
    const [pinRau] = await sql<Array<{ lat: number | null; sursa: string }>>`
      SELECT lat, sursa FROM geo_firme WHERE cui = ${CUI_RAU}`;
    check("pinul stricat e marcat «gresit», fără coordonată (nu șters)",
      pinRau?.lat === null && pinRau?.sursa === "gresit", JSON.stringify(pinRau));
    const [seedNeatins] = await sql<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM geo_localitati
      WHERE judet = ${J} AND localitate = ANY(${sateSeed}) AND lat IS NOT NULL`;
    check("niciun sat bun n-a fost atins de reparație", seedNeatins.n === "12", `${seedNeatins.n} din 12`);
    const h2 = await geo(J);
    check("a doua deschidere nu mai are ce repara",
      h2.d.reparate?.localitati === 0 && h2.d.reparate?.pini === 0, JSON.stringify(h2.d.reparate));

    sectiune("Pinul pus cu degetul: refuzat departe, acceptat la margine");
    const rMoldova = await pin(CUI_BUN, MOLDOVA);
    const dMoldova = (await rMoldova.json()) as { error?: string };
    check("pin în Moldova pentru o firmă din TL → refuzat", rMoldova.status === 400, `status ${rMoldova.status}`);
    check("…cu motiv pe înțeles, cu distanța în km", /km/.test(dMoldova.error ?? ""), dMoldova.error);
    const rMargine = await pin(CUI_BUN, LA_MARGINE);
    check("pin la ~60 km de mijloc (județ mare, la margine) → acceptat", rMargine.status === 200, `status ${rMargine.status}`);
    const [pinBun] = await sql<Array<{ lat: number }>>`SELECT lat FROM geo_firme WHERE cui = ${CUI_BUN}`;
    check("…și chiar s-a scris", pinBun?.lat === LA_MARGINE.lat, `${pinBun?.lat}`);
    const rGps = await pin(CUI_BUN, MOLDOVA, "gps", 30);
    check("«Sunt aici» cu GPS aiurea → refuzat la fel", rGps.status === 400, `status ${rGps.status}`);
    const [pinDupa] = await sql<Array<{ lat: number }>>`SELECT lat FROM geo_firme WHERE cui = ${CUI_BUN}`;
    check("…iar pinul bun n-a fost suprascris", pinDupa?.lat === LA_MARGINE.lat, `${pinDupa?.lat}`);

    sectiune("«Am fost» cu GPS aiurea: vizita se salvează, pinul nu");
    await sql`DELETE FROM geo_firme WHERE cui = ${CUI_BUN}`;
    const rViz = await fetch(`${BASE}/api/visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: tok, cui: CUI_BUN, denumire: "BUN", result: "gandeste",
        lat: MOLDOVA.lat, lng: MOLDOVA.lng, acc: 40,
      }),
    });
    check("vizita se salvează", rViz.status === 200, `status ${rViz.status}`);
    const [pinViz] = await sql<Array<{ lat: number | null }>>`SELECT lat FROM geo_firme WHERE cui = ${CUI_BUN}`;
    check("…dar firma NU primește pin în Moldova", !pinViz || pinViz.lat === null, JSON.stringify(pinViz));
    const [viz] = await sql<[{ n: string }]>`SELECT COUNT(*)::text AS n FROM visits WHERE agent_id = ${agentId}`;
    check("vizita e în bază", viz.n === "1", viz.n);

    sectiune("Fără destule sate cunoscute, garda tace (nu inventează)");
    const rMic = await pin(CUI_MIC, MOLDOVA);
    check("județ cu 2 sate cunoscute: pinul trece doar prin dreptunghi (comportament vechi)",
      rMic.status === 200, `status ${rMic.status}`);
    const hMic = await geo(J_MIC);
    check("și repararea nu atinge nimic acolo",
      hMic.d.reparate?.localitati === 0 && hMic.d.reparate?.pini === 0, JSON.stringify(hMic.d.reparate));

    sectiune("Magazinele de pe hartă: doar județul ales, rătăciții ascunși");
    const mag = async (judet: string) => {
      const r = await fetch(
        `${BASE}/api/prospects/magazine-harta?token=${tok}${judet ? `&judet=${judet}` : ""}`,
      );
      return (await r.json()) as {
        magazine?: Array<{ id: string; nume: string }>;
        reparate?: { mutate: number; ascunse: number };
      };
    };
    const mTL = await mag(J);
    const ids = (mTL.magazine ?? []).map((m) => m.id);
    check("magazinul din Moldova a fost ascuns", (mTL.reparate?.ascunse ?? 0) >= 1, JSON.stringify(mTL.reparate));
    check("magazinul din Cluj scris la TL a fost mutat la Cluj", (mTL.reparate?.mutate ?? 0) >= 1, JSON.stringify(mTL.reparate));
    check("pe harta din TL apare magazinul bun", ids.includes(MAG_TL));
    check("…dar NU cel din Moldova", !ids.includes(MAG_MOLDOVA));
    check("…și NU cel din Cluj", !ids.includes(MAG_J2));
    const mCT = await mag(J2);
    check("pe harta din Cluj apare magazinul mutat acolo", (mCT.magazine ?? []).some((m) => m.id === MAG_J2));
    const [stMold] = await sql<Array<{ stare: string }>>`SELECT stare FROM magazin_harta WHERE id = ${MAG_MOLDOVA}`;
    check("cel din Moldova e marcat «in_afara», nu șters", stMold?.stare === "in_afara", stMold?.stare);
    const [jCT] = await sql<Array<{ judet: string }>>`SELECT judet FROM magazin_harta WHERE id = ${MAG_J2}`;
    check("cel din Cluj poartă acum județul CJ", jCT?.judet === J2, jCT?.judet);
    const mToate = await mag("");
    check("fără județ (compatibilitate) tot nu apare rătăcitul din Moldova",
      !(mToate.magazine ?? []).some((m) => m.id === MAG_MOLDOVA));
    const mDoi = await mag(J);
    check("a doua cerere nu mai are ce repara", mDoi.reparate?.mutate === 0 && mDoi.reparate?.ascunse === 0, JSON.stringify(mDoi.reparate));

    sectiune("Cereri stricate");
    const faraToken = await fetch(`${BASE}/api/prospects/pin`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cui: CUI_BUN, lat: 45, lng: 28 }),
    });
    check("fără token → 401", faraToken.status === 401, `status ${faraToken.status}`);
    const inOcean = await pin(CUI_BUN, { lat: 0, lng: 0 });
    check("în ocean → refuzat de dreptunghi", inOcean.status === 400, `status ${inOcean.status}`);
    const nan = await fetch(`${BASE}/api/prospects/pin`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tok, cui: CUI_BUN, lat: "aiurea", lng: null }),
    });
    check("coordonate care nu-s numere → refuzat", nan.status === 400, `status ${nan.status}`);
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
