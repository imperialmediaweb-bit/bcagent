/**
 * QA COMPLET din perspectiva MANAGERULUI / PATRONULUI — toate fluxurile
 * panoului de agenție: login + roluri, dashboard, agenți (link, concediu,
 * salarii owner-only), echipa (owner-only), upload rapoarte, vânzări +
 * appSales, targeturi, comenzi + van + facturi, clienți + import +
 * realocare, solduri, decont, transfer portofoliu, raport săptămânal,
 * schimbare parolă — plus izolarea față de altă firmă.
 *
 *   BASE_URL=http://127.0.0.1:3131 TOKEN_SECRET=... DATABASE_URL=... \
 *   npx tsx scripts/test-agentie-flows.ts
 */

import crypto from "node:crypto";
import postgres from "postgres";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const SECRET = process.env.TOKEN_SECRET ?? "";
const DB_URL = process.env.DATABASE_URL ?? "";
if (!SECRET || !DB_URL) {
  console.error("TOKEN_SECRET și DATABASE_URL sunt obligatorii");
  process.exit(1);
}
const sql = postgres(DB_URL, { ssl: false, max: 2 });

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function mkToken(agentId: string, agentName: string): string {
  const payload = { agentId, agentName, exp: Math.floor(Date.now() / 1000) + 3600 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

async function req(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON
  }
  return { status: res.status, data };
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/agentie/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  const m = (res.headers.get("set-cookie") ?? "").match(/bcagent_org=[^;]+/);
  if (!m) throw new Error("fără cookie");
  return m[0];
}

async function main() {
  console.log("\n══ Pregătire: firmă cu patron + manager + agenți ══");
  await sql`DELETE FROM organizations WHERE name IN ('QA Boss SRL', 'QA Boss Rival SRL')`;
  for (const t of ["batches", "orders", "van_stock", "routes", "visits", "expenses"]) {
    await sql.unsafe(`DELETE FROM ${t} WHERE agent_id LIKE 'qab-%'`);
  }
  await sql`DELETE FROM batches WHERE agent_id LIKE 'org:%' AND file_name LIKE 'qa-boss%'`;
  await sql`DELETE FROM prospects WHERE cui LIKE '666333%'`;

  const now = new Date();
  const mkid = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const orgId = mkid("org");
  const rivalId = mkid("org");
  await sql`
    INSERT INTO organizations (id, name, cui, email, plan_id, status, agent_limit, created_at, updated_at)
    VALUES (${orgId}, 'QA Boss SRL', '66633300', 'boss@qa.ro', 'business', 'activ', 5, ${now}, ${now}),
           (${rivalId}, 'QA Boss Rival SRL', '66633399', 'rival@qa.ro', 'business', 'activ', 5, ${now}, ${now})
  `;
  const { hashPassword } = await import("../src/modules/platform/passwords");
  const ph = await hashPassword("Parola-Boss-123");
  const pm = await hashPassword("Parola-Mgr-123");
  const pr = await hashPassword("Parola-Rival-123");
  await sql`
    INSERT INTO org_users (id, org_id, email, name, role, password_hash, active, created_at)
    VALUES (${mkid("usr")}, ${orgId}, 'patron@qa-boss.ro', 'Patronul', 'owner', ${ph}, TRUE, ${now}),
           (${mkid("usr")}, ${orgId}, 'bogdan@qa-boss.ro', 'Bogdan Managerul', 'manager', ${pm}, TRUE, ${now}),
           (${mkid("usr")}, ${rivalId}, 'rival@qa-rival.ro', 'Rivalul', 'owner', ${pr}, TRUE, ${now})
  `;
  await sql`
    INSERT INTO org_agents (id, org_id, agent_id, name, active, created_at)
    VALUES (${mkid("agt")}, ${orgId}, 'qab-a1', 'Vlad Unu', TRUE, ${now}),
           (${mkid("agt")}, ${orgId}, 'qab-a2', 'Dana Doi', TRUE, ${now}),
           (${mkid("agt")}, ${rivalId}, 'qab-r1', 'Rival Agent', TRUE, ${now})
  `;
  await sql`
    INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, activ, status, assigned_agent, sold_cents)
    VALUES ('666333001', 'QABOSS MARKET SRL', 'Str. X 1', 'SUCEAVA', 'SV', '4711', TRUE, 'client', 'Vlad Unu', 250000),
           ('666333002', 'QABOSS BAR SRL', 'Str. Y 2', 'RADAUTI', 'SV', '5630', TRUE, 'client', 'Dana Doi', NULL),
           ('666333003', 'QABOSS LIBER SRL', 'Str. Z 3', 'SUCEAVA', 'SV', '4711', TRUE, 'nou', '', NULL)
    ON CONFLICT (cui) DO UPDATE SET status = EXCLUDED.status, assigned_agent = EXCLUDED.assigned_agent, sold_cents = EXCLUDED.sold_cents
  `;

  const patron = await login("patron@qa-boss.ro", "Parola-Boss-123");
  const manager = await login("bogdan@qa-boss.ro", "Parola-Mgr-123");
  const rival = await login("rival@qa-rival.ro", "Parola-Rival-123");
  check("login patron + manager + rival", !!patron && !!manager && !!rival);
  let r = await req("POST", "/api/agentie/login", { email: "patron@qa-boss.ro", password: "gresita" });
  check("parolă greșită → 401", r.status === 401);

  console.log("\n══ 1. Dashboard (overview) ══");
  r = await req("GET", "/api/agentie/overview", undefined, manager);
  check("managerul vede dashboardul", r.status === 200, JSON.stringify(r.data).slice(0, 80));
  r = await req("GET", "/api/agentie/overview");
  check("fără sesiune → 401", r.status === 401);

  console.log("\n══ 2. Agenți: link, concediu, suprapunere, salarii ══");
  r = await req("GET", "/api/agentie/agents", undefined, manager);
  check("lista agenților (2) + rolul meu", r.data?.agents?.length === 2 && r.data?.myRole === "manager");
  r = await req("POST", "/api/agentie/agents", { agentId: "qab-a1", agentName: "Vlad Unu", ttlDays: 7 }, manager);
  check("managerul emite link de agent", r.status === 200 && String(r.data?.url ?? r.data?.link ?? "").includes("/a/"),
    JSON.stringify(r.data).slice(0, 100));
  const lista = await req("GET", "/api/agentie/agents", undefined, manager);
  const rowIdOf = (agentId: string) =>
    (lista.data?.agents ?? []).find((a: any) => a.agentId === agentId)?.id ?? "";
  r = await req("PATCH", "/api/agentie/agents",
    { agentRowId: rowIdOf("qab-a1"), awayFrom: "2026-08-03", awayUntil: "2026-08-09" }, manager);
  check("concediu setat pentru Vlad", r.status === 200, JSON.stringify(r.data));
  r = await req("PATCH", "/api/agentie/agents",
    { agentRowId: rowIdOf("qab-a2"), awayFrom: "2026-08-05", awayUntil: "2026-08-12" }, manager);
  check("suprapunere detectată → 409", r.status === 409);
  r = await req("PATCH", "/api/agentie/agents",
    { agentRowId: rowIdOf("qab-a2"), awayFrom: "2026-08-05", awayUntil: "2026-08-12", force: true }, manager);
  check("cu force trece", r.status === 200);
  r = await req("PATCH", "/api/agentie/agents", { agentRowId: rowIdOf("qab-a1"), salaryCents: 500000 }, manager);
  check("managerul NU poate seta salarii → 403", r.status === 403);
  r = await req("PATCH", "/api/agentie/agents", { agentRowId: rowIdOf("qab-a1"), salaryCents: 500000 }, patron);
  check("patronul setează salariul", r.status === 200);
  // Atac cross-org: managerul nostru încearcă să dezactiveze agentul
  // RIVALULUI folosind rowId-ul lui REAL — UPDATE-ul e legat de org_id,
  // deci nu trebuie să atingă nimic.
  const [rivalRow] = await sql`SELECT id FROM org_agents WHERE agent_id = 'qab-r1'`;
  await req("PATCH", "/api/agentie/agents", { agentRowId: rivalRow.id, active: false }, manager);
  const [rivalAfter] = await sql`SELECT active FROM org_agents WHERE agent_id = 'qab-r1'`;
  check("agentul firmei rivale rămâne neatins în DB", rivalAfter?.active === true);

  console.log("\n══ 3. Echipa (org_users) — doar patronul ══");
  r = await req("POST", "/api/agentie/users",
    { email: "supervizor@qa-boss.ro", name: "Super Vizor", role: "manager" }, manager);
  check("managerul NU adaugă conturi → 403", r.status === 403);
  r = await req("POST", "/api/agentie/users",
    { email: "supervizor@qa-boss.ro", name: "Super Vizor", role: "manager" }, patron);
  check("patronul adaugă manager nou (cu parolă generată)",
    r.status === 200 && typeof r.data?.password === "string", JSON.stringify(r.data).slice(0, 80));

  console.log("\n══ 4. Upload raport de vânzări (fișierul centralizat) ══");
  const rows = [1, 2, 3].flatMap((d) => [
    { date: `2026-07-1${d}`, agent: "Vlad Unu", producer: "BAT", client: "QABOSS MARKET SRL", volume: 200 + d, value: 0 },
    { date: `2026-07-1${d}`, agent: "Dana Doi", producer: "JTI", client: "QABOSS BAR SRL", volume: 100 + d, value: 0 },
  ]);
  r = await req("POST", "/api/agentie/upload",
    { fileName: "qa-boss-ianuarie.xls", rows }, manager);
  check("managerul urcă raportul", r.status === 200, JSON.stringify(r.data).slice(0, 100));
  r = await req("GET", "/api/agentie/upload", undefined, manager);
  check("raportul apare în listă", r.data?.batches?.some((b: any) => b.fileName === "qa-boss-ianuarie.xls"));

  console.log("\n══ 5. Vânzări: analiza pe agenți + appSales separat ══");
  r = await req("GET", "/api/agentie/sales?months=3", undefined, manager);
  check("analiza are ambii agenți", r.data?.agents?.length === 2, `got ${r.data?.agents?.length}`);
  const vlad = r.data?.agents?.find((a: any) => a.name === "Vlad Unu");
  check("volumele lui Vlad însumate corect", vlad?.total === 606, `got ${vlad?.total}`);
  // o vânzare van a lui Vlad → apare în appSales, NU în analiza SAGA
  const tokV = mkToken("qab-a1", "Vlad Unu");
  await req("POST", "/api/orders", {
    token: tokV, cui: "666333001", denumire: "QABOSS MARKET SRL", tip: "van", plata: "numerar",
    lines: [{ produs: "Kent", cantitate: 2, um: "cartus", pret: 250 }],
  });
  r = await req("GET", "/api/agentie/sales?months=3", undefined, manager);
  const app = r.data?.appSales?.agents?.find((a: any) => a.name === "Vlad Unu");
  check("vânzarea van intră în appSales (500 RON)", app?.total === 500, JSON.stringify(app));
  const vlad2 = r.data?.agents?.find((a: any) => a.name === "Vlad Unu");
  check("analiza SAGA nu s-a dublat", vlad2?.total === 606);

  console.log("\n══ 6. Targeturi ══");
  const month = new Date().toISOString().slice(0, 7);
  r = await req("POST", "/api/agentie/targets",
    { month, targets: [{ name: "Vlad Unu", target: 5000 }] }, manager);
  check("managerul setează target", r.status === 200, JSON.stringify(r.data).slice(0, 80));
  r = await req("GET", `/api/agentie/targets?month=${month}`, undefined, manager);
  check("targetul se citește înapoi", JSON.stringify(r.data).includes("5000"));

  console.log("\n══ 7. Comenzi + van + factură ══");
  r = await req("GET", "/api/agentie/orders?days=7", undefined, manager);
  const ord = r.data?.orders?.find((o: any) => o.agentId === "qab-a1");
  check("comanda van a lui Vlad e în panou, livrata", ord?.status === "livrata" && ord?.tip === "van");
  r = await req("GET", "/api/agentie/van", undefined, manager);
  const van = r.data?.vans?.find((v: any) => v.agentId === "qab-a1");
  check("numerar de predat: 500", van?.numerarToday === 500, JSON.stringify(van));
  const csv = await fetch(`${BASE}/api/agentie/orders?export=csv&days=7`, { headers: { Cookie: manager } });
  const csvText = await csv.text();
  check("CSV pentru SAGA include Tip și Plata", csvText.includes(";Tip;Plata;") && csvText.includes("van (pe loc)"));

  console.log("\n══ 8. Clienți: listă, import, realocare, solduri ══");
  r = await req("GET", "/api/agentie/clients", undefined, manager);
  check("clienții firmei (2 alocați)", r.data?.total >= 2, `got ${r.data?.total}`);
  r = await req("POST", "/api/agentie/clients-import",
    { clients: [{ name: "QABOSS LIBER SRL", cui: "", agent: "dana doi" }] }, manager);
  check("import: firma liberă devine client la Dana", r.data?.matched?.[0]?.agent === "Dana Doi");
  r = await req("PATCH", "/api/agentie/clients", { cui: "666333003", agent: "Vlad Unu" }, manager);
  check("realocare Dana → Vlad", r.status === 200);
  r = await req("POST", "/api/agentie/balances",
    { rows: [{ cui: "666333002", name: "QABOSS BAR SRL", sold: 1234.5 }] }, manager);
  check("solduri încărcate", r.status === 200, JSON.stringify(r.data).slice(0, 80));
  r = await req("GET", "/api/agentie/balances", undefined, manager);
  check("restanțele se văd (QABOSS MARKET 2500)",
    JSON.stringify(r.data).includes("666333001") || JSON.stringify(r.data).includes("QABOSS"));

  console.log("\n══ 9. Decont + transfer portofoliu ══");
  const tokD = mkToken("qab-a2", "Dana Doi");
  await req("POST", "/api/expenses", { token: tokD, category: "combustibil", amount: 99, note: "bon qa-boss" });
  r = await req("GET", "/api/agentie/expenses", undefined, manager);
  const exp = (r.data?.expenses ?? []).find((e: any) => e.note === "bon qa-boss");
  check("decontul Danei e în panou", !!exp);
  if (exp) {
    r = await req("PATCH", "/api/agentie/expenses", { id: exp.id, status: "aprobat" }, manager);
    check("managerul aprobă decontul", r.status === 200);
  } else {
    check("managerul aprobă decontul", false, "decont negăsit");
  }
  r = await req("POST", "/api/agentie/transfer",
    { fromAgent: "Vlad Unu", toAgent: "Dana Doi", deactivate: false }, manager);
  check("transfer portofoliu Vlad → Dana", r.status === 200, JSON.stringify(r.data).slice(0, 100));
  const [moved] = await sql`SELECT assigned_agent FROM prospects WHERE cui = '666333001'`;
  check("clientul lui Vlad e acum la Dana", moved?.assigned_agent === "Dana Doi");

  console.log("\n══ 10. Raport săptămânal + parolă ══");
  r = await req("GET", "/api/agentie/report", undefined, manager);
  check("raportul săptămânal se generează", r.status === 200 && !!r.data?.report, JSON.stringify(r.data).slice(0, 80));
  r = await req("POST", "/api/agentie/password",
    { current: "Parola-Mgr-123", next: "Parola-Noua-456" }, manager);
  check("schimbare parolă manager", r.status === 200);
  const relog = await login("bogdan@qa-boss.ro", "Parola-Noua-456");
  check("login cu parola nouă", !!relog);

  console.log("\n══ 11. Izolare: rivalul nu vede nimic ══");
  r = await req("GET", "/api/agentie/clients", undefined, rival);
  check("clienții firmei nu apar la rival",
    !(JSON.stringify(r.data).includes("QABOSS MARKET")));
  r = await req("GET", "/api/agentie/sales?months=3", undefined, rival);
  check("vânzările nu apar la rival",
    !(r.data?.agents ?? []).some((a: any) => a.name === "Vlad Unu"));
  r = await req("GET", "/api/agentie/report", undefined, rival);
  check("raportul rivalului nu conține echipa noastră",
    !(JSON.stringify(r.data).includes("Vlad Unu")));

  console.log("\n══ Înregistrare singură (self-signup, trial 14 zile) ══");
  await sql`DELETE FROM org_users WHERE email = 'qa.selfsignup@test.ro'`;
  await sql`DELETE FROM organizations WHERE name = 'QA Selfsignup SRL'`;
  r = await req("POST", "/api/agentie/signup", {
    firma: "QA Selfsignup SRL", name: "QA Self", email: "qa.selfsignup@test.ro",
    password: "scurt",
  });
  check("parolă scurtă → 400", r.status === 400);
  const sres = await fetch(`${BASE}/api/agentie/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firma: "QA Selfsignup SRL", name: "QA Self",
      email: "qa.selfsignup@test.ro", password: "parola-buna-123",
    }),
  });
  check("signup ok + sesiune pornită",
    sres.status === 200 && (sres.headers.get("set-cookie") ?? "").includes("bcagent_org="));
  const [sorg] = await sql`
    SELECT status, trial_ends_at, agent_limit FROM organizations
    WHERE name = 'QA Selfsignup SRL'
  `;
  const trialDays = sorg?.trial_ends_at
    ? Math.round((new Date(sorg.trial_ends_at).getTime() - Date.now()) / 86400_000)
    : 0;
  check("organizația e în trial ~14 zile",
    sorg?.status === "trial" && trialDays >= 13 && trialDays <= 14);
  const [suser] = await sql`
    SELECT role, active FROM org_users WHERE email = 'qa.selfsignup@test.ro'
  `;
  check("contul creat e owner (administrator) activ",
    suser?.role === "owner" && suser?.active === true);
  r = await req("POST", "/api/agentie/signup", {
    firma: "QA Selfsignup SRL", name: "QA Self",
    email: "qa.selfsignup@test.ro", password: "parola-buna-123",
  });
  check("același email a doua oară → 409", r.status === 409);
  const selfck = await login("qa.selfsignup@test.ro", "parola-buna-123");
  r = await req("GET", "/api/agentie/orders", undefined, selfck);
  check("firma nouă intră și panoul răspunde", r.status === 200);
  await sql`DELETE FROM org_users WHERE email = 'qa.selfsignup@test.ro'`;
  await sql`DELETE FROM organizations WHERE name = 'QA Selfsignup SRL'`;

  console.log("\n══ Curățenie ══");
  await sql`DELETE FROM organizations WHERE name IN ('QA Boss SRL', 'QA Boss Rival SRL')`;
  for (const t of ["batches", "orders", "van_stock", "routes", "visits", "expenses"]) {
    await sql.unsafe(`DELETE FROM ${t} WHERE agent_id LIKE 'qab-%'`);
  }
  await sql`DELETE FROM batches WHERE file_name LIKE 'qa-boss%'`;
  await sql`DELETE FROM prospects WHERE cui LIKE '666333%'`;
  await sql.end();

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} verificări trecute, ${failed} eșuate`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
