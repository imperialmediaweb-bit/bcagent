/**
 * IMPORTUL DIN MY MAPS, CAP-COADĂ.
 *
 * Suita cealaltă (test-harta-mymaps) verifică citirea și potrivirea, care
 * sunt funcții pure. Aici verificăm ce se întâmplă cu ADEVĂRAT în bază
 * când managerul apasă „Salvează": ce se scrie, ce NU se scrie, și mai
 * ales ce nu are voie să atingă.
 *
 * Partea periculoasă e ultima: dacă o firmă ar putea scrie coordonate pe
 * clienții alteia, i-ar putea trimite agenții unde vrea. Se verifică în
 * ambele sensuri.
 *
 * Rulare:
 *   BASE_URL=... DATABASE_URL=... SESSION_SECRET=... npx tsx scripts/test-harta-import-api.ts
 */
import postgres from "postgres";
import { COOKIE_NAME, semneazaSesiuneTest } from "./_sesiune-test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
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

const RUN = `hi${Date.now().toString(36).slice(-6)}`;
const SUS = RUN.toUpperCase();
const orgMea = `org-${RUN}`;
const orgAlta = `orgx-${RUN}`;
const numeEu = `HI Eu ${RUN}`;
const numeStrain = `HI Strain ${RUN}`;
const email = `${RUN}@hi.test`;
const emailX = `${RUN}x@hi.test`;
const baza = Date.now().toString().slice(-7);
const cui = (i: number) => `99${baza}${i}`;

const LOC: [number, number] = [47.8211, 26.3344];

async function pregateste() {
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgMea}, ${"HI MEA " + SUS}, ${email}, 'trial', 5),
                   (${orgAlta}, ${"HI ALTA " + SUS}, ${emailX}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"hia-" + RUN}, ${orgMea}, ${"ag-" + RUN}, ${numeEu}),
                   (${"hib-" + RUN}, ${orgAlta}, ${"agx-" + RUN}, ${numeStrain})`;
  // 0,1 = ale mele; 2 = al firmei vecine; 3 = nealocat (registrul comun)
  const firme: Array<[number, string, string]> = [
    [0, `MAGAZIN UNU ${SUS} SRL`, numeEu],
    [1, `MAGAZIN DOI ${SUS} SRL`, numeEu],
    [2, `MAGAZIN STRAIN ${SUS} SRL`, numeStrain],
    [3, `MAGAZIN LIBER ${SUS} SRL`, ""],
  ];
  for (const [i, den, ag] of firme) {
    await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ)
      VALUES (${cui(i)}, ${den}, 'Str. Test 1', ${"HISAT " + SUS}, 'BT', '4711',
              'client', ${ag}, TRUE)`;
  }
}

async function curata() {
  const cuis = [0, 1, 2, 3].map(cui);
  await sql`DELETE FROM geo_firme WHERE cui = ANY(${cuis})`.catch(() => {});
  await sql`DELETE FROM prospects WHERE cui = ANY(${cuis})`;
  await sql`DELETE FROM org_agents WHERE org_id IN (${orgMea}, ${orgAlta})`;
  await sql`DELETE FROM organizations WHERE id IN (${orgMea}, ${orgAlta})`;
}

async function main() {
  console.log(`\nIMPORT MY MAPS, CAP-COADĂ — rulare ${RUN}`);
  await pregateste();
  const ck = `${COOKIE_NAME}=${await semneazaSesiuneTest({
    userId: `usr-${RUN}`,
    orgId: orgMea,
    email,
    name: "Bogdan",
    role: "owner",
  })}`;
  const ckX = `${COOKIE_NAME}=${await semneazaSesiuneTest({
    userId: `usr-${RUN}x`,
    orgId: orgAlta,
    email: emailX,
    name: "Altul",
    role: "owner",
  })}`;

  const cere = async (cookie: string, corp: Record<string, unknown>) => {
    const r = await fetch(`${BASE}/api/agentie/harta-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(corp),
    });
    return {
      s: r.status,
      d: (await r.json()) as {
        error?: string;
        scrise?: number;
        sarite?: number;
      },
    };
  };
  const pin = async (c: string) =>
    (await sql<Array<{ lat: number; lng: number; aprox: boolean }>>`
      SELECT lat, lng, aprox FROM geo_firme WHERE cui = ${c}`)[0];

  try {
    sectiune("Linkul dat de om");
    const faraLink = await cere(ck, { link: "", verificaDoar: true });
    check("link gol → mesaj clar, nu 500", faraLink.s === 400, `status ${faraLink.s}`);
    check("…pe românește", /link/i.test(faraLink.d.error ?? ""), faraLink.d.error);
    const linkProst = await cere(ck, { link: "https://facebook.com", verificaDoar: true });
    check("link care nu e de My Maps → refuz politicos", linkProst.s === 400);

    sectiune("Fără cont de firmă nu se atinge nimic");
    const faraCont = await fetch(`${BASE}/api/agentie/harta-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmate: [{ cui: cui(0), lat: LOC[0], lng: LOC[1] }] }),
    });
    check("fără sesiune → refuzat", faraCont.status === 401 || faraCont.status === 403,
      `status ${faraCont.status}`);
    check("…și nu s-a scris nimic", !(await pin(cui(0))));

    sectiune("Salvarea scrie DOAR ce a confirmat omul");
    const ok = await cere(ck, {
      confirmate: [
        { cui: cui(0), lat: LOC[0], lng: LOC[1] },
        { cui: cui(1), lat: LOC[0] + 0.001, lng: LOC[1] + 0.001 },
      ],
    });
    check("cele două locații se salvează", ok.s === 200 && ok.d.scrise === 2, JSON.stringify(ok.d));
    const p0 = await pin(cui(0));
    check("prima e în bază", !!p0);
    check("…cu coordonatele exacte", Math.abs((p0?.lat ?? 0) - LOC[0]) < 0.0001, `${p0?.lat}`);
    check("…marcată EXACTĂ, nu aproximativă", p0?.aprox === false);
    check("a doua e și ea în bază", !!(await pin(cui(1))));

    sectiune("Izolare: nu pot scrie pe clienții altei firme");
    const furt = await cere(ck, {
      confirmate: [{ cui: cui(2), lat: 44.0, lng: 26.0 }],
    });
    check("cererea nu crapă", furt.s === 200, `status ${furt.s}`);
    check("…dar n-a scris nimic", furt.d.scrise === 0, `scrise=${furt.d.scrise}`);
    check("…și o raportează ca sărită", (furt.d.sarite ?? 0) === 1, `sarite=${furt.d.sarite}`);
    check("clientul vecinilor n-are pin de la mine", !(await pin(cui(2))));

    sectiune("…iar ei nu pot scrie pe ai mei");
    const furtInvers = await cere(ckX, {
      confirmate: [{ cui: cui(0), lat: 44.5, lng: 26.5 }],
    });
    check("nici invers nu merge", furtInvers.d.scrise === 0, `scrise=${furtInvers.d.scrise}`);
    const dupa = await pin(cui(0));
    check(
      "…iar pinul meu a rămas neatins",
      Math.abs((dupa?.lat ?? 0) - LOC[0]) < 0.0001,
      `${dupa?.lat}`,
    );

    sectiune("Firmele nealocate din registrul comun");
    const liber = await cere(ck, {
      confirmate: [{ cui: cui(3), lat: LOC[0] + 0.01, lng: LOC[1] + 0.01 }],
    });
    check("un prospect nealocat poate primi loc", liber.d.scrise === 1, `scrise=${liber.d.scrise}`);

    sectiune("Coordonatele imposibile nu intră în bază");
    const aiurea = await cere(ck, {
      confirmate: [
        { cui: cui(0), lat: 6.5, lng: 3.0 },
        { cui: cui(1), lat: NaN, lng: 26.0 },
        { cui: "", lat: 47.8, lng: 26.3 },
      ],
    });
    check("toate trei sunt refuzate", aiurea.d.scrise === 0, `scrise=${aiurea.d.scrise}`);
    check("…și numărate ca sărite", (aiurea.d.sarite ?? 0) === 3, `sarite=${aiurea.d.sarite}`);
    const inca = await pin(cui(0));
    check(
      "pinul bun de dinainte n-a fost stricat",
      Math.abs((inca?.lat ?? 0) - LOC[0]) < 0.0001,
      `${inca?.lat}`,
    );

    sectiune("Lista goală");
    const gol = await cere(ck, { confirmate: [] });
    check("„n-am bifat nimic” nu e o eroare", gol.s === 200 && gol.d.scrise === 0);

    sectiune("Pagina se deschide");
    const pag = await fetch(`${BASE}/agentie/harta-import`, { headers: { cookie: ck } });
    check("pagina răspunde", pag.status === 200, `status ${pag.status}`);
    const html = await pag.text();
    check("are câmpul pentru link", /My Maps/i.test(html));
    check("spune că nimic nu se salvează pe încredere", /ce am înțeles/i.test(html));
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
