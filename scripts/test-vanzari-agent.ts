/**
 * VÂNZĂRILE AGENTULUI din fișierul FIRMEI.
 *
 * Managerul urcă un singur raport pentru toată echipa. Fiecare agent
 * trebuie să-și vadă cifrele din el — dar DOAR felia lui, nu ale
 * colegilor. Suita verifică exact asta, plus că fișierul firmei nu poate
 * fi șters de pe telefonul unui agent.
 *
 * Rulare:
 *   BASE_URL=http://127.0.0.1:3131 DATABASE_URL=... TOKEN_SECRET=... \
 *   npx tsx scripts/test-vanzari-agent.ts
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

interface DataResp {
  batches?: Array<{ id: string; fileName: string; rowCount: number }>;
  rows?: Array<{ agent: string; client: string; volume: number }>;
}

async function main() {
  const RUN = `va${Date.now().toString(36).slice(-6)}`;
  const orgId = `org-${RUN}`;
  const idA = `ag-${RUN}-a`;
  const idB = `ag-${RUN}-b`;
  // Cu diacritice în numele din org, fără în fișier — potrivirea trebuie
  // să treacă peste asta (așa vine din SAGA).
  const numeA = "Gavrileț Bogdan";
  const numeB = "Cojocaru Răzvan";

  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgId}, 'VANZARI TEST SRL', ${RUN + "@test.ro"}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"agt-" + RUN + "-a"}, ${orgId}, ${idA}, ${numeA}),
                   (${"agt-" + RUN + "-b"}, ${orgId}, ${idB}, ${numeB})`;

  // Fișierul FIRMEI: 3 rânduri ale lui A, 2 ale lui B (nume fără diacritice).
  const rows = [
    { date: "2026-08-03", agent: "Gavrilet Bogdan", producer: "BAT", client: "MAGAZIN 1", volume: 10, value: 100 },
    { date: "2026-08-04", agent: "Gavrilet Bogdan", producer: "BAT", client: "MAGAZIN 2", volume: 20, value: 200 },
    { date: "2026-08-05", agent: "GAVRILET BOGDAN", producer: "PMI", client: "MAGAZIN 3", volume: 5, value: 50 },
    { date: "2026-08-03", agent: "Cojocaru Razvan", producer: "BAT", client: "BAR 1", volume: 7, value: 70 },
    { date: "2026-08-06", agent: "Cojocaru Razvan", producer: "JTI", client: "BAR 2", volume: 3, value: 30 },
  ];
  const batchId = `bo_${RUN}`;
  await sql`
    INSERT INTO batches (id, agent_id, file_name, uploaded_at, row_count, date_min, date_max, rows)
    VALUES (${batchId}, ${"org:" + orgId}, 'RAPORT FIRMA.ods', NOW(), ${rows.length},
            '2026-08-03', '2026-08-06', ${sql.json(rows)})
  `;

  const tokA = await signToken(
    { agentId: idA, agentName: numeA, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
  const tokB = await signToken(
    { agentId: idB, agentName: numeB, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );

  const dataFor = async (tok: string): Promise<DataResp> => {
    const r = await fetch(`${BASE}/api/data?token=${encodeURIComponent(tok)}`);
    return (await r.json()) as DataResp;
  };

  console.log("══ Agentul A își vede felia lui din fișierul firmei ══");
  const a = await dataFor(tokA);
  check("A vede fișierul firmei", (a.batches ?? []).length === 1, JSON.stringify(a.batches));
  check("A are exact 3 rânduri (ale lui)", (a.rows ?? []).length === 3, `${(a.rows ?? []).length}`);
  check(
    "A NU vede niciun rând al colegului",
    (a.rows ?? []).every((r) => !/cojocaru/i.test(r.agent)),
    JSON.stringify((a.rows ?? []).map((r) => r.agent)),
  );
  check(
    "cantitatea lui A e corectă (10+20+5=35)",
    (a.rows ?? []).reduce((s, r) => s + r.volume, 0) === 35,
  );
  check(
    "potrivirea trece peste diacritice și MAJUSCULE",
    (a.rows ?? []).some((r) => r.agent === "GAVRILET BOGDAN"),
  );
  check("numărul de rânduri afișat e cel al feliei lui", a.batches?.[0]?.rowCount === 3, `${a.batches?.[0]?.rowCount}`);

  console.log("══ Agentul B vede DOAR ce e al lui ══");
  const b = await dataFor(tokB);
  check("B are exact 2 rânduri", (b.rows ?? []).length === 2, `${(b.rows ?? []).length}`);
  check(
    "B NU vede rândurile lui A",
    (b.rows ?? []).every((r) => !/gavrilet/i.test(r.agent)),
  );
  check("cantitatea lui B e corectă (7+3=10)", (b.rows ?? []).reduce((s, r) => s + r.volume, 0) === 10);

  console.log("══ Agentul străin (fără firmă) nu vede nimic ══");
  const tokStrain = await signToken(
    { agentId: `ag-${RUN}-strain`, agentName: "Strain", exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
  const s = await dataFor(tokStrain);
  check("agentul din afara firmei nu primește fișierul", (s.batches ?? []).length === 0);

  console.log("══ Agentul NU poate șterge fișierul firmei ══");
  const del = await fetch(`${BASE}/api/data?token=${encodeURIComponent(tokA)}`, {
    method: "DELETE",
  });
  const [ramas] = await sql<[{ n: string }]>`
    SELECT COUNT(*)::text AS n FROM batches WHERE id = ${batchId}
  `;
  check(
    "fișierul firmei rămâne după ștergerea de pe telefonul agentului",
    ramas.n === "1",
    `status ${del.status}, rămase ${ramas.n}`,
  );

  console.log("══ Curățenie ══");
  await sql`DELETE FROM batches WHERE id = ${batchId}`;
  await sql`DELETE FROM organizations WHERE id = ${orgId}`;
  await sql.end();

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
