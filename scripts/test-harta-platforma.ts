/**
 * ADMINUL PLATFORMEI ADUCE LOCAȚIILE PENTRU O FIRMĂ.
 *
 * „Sau dacă intru în contul lui Bogdan… pot face asta?" — se poate, dar
 * nu e curat: i-ar sări alerta de „dispozitiv nou", i-ar apărea în jurnal
 * ca făcut de EL, iar dacă iese ceva strâmb nu s-ar mai ști cine a apăsat.
 * De-aia importul se poate face din panoul de platformă, de unde e locul
 * lui — și rămâne scris în jurnal cine l-a făcut.
 *
 * Suita verifică exact ce contează la o unealtă care scrie în datele
 * clientului: cine are voie, ce scrie, ce NU are voie să strice, și că
 * se poate da înapoi.
 *
 * Rulare:
 *   BASE_URL=... DATABASE_URL=... SESSION_SECRET=... npx tsx scripts/test-harta-platforma.ts
 */
import postgres from "postgres";
import { signSession } from "../src/modules/platform/session";

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

const RUN = `hp${Date.now().toString(36).slice(-6)}`;
const SUS = RUN.toUpperCase();
const orgA = `orga-${RUN}`;
const orgB = `orgb-${RUN}`;
const numeA = `HP Agent A ${RUN}`;
const numeB = `HP Agent B ${RUN}`;
const baza = Date.now().toString().slice(-7);
const cui = (i: number) => `12${baza}${i}`;

/** Harta firmei A: patru magazine, unul dintre ele al firmei B. */
const KML = `<kml><Document>
  <!-- DOUĂ magazine în EXACT același punct. Pe harta reală a lui Bogdan
       sunt zeci așa (puse la centrul satului). Dacă identificatorul lor
       vine doar din coordonate, importul crapă tot. -->
  <Placemark><name>DOI LA FEL UNU ${SUS}</name><Point><coordinates>26.65,47.85,0</coordinates></Point></Placemark>
  <Placemark><name>DOI LA FEL DOI ${SUS}</name><Point><coordinates>26.65,47.85,0</coordinates></Point></Placemark>
  <Placemark><name>ALFA ${SUS} SRL</name><Point><coordinates>26.61,47.81,0</coordinates></Point></Placemark>
  <Placemark><name>BETA ${SUS} SRL</name><Point><coordinates>26.62,47.82,0</coordinates></Point></Placemark>
  <Placemark><name>GAMA ${SUS} SRL</name><Point><coordinates>26.63,47.83,0</coordinates></Point></Placemark>
  <Placemark><name>CEVA NECUNOSCUT ${SUS}</name><Point><coordinates>26.64,47.84,0</coordinates></Point></Placemark>
</Document></kml>`;

async function pregateste() {
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgA}, ${"HP A " + SUS}, ${RUN + "a@hp.test"}, 'trial', 5),
                   (${orgB}, ${"HP B " + SUS}, ${RUN + "b@hp.test"}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"hpa-" + RUN}, ${orgA}, ${"aga-" + RUN}, ${numeA}),
                   (${"hpb-" + RUN}, ${orgB}, ${"agb-" + RUN}, ${numeB})`;
  const firme: Array<[number, string, string]> = [
    [0, `ALFA ${SUS} SRL`, numeA],
    [1, `BETA ${SUS} SRL`, numeA],
    [2, `GAMA ${SUS} SRL`, numeB], // clientul ALTEI firme
  ];
  for (const [i, den, ag] of firme) {
    await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ)
      VALUES (${cui(i)}, ${den}, 'Str. Test 1', ${"HPSAT " + SUS}, 'BT', '4711',
              'client', ${ag}, TRUE)`;
  }
  // Agentul a pus DEJA locul primei firme, din teren.
  await sql`INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
            VALUES (${cui(0)}, 47.101, 26.101, FALSE, FALSE, 'deget')`;
}

async function curata() {
  const cuis = [0, 1, 2].map(cui);
  await sql`DELETE FROM magazin_harta WHERE org_id IN (${orgA}, ${orgB})`.catch(() => {});
  await sql`DELETE FROM geo_firme WHERE cui = ANY(${cuis})`.catch(() => {});
  await sql`DELETE FROM prospects WHERE cui = ANY(${cuis})`;
  await sql`DELETE FROM org_agents WHERE org_id IN (${orgA}, ${orgB})`;
  await sql`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`;
}

async function main() {
  console.log(`\nIMPORT DIN PANOUL DE PLATFORMĂ — rulare ${RUN}`);
  await pregateste();
  const ckAdmin = `bcagent_admin=${await signSession({
    adminId: `adm-${RUN}`,
    email: "admin@provendi.ro",
    role: "platform_admin",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}`;

  const cere = async (org: string, corp: Record<string, unknown>, cookie = ckAdmin) => {
    const r = await fetch(`${BASE}/api/platform/orgs/${org}/harta`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(corp),
    });
    return {
      s: r.status,
      d: (await r.json()) as {
        error?: string;
        scrise?: number;
        sterse?: number;
        totalPuncte?: number;
        nesigure?: number;
      },
    };
  };
  const pin = async (c: string) =>
    (await sql<Array<{ lat: number; sursa: string }>>`
      SELECT lat, sursa FROM geo_firme WHERE cui = ${c}`)[0];

  try {
    sectiune("Cine are voie");
    const faraCont = await fetch(`${BASE}/api/platform/orgs/${orgA}/harta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kml: KML }),
    });
    check("fără cont de platformă → refuzat", faraCont.status >= 400, `status ${faraCont.status}`);
    check("…și nu s-a scris nimic", !(await pin(cui(1))));

    const cuContDeFirma = await cere(orgA, { kml: KML }, "bcagent_org=ceva-inventat");
    check(
      "cu un cookie de firmă, nu de platformă → refuzat",
      cuContDeFirma.s >= 400,
      `status ${cuContDeFirma.s}`,
    );

    sectiune("Importul propriu-zis");
    const r = await cere(orgA, { kml: KML });
    check("adminul platformei poate rula importul", r.s === 200, `status ${r.s} ${r.d.error ?? ""}`);
    check("a citit toate cele 6 magazine din hartă", r.d.totalPuncte === 6, `${r.d.totalPuncte}`);
    check(
      "…inclusiv două aflate în EXACT același punct (nu crapă importul)",
      r.s === 200 && !/Eroare/i.test(r.d.error ?? ""),
      r.d.error,
    );
    check("a scris locul unde numele se potrivește", (r.d.scrise ?? 0) >= 1, `scrise=${r.d.scrise}`);
    const pinBeta = await pin(cui(1));
    check("firma fără loc a primit unul", !!pinBeta);
    check("…marcat ca venit din import", pinBeta?.sursa === "import", pinBeta?.sursa);

    sectiune("Ce NU are voie să strice");
    const pinAgent = await pin(cui(0));
    check(
      "locul pus de agent pe teren a rămas neatins",
      Math.abs((pinAgent?.lat ?? 0) - 47.101) < 0.0001,
      `${pinAgent?.lat}`,
    );
    check("…și tot „deget” scrie pe el", pinAgent?.sursa === "deget", pinAgent?.sursa);
    check(
      "clientul ALTEI firme n-a primit loc de la importul ăsta",
      !(await pin(cui(2))),
      (await pin(cui(2)))?.sursa,
    );
    check(
      "ce n-a găsit e numărat, nu ghicit",
      (r.d.nesigure ?? 0) >= 1,
      `nesigure=${r.d.nesigure}`,
    );

    sectiune("Magazinele fără pereche NU se aruncă");
    // 1756 din harta reală n-au pereche în registru — dar sunt magazine
    // adevărate, cu locul pus de mână. Sunt puncte de prospectare.
    const salvate = await sql<Array<{ nume: string; org_id: string; lat: number }>>`
      SELECT nume, org_id, lat FROM magazin_harta WHERE org_id = ${orgA}`;
    check(
      "magazinul necunoscut e păstrat ca punct de prospectare",
      salvate.some((m) => m.nume.includes("CEVA NECUNOSCUT")),
      salvate.map((m) => m.nume).join(","),
    );
    check("…cu coordonatele lui", salvate.some((m) => Math.abs(m.lat - 47.84) < 0.001));
    check(
      "…și e al firmei ăsteia, nu al alteia",
      salvate.every((m) => m.org_id === orgA),
    );
    const laVecini = await sql`SELECT 1 FROM magazin_harta WHERE org_id = ${orgB}`;
    check("firma vecină n-a primit nimic", laVecini.length === 0, `${laVecini.length}`);
    check(
      "cele două din același punct s-au păstrat AMÂNDOUĂ",
      salvate.filter((m) => m.nume.includes("DOI LA FEL")).length === 2,
      `${salvate.filter((m) => m.nume.includes("DOI LA FEL")).length}`,
    );

    // Reimportul aceleiași hărți nu dublează magazinele.
    const inainteReimport = (
      await sql<[{ n: string }]>`SELECT COUNT(*)::text AS n FROM magazin_harta WHERE org_id = ${orgA}`
    )[0].n;
    await cere(orgA, { kml: KML });
    const dupaReimport = (
      await sql<[{ n: string }]>`SELECT COUNT(*)::text AS n FROM magazin_harta WHERE org_id = ${orgA}`
    )[0].n;
    check(
      "reimportul aceleiași hărți NU dublează magazinele",
      inainteReimport === dupaReimport,
      `${inainteReimport} → ${dupaReimport}`,
    );

    sectiune("Agentul le vede pe ale firmei lui, și numai pe alea");
    const { signToken } = await import("../src/lib/signed-token");
    const expT = Math.floor(Date.now() / 1000) + 3600;
    const tokA = await signToken(
      { agentId: `aga-${RUN}`, agentName: numeA, exp: expT },
      process.env.TOKEN_SECRET ?? "test-secret-0123456789",
    );
    const tokB = await signToken(
      { agentId: `agb-${RUN}`, agentName: numeB, exp: expT },
      process.env.TOKEN_SECRET ?? "test-secret-0123456789",
    );
    const vedeA = await (
      await fetch(`${BASE}/api/prospects/magazine-harta?token=${tokA}`)
    ).json();
    const vedeB = await (
      await fetch(`${BASE}/api/prospects/magazine-harta?token=${tokB}`)
    ).json();
    check(
      "agentul firmei A vede magazinele aduse de firma lui",
      ((vedeA.magazine ?? []) as Array<{ nume: string }>).some((m) =>
        m.nume.includes("CEVA NECUNOSCUT"),
      ),
    );
    check(
      "agentul firmei B NU le vede",
      ((vedeB.magazine ?? []) as unknown[]).length === 0,
      `${((vedeB.magazine ?? []) as unknown[]).length}`,
    );
    const faraToken = await fetch(`${BASE}/api/prospects/magazine-harta`);
    check("fără link valid → 401", faraToken.status === 401, `status ${faraToken.status}`);

    sectiune("Agentul confirmă ce a văzut cu ochii lui");
    // Harta veche poate fi de acum trei ani: unele magazine s-au închis,
    // altele s-au mutat. Agentul care trece pe-acolo spune ce e.
    const magId = (
      await sql<Array<{ id: string }>>`
        SELECT id FROM magazin_harta WHERE org_id = ${orgA} LIMIT 1`
    )[0]?.id;
    const spune = async (tok: string, id: string, stare: string, lat?: number, lng?: number) => {
      const r = await fetch(`${BASE}/api/prospects/magazine-harta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tok, id, stare, lat, lng }),
      });
      return { s: r.status, d: (await r.json()) as { error?: string } };
    };

    const conf = await spune(tokA, magId, "exista", 47.8500, 26.6500);
    check("agentul poate confirma că magazinul există", conf.s === 200, `status ${conf.s} ${conf.d.error ?? ""}`);
    const dupaConf = (
      await sql<Array<{ stare: string; confirmat_de: string; lat: number }>>`
        SELECT stare, confirmat_de, lat FROM magazin_harta WHERE id = ${magId}`
    )[0];
    check("…se scrie ce a găsit", dupaConf?.stare === "exista", dupaConf?.stare);
    check("…și cine a confirmat", dupaConf?.confirmat_de === numeA, dupaConf?.confirmat_de);
    check(
      "…iar pinul se mută pe locul adevărat (era chiar acolo)",
      Math.abs((dupaConf?.lat ?? 0) - 47.85) < 0.0001,
      `${dupaConf?.lat}`,
    );

    const alStrain = await spune(tokB, magId, "inchis");
    check(
      "agentul altei firme NU poate atinge magazinul nostru",
      alStrain.s === 403,
      `status ${alStrain.s}`,
    );
    const neatins = (
      await sql<Array<{ stare: string }>>`SELECT stare FROM magazin_harta WHERE id = ${magId}`
    )[0];
    check("…și starea a rămas cum a pus-o al nostru", neatins?.stare === "exista", neatins?.stare);

    const gresit = await spune(tokA, magId, "habar-n-am");
    check("o stare inventată e refuzată", gresit.s === 400, `status ${gresit.s}`);
    const faraId = await spune(tokA, "", "exista");
    check("fără magazin ales → refuz clar", faraId.s === 400, `status ${faraId.s}`);

    sectiune("Ce a găsit închis nu mai apare pe hartă");
    const inainteTaiere = ((await (await fetch(
      `${BASE}/api/prospects/magazine-harta?token=${tokA}`,
    )).json()).magazine as unknown[]).length;
    await spune(tokA, magId, "inchis");
    const dupaTaiere = ((await (await fetch(
      `${BASE}/api/prospects/magazine-harta?token=${tokA}`,
    )).json()).magazine as unknown[]).length;
    check(
      "magazinul tăiat dispare de pe hartă",
      dupaTaiere === inainteTaiere - 1,
      `${inainteTaiere} → ${dupaTaiere}`,
    );
    check(
      "…dar rămâne în bază, cu cine l-a tăiat",
      (
        await sql`SELECT 1 FROM magazin_harta WHERE id = ${magId} AND stare = 'inchis'`
      ).length === 1,
    );

    sectiune("Rămâne scris cine a făcut-o");
    const jurnal = await sql<Array<{ action: string; actor: string }>>`
      SELECT action, actor FROM audit_log
      WHERE target = ${orgA} AND action = 'harta.import'
      ORDER BY created_at DESC LIMIT 1`;
    check("importul intră în jurnal", jurnal.length === 1, `${jurnal.length}`);
    check(
      "…pe numele adminului de platformă, nu al clientului",
      jurnal[0]?.actor === "admin@provendi.ro",
      jurnal[0]?.actor,
    );

    sectiune("Anularea");
    const anul = await cere(orgA, { anuleaza: true });
    check("anularea merge", anul.s === 200 && (anul.d.sterse ?? 0) >= 1, `sterse=${anul.d.sterse}`);
    check("locul adus din hartă a dispărut", !(await pin(cui(1))));
    const dupa = await pin(cui(0));
    check(
      "LOCUL AGENTULUI A RĂMAS",
      Math.abs((dupa?.lat ?? 0) - 47.101) < 0.0001,
      `${dupa?.lat}`,
    );
    check("…și anularea e și ea în jurnal", (
      await sql`SELECT 1 FROM audit_log WHERE target = ${orgA} AND action = 'harta.anuleaza'`
    ).length === 1);

    sectiune("Marginile");
    const faraLink = await cere(orgA, {});
    check("fără link și fără fișier → mesaj clar", faraLink.s === 400, `status ${faraLink.s}`);
    const kmlProst = await cere(orgA, { kml: "buna ziua" });
    check("fișier care nu e hartă → mesaj clar, nu 500", kmlProst.s === 422, `status ${kmlProst.s}`);
    const orgInexistent = await cere(`org-care-nu-exista-${RUN}`, { kml: KML });
    check(
      "firmă inexistentă → refuz politicos",
      orgInexistent.s >= 400,
      `status ${orgInexistent.s}`,
    );
  } finally {
    sectiune("Curățenie");
    await sql`DELETE FROM audit_log WHERE target IN (${orgA}, ${orgB})`.catch(() => {});
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
