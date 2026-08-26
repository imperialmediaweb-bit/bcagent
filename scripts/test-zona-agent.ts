/**
 * PUNTEA: zona scrisă de manager → ruta de pe telefonul agentului.
 *
 * Bogdan trimite zonele pe WhatsApp și le lipește în panoul firmei, pe
 * zile. Până acum se opreau acolo: agentul tot trebuia să-și adune singur
 * opririle de pe hartă („nu îmi dă nici un traseu" — Costin, din teren).
 * Suita asta verifică veriga nouă, cap-coadă:
 *
 *   managerul salvează zona pe luni
 *     → agentul cere /api/routes/zona și primește satele lui de luni
 *     → primește CLIENȚII lui din satele alea, în ordinea scrisă de șef
 *     → apasă „Fă-mi ruta de azi" și ruta se salvează pe ziua curentă
 *     → de acolo merge tot ce era: etape, navigare, „continuă de unde ai rămas"
 *
 * Plus ce nu are voie să se întâmple: agentul altei firme nu vede zona
 * noastră, iar în rută nu intră clienții colegului sau firmele închise.
 *
 * Rulare:
 *   BASE_URL=... DATABASE_URL=... TOKEN_SECRET=... SESSION_SECRET=... \
 *   npx tsx scripts/test-zona-agent.ts
 */
import postgres from "postgres";
import { signToken } from "../src/lib/signed-token";
import { COOKIE_NAME, semneazaSesiuneTest } from "./_sesiune-test";

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
function sectiune(t: string) {
  console.log(`\n══ ${t} ══`);
}

/** Ziua de AZI, în cheia folosită de aplicație. */
const ZILE = ["duminica", "luni", "marti", "miercuri", "joi", "vineri", "sambata"];
const AZI = ZILE[new Date().getDay()];
/** O zi care sigur NU e azi — ca să verificăm că zilele nu se amestecă. */
const ALTA_ZI = ZILE[(new Date().getDay() + 3) % 7];

const RUN = `zn${Date.now().toString(36).slice(-6)}`;
const SUS = RUN.toUpperCase();
const orgMea = `org-${RUN}`;
const orgAlta = `orgx-${RUN}`;
const idEu = `ag-${RUN}-eu`;
const idColeg = `ag-${RUN}-coleg`;
const idStrain = `ag-${RUN}-strain`;
const numeEu = `Zona Eu ${RUN}`;
const numeColeg = `Zona Coleg ${RUN}`;
const numeStrain = `Zona Strain ${RUN}`;
const email = `${RUN}@zona.test`;
const baza = Date.now().toString().slice(-7);
const cui = (i: number) => `66${baza}${i}`;

// Trei sate din zona de AZI + unul care e pe ALTĂ zi.
const S1 = `ZSAT UNU ${SUS}`;
const S2 = `ZSAT DOI ${SUS}`;
const S3 = `ZSAT TREI ${SUS}`;
const S_ALTA_ZI = `ZSAT ALTAZI ${SUS}`;

interface Oprire {
  cui: string;
  denumire: string;
  localitate: string;
  adresa: string;
  telefon: string;
}
interface RaspunsZona {
  zi?: string;
  localitati?: string[];
  stops?: Oprire[];
  alteFirme?: number;
  error?: string;
}

async function pregateste() {
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgMea}, ${"ZONA MEA " + SUS}, ${email}, 'trial', 9),
                   (${orgAlta}, ${"ZONA ALTA " + SUS}, ${RUN + "x@zona.test"}, 'trial', 9)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"za1-" + RUN}, ${orgMea}, ${idEu}, ${numeEu}),
                   (${"za2-" + RUN}, ${orgMea}, ${idColeg}, ${numeColeg}),
                   (${"za3-" + RUN}, ${orgAlta}, ${idStrain}, ${numeStrain})`;

  const firme: Array<[number, string, string, string, string, boolean]> = [
    // [i, denumire, sat, agent, status, activ]
    [0, `CLIENT UNU A ${SUS}`, S1, numeEu, "client", true],
    [1, `CLIENT UNU B ${SUS}`, S1, numeEu, "client", true],
    [2, `CLIENT DOI ${SUS}`, S2, numeEu, "client", true],
    [3, `CLIENT TREI ${SUS}`, S3, numeEu, "client", true],
    // clientul COLEGULUI, în satul meu de azi — NU intră în ruta mea
    [4, `CLIENT COLEG ${SUS}`, S1, numeColeg, "client", true],
    // clientul meu, dar în satul de ALTĂ zi — nu are ce căuta azi
    [5, `CLIENT ALTAZI ${SUS}`, S_ALTA_ZI, numeEu, "client", true],
    // prospect liber în satul de azi — nu e client, dar se numără la „mai sunt"
    [6, `PROSPECT UNU ${SUS}`, S1, "", "nou", true],
    [7, `PROSPECT DOI ${SUS}`, S2, "", "nou", true],
    // clientul altei firme, în satul meu — nici pomeneală să intre
    [8, `CLIENT STRAIN ${SUS}`, S1, numeStrain, "client", true],
  ];
  for (const [i, den, sat, agent, status, activ] of firme) {
    await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ, telefon)
              VALUES (${cui(i)}, ${den}, ${"Str. Test nr. " + (i + 1)}, ${sat}, 'SV',
                      '4711', ${status}, ${agent}, ${activ}, ${"07600000" + i})`;
  }
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('SV', ${S1}, 47.60, 26.20, FALSE),
                   ('SV', ${S2}, 47.62, 26.22, FALSE),
                   ('SV', ${S3}, 47.64, 26.24, FALSE),
                   ('SV', ${S_ALTA_ZI}, 47.66, 26.26, FALSE)
            ON CONFLICT (judet, localitate) DO UPDATE
              SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, failed = FALSE`;
}

async function curata() {
  const cuis = Array.from({ length: 9 }, (_, i) => cui(i));
  await sql`DELETE FROM routes WHERE agent_id IN (${idEu}, ${idColeg}, ${idStrain})`.catch(() => {});
  await sql`DELETE FROM visits WHERE cui = ANY(${cuis})`.catch(() => {});
  await sql`DELETE FROM agent_zone WHERE org_id IN (${orgMea}, ${orgAlta})`;
  await sql`DELETE FROM prospect_inchis WHERE cui = ANY(${cuis})`.catch(() => {});
  await sql`DELETE FROM geo_firme WHERE cui = ANY(${cuis})`.catch(() => {});
  await sql`DELETE FROM prospects WHERE cui = ANY(${cuis})`;
  await sql`DELETE FROM geo_localitati WHERE localitate IN (${S1}, ${S2}, ${S3}, ${S_ALTA_ZI})`;
  await sql`DELETE FROM org_agents WHERE org_id IN (${orgMea}, ${orgAlta})`;
  await sql`DELETE FROM organizations WHERE id IN (${orgMea}, ${orgAlta})`;
}

async function main() {
  console.log(`\nZONA → RUTĂ (azi e „${AZI}") — rulare ${RUN}`);
  await pregateste();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tokEu = await signToken({ agentId: idEu, agentName: numeEu, exp }, SECRET);
  const tokColeg = await signToken({ agentId: idColeg, agentName: numeColeg, exp }, SECRET);
  const tokStrain = await signToken({ agentId: idStrain, agentName: numeStrain, exp }, SECRET);

  const zona = async (t: string, zi = "") => {
    const r = await fetch(
      `${BASE}/api/routes/zona?token=${t}${zi ? `&zi=${zi}` : ""}`,
    );
    return { s: r.status, d: (await r.json()) as RaspunsZona };
  };

  try {
    sectiune("Înainte ca managerul să scrie ceva");
    const goala = await zona(tokEu);
    check("agentul fără zonă primește răspuns curat, nu eroare", goala.s === 200, `status ${goala.s}`);
    check("…cu listă goală de sate", (goala.d.localitati ?? []).length === 0);
    check("…și fără opriri", (goala.d.stops ?? []).length === 0);
    check("…dar știe ce zi e azi", goala.d.zi === AZI, `zi=${goala.d.zi}`);

    sectiune("Managerul scrie zonele, exact ca pe WhatsApp");
    const ck = `${COOKIE_NAME}=${await semneazaSesiuneTest({
      userId: `usr-${RUN}`,
      orgId: orgMea,
      email,
      name: "Bogdan",
      role: "owner",
    })}`;
    const text = `${AZI} - ${S1}, ${S2}, ${S3}\n${ALTA_ZI}: ${S_ALTA_ZI}`;
    const salv = await fetch(`${BASE}/api/agentie/zone`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: ck },
      body: JSON.stringify({ agent: numeEu, text }),
    });
    const dSalv = (await salv.json()) as { ok?: boolean; gasite?: unknown[] };
    check("zona se salvează din panoul firmei", salv.status === 200, `status ${salv.status}`);
    check("…cu toate cele 4 sate recunoscute", (dSalv.gasite ?? []).length === 4, `${(dSalv.gasite ?? []).length}`);

    sectiune("Agentul deschide telefonul dimineața");
    const azi = await zona(tokEu);
    check("primește zona zilei", azi.s === 200, `status ${azi.s}`);
    check("are exact satele de azi (3), nu și pe cel de altă zi",
      (azi.d.localitati ?? []).length === 3, (azi.d.localitati ?? []).join(","));
    check("satele vin în ORDINEA scrisă de șef",
      (azi.d.localitati ?? []).join("|") === [S1, S2, S3].join("|"),
      (azi.d.localitati ?? []).join("|"));
    check("satul de altă zi NU e în lista de azi",
      !(azi.d.localitati ?? []).includes(S_ALTA_ZI));

    const nume = (azi.d.stops ?? []).map((s) => s.denumire);
    check("primește CLIENȚII lui din satele de azi", nume.length === 4, `${nume.length}: ${nume.join(",")}`);
    check("…toți patru, cu numele lor", [0, 1, 2, 3].every((i) => nume.some((n) => n.includes(`${SUS}`) && n.includes(["CLIENT UNU A", "CLIENT UNU B", "CLIENT DOI", "CLIENT TREI"][i]))), nume.join(","));
    check("clientul COLEGULUI nu intră în ruta mea", !nume.some((n) => n.includes("CLIENT COLEG")));
    check("clientul altei FIRME nu intră deloc", !nume.some((n) => n.includes("CLIENT STRAIN")));
    check("clientul meu din satul de altă zi nu intră azi", !nume.some((n) => n.includes("CLIENT ALTAZI")));
    check("prospecții liberi nu intră în rută (nu-s clienți)", !nume.some((n) => n.includes("PROSPECT")));
    check("…dar sunt număraţi ca «mai ai unde bate»", (azi.d.alteFirme ?? 0) === 2, `alteFirme=${azi.d.alteFirme}`);

    const primele = (azi.d.stops ?? []).map((s) => s.localitate);
    check("opririle sunt grupate pe sate, în ordinea șefului",
      primele[0] === S1 && primele[1] === S1 && primele[2] === S2 && primele[3] === S3,
      primele.join(" → "));
    const s0 = (azi.d.stops ?? [])[0];
    check("fiecare oprire vine cu adresa ei", !!s0?.adresa && s0.adresa.length > 3, s0?.adresa);
    check("…și cu telefonul clientului", !!s0?.telefon && s0.telefon.length >= 9, s0?.telefon);

    sectiune("Cine n-a mai fost vizitat de mult, primul");
    // Vizităm clientul UNU A acum: la reîncărcare trebuie să treacă DUPĂ
    // UNU B, care n-a fost vizitat niciodată.
    await fetch(`${BASE}/api/visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokEu, cui: cui(0), denumire: "UNU A", result: "gandeste" }),
    });
    const dupaVizita = await zona(tokEu);
    const inS1 = (dupaVizita.d.stops ?? []).filter((s) => s.localitate === S1).map((s) => s.denumire);
    check(
      "în sat, cel nevizitat trece înaintea celui vizitat azi",
      inS1[0]?.includes("UNU B") === true,
      inS1.join(" → "),
    );

    sectiune("Ce a închis agentul pe teren nu mai intră în rută");
    await fetch(`${BASE}/api/visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokEu, cui: cui(3), denumire: "TREI", result: "inchis" }),
    });
    const dupaInchis = await zona(tokEu);
    check(
      "clientul închis dispare din ruta zilei",
      !(dupaInchis.d.stops ?? []).some((s) => s.denumire.includes("CLIENT TREI")),
      (dupaInchis.d.stops ?? []).map((s) => s.denumire).join(","),
    );

    sectiune("„Fă-mi ruta de azi” chiar salvează ruta");
    const stops = dupaInchis.d.stops ?? [];
    const facut = await fetch(`${BASE}/api/routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokEu, name: `Zona de ${AZI}`, day: AZI, stops }),
    });
    check("ruta din zonă se salvează", facut.status === 200, `status ${facut.status}`);
    const listaR = await fetch(`${BASE}/api/routes?token=${tokEu}`);
    const dR = (await listaR.json()) as {
      routes?: Array<{ name: string; day: string; stops: Oprire[] }>;
    };
    const rAzi = (dR.routes ?? []).find((x) => x.day === AZI);
    check("ruta apare pe ziua de azi", !!rAzi, (dR.routes ?? []).map((x) => x.day).join(","));
    check("ruta are toate opririle din zonă", (rAzi?.stops ?? []).length === stops.length,
      `${rAzi?.stops.length} vs ${stops.length}`);
    check("ruta păstrează adresele (altfel navigația e oarbă)",
      (rAzi?.stops ?? []).every((s) => !!s.adresa));

    // Exact ce face „Ziua mea" cu ea.
    const { planRoute } = await import("../src/lib/route-nav");
    const plan = planRoute(rAzi?.stops ?? [], [], "SV");
    check("din rută iese traseu de navigare", (plan.etape?.length ?? 0) >= 1);
    check("linkul e de Google Maps", /google\.com\/maps/.test(plan.etape?.[0]?.url ?? ""));
    check("nicio oprire nu se pierde pe drum",
      (plan.etape ?? []).reduce((s, e) => s + e.stops.length, 0) + (plan.sarite ?? 0) === stops.length);

    sectiune("Zilele nu se amestecă");
    const alta = await zona(tokEu, ALTA_ZI);
    check("pot cere și altă zi", alta.s === 200 && alta.d.zi === ALTA_ZI, `zi=${alta.d.zi}`);
    check("ziua cealaltă are satul ei", (alta.d.localitati ?? []).join("") === S_ALTA_ZI,
      (alta.d.localitati ?? []).join(","));
    check("…și clientul ei", (alta.d.stops ?? []).some((s) => s.denumire.includes("CLIENT ALTAZI")));
    const ziAiurea = await zona(tokEu, "ziua-lui-peste");
    check("o zi inventată cade pe AZI, nu crapă", ziAiurea.s === 200 && ziAiurea.d.zi === AZI, `zi=${ziAiurea.d.zi}`);

    sectiune("Izolare: zona e a mea, nu a oricui");
    const colegZona = await zona(tokColeg);
    check("colegul din firma mea NU-mi vede zona (n-are una a lui)",
      (colegZona.d.localitati ?? []).length === 0, (colegZona.d.localitati ?? []).join(","));
    const strainZona = await zona(tokStrain);
    check("agentul altei firme nu vede nimic din zona noastră",
      (strainZona.d.localitati ?? []).length === 0 && (strainZona.d.stops ?? []).length === 0);
    const faraToken = await fetch(`${BASE}/api/routes/zona`);
    check("fără link valid → 401", faraToken.status === 401, `status ${faraToken.status}`);
    const tokenStricat = await fetch(`${BASE}/api/routes/zona?token=${tokEu}xx`);
    check("link ciupit → 401", tokenStricat.status === 401, `status ${tokenStricat.status}`);

    sectiune("AGENTUL își scrie singur zonele, de pe telefon");
    const scrie = async (t: string, corp: Record<string, unknown>) => {
      const r = await fetch(`${BASE}/api/routes/zona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: t, ...corp }),
      });
      return {
        s: r.status,
        d: (await r.json()) as {
          gasite?: Array<{ zi: string; localitate: string }>;
          negasite?: Array<{ scris: string; sugestii: string[] }>;
          salvate?: number;
          error?: string;
        },
      };
    };
    // Colegul își scrie zona lui — scris de om, cu diacritice lipsă.
    const prev = await scrie(tokColeg, {
      text: `${AZI} - ${S2.toLowerCase()}, ${S3.toLowerCase()}`,
      verificaDoar: true,
    });
    check("agentul poate cere «verifică ce am înțeles»", prev.s === 200, `status ${prev.s}`);
    check("…și primește satele recunoscute", (prev.d.gasite ?? []).length === 2,
      (prev.d.gasite ?? []).map((g) => g.localitate).join(","));
    check("…scrise cu litere mici, tot le găsește",
      (prev.d.gasite ?? []).every((g) => [S2, S3].includes(g.localitate)));
    const inainte = await sql`
      SELECT 1 FROM agent_zone WHERE org_id = ${orgMea} AND agent_name = ${numeColeg}`;
    check("«verifică» NU salvează nimic (doar arată)", inainte.length === 0, `${inainte.length} rânduri`);

    const salvColeg = await scrie(tokColeg, { text: `${AZI} - ${S2}, ${S3}` });
    check("agentul își salvează zona", salvColeg.s === 200 && salvColeg.d.salvate === 2,
      `salvate=${salvColeg.d.salvate}`);
    const colegDupa = await zona(tokColeg);
    check("…și o primește înapoi ca zonă de azi",
      (colegDupa.d.localitati ?? []).join("|") === [S2, S3].join("|"),
      (colegDupa.d.localitati ?? []).join(","));

    const gresit = await scrie(tokColeg, {
      text: `${AZI} - sat-care-nu-exista-nicaieri`,
      verificaDoar: true,
    });
    check("satul inexistant e raportat, nu ghicit", (gresit.d.negasite ?? []).length === 1,
      JSON.stringify(gresit.d.negasite));
    const gol = await scrie(tokColeg, { text: "", verificaDoar: true });
    check("text gol → răspuns curat, nu eroare", gol.s === 200 && (gol.d.gasite ?? []).length === 0);

    const scriuLaAltul = await scrie(tokStrain, { text: `${AZI} - ${S1}` });
    check("agentul altei firme nu poate scrie în firma mea", scriuLaAltul.s === 200, `status ${scriuLaAltul.s}`);
    const scurs = await sql<Array<{ agent_name: string }>>`
      SELECT agent_name FROM agent_zone WHERE org_id = ${orgMea}`;
    check("…zona lui chiar a intrat la firma LUI, nu la a mea",
      !scurs.some((r) => r.agent_name === numeStrain),
      scurs.map((r) => r.agent_name).join(","));
    const faraLink = await fetch(`${BASE}/api/routes/zona`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `${AZI} - ${S1}` }),
    });
    check("fără link nu se scriu zone", faraLink.status === 401, `status ${faraLink.status}`);

    sectiune("Ce scrie agentul vede managerul, și invers");
    const vedeSeful = await fetch(`${BASE}/api/agentie/zone`, { headers: { cookie: ck } });
    const dSef = (await vedeSeful.json()) as {
      agenti?: Array<{ nume: string; zone: Array<{ localitate: string; zi: string }> }>;
    };
    const zonaColeg = (dSef.agenti ?? []).find((a) => a.nume === numeColeg);
    check("managerul vede în panoul firmei zona scrisă de agent",
      (zonaColeg?.zone ?? []).length === 2,
      `${(zonaColeg?.zone ?? []).length} rânduri`);
    check("…pe ziua corectă", (zonaColeg?.zone ?? []).every((z) => z.zi === AZI));

    sectiune("Cine a pus zona ultima dată (ca să nu vă suprascrieți orbește)");
    // Agentul tocmai și-a scris-o singur.
    const dupaAgent = await zona(tokColeg);
    const uAgent = (dupaAgent.d as { ultima?: { pusDe: string; cand: string } | null }).ultima;
    check("după ce își scrie agentul, scrie numele LUI", uAgent?.pusDe === numeColeg, `pusDe=${uAgent?.pusDe}`);
    check("…și când a pus-o", !!uAgent?.cand && !Number.isNaN(Date.parse(uAgent.cand)), uAgent?.cand);

    // Acum o suprascrie managerul din panoul firmei.
    await fetch(`${BASE}/api/agentie/zone`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: ck },
      body: JSON.stringify({ agent: numeColeg, text: `${AZI} - ${S1}` }),
    });
    const dupaSef = await zona(tokColeg);
    const uSef = (dupaSef.d as { ultima?: { pusDe: string; cand: string } | null }).ultima;
    check("după ce o schimbă șeful, agentul vede că el a pus-o", uSef?.pusDe === "Bogdan", `pusDe=${uSef?.pusDe}`);
    check("…și zona chiar e cea a șefului", (dupaSef.d.localitati ?? []).join("") === S1,
      (dupaSef.d.localitati ?? []).join(","));
    const sefVede = await fetch(`${BASE}/api/agentie/zone`, { headers: { cookie: ck } });
    const dSefVede = (await sefVede.json()) as {
      agenti?: Array<{ nume: string; ultima?: { pusDe: string } | null }>;
    };
    check("și în panoul firmei scrie cine a pus-o",
      (dSefVede.agenti ?? []).find((a) => a.nume === numeColeg)?.ultima?.pusDe === "Bogdan",
      JSON.stringify((dSefVede.agenti ?? []).find((a) => a.nume === numeColeg)?.ultima));

    sectiune("Managerul schimbă zona, agentul o vede schimbată");
    const text2 = `${AZI} - ${S2}`;
    await fetch(`${BASE}/api/agentie/zone`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: ck },
      body: JSON.stringify({ agent: numeEu, text: text2 }),
    });
    const dupa = await zona(tokEu);
    check("zona nouă înlocuiește zona veche",
      (dupa.d.localitati ?? []).join("") === S2, (dupa.d.localitati ?? []).join(","));
    check("opririle se strâng la satul rămas",
      (dupa.d.stops ?? []).every((s) => s.localitate === S2),
      (dupa.d.stops ?? []).map((s) => s.localitate).join(","));
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
