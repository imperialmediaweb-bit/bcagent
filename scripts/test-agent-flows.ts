/**
 * QA COMPLET din perspectiva AGENTULUI — toate fluxurile panoului lui:
 * autentificare + revocare instant, fișiere (upload batch → analize),
 * hartă (filtre prospecți, geo, alocare), rute + vizite + scadenți,
 * targeturi, deconturi, setări, comenzi + van, fișă client / AI gating,
 * probleme raportate. Lovește serverul REAL.
 *
 *   BASE_URL=http://127.0.0.1:3131 TOKEN_SECRET=... DATABASE_URL=... \
 *   npx tsx scripts/test-agent-flows.ts
 */

import crypto from "node:crypto";
import postgres from "postgres";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";

// IP unic per RULARE: rulările consecutive nu se lovesc de limitele
// anti-abuz pe IP (alea sunt testate separat, intenționat).
const RUN_IP = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
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
  const payload = { agentId, agentName, exp: Math.floor(Date.now() / 1000) + expInSec };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "X-Forwarded-For": RUN_IP,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // HTML sau gol
  }
  return { status: res.status, data };
}

const AG = "qaf-a1";
const AGN = "Radu Testeru";

async function main() {
  console.log("\n══ Pregătire ══");
  await sql`DELETE FROM organizations WHERE name = 'QA Flux SRL'`;
  for (const t of ["batches", "orders", "van_stock", "routes", "visits", "expenses"]) {
    await sql.unsafe(`DELETE FROM ${t} WHERE agent_id LIKE 'qaf-%'`);
  }
  await sql`DELETE FROM issues WHERE message LIKE 'test QA:%'`;
  await sql`DELETE FROM prospects WHERE cui LIKE '777222%'`;
  await sql`DELETE FROM geo_localitati WHERE localitate LIKE 'QAFLUX%'`;

  const now = new Date();
  const mkid = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const orgId = mkid("org");
  await sql`
    INSERT INTO organizations (id, name, cui, email, plan_id, status, agent_limit, created_at, updated_at)
    VALUES (${orgId}, 'QA Flux SRL', '77722200', 'qa-flux@test.ro', 'business', 'activ', 5, ${now}, ${now})
  `;
  await sql`
    INSERT INTO org_agents (id, org_id, agent_id, name, active, created_at)
    VALUES (${mkid("agt")}, ${orgId}, ${AG}, ${AGN}, TRUE, ${now})
  `;
  // Firme pe hartă: două localități, una cu client, una „pată albă".
  await sql`
    INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, activ, status, telefon)
    VALUES ('777222001', 'QAFLUX MAGAZIN SRL', 'Str. A 1', 'QAFLUXVILLE', 'SV', '4711', TRUE, 'nou', '0740111222'),
           ('777222002', 'QAFLUX BAR SRL', 'Str. B 2', 'QAFLUXVILLE', 'SV', '5630', TRUE, 'nou', ''),
           ('777222003', 'QAFLUX DEPARTE SRL', 'Str. C 3', 'QAFLUXSAT', 'SV', '4711', TRUE, 'nou', '')
    ON CONFLICT (cui) DO NOTHING
  `;
  // Geo pre-populat (Nominatim e blocat în sandbox — exact ca un cache cald).
  await sql`
    INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
    VALUES ('SV', 'QAFLUXVILLE', 47.65, 26.25, FALSE),
           ('SV', 'QAFLUXSAT', 47.70, 26.30, FALSE)
    ON CONFLICT (judet, localitate) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, failed = FALSE
  `;
  const tok = mkToken(AG, AGN);

  console.log("\n══ 1. Autentificare + revocare instant ══");
  let r = await req("GET", `/api/data?token=${tok}`);
  check("token valid → date", r.status === 200);
  r = await req("GET", `/api/data?token=${tok}x`);
  check("token corupt → 401", r.status === 401);
  const expired = mkToken(AG, AGN, -60);
  r = await req("GET", `/api/data?token=${expired}`);
  check("token expirat → 401", r.status === 401);
  const page = await fetch(`${BASE}/a/${tok}`);
  check("pagina panoului se încarcă (200)", page.status === 200);
  await sql`UPDATE org_agents SET active = FALSE WHERE agent_id = ${AG}`;
  const blocked = await fetch(`${BASE}/a/${tok}`);
  const blockedHtml = await blocked.text();
  check("agent dezactivat → panoul blocat instant",
    blockedHtml.includes("dezactivat") || blockedHtml.includes("blocat") || blocked.status !== 200);
  await sql`UPDATE org_agents SET active = TRUE WHERE agent_id = ${AG}`;

  console.log("\n══ 2. Fișiere: upload batch → date → analiză → ștergere ══");
  const days = [1, 2, 3, 4, 5];
  const rows = days.flatMap((d) => [
    { date: `2026-07-0${d}T00:00:00.000Z`, agent: AGN, producer: "BAT", client: "QAFLUX MAGAZIN SRL", volume: 100 + d, value: 0 },
    { date: `2026-07-0${d}T00:00:00.000Z`, agent: AGN, producer: "JTI", client: "QAFLUX BAR SRL", volume: 50 + d, value: 0 },
  ]);
  r = await req("POST", "/api/batches", {
    token: tok,
    batch: {
      id: "qaf-b1",
      fileName: "vanzari-iulie.xls",
      uploadedAt: new Date().toISOString(),
      rowCount: rows.length,
      dateRange: { min: "2026-07-01", max: "2026-07-05" },
      rows,
    },
  });
  check("upload batch ok", r.status === 200, JSON.stringify(r.data));
  r = await req("GET", `/api/data?token=${tok}`);
  check("datele se întorc cu tot cu rânduri", r.data?.rows?.length === rows.length);
  check("batch-ul apare în listă", r.data?.batches?.some((b: any) => b.id === "qaf-b1"));
  const totalVol = r.data.rows.reduce((s: number, x: any) => s + x.volume, 0);
  check("volumele intacte (analiza are ce aduna)",
    totalVol === rows.reduce((s, x) => s + x.volume, 0));
  // batch străin nu poate fi șters de alt agent
  const tokStrain = mkToken("qaf-x9", "Strain");
  r = await req("DELETE", `/api/data?token=${tokStrain}&batch=qaf-b1`);
  const [still] = await sql`SELECT id FROM batches WHERE id = 'qaf-b1'`;
  check("alt agent NU poate șterge batch-ul", !!still);

  console.log("\n══ 3. Harta: filtre, căutare, alocare, geo ══");
  r = await req("GET", `/api/prospects?token=${tok}&judet=SV&search=QAFLUX&limit=50`);
  check("căutare pe hartă: 3 firme QAFLUX", r.data?.prospects?.length === 3, `got ${r.data?.prospects?.length}`);
  r = await req("GET", `/api/prospects?token=${tok}&judet=SV&caen=5630&search=QAFLUX`);
  check("filtru domeniu (baruri): doar barul", r.data?.prospects?.length === 1 && r.data.prospects[0].cui === "777222002");
  r = await req("PATCH", "/api/prospects", {
    token: tok, cui: "777222001", status: "client", assignedAgent: AGN,
  });
  check("conversia în client din teren", r.status === 200);
  const [conv] = await sql`SELECT status, assigned_agent FROM prospects WHERE cui = '777222001'`;
  check("clientul e al agentului în DB", conv?.status === "client" && conv?.assigned_agent === AGN);
  r = await req("GET", `/api/prospects/geo?token=${tok}&judet=SV`);
  const geoLocs = r.data?.localities ?? [];
  const ville = geoLocs.find((l: any) => l.localitate === "QAFLUXVILLE");
  check("geo întoarce localitățile cu coordonate",
    !!ville && ville.lat === 47.65 && ville.count === 2,
    JSON.stringify(r.data).slice(0, 120));

  console.log("\n══ 4. Rute + vizite + scadenți ══");
  const DAY_KEYS = ["duminica", "luni", "marti", "miercuri", "joi", "vineri", "sambata"];
  const today = DAY_KEYS[new Date().getDay()];
  r = await req("POST", "/api/routes", {
    token: tok, name: "Ruta QA", day: today,
    stops: [{ cui: "777222001", denumire: "QAFLUX MAGAZIN SRL", adresa: "Str. A 1", localitate: "QAFLUXVILLE", telefon: "" }],
  });
  check("salvare rută pe azi", r.status === 200, JSON.stringify(r.data));
  r = await req("GET", `/api/routes?token=${tok}`);
  check("ruta apare în listă", r.data?.routes?.some((x: any) => x.name === "Ruta QA"));
  r = await req("POST", "/api/visits", {
    token: tok, cui: "777222001", denumire: "QAFLUX MAGAZIN SRL", result: "client", note: "totul ok",
  });
  check("vizită înregistrată (am fost → client)", r.status === 200);
  r = await req("GET", `/api/visits?token=${tok}&due=1`);
  const dueList = r.data?.due ?? r.data?.clients ?? [];
  check("scadenții NU includ clientul abia vizitat",
    !dueList.some((c: any) => c.cui === "777222001"));

  console.log("\n══ 5. Target + decont + setări ══");
  await sql`
    INSERT INTO targets (org_id, agent_name, month, target_value)
    VALUES (${orgId}, ${AGN}, ${new Date().toISOString().slice(0, 7)}, 10000)
    ON CONFLICT (org_id, agent_name, month) DO UPDATE SET target_value = 10000
  `;
  r = await req("GET", `/api/targets?token=${tok}`);
  check("targetul meu + clasament", r.status === 200 && r.data?.inOrg !== false);
  r = await req("POST", "/api/expenses", {
    token: tok, category: "combustibil", amount: 150.5, note: "bon QA",
  });
  check("decont trimis", r.status === 200, JSON.stringify(r.data));
  r = await req("GET", `/api/expenses?token=${tok}`);
  check("decontul apare în lista lui", r.data?.expenses?.some((e: any) => e.note === "bon QA"));
  r = await req("POST", "/api/settings", { token: tok, settings: { theme: "dark" } });
  check("setările se salvează", r.status === 200);

  console.log("\n══ 6. Comenzi + van (fluxul zilei) ══");
  r = await req("POST", "/api/van", {
    token: tok, kind: "incarcare", lines: [{ produs: "Kent", cantitate: 10, um: "cartus" }],
  });
  check("dimineața: marfa în dubă", r.status === 200);
  r = await req("POST", "/api/orders", {
    token: tok, cui: "777222001", denumire: "QAFLUX MAGAZIN SRL", localitate: "QAFLUXVILLE",
    tip: "van", plata: "numerar", lines: [{ produs: "Kent", cantitate: 3, um: "cartus", pret: 260 }],
  });
  check("vânzare pe loc la client", r.status === 200);
  r = await req("GET", `/api/van?token=${tok}`);
  check("seara: stoc 7 + numerar 780",
    r.data?.stock?.[0]?.cantitate === 7 && r.data?.today?.numerar === 780,
    JSON.stringify(r.data));
  r = await req("GET", `/api/orders?token=${tok}`);
  check("istoricul comenzilor pe telefon", r.data?.orders?.length >= 1);

  console.log("\n══ 7. AI: gating curat (fără chei local) ══");
  r = await req("POST", "/api/coach", { token: tok, messages: [{ role: "user", content: "salut" }] });
  check("antrenorul răspunde controlat fără chei AI",
    r.status !== 200 ? typeof r.data?.error === "string" : true, `status ${r.status}`);
  r = await req("POST", "/api/client-brief", { token: tok, cui: "777222001" });
  check("fișa de client răspunde controlat", r.status === 200 || typeof r.data?.error === "string");
  r = await req("POST", "/api/insights", { token: "invalid", summary: {} });
  check("insights cu token invalid respins (401, sau 503 fără chei AI)",
    r.status === 401 || r.status === 503);

  console.log("\n══ 8. Probleme raportate de agent ══");
  r = await req("POST", "/api/issues", {
    token: tok, page: "/a/...", message: "test QA: nu merge butonul X",
  });
  check("agentul poate raporta o problemă", r.status === 200, JSON.stringify(r.data).slice(0, 80));
  const [iss] = await sql`SELECT id FROM issues WHERE message LIKE 'test QA:%' LIMIT 1`;
  check("problema e în baza de date pentru admin", !!iss);

  console.log("\n══ Curățenie ══");
  await sql`DELETE FROM organizations WHERE name = 'QA Flux SRL'`;
  for (const t of ["batches", "orders", "van_stock", "routes", "visits", "expenses"]) {
    await sql.unsafe(`DELETE FROM ${t} WHERE agent_id LIKE 'qaf-%'`);
  }
  await sql`DELETE FROM issues WHERE message LIKE 'test QA:%'`;
  await sql`DELETE FROM prospects WHERE cui LIKE '777222%'`;
  await sql`DELETE FROM geo_localitati WHERE localitate LIKE 'QAFLUX%'`;
  await sql.end();

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} verificări trecute, ${failed} eșuate`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
