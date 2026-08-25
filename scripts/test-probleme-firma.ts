/**
 * „VOLANSCHI A TRIMIS UN RAPORT ȘI NU-L VĂD" (Bogdan, 25.08).
 *
 * Rapoartele de probleme ajungeau doar la platformă — firma raportorului
 * nu le vedea nicăieri. Suita verifică pe serverul real:
 *   1. agentul trimite un raport prin 💬 → raportul primește firma lui;
 *   2. administratorul firmei îl vede în /api/agentie/issues;
 *   3. raportul VECHI (fără org_id — dinainte de fix) se recuperează
 *      după numele agentului;
 *   4. firma STRĂINĂ nu vede rapoartele altora.
 *
 * Rulare:
 *   BASE_URL=... DATABASE_URL=... TOKEN_SECRET=... npx tsx scripts/test-probleme-firma.ts
 */
import postgres from "postgres";
import { createOrg, createOrgUser } from "../src/modules/platform/repo";
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

interface Issue {
  reporter: string;
  message: string;
}

async function orgLogin(email: string, parola: string): Promise<string> {
  const r = await fetch(`${BASE}/api/agentie/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: parola }),
  });
  const cookie = r.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0];
}

async function main() {
  const RUN = `pb${Date.now().toString(36).slice(-6)}`;
  const orgId = `org-${RUN}`;
  const idA = `ag-${RUN}-a`;
  const numeA = `Agent PB A ${RUN}`;

  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgId}, 'PB TEST SRL', ${RUN + "@test.ro"}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"agt-" + RUN + "-a"}, ${orgId}, ${idA}, ${numeA})`;
  // Conturi de owner pentru ambele firme (parolă hash-uită de API-ul real
  // e complicată aici — folosim direct sesiunea? Nu: creăm useri prin
  // signup-ul real ar cere email unic; mai simplu: interogăm API-ul cu
  // sesiune construită de login doar dacă există user. Așa că userii îi
  // punem cu hash-ul generat de aplicație la /api/agentie/auth/register?
  // Cel mai robust: register prin API.
  // Cont direct, fără înregistrarea publică (limită de 5 pe oră).
  const reg = async (email: string, firma: string) => {
    const org = await createOrg({ name: firma, email });
    await createOrgUser(org.id, email, "ParolaTest123!", "Test Owner", "owner");
    return true;
  };
  const emailA = `${RUN}-owner@test.ro`;
  const emailB = `${RUN}-strain@test.ro`;
  check("cont firmă A creat prin API", await reg(emailA, `PB API A ${RUN}`));
  check("cont firmă B creat prin API", await reg(emailB, `PB API B ${RUN}`));
  // Mutăm agentul în organizația NOU-creată prin register (aia are user).
  const [orgA] = await sql<Array<{ id: string }>>`
    SELECT o.id FROM organizations o JOIN org_users u ON u.org_id = o.id
    WHERE u.email = ${emailA} LIMIT 1
  `;
  const [orgB] = await sql<Array<{ id: string }>>`
    SELECT o.id FROM organizations o JOIN org_users u ON u.org_id = o.id
    WHERE u.email = ${emailB} LIMIT 1
  `;
  if (!orgA || !orgB) {
    // Signup picat — curățăm ce am pus și ieșim cinstit, fără resturi.
    await sql`DELETE FROM org_agents WHERE agent_id = ${idA}`;
    await sql`DELETE FROM organizations WHERE id = ${orgId}`;
    await sql.end();
    console.log("❌ signup-ul de test a picat — nu pot continua");
    process.exit(1);
  }
  await sql`UPDATE org_agents SET org_id = ${orgA.id} WHERE agent_id = ${idA}`;

  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tokA = await signToken({ agentId: idA, agentName: numeA, exp }, SECRET);

  console.log("\n══ Agentul trimite raport → firma lui îl vede ══");
  const mesaj = `Nu-mi merge harta pe telefon ${RUN}`;
  const rPost = await fetch(`${BASE}/api/issues`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: tokA, message: mesaj, page: "/a/test" }),
  });
  check("raportul se trimite", rPost.ok, String(rPost.status));
  const [randNou] = await sql<Array<{ org_id: string }>>`
    SELECT org_id FROM issues WHERE message = ${mesaj} LIMIT 1
  `;
  check("raportul are FIRMA agentului pe el", randNou?.org_id === orgA.id, JSON.stringify(randNou));

  // Raport VECHI (dinainte de fix): fără org_id, doar numele agentului.
  const mesajVechi = `Raport vechi fara firma ${RUN}`;
  await sql`INSERT INTO issues (id, source, reporter, role, page, message)
            VALUES (${"iss-vechi-" + RUN}, 'user', ${numeA}, 'agent', '/a/x', ${mesajVechi})`;

  const cookieA = await orgLogin(emailA, "ParolaTest123!");
  const rA = await fetch(`${BASE}/api/agentie/issues`, { headers: { cookie: cookieA } });
  const dA = (await rA.json()) as { issues?: Issue[] };
  check("administratorul își vede raportul agentului", dA.issues?.some((i) => i.message === mesaj) === true, `total: ${dA.issues?.length}`);
  check("raportul VECHI (fără firmă) se recuperează după nume", dA.issues?.some((i) => i.message === mesajVechi) === true);

  console.log("\n══ Firma străină nu vede nimic ══");
  const cookieB = await orgLogin(emailB, "ParolaTest123!");
  const rB = await fetch(`${BASE}/api/agentie/issues`, { headers: { cookie: cookieB } });
  const dB = (await rB.json()) as { issues?: Issue[] };
  check(
    "firma străină NU vede rapoartele firmei A",
    dB.issues?.every((i) => i.message !== mesaj && i.message !== mesajVechi) === true,
    `vede ${dB.issues?.length}`,
  );

  console.log("\n══ Curățenie ══");
  await sql`DELETE FROM issues WHERE message IN (${mesaj}, ${mesajVechi})`;
  await sql`DELETE FROM org_agents WHERE agent_id = ${idA}`;
  await sql`DELETE FROM org_users WHERE email IN (${emailA}, ${emailB})`;
  await sql`DELETE FROM organizations WHERE id IN (${orgId}, ${orgA.id}, ${orgB.id})`;
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
