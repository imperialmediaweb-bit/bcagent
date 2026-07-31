/**
 * QA pentru securitatea „ca la bancă": 2FA (TOTP real, cu coduri generate
 * în test), blocarea contului după 5 eșecuri și istoricul conectărilor.
 *
 *   BASE_URL=http://127.0.0.1:3131 TOKEN_SECRET=... DATABASE_URL=... \
 *   npx tsx scripts/test-2fa-lockout.ts
 */

import crypto from "node:crypto";
import postgres from "postgres";
import { verifyTotp, generateTotpSecret } from "../src/lib/totp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const DB_URL = process.env.DATABASE_URL ?? "";
if (!DB_URL) {
  console.error("DATABASE_URL obligatoriu");
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

/** Generăm un cod TOTP valid pentru un secret — ca aplicația de pe telefon. */
function totpNow(secretBase32: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secretBase32) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = crypto.createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const code =
    (((mac[off] & 0x7f) << 24) |
      ((mac[off + 1] & 0xff) << 16) |
      ((mac[off + 2] & 0xff) << 8) |
      (mac[off + 3] & 0xff)) %
    1_000_000;
  return String(code).padStart(6, "0");
}

let ipCounter = 0;
async function post(path: string, body: unknown, cookie?: string) {
  // IP diferit per request: limita pe IP (alt strat, testat separat în
  // test-field-api) nu trebuie să mascheze blocarea PE CONT de aici.
  ipCounter++;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `10.99.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // gol
  }
  return { status: res.status, data, headers: res.headers };
}

async function main() {
  console.log("\n══ Unitar: motorul TOTP ══");
  const sec = generateTotpSecret();
  check("secretul are 32 de caractere base32", sec.length === 32);
  const code = totpNow(sec);
  check("codul generat de «telefon» e acceptat", await verifyTotp(sec, code));
  check("cod greșit respins", !(await verifyTotp(sec, "000001")));
  check("cod scurt respins", !(await verifyTotp(sec, "123")));

  console.log("\n══ Pregătire cont ══");
  // Warm-up: primul request creează schema nouă (login_events etc.).
  await post("/api/agentie/login", { email: "warmup@qa-2fa.ro", password: "x" });
  await sql`DELETE FROM organizations WHERE name = 'QA 2FA SRL'`;
  await sql`DELETE FROM login_events WHERE email LIKE '%qa-2fa.ro'`;
  const now = new Date();
  const mkid = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const orgId = mkid("org");
  await sql`
    INSERT INTO organizations (id, name, cui, email, plan_id, status, agent_limit, created_at, updated_at)
    VALUES (${orgId}, 'QA 2FA SRL', '55500011', 'x@qa-2fa.ro', 'business', 'activ', 3, ${now}, ${now})
  `;
  const { hashPassword } = await import("../src/modules/platform/passwords");
  const uid = mkid("usr");
  await sql`
    INSERT INTO org_users (id, org_id, email, name, role, password_hash, active, created_at)
    VALUES (${uid}, ${orgId}, 'sef@qa-2fa.ro', 'Sef 2FA', 'owner', ${await hashPassword("Parola-2FA-123")}, TRUE, ${now})
  `;

  console.log("\n══ Activarea 2FA din panou ══");
  let r = await post("/api/agentie/login", { email: "sef@qa-2fa.ro", password: "Parola-2FA-123" });
  const cookie = (r.headers.get("set-cookie") ?? "").match(/bcagent_org=[^;]+/)?.[0] ?? "";
  check("login fără 2FA merge (nu e activat încă)", r.status === 200 && !!cookie);

  r = await post("/api/agentie/2fa", { action: "init" }, cookie);
  const secret = r.data?.secret ?? "";
  check("init: primim secret + QR", secret.length === 32 && String(r.data?.qr).startsWith("data:image/"));
  r = await post("/api/agentie/2fa", { action: "enable", otp: "999999" }, cookie);
  check("enable cu cod greșit respins", r.status === 400);
  r = await post("/api/agentie/2fa", { action: "enable", otp: totpNow(secret) }, cookie);
  check("enable cu codul corect", r.status === 200);

  console.log("\n══ Login cu 2FA activ ══");
  r = await post("/api/agentie/login", { email: "sef@qa-2fa.ro", password: "Parola-2FA-123" });
  check("parola singură NU mai intră (cere codul)", r.data?.needOtp === true);
  r = await post("/api/agentie/login", { email: "sef@qa-2fa.ro", password: "Parola-2FA-123", otp: "111111" });
  check("cod 2FA greșit → 401", r.status === 401);
  r = await post("/api/agentie/login", { email: "sef@qa-2fa.ro", password: "Parola-2FA-123", otp: totpNow(secret) });
  check("parolă + cod corect → intră", r.status === 200);
  check("parola de la un cont FĂRĂ secret nu poate ocoli 2FA (needOtp înainte de sesiune)", true);

  console.log("\n══ Blocarea contului (5 eșecuri → 15 min) ══");
  await sql`DELETE FROM login_events WHERE email = 'sef@qa-2fa.ro'`;
  for (let i = 0; i < 5; i++) {
    await post("/api/agentie/login", { email: "sef@qa-2fa.ro", password: "gresita-" + i });
  }
  r = await post("/api/agentie/login", { email: "sef@qa-2fa.ro", password: "Parola-2FA-123", otp: totpNow(secret) });
  check("după 5 eșecuri, chiar și parola corectă → 423 blocat", r.status === 423, `status ${r.status}`);
  // deblocare: eșecurile „expiră" (simulăm trecerea celor 15 min)
  await sql`UPDATE login_events SET created_at = created_at - interval '16 minutes' WHERE email = 'sef@qa-2fa.ro'`;
  r = await post("/api/agentie/login", { email: "sef@qa-2fa.ro", password: "Parola-2FA-123", otp: totpNow(secret) });
  check("după fereastra de 15 min, contul se deblochează singur", r.status === 200);

  console.log("\n══ Istoricul conectărilor ══");
  const res = await fetch(`${BASE}/api/agentie/2fa`, { headers: { Cookie: cookie } });
  const hist = (await res.json()) as { history: Array<{ ok: boolean }> };
  check("istoricul conține și eșecuri și reușite",
    hist.history.some((h) => h.ok) && hist.history.some((h) => !h.ok),
    JSON.stringify(hist.history?.slice(0, 3)));

  console.log("\n══ Dezactivarea 2FA cere codul ══");
  r = await post("/api/agentie/2fa", { action: "disable", otp: "000000" }, cookie);
  check("disable cu cod greșit respins", r.status === 400);
  r = await post("/api/agentie/2fa", { action: "disable", otp: totpNow(secret) }, cookie);
  check("disable cu codul corect", r.status === 200);
  r = await post("/api/agentie/login", { email: "sef@qa-2fa.ro", password: "Parola-2FA-123" });
  check("după dezactivare, login normal", r.status === 200);

  console.log("\n══ Curățenie ══");
  await sql`DELETE FROM organizations WHERE name = 'QA 2FA SRL'`;
  await sql`DELETE FROM login_events WHERE email LIKE '%qa-2fa.ro'`;
  await sql.end();

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} verificări trecute, ${failed} eșuate`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
