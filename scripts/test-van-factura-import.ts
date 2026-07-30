/**
 * QA de integrare pentru: VAN SALES (stoc dubă + vânzare pe loc),
 * poza la factură (gating + atașare), importul universului de clienți
 * (CUI/nume, distribuție + creare agenți), realocare clienți, demo-login
 * pe roluri și — critic — IZOLAREA între firme pe toate rutele noi.
 *
 * Lovește serverul REAL (next start):
 *   BASE_URL=http://127.0.0.1:3131 TOKEN_SECRET=... DATABASE_URL=... \
 *   npx tsx scripts/test-van-factura-import.ts
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

function mkToken(agentId: string, agentName: string, expInSec = 3600): string {
  const payload = {
    agentId,
    agentName,
    exp: Math.floor(Date.now() / 1000) + expInSec,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

async function req(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<{ status: number; data: any; headers: Headers }> {
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
    // redirecturi / non-JSON
  }
  return { status: res.status, data, headers: res.headers };
}

/** Login de agenție → cookie-ul de sesiune. */
async function orgLogin(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/agentie/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/bcagent_org=[^;]+/);
  if (!m) throw new Error("fără cookie de sesiune");
  return m[0];
}

async function main() {
  console.log("\n══ Pregătire: două firme separate + agenți ══");
  // Curățenie idempotentă.
  await sql`DELETE FROM organizations WHERE name IN ('QA Van SRL', 'QA Rival SRL')`;
  await sql`DELETE FROM batches WHERE agent_id LIKE 'qav-%'`;
  await sql`DELETE FROM orders WHERE agent_id LIKE 'qav-%'`;
  await sql`DELETE FROM van_stock WHERE agent_id LIKE 'qav-%'`;
  await sql`DELETE FROM prospects WHERE cui LIKE '888111%'`;

  // Firme de test — direct în DB (modelul din test-platform-db).
  const now = new Date();
  const mkid = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const org1 = mkid("org");
  const org2 = mkid("org");
  await sql`
    INSERT INTO organizations (id, name, cui, email, plan_id, status, agent_limit, created_at, updated_at)
    VALUES (${org1}, 'QA Van SRL', '11122233', 'qa-van@test.ro', 'business', 'activ', 3, ${now}, ${now}),
           (${org2}, 'QA Rival SRL', '44455566', 'qa-rival@test.ro', 'business', 'activ', 5, ${now}, ${now})
  `;
  // Utilizatori manager (parole PBKDF2 — folosim endpointul intern de creare?
  // Nu: inserăm hash-ul generat de modulul de parole prin scripts context).
  const { hashPassword } = await import("../src/modules/platform/passwords");
  const pw1 = await hashPassword("Parola-Unu-123");
  const pw2 = await hashPassword("Parola-Doi-123");
  await sql`
    INSERT INTO org_users (id, org_id, email, name, role, password_hash, active, created_at)
    VALUES (${mkid("usr")}, ${org1}, 'manager@qa-van.ro', 'QA Manager', 'manager', ${pw1}, TRUE, ${now}),
           (${mkid("usr")}, ${org2}, 'manager@qa-rival.ro', 'Rival Manager', 'manager', ${pw2}, TRUE, ${now})
  `;
  await sql`
    INSERT INTO org_agents (id, org_id, agent_id, name, active, created_at)
    VALUES (${mkid("agt")}, ${org1}, 'qav-a1', 'Ion Vanzatorul', TRUE, ${now}),
           (${mkid("agt")}, ${org2}, 'qav-b1', 'Rival Agent', TRUE, ${now})
  `;
  // Firme în registrul de prospecți.
  await sql`
    INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, activ, status)
    VALUES ('888111001', 'QA MARKET UNU SRL', 'Str. Test 1', 'SUCEAVA', 'SV', '4711', TRUE, 'nou'),
           ('888111002', 'QA BAR DOI SRL', 'Str. Test 2', 'RADAUTI', 'SV', '5630', TRUE, 'nou'),
           ('888111003', 'QA SHOP TREI SRL', 'Str. Test 3', 'BOTOSANI', 'BT', '4711', TRUE, 'nou')
    ON CONFLICT (cui) DO UPDATE SET status='nou', assigned_agent=''
  `;

  const ck1 = await orgLogin("manager@qa-van.ro", "Parola-Unu-123");
  const ck2 = await orgLogin("manager@qa-rival.ro", "Parola-Doi-123");
  const tok1 = mkToken("qav-a1", "Ion Vanzatorul");
  check("login manager firma 1 și 2", !!ck1 && !!ck2);

  console.log("\n══ VAN: încărcare → vânzare → retur ══");
  let r = await req("POST", "/api/van", {
    token: tok1,
    kind: "incarcare",
    lines: [
      { produs: "Kent Blue", cantitate: 20, um: "cartus" },
      { produs: "Marlboro Red", cantitate: 10, um: "cartus" },
    ],
  });
  check("încărcare marfă ok", r.status === 200 && r.data.ok === true);
  r = await req("GET", `/api/van?token=${tok1}`);
  check("stoc 2 produse", r.data?.stock?.length === 2);

  r = await req("POST", "/api/orders", {
    token: tok1,
    cui: "888111001",
    denumire: "QA MARKET UNU SRL",
    localitate: "SUCEAVA",
    tip: "van",
    plata: "numerar",
    lines: [{ produs: "KENT BLUE", cantitate: 5, um: "cartus", pret: 260 }],
  });
  check("vânzare van ok", r.status === 200 && r.data.ok === true);
  const [ks] = await sql`
    SELECT cantitate FROM van_stock WHERE agent_id = 'qav-a1' AND produs = 'Kent Blue'
  `;
  check("stoc scăzut 20→15 (match case-insensitive)", Number(ks?.cantitate) === 15);
  const [vo] = await sql`
    SELECT status, tip, plata FROM orders WHERE agent_id='qav-a1' AND tip='van' LIMIT 1
  `;
  check("vânzarea van intră direct livrata+numerar", vo?.status === "livrata" && vo?.plata === "numerar");

  r = await req("POST", "/api/orders", {
    token: tok1, cui: "1", denumire: "X", tip: "van", plata: "numerar",
    lines: [{ produs: "Y", cantitate: 1, um: "buc", pret: null }],
  });
  check("van fără preț → 400", r.status === 400);
  r = await req("POST", "/api/orders", {
    token: tok1, cui: "1", denumire: "X", tip: "van", plata: "bitcoin",
    lines: [{ produs: "Y", cantitate: 1, um: "buc", pret: 2 }],
  });
  check("plată invalidă → 400", r.status === 400);

  r = await req("POST", "/api/van", {
    token: tok1, kind: "retur",
    lines: [{ produs: "marlboro red", cantitate: 999, um: "cartus" }],
  });
  check("retur peste stoc nu dă negativ", r.status === 200);
  const rest = await sql`SELECT produs FROM van_stock WHERE agent_id='qav-a1'`;
  check("rândul pe zero a dispărut", !rest.some((x) => x.produs === "Marlboro Red"));

  console.log("\n══ VAN: vederea managerului + izolare ══");
  r = await req("GET", "/api/agentie/van", undefined, ck1);
  const v1 = r.data?.vans?.find((v: any) => v.agentId === "qav-a1");
  check("managerul 1 vede duba și numerarul", !!v1 && v1.numerarToday === 1300);
  r = await req("GET", "/api/agentie/van", undefined, ck2);
  check("firma rivală NU vede duba firmei 1",
    !(r.data?.vans ?? []).some((v: any) => v.agentId === "qav-a1"));
  r = await req("GET", "/api/agentie/van");
  check("fără sesiune → 401", r.status === 401);

  console.log("\n══ Poza la factură: gating ══");
  r = await req("POST", "/api/factura-scan", { image: { data: "x" } });
  check("scan fără token → 401", r.status === 401);
  r = await req("POST", "/api/factura-scan", { token: tok1 });
  check("scan fără poză → 400", r.status === 400);
  r = await req("POST", "/api/factura-scan", {
    token: tok1, image: { data: "A".repeat(6_000_001), mime: "image/jpeg" },
  });
  check("poză uriașă → 400", r.status === 400);

  console.log("\n══ Foto pe comandă + izolare ══");
  r = await req("POST", "/api/orders", {
    token: tok1, cui: "888111002", denumire: "QA BAR DOI SRL", tip: "van",
    plata: "card", foto: "data:image/jpeg;base64,QUJD",
    lines: [{ produs: "Pall Mall", cantitate: 2, um: "cartus", pret: 200 }],
  });
  check("comandă cu foto ok", r.status === 200);
  const oid = r.data.id;
  r = await req("GET", `/api/agentie/orders?foto=${oid}`, undefined, ck1);
  check("managerul 1 vede factura", r.status === 200 && String(r.data.foto).startsWith("data:image/"));
  r = await req("GET", `/api/agentie/orders?foto=${oid}`, undefined, ck2);
  check("firma rivală NU vede factura → 404", r.status === 404);
  r = await req("POST", "/api/orders", {
    token: tok1, cui: "1", denumire: "T", foto: "javascript:alert(1)",
    lines: [{ produs: "X", cantitate: 1, um: "buc", pret: 1 }],
  });
  const [bad] = await sql`SELECT foto FROM orders WHERE id = ${r.data.id}`;
  check("foto non-imagine se ignoră", bad?.foto === "");

  console.log("\n══ Import universul de clienți ══");
  r = await req("POST", "/api/agentie/clients-import", {
    clients: [
      { name: "Magazinu lu nea Gigi", cui: "888111001", agent: "ion vanzatorul" },
      { name: "QA BAR DOI", cui: "", agent: "Ion" },
      { name: "FIRMA FANTOMA 999", cui: "", agent: "" },
    ],
  }, ck1);
  check("2 potriviți (CUI + nume), 1 nu", r.data?.matched?.length === 2 && r.data?.unmatched?.length === 1);
  check("agenții rezolvați tolerant",
    r.data.matched.every((m: any) => m.agent === "Ion Vanzatorul"));
  const [c1] = await sql`SELECT status, assigned_agent FROM prospects WHERE cui='888111001'`;
  check("clientul scris în DB cu agent", c1?.status === "client" && c1?.assigned_agent === "Ion Vanzatorul");

  console.log("\n══ Creare automată agenți din fișier + limită ══");
  r = await req("POST", "/api/agentie/clients-import", {
    createAgents: true,
    clients: [
      { name: "QA SHOP TREI SRL", cui: "", agent: "Maria Noua" },
      { name: "QA SHOP TREI SRL", cui: "", agent: "Al Treilea Om" },
      { name: "QA SHOP TREI SRL", cui: "", agent: "Al Patrulea Depaseste" },
    ],
  }, ck1);
  const created = (r.data?.agentsCreated ?? []).map((a: any) => a.name);
  check("2 agenți creați (limita 3, era 1)", created.length === 2, JSON.stringify(created));
  check("al 3-lea raportat la limită",
    (r.data?.agentsUnknown ?? []).some((s: string) => s.includes("limita")));
  check("linkurile create funcționează", !!r.data.agentsCreated[0]?.url);
  const linkRes = await fetch(r.data.agentsCreated[0].url, { redirect: "manual" });
  check("panoul agentului nou răspunde 200", linkRes.status === 200);

  console.log("\n══ Realocare + izolare ══");
  r = await req("PATCH", "/api/agentie/clients", { cui: "888111001", agent: "Maria Noua" }, ck1);
  check("realocare ok", r.status === 200);
  r = await req("PATCH", "/api/agentie/clients", { cui: "888111001", agent: "Rival Agent" }, ck1);
  check("agent străin → 400", r.status === 400);
  r = await req("PATCH", "/api/agentie/clients", { cui: "888111001", agent: "Rival Agent" }, ck2);
  check("firma rivală nu fură clientul → 403", r.status === 403);
  r = await req("GET", "/api/agentie/clients?agent=__none__", undefined, ck1);
  check("filtrul fără-agent răspunde", r.status === 200);

  console.log("\n══ Vânzări prin aplicație (appSales) ══");
  r = await req("GET", "/api/agentie/sales?months=3", undefined, ck1);
  const app1 = r.data?.appSales?.agents?.find((a: any) => a.name === "Ion Vanzatorul");
  check("appSales are vânzările lui Ion", !!app1 && app1.sales >= 2);
  r = await req("GET", "/api/agentie/sales?months=3", undefined, ck2);
  check("firma rivală nu vede appSales-ul firmei 1",
    !(r.data?.appSales?.agents ?? []).some((a: any) => a.name === "Ion Vanzatorul"));

  console.log("\n══ Demo-login pe roluri ══");
  for (const rol of ["patron", "manager", "agent"]) {
    const res = await fetch(`${BASE}/api/agentie/demo-login?rol=${rol}`, { redirect: "manual" });
    const loc = res.headers.get("location") ?? "";
    check(`demo ${rol} → 302 ${rol === "agent" ? "/a/..." : "/agentie"}`,
      res.status === 302 && (rol === "agent" ? loc.includes("/a/") : loc.endsWith("/agentie")));
  }

  console.log("\n══ Curățenie ══");
  await sql`DELETE FROM organizations WHERE name IN ('QA Van SRL', 'QA Rival SRL')`;
  await sql`DELETE FROM orders WHERE agent_id LIKE 'qav-%'`;
  await sql`DELETE FROM van_stock WHERE agent_id LIKE 'qav-%'`;
  await sql`DELETE FROM prospects WHERE cui LIKE '888111%'`;
  await sql.end();

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} verificări trecute, ${failed} eșuate`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
