/**
 * TESTUL TUTUROR PANOURILOR — fiecare funcție, din fiecare panou.
 *
 *  1. Panoul AGENTULUI (link + PIN): zi, hartă, vizite, rute, comenzi, van,
 *     target, decont, fișiere, probleme, AI-gating.
 *  2. Panoul FIRMEI (administrator + manager): dashboard, vânzări, comenzi,
 *     agenți, clienți, solduri, targeturi, decont, vizite, echipă, transfer,
 *     raport, upload, parolă, 2FA.
 *  3. Panoul ADMIN (platformă): organizații, planuri, facturi, activitate,
 *     jurnal, metrici, demo.
 *  + Ce NU are voie fiecare: agentul în panoul firmei, managerul la echipă,
 *    firma în panoul de admin, o firmă la datele alteia.
 *
 * Rulare:
 *   BASE_URL=http://127.0.0.1:3131 TOKEN_SECRET=... DATABASE_URL=... \
 *     npx tsx scripts/test-panouri.ts
 */
import crypto from "node:crypto";
import postgres from "postgres";
import {
  planRoute,
  routeLegs,
  remainingStops,
  legMapsUrl,
  navAddress,
} from "../src/lib/route-nav";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const SECRET = process.env.TOKEN_SECRET ?? "";
const DB_URL = process.env.DATABASE_URL ?? "";
if (!SECRET || !DB_URL) {
  console.error("TOKEN_SECRET și DATABASE_URL sunt obligatorii");
  process.exit(1);
}

const sql = postgres(DB_URL, { ssl: false, max: 3 });
const RUN_IP = `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string) {
  console.log(`\n══ ${title} ══`);
}

function mkToken(agentId: string, agentName: string, expInSec = 3600): string {
  const payload = {
    agentId,
    agentName,
    exp: Math.floor(Date.now() / 1000) + expInSec,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

type Res = { status: number; data: any; text: string };
async function req(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "X-Forwarded-For": RUN_IP,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON (CSV/HTML) */
  }
  return { status: res.status, data, text };
}
const get = (p: string, c?: string) => req("GET", p, undefined, c);

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/agentie/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": RUN_IP },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status} ${await res.text()}`);
  const m = (res.headers.get("set-cookie") ?? "").match(/bcagent_org=[^;]+/);
  if (!m) throw new Error("fără cookie de sesiune");
  return m[0];
}

const ORG = "QA Panouri SRL";
const ORG2 = "QA Panouri Rival SRL";
const OWNER = "qa.panouri.owner@test.ro";
const MANAGER = "qa.panouri.manager@test.ro";
const RIVAL = "qa.panouri.rival@test.ro";
const PASS = "parola-panouri-123";
const AG1 = "qap-1";
const AG2 = "qap-2";
const TOK1 = mkToken(AG1, "QA Agent Unu");
const TOK2 = mkToken(AG2, "QA Agent Doi");

async function cleanup() {
  await sql`DELETE FROM organizations WHERE name IN (${ORG}, ${ORG2})`;
  await sql`DELETE FROM org_users WHERE email IN (${OWNER}, ${MANAGER}, ${RIVAL})`;
  for (const t of [
    "batches",
    "orders",
    "van_stock",
    "routes",
    "visits",
    "expenses",
    "agent_pin",
  ]) {
    await sql.unsafe(`DELETE FROM ${t} WHERE agent_id LIKE 'qap-%'`);
  }
  await sql`DELETE FROM batches WHERE agent_id LIKE 'org:%' AND file_name LIKE '%qa%'`;
  await sql`DELETE FROM prospects WHERE cui LIKE '7771%'`;
  await sql`DELETE FROM targets WHERE agent_name LIKE 'QA Agent%'`;
}

async function main() {
  section("Pregătire: firmă + rival + 2 agenți + firme pe hartă");
  await get(`/api/prospects?token=${TOK1}&limit=1`); // ensureSchema
  await cleanup();

  const mkid = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const orgId = mkid("org");
  const org2Id = mkid("org");
  const hash = async (pw: string) => {
    const r = await req("POST", "/api/agentie/signup", {
      firma: "tmp",
      email: "x",
      password: pw,
    });
    return r; // doar ca să nu rămână nefolosit; parola reală o punem prin signup
  };
  void hash;

  for (const [id, name, email] of [
    [orgId, ORG, OWNER],
    [org2Id, ORG2, RIVAL],
  ] as const) {
    await sql`
      INSERT INTO organizations (id, name, email, status, agent_limit, trial_ends_at)
      VALUES (${id}, ${name}, ${email}, 'trial', 10, NOW() + INTERVAL '14 days')
    `;
    void email;
  }
  // Conturile le facem prin API (hash-ul de parolă e al aplicației).
  await sql`DELETE FROM org_users WHERE email IN (${OWNER}, ${MANAGER}, ${RIVAL})`;
  const mkUser = async (
    oid: string,
    email: string,
    role: "owner" | "manager",
  ) => {
    // signup creează org nouă; aici avem deja org — inserăm prin API-ul de
    // platformă nu e disponibil fără admin, deci folosim același hash ca
    // aplicația: cerem unei rute publice să-l facă (signup) și îl mutăm.
    const tmpEmail = `tmp.${crypto.randomUUID().slice(0, 8)}@test.ro`;
    const r = await req("POST", "/api/agentie/signup", {
      firma: `TMP ${tmpEmail}`,
      name: "tmp",
      email: tmpEmail,
      password: PASS,
    });
    if (r.status !== 200) throw new Error(`signup temporar: ${r.status} ${r.text}`);
    const [row] = await sql<Array<{ password_hash: string }>>`
      SELECT password_hash FROM org_users WHERE email = ${tmpEmail}
    `;
    await sql`DELETE FROM org_users WHERE email = ${tmpEmail}`;
    await sql`DELETE FROM organizations WHERE name = ${`TMP ${tmpEmail}`}`;
    await sql`
      INSERT INTO org_users (id, org_id, email, password_hash, name, role)
      VALUES (${mkid("usr")}, ${oid}, ${email}, ${row.password_hash},
              ${role === "owner" ? "QA Owner" : "QA Manager"}, ${role})
    `;
  };
  await mkUser(orgId, OWNER, "owner");
  await mkUser(orgId, MANAGER, "manager");
  await mkUser(org2Id, RIVAL, "owner");

  await sql`
    INSERT INTO org_agents (id, org_id, agent_id, name, active) VALUES
      (${mkid("ag")}, ${orgId}, ${AG1}, 'QA Agent Unu', TRUE),
      (${mkid("ag")}, ${orgId}, ${AG2}, 'QA Agent Doi', TRUE)
  `;
  // Firme pe hartă (una neverificată ANAF, ca în teren).
  await sql`
    INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, activ, telefon, status, assigned_agent) VALUES
      ('77710001','QA MAGAZIN UNU SRL','Str. 1','QA VATRA','SV','4711',TRUE,'0740000011','client','QA Agent Unu'),
      ('77710002','QA BAR DOI SRL','Str. 2','QA VATRA','SV','5630',NULL,'0740000012','nou',''),
      ('77710003','QA ALIMENTARA TREI SRL','Str. 3','QA POIANA','SV','4711',TRUE,'','nou',''),
      ('77710004','QA CHIOSC PATRU SRL','Str. 4','QA POIANA','SV','4711',TRUE,'0740000014','nou','')
  `;

  const ck = await login(OWNER, PASS);
  const ckMgr = await login(MANAGER, PASS);
  const ckRival = await login(RIVAL, PASS);
  check("administratorul intră în panou", ck.length > 20);
  check("managerul intră în panou", ckMgr.length > 20);

  /* ─────────────────── 1. PANOUL AGENTULUI ─────────────────── */

  section("AGENT · Ziua mea (vizite, comenzi, target, rute)");
  let r = await get(`/api/visits?token=${TOK1}&limit=1`);
  check("vizitele mele răspund", r.status === 200 && "today" in r.data);
  r = await get(`/api/orders?token=${TOK1}`);
  check("comenzile mele răspund", r.status === 200 && Array.isArray(r.data.orders));
  r = await get(`/api/targets?token=${TOK1}`);
  check("targetul meu răspunde", r.status === 200);
  r = await get(`/api/routes?token=${TOK1}`);
  check("rutele mele răspund", r.status === 200 && Array.isArray(r.data.routes));

  section("AGENT · Harta pieței (localități, firme, filtre, pete albe)");
  r = await get(`/api/prospects/geo?token=${TOK1}&judet=SV&geocode=0`);
  const locs = r.data?.localities ?? [];
  check(
    "harta întoarce localitățile județului",
    r.status === 200 && locs.some((l: any) => l.localitate === "QA VATRA"),
  );
  const vatra = locs.find((l: any) => l.localitate === "QA VATRA");
  check(
    "bula numără și firma neverificată ANAF",
    !!vatra && Number(vatra.count) >= 2,
    JSON.stringify(vatra),
  );
  r = await get(
    `/api/prospects?token=${TOK1}&judet=SV&localitate=QA VATRA&onlyActive=1`,
  );
  check(
    "lista localității arată aceleași firme ca bula",
    r.status === 200 && (r.data.prospects ?? []).length >= 2,
    `${r.data?.total}`,
  );
  r = await get(`/api/prospects?token=${TOK1}&judet=SV&caenIn=5630&limit=50`);
  check(
    "filtrul pe domeniu (baruri) funcționează",
    r.status === 200 && (r.data.prospects ?? []).every((p: any) => p.caen.startsWith("56")),
  );
  r = await get(`/api/prospects?token=${TOK1}&search=CHIOSC PATRU&limit=10`);
  check(
    "căutarea după nume funcționează",
    r.status === 200 && (r.data.prospects ?? []).some((p: any) => p.cui === "77710004"),
  );
  r = await req("POST", "/api/prospects/match", {
    token: TOK1,
    clients: ["QA MAGAZIN UNU"],
  });
  check(
    "potrivirea clienților mei cu firmele oficiale",
    r.status === 200 && (r.data.matches ?? []).length >= 1,
  );

  section("AGENT · Vizite (Am fost) + scadenți");
  r = await req("POST", "/api/visits", {
    token: TOK1,
    cui: "77710001",
    denumire: "QA MAGAZIN UNU SRL",
    result: "client",
    note: "test vizită",
  });
  check("marchez vizita „a devenit client\"", r.status === 200);
  r = await req("POST", "/api/visits", {
    token: TOK1,
    cui: "77710002",
    denumire: "QA BAR DOI SRL",
    result: "inexistent",
  });
  check("rezultat invalid → 400", r.status === 400);
  r = await get(`/api/visits?token=${TOK1}&limit=50`);
  check(
    "vizita apare în jurnal cu ora ei",
    r.status === 200 &&
      (r.data.visits ?? []).some((v: any) => v.cui === "77710001" && v.visitedAt),
  );
  check("contorul „vizite azi\" a crescut", (r.data.today ?? 0) >= 1);
  r = await get(`/api/visits?token=${TOK1}&due=1&limit=50`);
  check("lista scadenților răspunde", r.status === 200 && Array.isArray(r.data.due));

  section("AGENT · Rute (salvare, zi, continuare, ștergere)");
  const stops = Array.from({ length: 12 }, (_, i) => ({
    cui: `7771000${i}`.slice(0, 8),
    denumire: `Firma ${i + 1}`,
    adresa: `Str. ${i + 1}`,
    localitate: "QA VATRA",
    telefon: "",
  }));
  r = await req("POST", "/api/routes", {
    token: TOK1,
    name: "Ruta QA lungă",
    day: "luni",
    stops,
  });
  check("salvez o rută de 12 opriri", r.status === 200, r.text.slice(0, 120));
  const routeId = r.data?.route?.id ?? r.data?.id;
  r = await get(`/api/routes?token=${TOK1}`);
  const savedRoute = (r.data.routes ?? []).find((x: any) => x.name === "Ruta QA lungă");
  check("ruta apare în programul meu", !!savedRoute && savedRoute.stops.length === 12);
  check("ruta are ziua setată", savedRoute?.day === "luni");
  r = await get(`/api/routes?token=${TOK2}`);
  check(
    "ruta NU se vede la alt agent",
    !(r.data.routes ?? []).some((x: any) => x.name === "Ruta QA lungă"),
  );
  if (routeId) {
    r = await req("DELETE", `/api/routes?token=${TOK1}&id=${routeId}`);
    check("șterg ruta", r.status === 200);
  }

  section("AGENT · Comandă la depozit + vânzare pe loc (van) + facturi");
  r = await req("POST", "/api/orders", {
    token: TOK1,
    cui: "77710001",
    denumire: "QA MAGAZIN UNU SRL",
    localitate: "QA VATRA",
    lines: [{ produs: "Apă plată 0,5L", cantitate: 10, um: "bax", pret: 12 }],
    note: "livrare joi",
  });
  check("trimit comandă la depozit", r.status === 200);
  const ordId = r.data?.id;
  r = await req("POST", "/api/orders", {
    token: TOK1,
    cui: "77710001",
    denumire: "QA MAGAZIN UNU SRL",
    tip: "van",
    plata: "numerar",
    lines: [{ produs: "Cola 2L", cantitate: 3, um: "buc", pret: 9 }],
    fotos: ["data:image/jpeg;base64,QUJD", "data:image/jpeg;base64,REVG"],
  });
  check("vânzare pe loc cu 2 facturi", r.status === 200);
  const vanOrd = r.data?.id;
  r = await req("POST", "/api/orders", {
    token: TOK1,
    cui: "77710001",
    denumire: "X",
    tip: "van",
    lines: [{ produs: "Y", cantitate: 1, um: "buc", pret: 1 }],
  });
  check("van fără metodă de plată → 400", r.status === 400);
  r = await req("POST", "/api/orders", {
    token: TOK1,
    cui: "77710001",
    denumire: "X",
    lines: [],
  });
  check("comandă fără produse → 400", r.status === 400);
  r = await get(`/api/orders?token=${TOK1}`);
  check(
    "comenzile mele conțin ambele tipuri",
    (r.data.orders ?? []).some((o: any) => o.tip === "van") &&
      (r.data.orders ?? []).some((o: any) => o.tip === "comanda"),
  );

  section("AGENT · Marfa din mașină (încarc / retur / stoc)");
  r = await req("POST", "/api/van", {
    token: TOK1,
    action: "load",
    lines: [{ produs: "Cola 2L", cantitate: 20, um: "buc" }],
  });
  check("încarc marfă în dubă", r.status === 200, r.text.slice(0, 120));
  r = await get(`/api/van?token=${TOK1}`);
  check("stocul din dubă se vede", r.status === 200 && Array.isArray(r.data.stock));
  r = await req("POST", "/api/van", {
    token: TOK1,
    action: "return",
    lines: [{ produs: "Cola 2L", cantitate: 5, um: "buc" }],
  });
  check("dau retur la depozit", r.status === 200);

  section("AGENT · Decont, fișiere, probleme, setări");
  r = await req("POST", "/api/expenses", {
    token: TOK1,
    spentOn: new Date().toISOString().slice(0, 10),
    category: "combustibil",
    amount: 250.5,
    note: "plin Rădăuți",
  });
  check("trimit o cheltuială", r.status === 200, r.text.slice(0, 120));
  r = await get(`/api/expenses?token=${TOK1}`);
  check(
    "cheltuiala apare în deconturile mele",
    r.status === 200 && (r.data.expenses ?? []).length >= 1,
  );
  r = await get(`/api/data?token=${TOK1}`);
  check("fișierele mele răspund", r.status === 200);
  r = await req("POST", "/api/issues", {
    token: TOK1,
    message: "QA: butonul X nu merge pe telefon",
  });
  check("raportez o problemă", r.status === 200 || r.status === 503, `${r.status}`);

  section("AGENT · Securitate (token invalid, expirat, alt agent)");
  const expired = mkToken(AG1, "QA Agent Unu", -60);
  for (const [name, path] of [
    ["vizite", `/api/visits?token=${expired}`],
    ["rute", `/api/routes?token=${expired}`],
    ["comenzi", `/api/orders?token=${expired}`],
    ["hartă", `/api/prospects/geo?token=${expired}&judet=SV`],
    ["van", `/api/van?token=${expired}`],
    ["decont", `/api/expenses?token=${expired}`],
  ] as const) {
    const rr = await get(path);
    check(`${name} cu token expirat → 401`, rr.status === 401);
  }
  r = await get(`/api/orders?token=${TOK2}`);
  check(
    "agentul 2 NU vede comenzile agentului 1",
    !(r.data.orders ?? []).some((o: any) => o.id === ordId),
  );

  /* ─────────────────── 2. PANOUL FIRMEI ─────────────────── */

  section("FIRMĂ · Dashboard, vânzări, raport, vizite");
  r = await get("/api/agentie/overview", ck);
  check("dashboard-ul firmei răspunde", r.status === 200);
  r = await get("/api/agentie/sales?months=3", ck);
  check("vânzările firmei răspund", r.status === 200);
  r = await get("/api/agentie/report", ck);
  check("raportul săptămânal răspunde", r.status === 200);
  r = await get("/api/agentie/visits?days=30", ck);
  check("jurnalul de vizite al echipei", r.status === 200);
  check(
    "vizita agentului apare la firmă",
    JSON.stringify(r.data).includes("QA MAGAZIN UNU"),
  );

  section("FIRMĂ · Comenzi (stări, facturi, export CSV, dube)");
  r = await get("/api/agentie/orders?days=7", ck);
  const firmOrders = r.data.orders ?? [];
  check("comenzile din teren ajung la firmă", firmOrders.length >= 2);
  const vanRow = firmOrders.find((o: any) => o.id === vanOrd);
  check("vânzarea van are 2 facturi (nFoto)", vanRow?.nFoto === 2, JSON.stringify(vanRow?.nFoto));
  r = await get(`/api/agentie/orders?foto=${vanOrd}`, ck);
  check("firma deschide ambele poze", r.status === 200 && r.data.fotos?.length === 2);
  r = await req("PATCH", "/api/agentie/orders", { id: ordId, status: "pregatita" }, ck);
  check("depozitul trece comanda în „pregătită\"", r.status === 200);
  r = await req("PATCH", "/api/agentie/orders", { id: ordId, status: "livrata" }, ck);
  check("apoi în „livrată\"", r.status === 200);
  r = await req("PATCH", "/api/agentie/orders", { id: ordId, status: "aiurea" }, ck);
  check("stare inventată → 400", r.status === 400);
  r = await req(
    "PATCH",
    "/api/agentie/orders",
    { id: ordId, foto: "data:image/jpeg;base64,R0hJ" },
    ck,
  );
  check("firma atașează factura pe comandă", r.status === 200 && r.data.nFoto === 1);
  r = await get("/api/agentie/orders?export=csv&days=7", ck);
  check(
    "exportul CSV are antet și linii",
    r.status === 200 && r.text.includes("Data;Ora;Agent") && r.text.includes("QA MAGAZIN UNU"),
  );
  r = await get("/api/agentie/van", ck);
  check("„Dubele azi\" răspund", r.status === 200 && Array.isArray(r.data.vans));

  section("FIRMĂ · Agenți (adăugare, link, concediu, PIN, evaluare)");
  r = await req(
    "POST",
    "/api/agentie/agents",
    { agentId: "qap-nou", agentName: "QA Agent Nou", ttlDays: 30 },
    ck,
  );
  check("adaug un agent nou", r.status === 200 && !!r.data.url, r.text.slice(0, 140));
  const newAgentUrl: string = r.data?.url ?? "";
  check("linkul agentului e complet", /\/a\/[\w.-]+$/.test(newAgentUrl));
  r = await get("/api/agentie/agents", ck);
  const agents = r.data.agents ?? [];
  check("agenții firmei se listează", agents.length >= 3);
  const a1 = agents.find((a: any) => a.agentId === AG1);
  if (a1) {
    r = await req(
      "PATCH",
      "/api/agentie/agents",
      { agentRowId: a1.id, awayFrom: "2026-08-10", awayUntil: "2026-08-14" },
      ck,
    );
    check("pun agentul în concediu", r.status === 200, r.text.slice(0, 120));
  }

  section("FIRMĂ · Clienți, import universul, solduri");
  r = await get("/api/agentie/clients?limit=50", ck);
  check("clienții firmei se listează", r.status === 200);
  r = await req(
    "POST",
    "/api/agentie/clients-import",
    {
      clients: [
        { name: "QA ALIMENTARA TREI", cui: "77710003", agent: "qa agent doi" },
        { name: "FIRMA CARE NU EXISTA 999", cui: "", agent: "" },
      ],
    },
    ck,
  );
  check(
    "importul potrivește 1 și raportează 1 nepotrivit",
    r.status === 200 && r.data.matched?.length === 1 && r.data.unmatched?.length === 1,
    r.text.slice(0, 160),
  );
  check(
    "agentul din fișier e rezolvat tolerant (litere mici)",
    r.data.matched?.[0]?.agent === "QA Agent Doi",
  );
  r = await req(
    "POST",
    "/api/agentie/balances",
    { rows: [{ cui: "77710001", name: "QA MAGAZIN UNU SRL", sold: 1234.5 }] },
    ck,
  );
  check("încarc soldurile", r.status === 200, r.text.slice(0, 120));
  const [sold] = await sql`SELECT sold_cents FROM prospects WHERE cui = '77710001'`;
  check("restanța e scrisă pe client", Number(sold?.sold_cents) === 123450, `${sold?.sold_cents}`);
  r = await get("/api/agentie/balances", ck);
  check("soldurile se citesc înapoi", r.status === 200);

  section("FIRMĂ · Targeturi + decont");
  const luna = new Date().toISOString().slice(0, 7);
  r = await req(
    "POST",
    "/api/agentie/targets",
    { month: luna, targets: [{ name: "QA Agent Unu", target: 50000 }] },
    ck,
  );
  check("setez targetul lunii", r.status === 200, r.text.slice(0, 120));
  r = await get(`/api/agentie/targets?month=${luna}`, ck);
  check("targetul se vede în panou", r.status === 200);
  r = await get(`/api/targets?token=${TOK1}`);
  check(
    "și agentul își vede targetul",
    r.status === 200 && JSON.stringify(r.data).includes("QA Agent Unu"),
  );
  r = await get("/api/agentie/expenses", ck);
  const exp = (r.data.expenses ?? [])[0];
  check("deconturile agenților ajung la firmă", !!exp, JSON.stringify(r.data).slice(0, 120));
  if (exp) {
    r = await req("PATCH", "/api/agentie/expenses", { id: exp.id, status: "aprobat" }, ck);
    check("aprob decontul", r.status === 200, r.text.slice(0, 120));
  }

  section("FIRMĂ · Echipa, transfer portofoliu, parolă, 2FA");
  r = await get("/api/agentie/users", ck);
  check("administratorul vede echipa", r.status === 200 && (r.data.users ?? []).length >= 2);
  r = await get("/api/agentie/users", ckMgr);
  check("managerul vede lista (read-only)", r.status === 200);
  r = await req(
    "POST",
    "/api/agentie/users",
    { email: "qa.nou.manager@test.ro", password: "parola-noua-123", role: "manager" },
    ckMgr,
  );
  check("managerul NU poate crea conturi → 403", r.status === 403, `${r.status}`);
  r = await req(
    "POST",
    "/api/agentie/users",
    { email: "qa.nou.manager@test.ro", password: "parola-noua-123", role: "manager", name: "QA Nou" },
    ck,
  );
  check("administratorul poate crea manager", r.status === 200, r.text.slice(0, 140));
  await sql`DELETE FROM org_users WHERE email = 'qa.nou.manager@test.ro'`;
  r = await req(
    "POST",
    "/api/agentie/transfer",
    { fromAgent: "QA Agent Unu", toAgent: "QA Agent Doi", deactivate: false },
    ck,
  );
  check("transfer portofoliu între agenți", r.status === 200, r.text.slice(0, 120));
  r = await get("/api/agentie/2fa", ck);
  check("starea 2FA se citește", r.status === 200);
  r = await req("POST", "/api/agentie/password", { current: "gresita", next: "altaparola123" }, ck);
  check("parolă curentă greșită → refuz", r.status >= 400);

  section("FIRMĂ · Izolare: rivalul nu vede și nu atinge nimic");
  r = await get("/api/agentie/orders?days=7", ckRival);
  check(
    "rivalul nu vede comenzile noastre",
    !(r.data.orders ?? []).some((o: any) => o.id === ordId),
  );
  r = await get(`/api/agentie/orders?foto=${vanOrd}`, ckRival);
  check("rivalul nu deschide pozele noastre → 404", r.status === 404);
  r = await req("PATCH", "/api/agentie/orders", { id: ordId, status: "anulata" }, ckRival);
  check("rivalul nu schimbă starea comenzii → 403", r.status === 403);
  const [stillOk] = await sql`SELECT status FROM orders WHERE id = ${ordId}`;
  check("starea comenzii a rămas neschimbată", stillOk?.status === "livrata");
  r = await get("/api/agentie/agents", ckRival);
  check(
    "rivalul nu vede agenții noștri",
    !JSON.stringify(r.data).includes("QA Agent Unu"),
  );
  r = await get("/api/agentie/users", ckRival);
  check("rivalul nu vede echipa noastră", !JSON.stringify(r.data).includes(OWNER));

  section("FIRMĂ · Fără sesiune → 401 peste tot");
  for (const p of [
    "/api/agentie/overview",
    "/api/agentie/orders",
    "/api/agentie/agents",
    "/api/agentie/clients",
    "/api/agentie/users",
    "/api/agentie/sales",
    "/api/agentie/report",
    "/api/agentie/expenses",
    "/api/agentie/balances",
    "/api/agentie/van",
  ]) {
    const rr = await get(p);
    check(`${p} fără sesiune → 401`, rr.status === 401, `${rr.status}`);
  }

  /* ─────────────────── 3. PANOUL ADMIN ─────────────────── */

  section("ADMIN · Firma NU are voie în panoul de platformă");
  for (const p of [
    "/api/platform/orgs",
    "/api/platform/plans",
    "/api/platform/invoices",
    "/api/platform/metrics",
    "/api/platform/activity",
    "/api/platform/audit",
  ]) {
    const rr = await get(p, ck);
    check(`${p} cu sesiune de firmă → 401/403`, rr.status === 401 || rr.status === 403);
    const anon = await get(p);
    check(`${p} fără nimic → 401/403`, anon.status === 401 || anon.status === 403);
  }

  /* ─────────────────── 4. LOGICA DE RUTE (fără server) ─────────────────── */

  section("RUTE · Logica de navigare (unit, fără server)");
  const s12 = Array.from({ length: 12 }, (_, i) => ({
    cui: String(1000 + i),
    denumire: `F${i}`,
    adresa: `Str ${i}`,
    localitate: "QA VATRA",
  }));
  check("ruta de 12 se rupe în 2 etape", routeLegs(s12).length === 2);
  check("prima etapă are exact 10 opriri", routeLegs(s12)[0].length === 10);
  check("a doua etapă are restul de 2", routeLegs(s12)[1].length === 2);
  const rest = remainingStops(s12, ["1000", "1001", "1002"]);
  check("opririle vizitate ies din calcul", rest.length === 9 && rest[0].cui === "1003");
  const plan = planRoute(s12, ["1000", "1001", "1002"], "SV");
  check("planul zice câte sunt făcute", plan.done === 3 && plan.total === 12);
  check("planul dă linkuri pentru fiecare etapă", plan.urls.length === plan.legs.length);
  check(
    "linkul are destinație + waypoints",
    plan.urls[0].includes("destination=") && plan.urls[0].includes("waypoints="),
  );
  check(
    "toate opririle rămase intră în linkuri (nimic pierdut)",
    plan.legs.reduce((n, l) => n + l.length, 0) === 9,
  );
  const donePlan = planRoute(s12, s12.map((s) => s.cui), "SV");
  check("ruta terminată e marcată gata", donePlan.finished && donePlan.urls.length === 0);
  check("ruta goală NU e „terminată\"", !planRoute([], [], "SV").finished);
  check(
    "CUI-urile cu spații/puncte se potrivesc la fel",
    remainingStops([{ cui: "RO 1000" }], ["1000"]).length === 0,
  );
  check(
    "adresa de navigare are județul și țara",
    navAddress({ adresa: "Str 1", localitate: "Vatra Dornei", judet: "SV" }) ===
      "Str 1, Vatra Dornei, Suceava, Romania",
  );
  check("etapă goală → link gol", legMapsUrl([], "SV") === "");
  check(
    "o singură oprire → link fără waypoints",
    !legMapsUrl([s12[0]], "SV").includes("waypoints="),
  );

  /* ───────── 5. CELE 6 SCENARII CRITICE (checklist QA extern) ───────── */

  section("CRITIC · Același fișier încărcat de 2 ori NU dublează cifrele");
  const salesRows = [
    { date: "2026-06-01", agent: "QA Agent Unu", producer: "BRAND X", client: "QA MAGAZIN UNU SRL", volume: 100, value: 1000 },
    { date: "2026-06-02", agent: "QA Agent Unu", producer: "BRAND X", client: "QA MAGAZIN UNU SRL", volume: 50, value: 500 },
  ];
  r = await req("POST", "/api/agentie/upload", { fileName: "raport-qa.xlsx", rows: salesRows }, ck);
  check("primul import trece", r.status === 200 && !r.data.duplicate, r.text.slice(0, 140));
  r = await req("POST", "/api/agentie/upload", { fileName: "raport-qa.xlsx", rows: salesRows }, ck);
  check("al doilea import identic e marcat duplicat", r.status === 200 && r.data.duplicate === true);
  r = await req(
    "POST",
    "/api/agentie/upload",
    { fileName: "ALT-NUME.xlsx", rows: [...salesRows].reverse() },
    ck,
  );
  check(
    "același conținut cu ALT NUME tot e prins ca duplicat",
    r.status === 200 && r.data.duplicate === true,
  );
  const [nBatches] = await sql<Array<{ n: string }>>`
    SELECT COUNT(*)::text AS n FROM batches WHERE agent_id = ${"org:" + orgId}
  `;
  check("există un SINGUR lot în baza de date", nBatches?.n === "1", `${nBatches?.n}`);
  const [sumRows] = await sql<Array<{ v: string }>>`
    SELECT COALESCE(SUM((r->>'value')::float), 0)::text AS v
    FROM batches b, jsonb_array_elements(b.rows) r
    WHERE b.agent_id = ${"org:" + orgId}
  `;
  check("valoarea totală e 1500, nu 3000", Math.round(Number(sumRows?.v)) === 1500, sumRows?.v);
  r = await req(
    "POST",
    "/api/agentie/upload",
    {
      fileName: "raport-luna-noua.xlsx",
      rows: [{ date: "2026-07-01", agent: "QA Agent Unu", producer: "BRAND X", client: "QA MAGAZIN UNU SRL", volume: 10, value: 100 }],
    },
    ck,
  );
  check("un fișier DIFERIT intră normal", r.status === 200 && !r.data.duplicate);

  section("CRITIC · Stocul din dubă nu poate intra pe minus");
  await req("POST", "/api/van", {
    token: TOK2,
    action: "load",
    lines: [{ produs: "Bere 0,5", cantitate: 5, um: "buc" }],
  });
  r = await req("POST", "/api/orders", {
    token: TOK2,
    cui: "77710001",
    denumire: "QA MAGAZIN UNU SRL",
    tip: "van",
    plata: "numerar",
    lines: [{ produs: "Bere 0,5", cantitate: 50, um: "buc", pret: 5 }],
  });
  check("vânzarea peste stoc NU e blocată (agentul știe mai bine)", r.status === 200);
  const [vs] = await sql<Array<{ cantitate: number }>>`
    SELECT cantitate FROM van_stock WHERE agent_id = ${AG2} AND produs = 'Bere 0,5'
  `;
  check("dar stocul se oprește la 0, nu merge pe minus", Number(vs?.cantitate) === 0, `${vs?.cantitate}`);

  section("CRITIC · PIN-ul agentului are limită la încercări");
  const pinAgent = "qap-pin";
  const pinTok = mkToken(pinAgent, "QA Agent PIN");
  await sql`DELETE FROM agent_pin WHERE agent_id = ${pinAgent}`;
  r = await req("POST", "/api/agent-access", { token: pinTok, pin: "1234", action: "setup" });
  check("agentul își setează PIN-ul", r.status === 200, r.text.slice(0, 140));
  r = await req("POST", "/api/agent-access", { token: pinTok, pin: "9999", action: "verify" });
  check("PIN greșit → refuz", r.status >= 400);
  let blocked = false;
  for (let i = 0; i < 25; i++) {
    const rr = await req("POST", "/api/agent-access", {
      token: pinTok,
      pin: "8888",
      action: "verify",
    });
    if (rr.status === 429 || rr.status === 423) {
      blocked = true;
      break;
    }
  }
  check("ghicitul repetat al PIN-ului e oprit (429/423)", blocked);
  await sql`DELETE FROM agent_pin WHERE agent_id = ${pinAgent}`;

  section("CRITIC · Comanda offline nu se pierde și nu se trimite de 2 ori");
  // Aceeași comandă retrimisă (agentul apasă de 2 ori / revine semnalul).
  const dupOrder = {
    token: TOK1,
    cui: "77710004",
    denumire: "QA CHIOSC PATRU SRL",
    localitate: "QA POIANA",
    lines: [{ produs: "Test dublu", cantitate: 2, um: "buc", pret: 10 }],
  };
  const o1 = await req("POST", "/api/orders", dupOrder);
  const o2 = await req("POST", "/api/orders", dupOrder);
  check("ambele cereri răspund OK (agentul nu vede eroare)", o1.status === 200 && o2.status === 200);
  const [dupCount] = await sql<Array<{ n: string }>>`
    SELECT COUNT(*)::text AS n FROM orders
    WHERE agent_id = ${AG1} AND denumire = 'QA CHIOSC PATRU SRL'
  `;
  check(
    "comanda retrimisă NU se dublează în depozit",
    dupCount?.n === "1",
    `sunt ${dupCount?.n} comenzi`,
  );

  section("CRITIC · Banii de predat = banii din buzunar (la leu)");
  // Cel mai important test din tot setul: dacă suma din aplicație nu bate
  // cu numerarul agentului, agenții abandonează aplicația a doua zi.
  const cashAgent = AG2;
  await sql`DELETE FROM orders WHERE agent_id = ${cashAgent}`;
  const vanzari: Array<[string, number, number, "numerar" | "card" | "termen"]> = [
    ["Cola 2L", 3, 9.5, "numerar"],
    ["Apă 5L", 2, 11.25, "numerar"],
    ["Cafea 250g", 1, 27.9, "card"],
    ["Bere 0,5", 6, 4.35, "numerar"],
    ["Suc 1L", 4, 6.15, "termen"],
  ];
  let asteptatNumerar = 0;
  for (const [produs, cant, pret, plata2] of vanzari) {
    const rr = await req("POST", "/api/orders", {
      token: TOK2,
      cui: "77710001",
      denumire: "QA MAGAZIN UNU SRL",
      tip: "van",
      plata: plata2,
      clientId: `cash-${produs}`,
      lines: [{ produs, cantitate: cant, um: "buc", pret }],
    });
    if (rr.status !== 200) check(`vânzarea ${produs} a intrat`, false, rr.text.slice(0, 100));
    if (plata2 === "numerar") asteptatNumerar += cant * pret;
  }
  // 3*9.5 + 2*11.25 + 6*4.35 = 28.5 + 22.5 + 26.1 = 77.10 RON
  check("calculul nostru de control e 77.10 RON", Math.abs(asteptatNumerar - 77.1) < 0.001);
  r = await get("/api/agentie/van", ck);
  const vanCash = (r.data.vans ?? []).find((v: any) => v.agentId === cashAgent);
  check(
    "aplicația arată EXACT aceeași sumă de predat (la bani)",
    !!vanCash && Math.abs(Number(vanCash.numerarToday) - asteptatNumerar) < 0.01,
    `aplicația: ${vanCash?.numerarToday} vs corect: ${asteptatNumerar.toFixed(2)}`,
  );
  check(
    "cardul și termenul NU intră în numerarul de predat",
    !!vanCash && Number(vanCash.totalToday) > Number(vanCash.numerarToday),
    `total ${vanCash?.totalToday} / numerar ${vanCash?.numerarToday}`,
  );
  check(
    "numărul de vânzări pe loc e corect",
    Number(vanCash?.salesToday) === vanzari.length,
    `${vanCash?.salesToday}`,
  );

  section("Curățenie");
  await cleanup();
  await sql.end();

  console.log(
    `\n${failed === 0 ? "✅" : "❌"} ${passed} verificări trecute, ${failed} eșuate`,
  );
  if (failures.length) {
    console.log("\nCe a picat:");
    for (const f of failures) console.log(`  · ${f}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await cleanup();
    await sql.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
