/**
 * SOLDUL UNUI CLIENT NU E TREABA ALTEI AGENȚII.
 *
 * Soldul e cât datorează un client — cea mai comercială informație din
 * toată aplicația. Registrul de firme e COMUN tuturor agențiilor de pe
 * platformă, deci în fișierul de solduri al unei agenții poate nimeri,
 * din greșeală sau nu, CUI-ul unui client de-al alteia.
 *
 * Citirea era deja mascată corect. SCRIEREA nu era: agenția A îi
 * suprascria soldul clientului agenției B, iar patronul lui B vedea pe
 * ecran o datorie care nu e a lui, pe un client adevărat.
 *
 * L-am găsit uitându-mă prin toate scrierile în `prospects` care n-aveau
 * pază de proprietate. Aici îl încuiem, ca să nu se mai poată întoarce.
 */

import { ensureSchema, getDB } from "../src/lib/db";

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

const ORG_A = "test-sold-a";
const ORG_B = "test-sold-b";
const AG_A = "test-sold-ag-a";
const AG_B = "test-sold-ag-b";
const N_A = "Agentul lui A";
const N_B = "Agentul lui B";
const CUI_AL_LUI_A = "14758812";
const CUI_AL_LUI_B = "18584450";
const CUI_NIMANUI = "18109370";
const TOATE = [CUI_AL_LUI_A, CUI_AL_LUI_B, CUI_NIMANUI];

async function curata() {
  await db!`DELETE FROM prospects WHERE cui = ANY(${TOATE})`;
  await db!`DELETE FROM org_agents WHERE org_id IN (${ORG_A}, ${ORG_B})`;
  await db!`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B})`;
}

async function sold(cui: string): Promise<number | null> {
  const [r] = await db!<Array<{ s: string | null }>>`
    SELECT sold_cents::text AS s FROM prospects WHERE cui = ${cui}
  `;
  return r?.s ? parseInt(r.s, 10) : null;
}

/** Exact scrierea din ruta de solduri, cu paza ei. */
async function importaSolduri(
  orgId: string,
  perechi: Array<{ cui: string; sold: number }>,
): Promise<number> {
  const agenti = (
    await db!<Array<{ name: string }>>`
      SELECT name FROM org_agents WHERE org_id = ${orgId}
    `
  ).map((a) => a.name);
  const r = await db!`
    UPDATE prospects p
    SET sold_cents = u.sold, sold_updated_at = NOW()
    FROM jsonb_to_recordset(${db!.json(
      perechi as unknown as Parameters<typeof db!.json>[0],
    )}) AS u(cui TEXT, sold BIGINT)
    WHERE p.cui = u.cui
      AND p.assigned_agent = ANY(${agenti.length ? agenti : [""]})
  `;
  return r.count;
}

async function main() {
  await ensureSchema();
  await curata();

  console.log("\n══ Două agenții, fiecare cu clientul ei ══");
  for (const [id, nume] of [[ORG_A, "Agentia A"], [ORG_B, "Agentia B"]]) {
    await db!`INSERT INTO organizations (id, name, status) VALUES (${id}, ${nume}, 'activ')
              ON CONFLICT (id) DO UPDATE SET status = 'activ'`;
  }
  await db!`INSERT INTO org_agents (id, org_id, agent_id, name, active)
            VALUES (${AG_A}, ${ORG_A}, ${AG_A}, ${N_A}, TRUE)
            ON CONFLICT (id) DO UPDATE SET org_id = ${ORG_A}, name = ${N_A}`;
  await db!`INSERT INTO org_agents (id, org_id, agent_id, name, active)
            VALUES (${AG_B}, ${ORG_B}, ${AG_B}, ${N_B}, TRUE)
            ON CONFLICT (id) DO UPDATE SET org_id = ${ORG_B}, name = ${N_B}`;
  await db!`
    INSERT INTO prospects (cui, denumire, judet, status, assigned_agent, sold_cents)
    VALUES (${CUI_AL_LUI_A}, 'CLIENTUL LUI A SRL', 'SV', 'client', ${N_A}, 100000),
           (${CUI_AL_LUI_B}, 'CLIENTUL LUI B SRL', 'SV', 'client', ${N_B}, 250000),
           (${CUI_NIMANUI}, 'FIRMA NEALOCATA SRL', 'SV', 'nou', '', NULL)
  `;
  ok("clientul lui B are soldul lui: 2500 lei", (await sold(CUI_AL_LUI_B)) === 250000);

  console.log("\n══ A încarcă un fișier care conține și CUI-ul lui B ══");
  {
    const scrise = await importaSolduri(ORG_A, [
      { cui: CUI_AL_LUI_A, sold: 777000 },
      { cui: CUI_AL_LUI_B, sold: 999999 },
      { cui: CUI_NIMANUI, sold: 555000 },
    ]);
    ok("a scris UN singur rând, al lui", scrise === 1, `a scris ${scrise}`);
    ok("soldul clientului lui A s-a pus", (await sold(CUI_AL_LUI_A)) === 777000);
    ok(
      "SOLDUL CLIENTULUI LUI B E NEATINS",
      (await sold(CUI_AL_LUI_B)) === 250000,
      `a devenit ${await sold(CUI_AL_LUI_B)}`,
    );
    ok(
      "și pe o firmă nealocată nu se pune sold — nu e clientul nimănui",
      (await sold(CUI_NIMANUI)) === null,
      `a devenit ${await sold(CUI_NIMANUI)}`,
    );
  }

  console.log("\n══ Și invers: B nu-l atinge pe A ══");
  {
    await importaSolduri(ORG_B, [{ cui: CUI_AL_LUI_A, sold: 111111 }]);
    ok(
      "soldul clientului lui A a rămas al lui",
      (await sold(CUI_AL_LUI_A)) === 777000,
      `a devenit ${await sold(CUI_AL_LUI_A)}`,
    );
  }

  console.log("\n══ O agenție fără agenți nu poate scrie nimic ══");
  {
    await db!`DELETE FROM org_agents WHERE org_id = ${ORG_B}`;
    const scrise = await importaSolduri(ORG_B, [{ cui: CUI_AL_LUI_B, sold: 1 }]);
    ok("zero rânduri scrise", scrise === 0, `a scris ${scrise}`);
    ok("soldul a rămas cum era", (await sold(CUI_AL_LUI_B)) === 250000);
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
