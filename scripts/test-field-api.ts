/**
 * QA de integrare pentru funcțiile de teren: rute, vizite, scadenți,
 * import clienți, match, geo — lovește serverul REAL (next start) și
 * verifică și baza de date după fiecare operație.
 *
 * Rulare (serverul pornit cu aceleași env-uri):
 *   BASE_URL=http://127.0.0.1:3113 \
 *   TOKEN_SECRET=... DATABASE_URL=postgres://... \
 *   pnpm dlx tsx scripts/test-field-api.ts
 *
 * Include intenționat și cazuri REle: payload corupt, rute străine,
 * stringuri de injecție, note uriașe, CUI-uri inventate.
 */

import crypto from "node:crypto";
import postgres from "postgres";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3113";
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

async function post(path: string, body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 100) };
  }
  return { status: res.status, data };
}

async function get(path: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 100) };
  }
  return { status: res.status, data };
}

async function main() {
  const TOK = mkToken("qa-1", "QA Unu");
  const TOK2 = mkToken("qa-2", "QA Doi");

  // Curățenie + seed determinist.
  await get(`/api/prospects?token=${TOK}&limit=1`); // declanșează ensureSchema
  await sql`DELETE FROM visits WHERE agent_id LIKE 'qa-%'`;
  await sql`DELETE FROM routes WHERE agent_id LIKE 'qa-%'`;
  await sql`DELETE FROM prospects WHERE cui LIKE '9%' AND length(cui) = 4`;
  await sql`
    INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, activ, telefon, status, assigned_agent) VALUES
      ('9001','QA MARKET S.R.L.','Str. A 1','RADAUTI','SV','4711',TRUE,'0740000001','nou',''),
      ('9002','SC QA BAR SRL','Str. B 2','RADAUTI','SV','5630',TRUE,'','nou',''),
      ('9003','QA VECHI SRL','Str. C 3','SUCEAVA','SV','4711',TRUE,'','client','QA Unu'),
      ('9004','QA RECENT SRL','Str. D 4','SUCEAVA','SV','4711',TRUE,'','client','QA Unu'),
      ('9005','QA STRAIN SRL','Str. E 5','SUCEAVA','SV','4711',TRUE,'','client','Altcineva'),
      ('9006','QA LIBER SRL','Str. F 6','SUCEAVA','SV','4711',TRUE,'','client','')
    ON CONFLICT (cui) DO UPDATE SET status = EXCLUDED.status,
      assigned_agent = EXCLUDED.assigned_agent, note = '', denumire = EXCLUDED.denumire
  `;
  // 9004 vizitat acum 2 zile (nu e scadent); 9003 vizitat acum 9 zile (scadent).
  await sql`
    INSERT INTO visits (agent_id, agent_name, cui, denumire, result, note, visited_at) VALUES
      ('qa-1','QA Unu','9004','QA RECENT SRL','gandeste','', NOW() - INTERVAL '2 days'),
      ('qa-1','QA Unu','9003','QA VECHI SRL','gandeste','', NOW() - INTERVAL '9 days')
  `;

  console.log("\n── Vizite: maparea rezultat → status ──");
  const cases: Array<[string, string, string]> = [
    ["gandeste", "9001", "contactat"],
    ["ne_suna", "9001", "contactat"],
    ["nu_vrea", "9001", "respins"],
    ["client", "9001", "client"],
  ];
  for (const [result, cui, expected] of cases) {
    const r = await post("/api/visits", { token: TOK, cui, denumire: "QA", result });
    const [row] = await sql`SELECT status FROM prospects WHERE cui = ${cui}`;
    check(
      `rezultat „${result}" → status „${expected}"`,
      r.status === 200 && row.status === expected,
      `http=${r.status} status=${row?.status}`,
    );
  }
  {
    const [before] = await sql`SELECT status FROM prospects WHERE cui = '9002'`;
    await post("/api/visits", { token: TOK, cui: "9002", result: "inchis" });
    const [after] = await sql`SELECT status FROM prospects WHERE cui = '9002'`;
    check("rezultatul inchis NU schimbă statusul", before.status === after.status);
  }
  {
    const r = await post("/api/visits", { token: TOK, cui: "9001", result: "hacked" });
    check("rezultat inventat → 400", r.status === 400);
    const r2 = await post("/api/visits", { token: TOK, result: "client" });
    check("fără CUI → 400", r2.status === 400);
    const r3 = await post("/api/visits", { token: "tok.fals", cui: "9001", result: "client" });
    check("token fals → 401", r3.status === 401);
  }
  {
    // Nota se limitează la 1000 și se lipește de prospect.
    const huge = "x".repeat(5000);
    await post("/api/visits", { token: TOK, cui: "9002", result: "gandeste", note: huge });
    const [v] = await sql`
      SELECT length(note) AS len FROM visits
      WHERE cui = '9002' ORDER BY id DESC LIMIT 1
    `;
    check("nota uriașă e tăiată la 1000", Number(v.len) === 1000, `len=${v.len}`);
    const [p] = await sql`SELECT note FROM prospects WHERE cui = '9002'`;
    check("nota vizitei ajunge pe firmă", p.note.length > 0);
  }
  {
    // Alocarea automată nu fură firma altui agent.
    await sql`UPDATE prospects SET assigned_agent = 'Altcineva' WHERE cui = '9002'`;
    await post("/api/visits", { token: TOK, cui: "9002", result: "gandeste" });
    const [p] = await sql`SELECT assigned_agent FROM prospects WHERE cui = '9002'`;
    check("vizita NU fură firma alocată altcuiva", p.assigned_agent === "Altcineva");
  }

  console.log("\n── Scadenți (vizita săptămânală) ──");
  {
    const r = await get(`/api/visits?token=${TOK}&due=1`);
    const names = (r.data.due ?? []).map((d: any) => d.cui);
    check("clientul vizitat acum 9 zile E scadent", names.includes("9003"));
    check("clientul vizitat acum 2 zile NU e scadent", !names.includes("9004"));
    check("clientul altui agent NU apare", !names.includes("9005"));
    check("clientul nealocat APARE (îl poate lua oricine)", names.includes("9006"));
    const idx3 = names.indexOf("9003");
    const idx6 = names.indexOf("9006");
    check(
      "niciodată-vizitatul e înaintea celui vizitat demult",
      idx6 !== -1 && (idx3 === -1 || idx6 < idx3),
    );
  }

  console.log("\n── Rute ──");
  const stops = [
    { cui: "9001", denumire: "QA MARKET", adresa: "Str. A 1", localitate: "RADAUTI", telefon: "" },
    { cui: "9002", denumire: "QA BAR", adresa: "Str. B 2", localitate: "RADAUTI", telefon: "" },
  ];
  let routeId = "";
  {
    const r = await post("/api/routes", { token: TOK, name: "QA Luni", day: "luni", stops });
    routeId = r.data.id;
    check("ruta se salvează", r.status === 200 && !!routeId);
    const r2 = await post("/api/routes", {
      token: TOK, id: routeId, name: "QA Luni v2", day: "marti", stops,
    });
    check("update pe același id nu duplică", r2.status === 200);
    const list = await get(`/api/routes?token=${TOK}`);
    const mine = (list.data.routes ?? []).filter((x: any) => x.name.startsWith("QA"));
    check("lista are exact 1 rută (actualizată)", mine.length === 1 && mine[0].name === "QA Luni v2");
  }
  {
    const r = await post("/api/routes", { token: TOK2, id: routeId, name: "FURATA", stops });
    check("ruta altcuiva nu poate fi suprascrisă → 403", r.status === 403);
    const del = await fetch(`${BASE}/api/routes?token=${TOK2}&id=${routeId}`, { method: "DELETE" });
    const still = await get(`/api/routes?token=${TOK}`);
    check(
      "ștergerea de către alt agent e no-op",
      del.status === 200 && (still.data.routes ?? []).some((x: any) => x.id === routeId),
    );
  }
  {
    const r = await post("/api/routes", { token: TOK, name: "Goala", stops: [] });
    check("rută fără opriri → 400", r.status === 400);
    const r2 = await post("/api/routes", { token: TOK, name: "", stops });
    check("rută fără nume → 400", r2.status === 400);
    const many = Array.from({ length: 60 }, (_, i) => ({
      cui: `90${String(i).padStart(2, "0")}`, denumire: `F${i}`, adresa: "", localitate: "", telefon: "",
    }));
    const r3 = await post("/api/routes", { token: TOK, name: "QA Multe", day: "zz-invalid", stops: many });
    const list = await get(`/api/routes?token=${TOK}`);
    const multe = (list.data.routes ?? []).find((x: any) => x.name === "QA Multe");
    check("peste 40 de opriri → tăiate la 40", r3.status === 200 && multe.stops.length === 40);
    check("zi invalidă → stocată ca fără zi", multe.day === "");
    const bad = await post("/api/routes", {
      token: TOK, name: "QA Rea",
      stops: [{ cui: "abc'; DROP TABLE routes;--", denumire: "X", adresa: "", localitate: "", telefon: "" }],
    });
    check("opriri cu CUI ne-numeric → respinse (rămâne goală → 400)", bad.status === 400);
    const [t] = await sql`SELECT COUNT(*)::int AS n FROM routes`;
    check("tabela routes există în continuare (fără injecție)", t.n >= 1);
  }

  console.log("\n── Import clienți din vânzări ──");
  {
    await sql`UPDATE prospects SET status = 'nou', assigned_agent = '' WHERE cui IN ('9001','9002')`;
    const r = await post("/api/prospects/import-clients", {
      token: TOK,
      clients: [
        { name: "QA MARKET SRL", agent: "QA Unu" },
        { name: "Qa Bar", agent: "QA Doi" },
        { name: "Firma Inexistentă Total SRL", agent: "X" },
        { name: "a'; DELETE FROM prospects;--bcd", agent: "X" },
      ],
    });
    const matchedCuis = (r.data.matched ?? []).map((m: any) => m.cui).sort();
    check("potrivește variante de formă juridică", matchedCuis.join(",") === "9001,9002");
    check("nepotriviții sunt raportați", (r.data.unmatched ?? []).length === 2);
    check("firmele au trecut pe client", r.data.updated === 2);
    const [p1] = await sql`SELECT status, assigned_agent FROM prospects WHERE cui = '9001'`;
    check("statusul + agentul s-au scris", p1.status === "client" && p1.assigned_agent === "QA Unu");
    const [cnt] = await sql`SELECT COUNT(*)::int AS n FROM prospects WHERE cui LIKE '9%' AND length(cui) = 4`;
    check("injecția din nume nu a șters nimic", cnt.n === 6);

    const again = await post("/api/prospects/import-clients", {
      token: TOK,
      clients: [{ name: "QA MARKET SRL", agent: "Alt Agent Nou" }],
    });
    const [p2] = await sql`SELECT assigned_agent FROM prospects WHERE cui = '9001'`;
    check("re-importul e idempotent", again.status === 200);
    check("re-importul NU fură alocarea existentă", p2.assigned_agent === "QA Unu");
    check("re-importul marchează era-deja-client", again.data.matched[0].wasClient === true);

    const dry = await post("/api/prospects/import-clients", {
      token: TOK, dryRun: true,
      clients: [{ name: "SC QA BAR SRL", agent: "Y" }],
    });
    check("dryRun nu scrie nimic", dry.data.updated === 0 && dry.data.dryRun === true);
  }

  console.log("\n── Autorizare pe toate endpointurile noi ──");
  for (const [name, res] of [
    ["routes GET", await get(`/api/routes?token=fals`)],
    ["visits GET", await get(`/api/visits?token=fals`)],
    ["match POST", await post("/api/prospects/match", { token: "fals", clients: ["x"] })],
    ["import-clients POST", await post("/api/prospects/import-clients", { token: "fals", clients: [] })],
    ["geo GET", await get(`/api/prospects/geo?token=fals&judet=SV`)],
  ] as const) {
    check(`${name} fără token valid → 401`, (res as any).status === 401);
  }
  {
    const expired = mkToken("qa-1", "QA Unu", -60);
    const r = await get(`/api/routes?token=${expired}`);
    check("token expirat → 401", r.status === 401);
  }

  // Curățenie finală.
  await sql`DELETE FROM visits WHERE agent_id LIKE 'qa-%'`;
  await sql`DELETE FROM routes WHERE agent_id LIKE 'qa-%'`;
  await sql`DELETE FROM prospects WHERE cui LIKE '9%' AND length(cui) = 4`;
  await sql.end();

  console.log(
    `\n${failed === 0 ? "✅" : "❌"} ${passed} verificări trecute, ${failed} eșuate\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
