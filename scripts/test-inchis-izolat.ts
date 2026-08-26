/**
 * „ÎNCHIS" DIN TEREN — cine pe cine poate stinge.
 *
 * Registrul de firme e COMUN tuturor agențiilor. Un agent care apasă din
 * greșeală „Închis" pe o firmă care nu-i clientul nimănui n-are voie să
 * o șteargă de pe harta ALTEI agenții. Regulile verificate aici:
 *   1. clientul PROPRIU închis pe teren → se stinge global (îl cunoaștem)
 *      și primește `inchis_teren`, ca verificarea ANAF să nu-l reînvie;
 *   2. firma NEALOCATĂ închisă → dispare DOAR pentru firma care a
 *      închis-o; altă agenție o vede în continuare;
 *   3. clientul ALTEI agenții nu poate fi stins deloc;
 *   4. bulele hărții respectă aceleași reguli.
 *
 * Rulare: BASE_URL=... DATABASE_URL=... TOKEN_SECRET=... npx tsx scripts/test-inchis-izolat.ts
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
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

interface Firm {
  cui: string;
  denumire: string;
}

async function main() {
  const RUN = `ii${Date.now().toString(36).slice(-6)}`;
  const orgA = `orgA-${RUN}`;
  const orgB = `orgB-${RUN}`;
  const idA = `ag-${RUN}-a`;
  const idB = `ag-${RUN}-b`;
  const numeA = `Agent A ${RUN}`;
  const numeB = `Agent B ${RUN}`;
  const baza = Date.now().toString().slice(-7);
  const cui = (i: number) => `55${baza}${i}`;
  const SAT = `SAT INCHIS ${RUN.toUpperCase()}`;

  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgA}, 'INCHIS A SRL', ${RUN + "a@test.ro"}, 'trial', 5),
                   (${orgB}, 'INCHIS B SRL', ${RUN + "b@test.ro"}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"agt-" + RUN + "a"}, ${orgA}, ${idA}, ${numeA}),
                   (${"agt-" + RUN + "b"}, ${orgB}, ${idB}, ${numeB})`;
  await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ)
    VALUES
    (${cui(1)}, ${"CLIENTUL MEU MORT " + RUN}, 'Str. 1', ${SAT}, 'SV', '4711', 'client', ${numeA}, TRUE),
    (${cui(2)}, ${"FIRMA NEALOCATA " + RUN}, 'Str. 2', ${SAT}, 'SV', '4711', 'nou', '', TRUE),
    (${cui(3)}, ${"CLIENTUL AGENTIEI B " + RUN}, 'Str. 3', ${SAT}, 'SV', '4711', 'client', ${numeB}, TRUE)`;
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('SV', ${SAT}, 47.7, 26.1, FALSE)
            ON CONFLICT (judet, localitate) DO NOTHING`;

  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tokA = await signToken({ agentId: idA, agentName: numeA, exp }, SECRET);
  const tokB = await signToken({ agentId: idB, agentName: numeB, exp }, SECRET);

  const inchide = (token: string, c: string) =>
    fetch(`${BASE}/api/visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, cui: c, denumire: "x", result: "nu_mai_exista", note: "" }),
    });
  const lista = async (token: string) => {
    const p = new URLSearchParams({ token, judet: "SV", localitate: SAT, limit: "50", onlyActive: "1" });
    const r = await fetch(`${BASE}/api/prospects?${p}`);
    const d = (await r.json()) as { prospects?: Firm[] };
    return (d.prospects ?? []).map((f) => f.cui);
  };

  console.log("\n══ Clientul MEU, închis pe teren ══");
  await inchide(tokA, cui(1));
  const [c1] = await sql<Array<{ activ: boolean; inchis_teren: boolean }>>`
    SELECT activ, inchis_teren FROM prospects WHERE cui = ${cui(1)}
  `;
  check("clientul meu mort se stinge global", c1?.activ === false, JSON.stringify(c1));
  check("…și e marcat «închis din teren» (ANAF nu-l mai învie)", c1?.inchis_teren === true);

  console.log("\n══ Firma NEALOCATĂ, închisă de agentul A ══");
  await inchide(tokA, cui(2));
  const [c2] = await sql<Array<{ activ: boolean }>>`
    SELECT activ FROM prospects WHERE cui = ${cui(2)}
  `;
  check("firma nealocată NU se stinge global (registrul e comun)", c2?.activ === true, JSON.stringify(c2));
  const [inregistrare] = await sql<Array<{ org_id: string }>>`
    SELECT org_id FROM prospect_inchis WHERE cui = ${cui(2)}
  `;
  check("închiderea e trecută pe firma care a făcut-o", inregistrare?.org_id === orgA);
  const listaA = await lista(tokA);
  const listaB = await lista(tokB);
  check("agentul A nu o mai vede", !listaA.includes(cui(2)), JSON.stringify(listaA));
  check("agenția B o vede în continuare (harta ei e neatinsă)", listaB.includes(cui(2)), JSON.stringify(listaB));

  console.log("\n══ Clientul ALTEI agenții nu se poate stinge ══");
  await inchide(tokA, cui(3));
  const [c3] = await sql<Array<{ activ: boolean }>>`
    SELECT activ FROM prospects WHERE cui = ${cui(3)}
  `;
  check("clientul agenției B rămâne activ", c3?.activ === true, JSON.stringify(c3));
  const [inreg3] = await sql<Array<{ org_id: string }>>`
    SELECT org_id FROM prospect_inchis WHERE cui = ${cui(3)}
  `;
  check(
    "cel mult se ascunde la noi, nu la ei",
    !inreg3 || inreg3.org_id === orgA,
    JSON.stringify(inreg3),
  );

  console.log("\n══ Bulele hărții respectă aceleași reguli ══");
  const geo = async (token: string) => {
    const r = await fetch(
      `${BASE}/api/prospects/geo?token=${encodeURIComponent(token)}&judet=SV&geocode=0`,
    );
    const d = (await r.json()) as { localities?: Array<{ localitate: string; count: number }> };
    return (d.localities ?? []).find((l) => l.localitate === SAT);
  };
  const gA = await geo(tokA);
  const gB = await geo(tokB);
  check("satul are mai puține firme pentru A decât pentru B", (gA?.count ?? 99) < (gB?.count ?? 0), `A=${gA?.count} B=${gB?.count}`);

  console.log("\n══ Curățenie ══");
  await sql`DELETE FROM visits WHERE cui = ANY(${[cui(1), cui(2), cui(3)]})`;
  await sql`DELETE FROM prospect_inchis WHERE cui = ANY(${[cui(1), cui(2), cui(3)]})`;
  await sql`DELETE FROM prospects WHERE cui LIKE ${"55" + baza + "%"}`;
  await sql`DELETE FROM geo_localitati WHERE localitate = ${SAT}`;
  await sql`DELETE FROM org_agents WHERE org_id IN (${orgA}, ${orgB})`;
  await sql`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`;
  console.log("  · datele de test șterse");

  await sql.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
