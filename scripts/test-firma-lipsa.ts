/**
 * FIRMELE CARE NU-S ÎN REGISTRU — cazul lui Costin, verificat pe cifre.
 *
 * Costin a raportat trei clienți ai lui care „nu-s pe hartă":
 * SC AndroCament SRL (Hilișeu-Crișan), SC Turism Premier Laur SRL și
 * I.I. Plugariu (Broscăuți). Două cauze, amândouă verificate aici:
 *
 *   1. FILTRUL DE DOMENIU ascundea orice firmă fără CAEN știut. Fișierul
 *      de la Finanțe n-are coloană CAEN, deci mii de firme intră cu
 *      domeniul gol — și dispăreau din hartă în TOATE satele.
 *   2. IMPORTUL DE CLIENȚI nu crea firmele lipsă: le arăta o dată și le
 *      pierdea. Acum rămân scrise și se pot aduce în registru.
 *
 * Rulare:
 *   BASE_URL=... DATABASE_URL=... TOKEN_SECRET=... SESSION_SECRET=... \
 *   npx tsx scripts/test-firma-lipsa.ts
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
const sectiune = (t: string) => console.log(`\n══ ${t} ══`);

const RUN = `fl${Date.now().toString(36).slice(-6)}`;
const SUS = RUN.toUpperCase();
const orgMea = `org-${RUN}`;
const orgAlta = `orgx-${RUN}`;
const idEu = `ag-${RUN}-eu`;
const idStrain = `ag-${RUN}-strain`;
const numeEu = `Lipsa Eu ${RUN}`;
const numeStrain = `Lipsa Strain ${RUN}`;
const email = `${RUN}@lipsa.test`;
/**
 * CUI-uri cu cifră de control ADEVĂRATĂ. De când aducerea firmelor
 * verifică cifra de control (registrul e comun: un rând stricat îl vede
 * toată lumea), un CUI inventat n-ar mai trece nicăieri — și testul ar
 * verifica refuzul, nu drumul.
 */
const CHEIE_CUI = [7, 5, 3, 2, 1, 7, 5, 3, 2];
function faCuiValid(baza: string): string {
  const cifre = baza.split("").map(Number);
  const cheie = CHEIE_CUI.slice(CHEIE_CUI.length - cifre.length);
  let suma = 0;
  for (let i = 0; i < cifre.length; i++) suma += cifre[i] * cheie[i];
  const rest = (suma * 10) % 11;
  return baza + String(rest === 10 ? 0 : rest);
}
const baza = Date.now().toString().slice(-6);
const cui = (i: number) => faCuiValid(`9${baza}${i}`.slice(0, 9));
const SAT = `LSAT UNU ${SUS}`;

/** Firma fără CAEN, exact ca cele venite din fișierul de la Finanțe. */
const CUI_FARA_CAEN = cui(0);
/** Firma cu CAEN de alt domeniu (materiale de construcții, ca AndroCament). */
const CUI_ALT_DOMENIU = cui(1);
/** Firma care lipsește cu totul din registru — o aduce importul. */
const CUI_LIPSA = cui(2);
/** Firma altei agenții — nu se atinge. */
const CUI_STRAIN = cui(3);
const CUIURI = [CUI_FARA_CAEN, CUI_ALT_DOMENIU, CUI_LIPSA, CUI_STRAIN];

async function curata() {
  await sql`DELETE FROM clienti_nepotriviti WHERE org_id IN (${orgMea}, ${orgAlta})`.catch(() => {});
  await sql`DELETE FROM magazin_harta WHERE org_id IN (${orgMea}, ${orgAlta})`.catch(() => {});
  await sql`DELETE FROM geo_firme WHERE cui = ANY(${CUIURI})`.catch(() => {});
  await sql`DELETE FROM geo_localitati WHERE localitate = ${SAT}`.catch(() => {});
  await sql`DELETE FROM prospects WHERE cui = ANY(${CUIURI})`;
  await sql`DELETE FROM org_agents WHERE org_id IN (${orgMea}, ${orgAlta})`;
  await sql`DELETE FROM organizations WHERE id IN (${orgMea}, ${orgAlta})`;
}

async function main() {
  console.log(`\nFIRME LIPSĂ DIN REGISTRU — rulare ${RUN}`);
  await curata();
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgMea}, ${"LIPSA MEA " + SUS}, ${email}, 'trial', 9),
                   (${orgAlta}, ${"LIPSA ALTA " + SUS}, ${RUN + "x@lipsa.test"}, 'trial', 9)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"fla-" + RUN}, ${orgMea}, ${idEu}, ${numeEu}),
                   (${"flb-" + RUN}, ${orgAlta}, ${idStrain}, ${numeStrain})`;
  // Firma FĂRĂ CAEN (ca cele de la Finanțe) și una cu CAEN de alt domeniu.
  await sql`
    INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, activ)
    VALUES (${CUI_FARA_CAEN}, ${"FARA CAEN " + SUS}, 'Str. Test 1', ${SAT}, 'BT', '', 'nou', TRUE),
           (${CUI_ALT_DOMENIU}, ${"CIMENT " + SUS}, 'Str. Test 2', ${SAT}, 'BT', '4752', 'nou', TRUE),
           (${CUI_STRAIN}, ${"AL VECINEI " + SUS}, 'Str. Test 3', ${SAT}, 'BT', '', 'client', TRUE)
  `;
  await sql`UPDATE prospects SET assigned_agent = ${numeStrain}, assigned_org = ${orgAlta}
            WHERE cui = ${CUI_STRAIN}`;
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('BT', ${SAT}, 47.90, 26.50, FALSE)
            ON CONFLICT (judet, localitate) DO UPDATE SET lat = 47.90, lng = 26.50, failed = FALSE`;

  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tok = await signToken({ agentId: idEu, agentName: numeEu, exp }, SECRET);
  const ck = `${COOKIE_NAME}=${await semneazaSesiuneTest({
    userId: `usr-${RUN}`,
    orgId: orgMea,
    email,
    name: "Bogdan",
    role: "owner",
  })}`;

  try {
    sectiune("Filtrul de domeniu nu mai ascunde firmele fără CAEN știut");
    // Presetul „alimentare" (fmcg) — exact cum pornește harta agentului.
    const fmcg = "4711,4719,4725,4726,5610,5630";
    const r1 = await fetch(
      `${BASE}/api/prospects?token=${tok}&judet=BT&localitate=${encodeURIComponent(SAT)}&caenIn=${fmcg}&limit=50`,
    );
    const d1 = (await r1.json()) as { prospects?: Array<{ cui: string; denumire: string }> };
    const gasite = (d1.prospects ?? []).map((p) => p.cui);
    check("ruta răspunde", r1.status === 200, `status ${r1.status}`);
    check(
      "firma FĂRĂ CAEN apare, deși filtrul e pe alimentare",
      gasite.includes(CUI_FARA_CAEN),
      `găsite: ${(d1.prospects ?? []).map((p) => p.denumire).join(", ")}`,
    );
    check(
      "firma cu CAEN de ALT domeniu rămâne ascunsă (filtrul chiar filtrează)",
      !gasite.includes(CUI_ALT_DOMENIU),
    );

    sectiune("Bulele de pe hartă numără la fel");
    const r2 = await fetch(`${BASE}/api/prospects/geo?token=${tok}&judet=BT&geocode=0`);
    const d2 = (await r2.json()) as {
      localities?: Array<{ localitate: string; count: number }>;
    };
    const satul = (d2.localities ?? []).find((l) => l.localitate === SAT);
    check("satul are bulă pe hartă", !!satul, JSON.stringify(d2.localities?.slice(0, 3)));
    check("…și numără și firma fără CAEN", (satul?.count ?? 0) >= 1, `count=${satul?.count}`);

    sectiune("Clienții nepotriviți la import nu se mai pierd");
    const fisier = [
      { name: `ANDRO ${SUS} SRL`, cui: CUI_LIPSA, agent: numeEu, adresa: "Str. Noua 5", localitate: SAT },
      { name: `FARA CUI ${SUS} SRL`, cui: "", agent: numeEu, adresa: "", localitate: SAT },
    ];
    const imp = await fetch(`${BASE}/api/agentie/clients-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: ck },
      body: JSON.stringify({ clients: fisier }),
    });
    const dImp = (await imp.json()) as { unmatched?: string[] };
    check("importul răspunde", imp.status === 200, `status ${imp.status}`);
    check("amândouă sunt raportate ca nepotrivite", (dImp.unmatched ?? []).length === 2,
      JSON.stringify(dImp.unmatched));

    const lista = await fetch(`${BASE}/api/agentie/clienti-lipsa`, { headers: { cookie: ck } });
    const dLista = (await lista.json()) as {
      clienti?: Array<{ id: string; denumire: string; cui: string }>;
      cuCui?: number;
    };
    check("lista rămâne scrisă în bază, nu doar pe ecran",
      (dLista.clienti ?? []).length === 2, `${(dLista.clienti ?? []).length}`);
    check("…și spune câte au CUI (doar alea se pot crea)", dLista.cuCui === 1, `${dLista.cuCui}`);

    sectiune("Aducerea în registru");
    const adu = await fetch(`${BASE}/api/agentie/clienti-lipsa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: ck },
      body: JSON.stringify({}),
    });
    const dAdu = (await adu.json()) as { create?: number; alocate?: number };
    check("firma cu CUI intră în registru", dAdu.create === 1, JSON.stringify(dAdu));
    check("…și e alocată agentului din fișier", dAdu.alocate === 1, `${dAdu.alocate}`);

    const [f] = await sql<Array<{ status: string; assigned_agent: string; adus_de_org: string }>>`
      SELECT status, assigned_agent, adus_de_org FROM prospects WHERE cui = ${CUI_LIPSA}`;
    check("firma nouă e client al agentului", f?.status === "client" && f?.assigned_agent === numeEu,
      JSON.stringify(f));
    check("…și scrie cine a adus-o (nu se dă drept dată de la Finanțe)",
      f?.adus_de_org === orgMea, f?.adus_de_org);

    const dupa = await fetch(`${BASE}/api/agentie/clienti-lipsa`, { headers: { cookie: ck } });
    const dDupa = (await dupa.json()) as { clienti?: unknown[] };
    check("cea adusă iese din listă, cea fără CUI rămâne",
      (dDupa.clienti ?? []).length === 1, `${(dDupa.clienti ?? []).length}`);

    sectiune("Acum agentul chiar o vede");
    const r3 = await fetch(
      `${BASE}/api/prospects?token=${tok}&judet=BT&localitate=${encodeURIComponent(SAT)}&caenIn=${fmcg}&aiMei=1&limit=50`,
    );
    const d3 = (await r3.json()) as { prospects?: Array<{ cui: string }> };
    check("firma adusă apare pe harta agentului",
      (d3.prospects ?? []).some((p) => p.cui === CUI_LIPSA));

    sectiune("Ce nu are voie să se întâmple");
    const [strain] = await sql<Array<{ assigned_agent: string; assigned_org: string }>>`
      SELECT assigned_agent, assigned_org FROM prospects WHERE cui = ${CUI_STRAIN}`;
    check("clientul altei agenții a rămas al ei",
      strain?.assigned_agent === numeStrain && strain?.assigned_org === orgAlta,
      JSON.stringify(strain));

    // A doua rulare nu trebuie să dubleze nimic.
    const dinNou = await fetch(`${BASE}/api/agentie/clienti-lipsa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: ck },
      body: JSON.stringify({}),
    });
    const dDinNou = (await dinNou.json()) as { create?: number };
    check("a doua apăsare nu creează duplicate", (dDinNou.create ?? 0) === 0, JSON.stringify(dDinNou));
    const [cate] = await sql<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM prospects WHERE cui = ${CUI_LIPSA}`;
    check("firma există o singură dată", cate.n === "1", cate.n);

    const faraSesiune = await fetch(`${BASE}/api/agentie/clienti-lipsa`);
    check("fără sesiune de firmă → refuz", faraSesiune.status === 401 || faraSesiune.status === 403,
      `status ${faraSesiune.status}`);

    sectiune("Agentul aduce firma din teren, cu CUI-ul de pe firmă");
    const CUI_TEREN = cui(4);
    await sql`DELETE FROM prospects WHERE cui = ${CUI_TEREN}`.catch(() => {});
    const adaug = await fetch(`${BASE}/api/prospects/magazine-harta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: tok,
        adauga: {
          nume: `MAGAZIN TEREN ${SUS}`,
          cui: CUI_TEREN,
          lat: 47.91,
          lng: 26.51,
          localitate: SAT,
          judet: "BT",
        },
      }),
    });
    const dAdaug = (await adaug.json()) as { ok?: boolean; cui?: string };
    check("magazinul se adaugă", adaug.status === 200 && dAdaug.ok === true, `status ${adaug.status}`);
    check("…și firma necunoscută intră în registru, legată de magazin",
      dAdaug.cui === CUI_TEREN, `cui=${dAdaug.cui}`);
    const [fTeren] = await sql<Array<{ adus_de_org: string; assigned_agent: string }>>`
      SELECT adus_de_org, assigned_agent FROM prospects WHERE cui = ${CUI_TEREN}`;
    check("firma adusă din teren poartă numele agentului și al firmei lui",
      fTeren?.assigned_agent === numeEu && fTeren?.adus_de_org === orgMea,
      JSON.stringify(fTeren));
    await sql`DELETE FROM prospects WHERE cui = ${CUI_TEREN}`.catch(() => {});
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
