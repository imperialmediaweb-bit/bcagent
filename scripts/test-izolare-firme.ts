/**
 * IZOLAREA ÎNTRE FIRME în universul comun de prospecți.
 *
 * Scenariu: două agenții, fiecare cu agentul ei. Firma A marchează o firmă
 * din piață drept client. Verificăm că agentul firmei B:
 *   · o vede ca firmă SIMPLĂ (status „nou", fără agent, fără notă, fără sold)
 *   · nu o găsește când filtrează după status=client
 *   · nu o poate MODIFICA (403)
 *   · importul firmei B nu i-o fură
 * și că agentul firmei A își vede starea lui neatinsă, iar tokenurile vechi
 * (fără firmă) văd tot, ca înainte.
 *
 * Rulare:
 *   BASE_URL=http://127.0.0.1:3131 DATABASE_URL=... TOKEN_SECRET=... \
 *   npx tsx scripts/test-izolare-firme.ts
 */
import postgres from "postgres";
import { signToken } from "../src/lib/signed-token";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const SECRET = process.env.TOKEN_SECRET ?? "test-secret-0123456789";
const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/postgres");

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

async function tokenFor(agentId: string, agentName: string): Promise<string> {
  return signToken(
    { agentId, agentName, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
}

async function main() {
  const RUN = `iz${Date.now().toString(36).slice(-6)}`;
  const CUI = `99${Date.now().toString().slice(-8)}`;
  const orgAId = `org-${RUN}-a`;
  const orgBId = `org-${RUN}-b`;

  // ── pregătire: două firme, doi agenți, o firmă în piață ──
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgAId}, 'IZO A SRL', ${RUN + "a@test.ro"}, 'trial', 5),
                   (${orgBId}, 'IZO B SRL', ${RUN + "b@test.ro"}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"agt-" + RUN + "-a"}, ${orgAId}, ${"ag-" + RUN + "-a"}, ${"Agent A " + RUN}),
                   (${"agt-" + RUN + "-b"}, ${orgBId}, ${"ag-" + RUN + "-b"}, ${"Agent B " + RUN})`;
  await sql`INSERT INTO prospects (cui, denumire, localitate, judet, status)
            VALUES (${CUI}, ${"IZO TEST MARKET SRL " + RUN}, 'Suceava', 'SV', 'nou')
            ON CONFLICT (cui) DO UPDATE SET status = 'nou', assigned_agent = '', note = ''`;

  const tokA = await tokenFor(`ag-${RUN}-a`, `Agent A ${RUN}`);
  const tokB = await tokenFor(`ag-${RUN}-b`, `Agent B ${RUN}`);
  const tokLegacy = await tokenFor(`ag-${RUN}-legacy`, "Agent Legacy");

  console.log("══ Firma A își ia clientul ══");
  const rp = await fetch(`${BASE}/api/prospects`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.44.1.1" },
    body: JSON.stringify({
      token: tokA,
      cui: CUI,
      status: "client",
      note: "secretul firmei A",
      assignedAgent: `Agent A ${RUN}`,
    }),
  });
  check("firma A marchează clientul (200)", rp.status === 200, `${rp.status}`);

  const getOne = async (tok: string, extra = "") => {
    const r = await fetch(
      `${BASE}/api/prospects?token=${tok}&search=${encodeURIComponent("IZO TEST MARKET SRL " + RUN)}${extra}`,
    );
    const d = (await r.json()) as {
      prospects?: Array<{ status: string; note: string; assignedAgent: string; soldCents: number | null }>;
    };
    return { status: r.status, row: d.prospects?.[0] };
  };

  console.log("══ Agentul firmei A își vede starea ══");
  const a = await getOne(tokA);
  check("A vede status=client", a.row?.status === "client", JSON.stringify(a.row));
  check("A vede nota lui", a.row?.note === "secretul firmei A");
  check("A vede agentul alocat", a.row?.assignedAgent === `Agent A ${RUN}`);

  console.log("══ Agentul firmei B vede firmă SIMPLĂ ══");
  const b = await getOne(tokB);
  check("B vede status=nou (mascat)", b.row?.status === "nou", JSON.stringify(b.row));
  check("B NU vede nota firmei A", b.row?.note === "");
  check("B NU vede agentul firmei A", b.row?.assignedAgent === "");
  const bf = await fetch(`${BASE}/api/prospects?token=${tokB}&status=client&search=${encodeURIComponent("IZO TEST MARKET")}`);
  const bfd = (await bf.json()) as { prospects?: unknown[] };
  check("B nu o găsește la filtrul status=client", (bfd.prospects ?? []).length === 0);

  console.log("══ B nu poate modifica clientul firmei A ══");
  const pb = await fetch(`${BASE}/api/prospects`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.44.1.2" },
    body: JSON.stringify({ token: tokB, cui: CUI, status: "contactat" }),
  });
  check("PATCH-ul lui B e refuzat (403)", pb.status === 403, `${pb.status}`);
  const [dupa] = await sql`SELECT status, note FROM prospects WHERE cui = ${CUI}`;
  check("starea firmei A e neatinsă în DB", dupa.status === "client" && dupa.note === "secretul firmei A");

  console.log("══ Tokenul vechi (fără firmă) vede tot, ca înainte ══");
  const l = await getOne(tokLegacy);
  check("legacy vede status=client", l.row?.status === "client", JSON.stringify(l.row));
  check("legacy vede nota", l.row?.note === "secretul firmei A");

  console.log("══ Importul firmei B nu fură clientul ══");
  // login owner B nu există — simulăm direct condiția SQL a importului:
  const stolen = await sql`
    UPDATE prospects p
    SET assigned_agent = ${"Agent B " + RUN}
    WHERE p.cui = ${CUI}
      AND (COALESCE(p.assigned_agent, '') = ''
           OR p.assigned_agent = ANY(${["Agent B " + RUN]}))
  `;
  check("condiția de import sare peste clientul altei firme", stolen.count === 0, `a atins ${stolen.count}`);

  console.log("══ Curățenie ══");
  await sql`DELETE FROM prospects WHERE cui = ${CUI}`;
  await sql`DELETE FROM organizations WHERE id IN (${orgAId}, ${orgBId})`;
  await sql.end();

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
